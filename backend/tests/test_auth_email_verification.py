"""Tests for email verification delivery responses."""

import logging

from django.contrib.auth import get_user_model

from apps.accounts.models import EmailVerificationToken

User = get_user_model()


class TestRegisterEmailVerification:
    """Tests for registration email delivery reporting."""

    def test_register_reports_sent_verification_email(self, api_client, db, mocker):
        mock_send_mail = mocker.patch("apps.accounts.views.send_mail", return_value=1)

        response = api_client.post(
            "/api/v1/auth/register/",
            {
                "email": "new-user@example.com",
                "password": "StrongPassword123!",
                "password_confirm": "StrongPassword123!",
                "first_name": "New",
                "last_name": "User",
            },
            format="json",
        )

        assert response.status_code == 201, response.data
        assert response.data["verification_email_status"] == "sent"
        assert "Please check your email" in response.data["message"]
        assert mock_send_mail.called is True
        assert EmailVerificationToken.objects.filter(
            user__email="new-user@example.com"
        ).exists()

    def test_register_reports_failed_verification_email(
        self, api_client, db, mocker, caplog
    ):
        mocker.patch(
            "apps.accounts.views.send_mail",
            side_effect=RuntimeError("smtp unavailable"),
        )

        with caplog.at_level(logging.ERROR):
            response = api_client.post(
                "/api/v1/auth/register/",
                {
                    "email": "broken-mail@example.com",
                    "password": "StrongPassword123!",
                    "password_confirm": "StrongPassword123!",
                    "first_name": "Broken",
                    "last_name": "Mail",
                },
                format="json",
            )

        assert response.status_code == 201, response.data
        assert response.data["verification_email_status"] == "failed"
        assert "could not send the verification email" in response.data["message"]
        assert User.objects.filter(email="broken-mail@example.com").exists()
        assert "Failed to send verification email during registration" in caplog.text


class TestResendEmailVerification:
    """Tests for resend email delivery reporting."""

    def test_resend_reports_sent_verification_email(self, api_client, db, mocker):
        user = User.objects.create_user(
            email="pending@example.com",
            password="StrongPassword123!",
        )
        mock_send_mail = mocker.patch("apps.accounts.views.send_mail", return_value=1)

        response = api_client.post(
            "/api/v1/auth/resend-verification/",
            {"email": user.email},
            format="json",
        )

        assert response.status_code == 200, response.data
        assert response.data["verification_email_status"] == "sent"
        assert mock_send_mail.called is True
        assert EmailVerificationToken.objects.filter(user=user, used=False).count() == 1

    def test_resend_reports_failed_verification_email(
        self, api_client, db, mocker, caplog
    ):
        user = User.objects.create_user(
            email="resend-failure@example.com",
            password="StrongPassword123!",
        )
        mocker.patch(
            "apps.accounts.views.send_mail",
            side_effect=RuntimeError("smtp unavailable"),
        )

        with caplog.at_level(logging.ERROR):
            response = api_client.post(
                "/api/v1/auth/resend-verification/",
                {"email": user.email},
                format="json",
            )

        assert response.status_code == 503, response.data
        assert response.data["verification_email_status"] == "failed"
        assert "could not send the verification email" in response.data["message"]
        assert EmailVerificationToken.objects.filter(user=user, used=False).count() == 1
        assert "Failed to send verification email during resend" in caplog.text

    def test_resend_keeps_unknown_status_for_missing_email(self, api_client, db):
        response = api_client.post(
            "/api/v1/auth/resend-verification/",
            {"email": "missing@example.com"},
            format="json",
        )

        assert response.status_code == 200, response.data
        assert response.data["verification_email_status"] == "unknown"
