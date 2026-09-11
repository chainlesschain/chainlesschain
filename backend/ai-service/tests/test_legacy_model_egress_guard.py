"""Default-deny regression coverage for legacy AI-service model paths."""

import ast
from pathlib import Path

import pytest

from src.llm.llm_client import MODEL_EGRESS_ERROR_CODE, ModelEgressGovernanceError
from src.utils.stream_utils import (
    stream_custom_llm_chat,
    stream_ollama_chat,
    stream_openai_chat,
)


SERVICE_ROOT = Path(__file__).resolve().parents[1]
ENGINE_PATHS = (
    SERVICE_ROOT / "src" / "engines" / "data_engine.py",
    SERVICE_ROOT / "src" / "engines" / "doc_engine.py",
    SERVICE_ROOT / "src" / "engines" / "web_engine.py",
)
RAG_PATH = SERVICE_ROOT / "src" / "rag" / "rag_engine.py"


def _function(tree, name):
    return next(node for node in ast.walk(tree) if isinstance(node, ast.AsyncFunctionDef) and node.name == name)


def _first_effective_statement(function):
    statements = function.body
    if isinstance(statements[0], ast.Expr) and isinstance(statements[0].value, ast.Constant):
        statements = statements[1:]
    return statements[0]


def test_legacy_engines_do_not_construct_provider_clients_and_reject_public_generation():
    for path in ENGINE_PATHS:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
        assert not any(call.func.id in {"AsyncOpenAI", "get_llm_client"} for call in calls), path
        assert isinstance(_first_effective_statement(_function(tree, "generate")), ast.Raise), path

    web_tree = ast.parse(ENGINE_PATHS[2].read_text(encoding="utf-8"))
    assert isinstance(_first_effective_statement(_function(web_tree, "generate_stream")), ast.Raise)


def test_legacy_rag_engine_does_not_construct_embeddings_or_accept_content():
    tree = ast.parse(RAG_PATH.read_text(encoding="utf-8"))
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)]
    assert not any(call.func.id == "SentenceTransformer" for call in calls)
    for function_name in ("add_knowledge", "search", "enhanced_search"):
        assert isinstance(_first_effective_statement(_function(tree, function_name)), ast.Raise)


@pytest.mark.asyncio
async def test_legacy_stream_helpers_reject_before_their_clients_are_used():
    for stream in (stream_ollama_chat, stream_openai_chat, stream_custom_llm_chat):
        with pytest.raises(ModelEgressGovernanceError) as raised:
            if stream is stream_ollama_chat:
                await stream(model="canary", messages=[]).__anext__()
            elif stream is stream_openai_chat:
                await stream(client=object(), model="canary", messages=[]).__anext__()
            else:
                await stream(llm_client=object(), messages=[]).__anext__()
        assert raised.value.code == MODEL_EGRESS_ERROR_CODE


def test_legacy_chat_stream_endpoint_rejects_before_provider_selection():
    tree = ast.parse((SERVICE_ROOT / "main.py").read_text(encoding="utf-8"))
    function = _function(tree, "chat_stream")
    statements = function.body
    assert isinstance(statements[0], ast.Expr)  # endpoint docstring
    assert isinstance(statements[1], ast.ImportFrom)
    assert isinstance(statements[2], ast.Raise)
