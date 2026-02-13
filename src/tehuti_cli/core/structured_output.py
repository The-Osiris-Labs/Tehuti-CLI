"""Structured output support for Tehuti agentic system.

This module provides Pydantic-based structured output validation and parsing,
enabling type-safe agent responses following 2025 best practices.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from typing import Any, Generic, TypeVar, get_type_hints

from pydantic import BaseModel, Field, ValidationError


T = TypeVar("T", bound=BaseModel)


class ToolCall(BaseModel):
    """Represents a tool call from the agent."""

    name: str = Field(description="Name of the tool to call")
    arguments: dict[str, Any] = Field(default_factory=dict, description="Arguments for the tool")
    call_id: str | None = Field(default=None, description="Unique identifier for this call")


class AgentThought(BaseModel):
    """Represents the agent's reasoning/thought process."""

    thought: str = Field(description="The agent's reasoning about what to do next")
    action: str | None = Field(default=None, description="The action decided upon")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="Confidence in the thought")


class ToolResultOutput(BaseModel):
    """Structured output for tool execution results."""

    success: bool = Field(description="Whether the tool execution succeeded")
    result: Any = Field(description="The result data from the tool")
    error: str | None = Field(default=None, description="Error message if failed")
    execution_time_ms: int | None = Field(default=None, description="Execution time in milliseconds")


class AgentResponse(BaseModel):
    """Standard agent response structure following ReAct pattern."""

    thought: str | None = Field(default=None, description="Agent's reasoning")
    tool_calls: list[ToolCall] = Field(default_factory=list, description="Tools to execute")
    content: str | None = Field(default=None, description="Final response content")
    should_continue: bool = Field(default=False, description="Whether to continue the agent loop")

    @classmethod
    def from_json(cls, json_str: str) -> AgentResponse:
        """Parse a JSON string into an AgentResponse."""
        try:
            data = cls._extract_json_dict(json_str)
            return cls.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as e:
            return cls(content=json_str, should_continue=False)

    @classmethod
    def from_text(cls, text: str) -> tuple[AgentResponse | None, str]:
        """Try to parse as structured response, fall back to text.

        Returns:
            Tuple of (parsed_response or None, fallback_content)
        """
        # Try to parse as JSON
        try:
            data = cls._extract_json_dict(text)
            return cls._parse_json_data(data), ""
        except (json.JSONDecodeError, ValidationError):
            pass

        # Look for JSON in markdown code blocks
        json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                return cls._parse_json_data(data), ""
            except (json.JSONDecodeError, ValidationError):
                pass

        # Return as plain content
        return None, text.strip()

    @classmethod
    def _parse_json_data(cls, data: dict[str, Any]) -> AgentResponse | None:
        """Parse JSON data into AgentResponse, handling shell format."""
        # Handle shell format: {"type":"tool","name":"shell","args":{"command":"ls"}}
        if data.get("type") == "tool":
            name = data.get("name", "")
            args = data.get("args", {})
            tool_calls = [ToolCall(name=name, arguments=args)]
            return cls(
                tool_calls=tool_calls,
                should_continue=True,
            )

        # Handle shell format: {"type":"final","content":"..."}
        if data.get("type") == "final":
            return cls(
                content=data.get("content", ""),
                should_continue=False,
            )

        # Handle AgentResponse format directly
        try:
            return cls.model_validate(data)
        except ValidationError:
            pass

        # Return None if we can't parse
        return None

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return self.model_dump_json(indent=2)

    @staticmethod
    def _extract_json_dict(text: str) -> dict[str, Any]:
        """Extract JSON dict from text."""
        text = text.strip()

        # Try code blocks first
        if "```json" in text:
            start = text.find("```json") + 7
            end = text.find("```", start)
            if end != -1:
                return json.loads(text[start:end].strip())

        if "```" in text:
            start = text.find("```") + 3
            end = text.find("```", start)
            if end != -1:
                return json.loads(text[start:end].strip())

        # Try raw JSON
        start = text.find("{")
        if start != -1:
            depth = 0
            for i, char in enumerate(text[start:], start):
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        return json.loads(text[start : i + 1])

        raise json.JSONDecodeError("No JSON found", text, 0)


class StructuredOutputParser(Generic[T]):
    """Parser for structured outputs with validation."""

    def __init__(self, output_type: type[T]):
        self.output_type = output_type

    def parse(self, text: str) -> T:
        """Parse text into the structured output type."""
        json_str = self._extract_json(text)

        try:
            data = json.loads(json_str)
            return self.output_type.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as e:
            raise StructuredOutputError(f"Failed to parse structured output: {e}") from e

    def parse_or_fallback(self, text: str) -> tuple[T | None, str]:
        """Parse as structured output, return (result, fallback_text)."""
        try:
            return self.parse(text), ""
        except StructuredOutputError:
            return None, text

    def _extract_json(self, text: str) -> str:
        """Extract JSON from text that may contain markdown or other content."""
        text = text.strip()

        # Try to find JSON in code blocks
        if "```json" in text:
            start = text.find("```json") + 7
            end = text.find("```", start)
            if end != -1:
                return text[start:end].strip()

        if "```" in text:
            start = text.find("```") + 3
            end = text.find("```", start)
            if end != -1:
                return text[start:end].strip()

        # Try to find JSON object boundaries
        start = text.find("{")
        if start != -1:
            depth = 0
            for i, char in enumerate(text[start:], start):
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        return text[start : i + 1]

        # Try array
        start = text.find("[")
        if start != -1:
            depth = 0
            for i, char in enumerate(text[start:], start):
                if char == "[":
                    depth += 1
                elif char == "]":
                    depth -= 1
                    if depth == 0:
                        return text[start : i + 1]

        return text


