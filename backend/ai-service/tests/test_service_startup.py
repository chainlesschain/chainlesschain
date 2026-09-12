"""Exercise the real FastAPI composition with legacy model egress denied."""

import asyncio
import importlib
import socket
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.llm.llm_client import MODEL_EGRESS_ERROR_CODE


@pytest.fixture(scope="module")
def service_client():
    # No engine/module substitutes: import the production composition and run
    # its ASGI lifespan. Network attempts fail and are counted even if caught.
    # Windows builds the event loop's internal socketpair over loopback TCP;
    # create that test-runner resource before monitoring application I/O.
    event_loop = asyncio.new_event_loop()
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("LLM_PROVIDER", "openai")
        patch.setenv("OPENAI_API_KEY", "startup-test-key-not-a-credential")
        connect = Mock(side_effect=AssertionError("startup/request attempted external I/O"))
        patch.setattr(socket.socket, "connect", connect)

        service = importlib.import_module("main")
        assert service.code_generator.llm_client is None
        assert service.code_reviewer.llm_client is None
        assert service.code_refactorer.llm_client is None
        with TestClient(
            service.app, backend_options={"loop_factory": lambda: event_loop}
        ) as client:
            yield client

        connect.assert_not_called()


def test_real_service_starts_and_serves_non_model_routes(service_client):
    root = service_client.get("/")
    assert root.status_code == 200
    assert root.json()["status"] == "running"

    health = service_client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert not any(health.json()["engines"].values())

    signaling = service_client.get("/api/signaling/stats")
    assert signaling.status_code == 200
    assert isinstance(signaling.json(), dict)

    rule_result = service_client.post(
        "/api/intent/classify", json={"text": "创建一个HTML网页"}
    )
    assert rule_result.status_code == 200
    assert rule_result.json()["project_type"] == "web"


@pytest.mark.parametrize(
    "route,payload",
    [
        ("generate", {"description": "private request", "language": "python"}),
        ("review", {"code": "private source", "language": "python"}),
        ("refactor", {"code": "private source", "language": "python"}),
        ("explain", {"code": "private source", "language": "python"}),
        ("fix-bug", {"code": "private source", "language": "python"}),
        ("generate-tests", {"code": "private source", "language": "python"}),
        ("optimize", {"code": "private source", "language": "python"}),
    ],
)
def test_code_routes_return_explicit_terminal_denial(service_client, route, payload):
    response = service_client.post("/api/code/" + route, json=payload)

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == MODEL_EGRESS_ERROR_CODE
    assert "private" not in response.text
    assert "tests" not in response.json()
    assert "explanation" not in response.json()


def test_stream_guard_uses_the_same_http_error_contract(service_client):
    response = service_client.post(
        "/api/chat/stream",
        json={"messages": [{"role": "user", "content": "private stream request"}]},
    )

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == MODEL_EGRESS_ERROR_CODE
    assert "private" not in response.text


def test_request_validation_remains_active(service_client):
    response = service_client.post("/api/code/generate", json={})
    assert response.status_code == 422
