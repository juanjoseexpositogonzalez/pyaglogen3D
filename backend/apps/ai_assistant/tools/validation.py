"""Argument validation for AI Assistant tools.

Provides JSON Schema-based validation for tool arguments.
"""

from typing import Any

import jsonschema
from jsonschema.exceptions import ValidationError as JsonSchemaValidationError


class ValidationError(Exception):
    """Raised when tool arguments fail validation."""

    def __init__(
        self,
        message: str,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        """Initialize validation error.

        Args:
            message: User-friendly error message.
            errors: List of detailed validation errors.
        """
        super().__init__(message)
        self.message = message
        self.errors = errors or []


def validate_arguments(
    schema: dict[str, Any],
    arguments: dict[str, Any],
) -> tuple[bool, list[str]]:
    """Validate arguments against a JSON Schema.

    Args:
        schema: JSON Schema to validate against.
        arguments: The arguments to validate.

    Returns:
        Tuple of (is_valid, error_messages).
        error_messages is empty if validation passes.
    """
    errors: list[str] = []

    try:
        jsonschema.validate(instance=arguments, schema=schema)
        return True, []
    except JsonSchemaValidationError as e:
        # Extract user-friendly error message
        if e.validator == "required":
            # Missing required field
            missing_field = e.message.split("'")[1]
            errors.append(f"Missing required parameter: {missing_field}")
        elif e.validator == "type":
            # Wrong type
            field_path = ".".join(str(p) for p in e.path) or "input"
            expected_type = e.validator_value
            errors.append(f"Invalid type for '{field_path}': expected {expected_type}")
        elif e.validator == "enum":
            # Invalid enum value
            field_path = ".".join(str(p) for p in e.path) or "input"
            allowed_values = e.validator_value
            errors.append(
                f"Invalid value for '{field_path}': must be one of {allowed_values}"
            )
        elif e.validator in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"):
            # Numeric range error
            field_path = ".".join(str(p) for p in e.path) or "input"
            errors.append(f"Value out of range for '{field_path}': {e.message}")
        elif e.validator in ("minLength", "maxLength"):
            # String length error
            field_path = ".".join(str(p) for p in e.path) or "input"
            errors.append(f"Invalid length for '{field_path}': {e.message}")
        elif e.validator in ("minItems", "maxItems"):
            # Array length error
            field_path = ".".join(str(p) for p in e.path) or "input"
            errors.append(f"Invalid array length for '{field_path}': {e.message}")
        else:
            # Generic error
            errors.append(e.message)

        return False, errors


def validate_and_raise(
    schema: dict[str, Any],
    arguments: dict[str, Any],
) -> None:
    """Validate arguments and raise ValidationError if invalid.

    Args:
        schema: JSON Schema to validate against.
        arguments: The arguments to validate.

    Raises:
        ValidationError: If validation fails.
    """
    is_valid, errors = validate_arguments(schema, arguments)
    if not is_valid:
        raise ValidationError(
            message="; ".join(errors),
            errors=[{"message": e} for e in errors],
        )


def format_validation_error(errors: list[str]) -> str:
    """Format validation errors for user display.

    Args:
        errors: List of error messages.

    Returns:
        Formatted error string.
    """
    if len(errors) == 1:
        return errors[0]
    return "Multiple validation errors:\n" + "\n".join(f"  - {e}" for e in errors)
