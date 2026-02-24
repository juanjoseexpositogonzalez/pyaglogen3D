"""
Authentication views for PyAglogen3D.
"""

import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import EmailVerificationToken
from .serializers import (
    ChangePasswordSerializer,
    EmailVerificationSerializer,
    LoginSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    UserSerializer,
)

User = get_user_model()


def get_tokens_for_user(user) -> dict:
    """Generate JWT tokens for a user."""
    refresh = RefreshToken.for_user(user)
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
    }


class RegisterView(generics.CreateAPIView):
    """
    Register a new user account.

    Sends verification email after registration.
    """

    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]

    def create(self, request: Request, *args, **kwargs) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Send verification email
        self._send_verification_email(user)

        tokens = get_tokens_for_user(user)
        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": tokens,
                "message": "Registration successful. Please check your email to verify your account.",
            },
            status=status.HTTP_201_CREATED,
        )

    def _send_verification_email(self, user) -> None:
        """Send email verification link to user."""
        # Create verification token
        token = secrets.token_urlsafe(32)
        EmailVerificationToken.objects.create(
            user=user,
            token=token,
            expires_at=timezone.now() + timedelta(hours=24),
        )

        # Build verification URL
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        verify_url = f"{frontend_url}/auth/verify-email?token={token}"

        # Send email
        try:
            send_mail(
                subject="Verify your PyAglogen3D account",
                message=f"Click this link to verify your email: {verify_url}",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
        except Exception:
            pass  # Don't fail registration if email fails


class LoginView(APIView):
    """
    Authenticate user and return JWT tokens.
    """

    permission_classes = [AllowAny]
    serializer_class = LoginSerializer

    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate(
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )

        if not user:
            return Response(
                {"error": "Invalid email or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if not user.is_active:
            return Response(
                {"error": "This account has been deactivated."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        tokens = get_tokens_for_user(user)
        return Response(
            {
                "user": UserSerializer(user).data,
                "tokens": tokens,
            }
        )


class LogoutView(APIView):
    """
    Blacklist the refresh token to log out.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
        except Exception:
            pass  # Token might already be blacklisted or invalid

        return Response({"message": "Successfully logged out."})


class MeView(generics.RetrieveUpdateAPIView):
    """
    Get or update the current user's profile.
    """

    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class ChangePasswordView(APIView):
    """
    Change the current user's password.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save()

        return Response({"message": "Password changed successfully."})


class VerifyEmailView(APIView):
    """
    Verify user's email address using token.
    """

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = EmailVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        token = serializer.validated_data["token"]

        try:
            verification = EmailVerificationToken.objects.get(token=token, used=False)
        except EmailVerificationToken.DoesNotExist:
            return Response(
                {"error": "Invalid or expired verification token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if timezone.now() > verification.expires_at:
            return Response(
                {"error": "Verification token has expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Mark user as verified
        user = verification.user
        user.email_verified = True
        user.save()

        # Mark token as used
        verification.used = True
        verification.save()

        return Response({"message": "Email verified successfully."})


class ResendVerificationView(APIView):
    """
    Resend verification email to user.
    """

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"]

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Don't reveal if email exists
            return Response({"message": "If this email exists, a verification link will be sent."})

        if user.email_verified:
            return Response({"message": "Email is already verified."})

        # Invalidate old tokens
        EmailVerificationToken.objects.filter(user=user, used=False).update(used=True)

        # Create new token and send email
        token = secrets.token_urlsafe(32)
        EmailVerificationToken.objects.create(
            user=user,
            token=token,
            expires_at=timezone.now() + timedelta(hours=24),
        )

        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")
        verify_url = f"{frontend_url}/auth/verify-email?token={token}"

        try:
            send_mail(
                subject="Verify your PyAglogen3D account",
                message=f"Click this link to verify your email: {verify_url}",
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[user.email],
                fail_silently=True,
            )
        except Exception:
            pass

        return Response({"message": "If this email exists, a verification link will be sent."})


class OAuthCallbackView(APIView):
    """
    Handle OAuth callback and return JWT tokens.

    After successful OAuth login, this endpoint generates JWT tokens
    and redirects to the frontend with tokens in URL parameters.
    """

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        """
        Called by frontend to get JWT tokens after OAuth redirect.
        The user should be authenticated via session from allauth.
        """
        from django.shortcuts import redirect
        from urllib.parse import urlencode

        user = request.user
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:3000")

        if not user.is_authenticated:
            # Redirect to login with error
            return redirect(f"{frontend_url}/auth/login?error=oauth_failed")

        # Generate JWT tokens
        tokens = get_tokens_for_user(user)

        # Redirect to frontend with tokens
        params = urlencode({
            "access": tokens["access"],
            "refresh": tokens["refresh"],
        })
        return redirect(f"{frontend_url}/auth/oauth-callback?{params}")
