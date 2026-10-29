"""Encryption service for API keys.

Security Notes:
    - AI_ENCRYPTION_KEY must be set via environment variable or secrets manager
    - Never commit the encryption key to version control
    - Use a unique key per environment (dev, staging, production)
    - Rotate keys periodically and re-encrypt stored data when doing so
    - Generate keys using: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
"""
import logging

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings

logger = logging.getLogger(__name__)


class APIKeyEncryption:
    """Handles encryption/decryption of API keys using Fernet.

    Fernet guarantees that a message encrypted using it cannot be
    manipulated or read without the key.

    Security:
        The encryption key MUST be stored securely:
        - Use environment variables (recommended for development)
        - Use a secrets management service (recommended for production):
          AWS Secrets Manager, HashiCorp Vault, Google Secret Manager, etc.
        - Never hardcode the key or commit it to version control
    """

    def __init__(self, key: str | None = None) -> None:
        """Initialize encryption with a key.

        Args:
            key: Base64-encoded encryption key. If not provided,
                 uses AI_ENCRYPTION_KEY from settings.

        Raises:
            ValueError: If no encryption key is available or key is invalid.
        """
        encryption_key = key or getattr(settings, "AI_ENCRYPTION_KEY", "")

        if not encryption_key:
            raise ValueError(
                "AI_ENCRYPTION_KEY must be set in environment. "
                "Generate one with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )

        try:
            self.fernet = Fernet(encryption_key.encode())
        except Exception as e:
            raise ValueError(f"Invalid encryption key format: {e}")

    def encrypt(self, plain_text: str) -> str:
        """Encrypt a plain text string.

        Args:
            plain_text: The text to encrypt (e.g., API key).

        Returns:
            Base64-encoded encrypted string.

        Raises:
            ValueError: If plain_text is empty or None.
        """
        if not plain_text:
            raise ValueError(
                "Cannot encrypt empty or None value. "
                "API key must be provided."
            )

        encrypted = self.fernet.encrypt(plain_text.encode())
        return encrypted.decode()

    def decrypt(self, cipher_text: str) -> str:
        """Decrypt an encrypted string.

        Args:
            cipher_text: The encrypted text to decrypt.

        Returns:
            The original plain text.

        Raises:
            ValueError: If cipher_text is empty, None, or decryption fails.
        """
        if not cipher_text:
            raise ValueError(
                "Cannot decrypt empty or None value. "
                "Encrypted API key must be provided."
            )

        try:
            decrypted = self.fernet.decrypt(cipher_text.encode())
            return decrypted.decode()
        except InvalidToken:
            raise ValueError(
                "Failed to decrypt API key. The encryption key may have changed "
                "or the data was tampered with."
            )

    @staticmethod
    def generate_key() -> str:
        """Generate a new encryption key.

        Returns:
            A new base64-encoded Fernet key.
        """
        return Fernet.generate_key().decode()


def get_encryption_service() -> APIKeyEncryption:
    """Get the default encryption service instance.

    Returns:
        APIKeyEncryption instance configured with settings key.
    """
    return APIKeyEncryption()
