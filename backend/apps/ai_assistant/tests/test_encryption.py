"""Tests for encryption service."""
import pytest
from unittest.mock import patch

from apps.ai_assistant.services.encryption import APIKeyEncryption


@pytest.fixture
def encryption_key():
    """Generate a test encryption key."""
    return APIKeyEncryption.generate_key()


@pytest.fixture
def encryption_service(encryption_key):
    """Create encryption service with test key."""
    return APIKeyEncryption(key=encryption_key)


class TestAPIKeyEncryption:
    """Tests for APIKeyEncryption class."""

    def test_encrypt_decrypt_roundtrip(self, encryption_service):
        """Test that encryption/decryption roundtrip works."""
        original = "sk-ant-api123456789"
        encrypted = encryption_service.encrypt(original)
        decrypted = encryption_service.decrypt(encrypted)
        assert decrypted == original

    def test_encrypt_with_special_characters(self, encryption_service):
        """Test encryption with special characters."""
        original = "sk-ant-!@#$%^&*()_+-=[]{}|;':\",./<>?"
        encrypted = encryption_service.encrypt(original)
        decrypted = encryption_service.decrypt(encrypted)
        assert decrypted == original

    def test_encrypt_with_unicode(self, encryption_service):
        """Test encryption with unicode characters."""
        original = "sk-ant-日本語テスト-🔐"
        encrypted = encryption_service.encrypt(original)
        decrypted = encryption_service.decrypt(encrypted)
        assert decrypted == original

    def test_encrypt_empty_string(self, encryption_service):
        """Test encryption of empty string."""
        encrypted = encryption_service.encrypt("")
        assert encrypted == ""
        decrypted = encryption_service.decrypt("")
        assert decrypted == ""

    def test_encrypted_value_differs_from_original(self, encryption_service):
        """Test that encrypted value is different from original."""
        original = "sk-ant-api123456789"
        encrypted = encryption_service.encrypt(original)
        assert encrypted != original

    def test_decrypt_with_wrong_key_fails(self, encryption_key):
        """Test that decryption with wrong key fails."""
        service1 = APIKeyEncryption(key=encryption_key)
        original = "sk-ant-api123456789"
        encrypted = service1.encrypt(original)

        # Create new service with different key
        new_key = APIKeyEncryption.generate_key()
        service2 = APIKeyEncryption(key=new_key)

        with pytest.raises(ValueError, match="Failed to decrypt"):
            service2.decrypt(encrypted)

    def test_generate_key_format(self):
        """Test that generated key has correct format."""
        key = APIKeyEncryption.generate_key()
        assert isinstance(key, str)
        assert len(key) == 44  # Base64 encoded 32 bytes

    def test_init_without_key_raises_error(self):
        """Test that init without key raises ValueError."""
        with patch("apps.ai_assistant.services.encryption.settings") as mock_settings:
            mock_settings.AI_ENCRYPTION_KEY = ""
            with pytest.raises(ValueError, match="AI_ENCRYPTION_KEY must be set"):
                APIKeyEncryption()

    def test_init_with_invalid_key_raises_error(self):
        """Test that init with invalid key raises ValueError."""
        with pytest.raises(ValueError, match="Invalid encryption key"):
            APIKeyEncryption(key="invalid-key-not-base64")
