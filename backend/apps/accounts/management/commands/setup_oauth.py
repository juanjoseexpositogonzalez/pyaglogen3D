"""
Management command to configure OAuth providers.

Usage:
    python manage.py setup_oauth

Reads credentials from environment variables:
    - GOOGLE_CLIENT_ID
    - GOOGLE_CLIENT_SECRET
    - GITHUB_CLIENT_ID
    - GITHUB_CLIENT_SECRET
"""

from django.core.management.base import BaseCommand
from django.contrib.sites.models import Site
from allauth.socialaccount.models import SocialApp
from decouple import config


class Command(BaseCommand):
    help = "Configure OAuth providers (Google, GitHub) from environment variables"

    def handle(self, *args, **options):
        # Get or create Site
        site, created = Site.objects.get_or_create(
            pk=1,
            defaults={"domain": "pyaglogen3d-api.fly.dev", "name": "PyAglogen3D"},
        )
        if not created:
            site.domain = "pyaglogen3d-api.fly.dev"
            site.name = "PyAglogen3D"
            site.save()
            self.stdout.write(f"Updated Site: {site.domain}")
        else:
            self.stdout.write(self.style.SUCCESS(f"Created Site: {site.domain}"))

        # Configure Google OAuth
        google_client_id = config("GOOGLE_CLIENT_ID", default="")
        google_client_secret = config("GOOGLE_CLIENT_SECRET", default="")

        if google_client_id and google_client_secret:
            app, created = SocialApp.objects.update_or_create(
                provider="google",
                defaults={
                    "name": "Google",
                    "client_id": google_client_id,
                    "secret": google_client_secret,
                },
            )
            app.sites.add(site)
            action = "Created" if created else "Updated"
            self.stdout.write(self.style.SUCCESS(f"{action} Google OAuth configuration"))
        else:
            self.stdout.write(
                self.style.WARNING(
                    "Skipping Google OAuth: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set"
                )
            )

        # Configure GitHub OAuth
        github_client_id = config("GITHUB_CLIENT_ID", default="")
        github_client_secret = config("GITHUB_CLIENT_SECRET", default="")

        if github_client_id and github_client_secret:
            app, created = SocialApp.objects.update_or_create(
                provider="github",
                defaults={
                    "name": "GitHub",
                    "client_id": github_client_id,
                    "secret": github_client_secret,
                },
            )
            app.sites.add(site)
            action = "Created" if created else "Updated"
            self.stdout.write(self.style.SUCCESS(f"{action} GitHub OAuth configuration"))
        else:
            self.stdout.write(
                self.style.WARNING(
                    "Skipping GitHub OAuth: GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set"
                )
            )

        self.stdout.write(self.style.SUCCESS("OAuth setup complete!"))
