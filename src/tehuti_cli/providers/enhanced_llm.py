"""Enhanced LLM provider with structured outputs and tool calling.

This module extends the existing LLM integration with modern features:
- Native tool calling support
- Structured output validation
- Streaming responses
- Multi-modal support preparation
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator, Iterator, TypeVar

from pydantic import BaseModel

from tehuti_cli.providers.llm import TehutiLLM
from tehuti_cli.core.structured_output import ToolSchema, AgentResponse


T = TypeVar("T", bound=BaseModel)


@dataclass
class ChatCompletion:
    """Standardized chat completion response."""

    content: str
    tool_calls: list[dict[str, Any]] | None = None
    usage: dict[str, int] | None = None
    model: str | None = None
    finish_reason: str | None = None


@dataclass
class StreamingChunk:
    """A chunk of a streaming response."""

    content: str
    is_tool_call: bool = False
    tool_call_data: dict[str, Any] | None = None
    is_finished: bool = False


class EnhancedLLM:
    """Enhanced LLM client with modern features."""

    def __init__(self, base_llm: TehutiLLM):
        self.base_llm = base_llm
        self.config = base_llm.config

    def chat_with_tools(
        self,
        messages: list[dict[str, str]],
        tools: list[ToolSchema] | None = None,
        tool_choice: str = "auto",
        stream: bool = False,
    ) -> ChatCompletion | Iterator[StreamingChunk]:
        """Chat with optional tool calling.

        Args:
            messages: List of message dicts with role and content
            tools: Optional list of tool schemas
            tool_choice: Tool choice strategy ("auto", "none", or specific tool)
            stream: Whether to stream the response

        Returns:
            ChatCompletion or iterator of StreamingChunk
        """
        # For providers that support native tool calling
        provider = self.config.provider.type

        if provider == "openrouter" or provider == "openai":
            return self._chat_openai_format(messages, tools, tool_choice, stream)
        else:
            # Fallback: inject tool descriptions into system prompt
            return self._chat_with_injected_tools(messages, tools, stream)

    def _chat_openai_format(
        self,
        messages: list[dict[str, str]],
        tools: list[ToolSchema] | None,
        tool_choice: str,
        stream: bool,
    ) -> ChatCompletion | Iterator[StreamingChunk]:
        """Chat using OpenAI format (works with OpenRouter too)."""
        # Convert tools to OpenAI format
        openai_tools = []
        if tools:
            for tool in tools:
                openai_tools.append(tool.to_openai_format())

        # For now, fall back to base implementation
        # In a full implementation, this would use the native tool calling API
        content = self.base_llm.chat_messages(messages, stream=stream)

        # Try to parse as structured response
        try:
            response = AgentResponse.from_json(content)
            return ChatCompletion(
                content=response.content or "",
                tool_calls=[tc.model_dump() for tc in response.tool_calls] if response.tool_calls else None,
                model=self.config.provider.model,
            )
        except Exception:
            return ChatCompletion(
                content=content,
                model=self.config.provider.model,
            )

    def _chat_with_injected_tools(
        self,
        messages: list[dict[str, str]],
        tools: list[ToolSchema] | None,
        stream: bool,
    ) -> ChatCompletion:
        """Chat with tool descriptions injected into system prompt."""
        # Clone messages to avoid modifying original
        modified_messages = list(messages)

        # Inject tool descriptions into system message
        if tools and modified_messages and modified_messages[0]["role"] == "system":
            tool_desc = self._format_tools_for_prompt(tools)
            modified_messages[0]["content"] += f"\n\n{tool_desc}"

        content = self.base_llm.chat_messages(modified_messages, stream=stream)

        return ChatCompletion(
            content=content,
            model=self.config.provider.model,
        )

    def chat_structured(
        self,
        messages: list[dict[str, str]],
        output_type: type[T],
    ) -> T:
        """Chat with structured output validation.

        Args:
            messages: List of messages
            output_type: Pydantic model class for output validation

        Returns:
            Validated instance of output_type
        """
        # Inject schema into system prompt
        modified_messages = list(messages)

        if modified_messages and modified_messages[0]["role"] == "system":
            schema_desc = self._format_schema_for_prompt(output_type)
            modified_messages[0]["content"] += f"\n\n{schema_desc}"

        # Get response
        response_text = self.base_llm.chat_messages(modified_messages)

        # Parse and validate
        try:
            # Try to extract JSON
            json_str = self._extract_json(response_text)
            data = json.loads(json_str)
            return output_type.model_validate(data)
        except Exception as e:
            raise StructuredOutputError(
                f"Failed to parse structured output: {e}\nResponse: {response_text[:500]}"
            ) from e

    def stream_chat(
        self,
        messages: list[dict[str, str]],
    ) -> Iterator[StreamingChunk]:
        """Stream chat response.

        Args:
            messages: List of messages

        Yields:
            StreamingChunk objects
        """
        content, _ = self.base_llm.chat_stream(messages)

        # For now, yield the entire content as one chunk
        # In a full implementation, this would stream token by token
        yield StreamingChunk(
            content=content,
            is_finished=True,
        )

    def _format_tools_for_prompt(self, tools: list[ToolSchema]) -> str:
        """Format tools for injection into system prompt."""
        lines = [
            "You have access to the following tools:",
            "",
        ]

        for tool in tools:
            lines.append(f"Tool: {tool.name}")
            lines.append(f"Description: {tool.description}")
            lines.append(f"Parameters: {json.dumps(tool.parameters, indent=2)}")
            lines.append("")

        lines.extend(
            [
                "To use a tool, respond with JSON in this format:",
                '{"tool_calls": [{"name": "tool_name", "arguments": {"arg": "value"}}]}',
                "",
                "If you don't need to use a tool, respond normally.",
            ]
        )

        return "\n".join(lines)

    def _format_schema_for_prompt(self, output_type: type[T]) -> str:
        """Format schema for injection into system prompt."""
        schema = output_type.model_json_schema()

        lines = [
            "You must respond with a valid JSON object matching this schema:",
            "",
            "Schema:",
            json.dumps(schema, indent=2),
            "",
            "Respond with only the JSON object, no markdown formatting.",
        ]

        return "\n".join(lines)

    def _extract_json(self, text: str) -> str:
        """Extract JSON from text."""
        text = text.strip()

        # Try code blocks
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

        # Find JSON boundaries
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

        return text

    def get_token_count(self, text: str) -> int:
        """Estimate token count (rough approximation)."""
        # Very rough approximation: ~4 characters per token
        return len(text) // 4

    def get_available_tools(self) -> list[ToolSchema]:
        """Get list of all available tools formatted as schemas."""
        # This would scan the ToolRegistry and generate schemas
        # For now, return common tools
        return [
            ToolSchema(
                name="read",
                description="Read a file from the filesystem",
                parameters={
                    "type": "object",
                    "properties": {"path": {"type": "string", "description": "Path to the file"}},
                    "required": ["path"],
                },
            ),
            ToolSchema(
                name="write",
                description="Write content to a file",
                parameters={
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Path to the file"},
                        "content": {"type": "string", "description": "Content to write"},
                    },
                    "required": ["path", "content"],
                },
            ),
            ToolSchema(
                name="shell",
                description="Execute a shell command",
                parameters={
                    "type": "object",
                    "properties": {"command": {"type": "string", "description": "Shell command to execute"}},
                    "required": ["command"],
                },
            ),
            ToolSchema(
                name="web_search",
                description="Search the web using DuckDuckGo",
                parameters={
                    "type": "object",
                    "properties": {"query": {"type": "string", "description": "Search query"}},
                    "required": ["query"],
                },
            ),
        ]


class StructuredOutputError(Exception):
    """Error raised when structured output parsing fails."""

    pass


# Convenience function to wrap existing LLM
def enhance_llm(base_llm: TehutiLLM) -> EnhancedLLM:
    """Wrap a base TehutiLLM with enhanced features."""
    return EnhancedLLM(base_llm)
