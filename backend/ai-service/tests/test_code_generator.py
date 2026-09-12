"""Deterministic governance and parsing tests for the legacy code assistants."""

import sys
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.code.code_generator import CodeGenerator
from src.code.code_reviewer import CodeReviewer
from src.code.code_refactorer import CodeRefactorer
from src.llm import llm_client
from src.llm.llm_client import MODEL_EGRESS_ERROR_CODE, ModelEgressGovernanceError


ASSISTANTS = (CodeGenerator, CodeReviewer, CodeRefactorer)


@pytest.mark.parametrize("assistant_type", ASSISTANTS)
def test_code_assistant_construction_never_initializes_a_provider(monkeypatch, assistant_type):
    get_client = Mock(side_effect=AssertionError("provider construction during startup"))
    monkeypatch.setattr(llm_client, "get_llm_client", get_client)

    assistant = assistant_type()

    assert assistant.llm_client is None
    get_client.assert_not_called()


class UnreadableContent:
    """Any prompt construction or content traversal is a regression."""

    def __str__(self):
        raise AssertionError("caller content was formatted before governance")

    def __format__(self, spec):
        raise AssertionError("caller content was formatted before governance")

    def __bool__(self):
        raise AssertionError("caller content was inspected before governance")

    def __iter__(self):
        raise AssertionError("caller content was enumerated before governance")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "assistant_type,method,kwargs",
    [
        (CodeGenerator, "generate", {}),
        (CodeGenerator, "generate", {"include_tests": True}),
        (CodeGenerator, "generate", {"context": UnreadableContent()}),
        (CodeGenerator, "_generate_tests", {}),
        (CodeReviewer, "review", {}),
        (CodeReviewer, "review", {"focus_areas": UnreadableContent()}),
        (CodeRefactorer, "refactor", {}),
        (CodeRefactorer, "refactor", {"refactor_type": "extract_function"}),
        (CodeRefactorer, "refactor", {"target": UnreadableContent()}),
        (CodeRefactorer, "explain", {}),
        (CodeRefactorer, "optimize", {}),
        (CodeRefactorer, "fix_bug", {}),
        (CodeRefactorer, "fix_bug", {"bug_description": UnreadableContent()}),
    ],
)
async def test_model_operations_reject_before_content_or_client_access(assistant_type, method, kwargs):
    assistant = assistant_type()
    # Even a previously assigned legacy client must never bypass the ingress.
    assistant.llm_client = Mock(generate=AsyncMock())

    with pytest.raises(ModelEgressGovernanceError) as raised:
        await getattr(assistant, method)(UnreadableContent(), "python", **kwargs)

    assert raised.value.code == MODEL_EGRESS_ERROR_CODE
    assert assistant.llm_client.mock_calls == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "description,language,kwargs",
    [
        ("", "python", {}),
        ("private code request", "unknown_language", {}),
        ("private code request", "javascript", {"include_tests": True, "include_comments": True}),
    ],
)
async def test_edge_inputs_cannot_turn_denial_into_a_success_result(description, language, kwargs):
    with pytest.raises(ModelEgressGovernanceError) as raised:
        await CodeGenerator().generate(description, language, **kwargs)
    assert raised.value.code == MODEL_EGRESS_ERROR_CODE


@pytest.mark.parametrize(
    "response,expected",
    [
        ("```python\nx = 1\n```", "x = 1"),
        ("  plain code  ", "plain code"),
        ("```\na\n```\ntext\n```\nb\n```", "a\nb"),
    ],
)
def test_local_code_extraction_remains_available(response, expected):
    assert CodeGenerator()._extract_code(response) == expected