class StructuredOutputError(Exception):
    """Error raised when structured output parsing fails."""

    pass


class ToolSchema(BaseModel):
    """Schema definition for a tool following OpenAI function calling format."""

    name: str = Field(description="Tool name")
    description: str = Field(description="Tool description")
    parameters: dict[str, Any] = Field(description="JSON Schema for parameters")

    def to_openai_format(self) -> dict[str, Any]:
        """Convert to OpenAI function calling format."""
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
        }

    def to_anthropic_format(self) -> dict[str, Any]:
        """Convert to Anthropic tool format."""
        return {"name": self.name, "description": self.description, "input_schema": self.parameters}


def generate_tool_schema(func: callable, name: str | None = None) -> ToolSchema:
    """Generate a ToolSchema from a Python function.

    Args:
        func: The function to generate schema for
        name: Optional override for tool name

    Returns:
        ToolSchema for the function
    """
    import inspect
    from docstring_parser import parse

    # Get function signature
    sig = inspect.signature(func)
    type_hints = get_type_hints(func)

    # Parse docstring
    doc = parse(func.__doc__ or "")
    description = doc.short_description or f"Call {func.__name__}"

    # Build parameter schema
    properties = {}
    required = []

    param_docs = {p.arg_name: p.description for p in doc.params}

    for param_name, param in sig.parameters.items():
        if param_name == "self" or param_name == "cls":
            continue

        param_type = type_hints.get(param_name, str)
        param_schema = _python_type_to_json_schema(param_type)
        param_schema["description"] = param_docs.get(param_name, f"Parameter {param_name}")

        properties[param_name] = param_schema

        # Check if parameter is required
        if param.default is inspect.Parameter.empty:
            required.append(param_name)

    parameters = {"type": "object", "properties": properties, "required": required}

    return ToolSchema(name=name or func.__name__, description=description, parameters=parameters)


def _python_type_to_json_schema(py_type: type) -> dict[str, Any]:
    """Convert a Python type to JSON Schema type."""
    import typing

    # Handle Optional types
    origin = typing.get_origin(py_type)
    args = typing.get_args(py_type)

    if origin is typing.Union:
        # Handle Optional[X] which is Union[X, None]
        non_none_types = [t for t in args if t is not type(None)]
        if len(non_none_types) == 1:
            schema = _python_type_to_json_schema(non_none_types[0])
            schema["nullable"] = True
            return schema
        return {"type": ["string", "number", "boolean", "object", "array"]}

    if origin is list or origin is typing.List:
        item_type = args[0] if args else str
        return {"type": "array", "items": _python_type_to_json_schema(item_type)}

    if origin is dict or origin is typing.Dict:
        return {"type": "object"}

    # Handle basic types
    type_map = {
        str: {"type": "string"},
        int: {"type": "integer"},
        float: {"type": "number"},
        bool: {"type": "boolean"},
        list: {"type": "array"},
        dict: {"type": "object"},
        Any: {},
    }

    return type_map.get(py_type, {"type": "string"})


# Predefined output types for common use cases


class FileEditOutput(BaseModel):
    """Structured output for file edit operations."""

    file_path: str = Field(description="Path to the file to edit")
    old_string: str = Field(description="The string to replace")
    new_string: str = Field(description="The replacement string")
    explanation: str | None = Field(default=None, description="Explanation of the change")


class ShellCommandOutput(BaseModel):
    """Structured output for shell command execution."""

    command: str = Field(description="The shell command to execute")
    explanation: str | None = Field(default=None, description="Explanation of what the command does")
    timeout: int | None = Field(default=30, description="Timeout in seconds")


class AnalysisOutput(BaseModel):
    """Structured output for analysis tasks."""

    summary: str = Field(description="Brief summary of the analysis")
    findings: list[str] = Field(default_factory=list, description="Key findings")
    recommendations: list[str] = Field(default_factory=list, description="Recommendations")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class CodeReviewOutput(BaseModel):
    """Structured output for code review."""

    overall_assessment: str = Field(description="Overall assessment of the code")
    issues: list[dict[str, Any]] = Field(default_factory=list, description="Issues found")
    suggestions: list[str] = Field(default_factory=list, description="Improvement suggestions")
    security_concerns: list[str] = Field(default_factory=list, description="Security issues")
    approved: bool = Field(default=False, description="Whether the code is approved")
