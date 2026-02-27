"""Tests for tool argument validation."""

import pytest

from apps.ai_assistant.tools.validation import (
    ValidationError,
    format_validation_error,
    validate_and_raise,
    validate_arguments,
)


class TestValidateArguments:
    """Tests for validate_arguments function."""

    @pytest.fixture
    def simple_schema(self):
        """Simple schema with required string."""
        return {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
            },
            "required": ["name"],
        }

    @pytest.fixture
    def complex_schema(self):
        """Complex schema with multiple types."""
        return {
            "type": "object",
            "properties": {
                "count": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 100,
                },
                "algorithm": {
                    "type": "string",
                    "enum": ["DLA", "CCA", "BALLISTIC"],
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 5,
                },
            },
            "required": ["count", "algorithm"],
        }

    def test_valid_arguments(self, simple_schema):
        """Test validation with valid arguments."""
        is_valid, errors = validate_arguments(
            simple_schema,
            {"name": "test"},
        )
        assert is_valid is True
        assert errors == []

    def test_missing_required_field(self, simple_schema):
        """Test validation with missing required field."""
        is_valid, errors = validate_arguments(simple_schema, {})
        assert is_valid is False
        assert len(errors) == 1
        assert "name" in errors[0]

    def test_wrong_type(self, simple_schema):
        """Test validation with wrong type."""
        is_valid, errors = validate_arguments(
            simple_schema,
            {"name": 123},  # Should be string
        )
        assert is_valid is False
        assert "type" in errors[0].lower() or "string" in errors[0].lower()

    def test_enum_validation(self, complex_schema):
        """Test enum value validation."""
        # Valid enum value
        is_valid, _ = validate_arguments(
            complex_schema,
            {"count": 10, "algorithm": "DLA"},
        )
        assert is_valid is True

        # Invalid enum value
        is_valid, errors = validate_arguments(
            complex_schema,
            {"count": 10, "algorithm": "INVALID"},
        )
        assert is_valid is False
        assert "algorithm" in errors[0]

    def test_numeric_range_validation(self, complex_schema):
        """Test numeric range validation."""
        # Value too low
        is_valid, errors = validate_arguments(
            complex_schema,
            {"count": 0, "algorithm": "DLA"},
        )
        assert is_valid is False
        assert "count" in errors[0]

        # Value too high
        is_valid, errors = validate_arguments(
            complex_schema,
            {"count": 101, "algorithm": "DLA"},
        )
        assert is_valid is False
        assert "count" in errors[0]

    def test_array_length_validation(self, complex_schema):
        """Test array length validation."""
        # Too few items
        is_valid, errors = validate_arguments(
            complex_schema,
            {"count": 10, "algorithm": "DLA", "tags": []},
        )
        assert is_valid is False
        assert "tags" in errors[0]

        # Too many items
        is_valid, errors = validate_arguments(
            complex_schema,
            {"count": 10, "algorithm": "DLA", "tags": ["a", "b", "c", "d", "e", "f"]},
        )
        assert is_valid is False
        assert "tags" in errors[0]

    def test_optional_fields(self, complex_schema):
        """Test that optional fields can be omitted."""
        is_valid, _ = validate_arguments(
            complex_schema,
            {"count": 50, "algorithm": "CCA"},  # tags is optional
        )
        assert is_valid is True


class TestValidateAndRaise:
    """Tests for validate_and_raise function."""

    def test_raises_on_invalid(self):
        """Test that ValidationError is raised for invalid args."""
        schema = {
            "type": "object",
            "properties": {"x": {"type": "integer"}},
            "required": ["x"],
        }
        with pytest.raises(ValidationError) as exc_info:
            validate_and_raise(schema, {})

        assert "x" in exc_info.value.message

    def test_no_raise_on_valid(self):
        """Test that no exception is raised for valid args."""
        schema = {
            "type": "object",
            "properties": {"x": {"type": "integer"}},
            "required": ["x"],
        }
        # Should not raise
        validate_and_raise(schema, {"x": 42})


class TestFormatValidationError:
    """Tests for error formatting."""

    def test_single_error(self):
        """Test formatting single error."""
        result = format_validation_error(["Missing required field: name"])
        assert result == "Missing required field: name"

    def test_multiple_errors(self):
        """Test formatting multiple errors."""
        result = format_validation_error([
            "Missing required field: name",
            "Invalid type for count",
        ])
        assert "Multiple validation errors" in result
        assert "name" in result
        assert "count" in result
