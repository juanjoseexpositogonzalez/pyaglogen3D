"""Custom adapters for django-allauth."""

from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter


class AccountAdapter(DefaultAccountAdapter):
    """Custom account adapter for email-only authentication."""

    def populate_username(self, request, user):
        """Skip username population since we use email-only auth."""
        # Our User model doesn't have a username field
        pass


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    """Custom social account adapter for OAuth logins."""

    def populate_user(self, request, sociallogin, data):
        """Populate user from social account data."""
        user = super().populate_user(request, sociallogin, data)

        # Set additional fields from OAuth data
        extra_data = sociallogin.account.extra_data

        # Set avatar URL if available
        if sociallogin.account.provider == "google":
            user.avatar_url = extra_data.get("picture", "")
            user.oauth_provider = "google"
            user.oauth_uid = extra_data.get("sub", "")
        elif sociallogin.account.provider == "github":
            user.avatar_url = extra_data.get("avatar_url", "")
            user.oauth_provider = "github"
            user.oauth_uid = str(extra_data.get("id", ""))

        # OAuth users have verified emails
        user.email_verified = True

        return user

    def save_user(self, request, sociallogin, form=None):
        """Save the user and mark email as verified for OAuth users."""
        user = super().save_user(request, sociallogin, form)
        user.email_verified = True
        user.save(update_fields=["email_verified"])
        return user
