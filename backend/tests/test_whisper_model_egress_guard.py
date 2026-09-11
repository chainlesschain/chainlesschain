"""Regression tests for the legacy Whisper default-deny boundary.

The services have heavyweight optional ML dependencies, so these tests provide
minimal import substitutes and assert the public endpoints reject before they
read an upload or invoke Whisper.
"""

import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path

from fastapi import HTTPException


REPO_ROOT = Path(__file__).resolve().parents[2]
SERVICE_PATHS = (
    REPO_ROOT / "backend" / "whisper-service" / "main.py",
    REPO_ROOT / "backend" / "whisper-local-server" / "whisper_local_server.py",
)
QUICK_TEST_PATH = REPO_ROOT / "backend" / "whisper-service" / "quick-test.py"


class _UnreadableUpload:
    filename = "canary.wav"

    def __init__(self):
        self.read_calls = 0

    async def read(self):
        self.read_calls += 1
        raise AssertionError("legacy Whisper boundary read user audio")


def _load_service(path: Path):
    whisper_calls = []
    whisper_module = types.ModuleType("whisper")
    whisper_module.load_model = lambda *args, **kwargs: whisper_calls.append((args, kwargs))

    torch_module = types.ModuleType("torch")
    torch_module.cuda = types.SimpleNamespace(is_available=lambda: False)

    multipart_module = types.ModuleType("python_multipart")
    multipart_module.__version__ = "0.0.13"
    prior_modules = {
        name: sys.modules.get(name)
        for name in ("whisper", "torch", "uvicorn", "python_multipart")
    }
    sys.modules["whisper"] = whisper_module
    sys.modules["torch"] = torch_module
    sys.modules["uvicorn"] = types.ModuleType("uvicorn")
    sys.modules["python_multipart"] = multipart_module
    try:
        module_name = f"whisper_egress_guard_{path.parent.name.replace('-', '_')}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module, whisper_calls
    finally:
        for name, prior in prior_modules.items():
            if prior is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = prior


class WhisperModelEgressGuardTest(unittest.TestCase):
    def test_legacy_whisper_endpoints_reject_before_audio_or_model_access(self):
        for path in SERVICE_PATHS:
            with self.subTest(service=path.parent.name):
                module, whisper_calls = _load_service(path)
                upload = _UnreadableUpload()
                parameters = {
                    "file": upload,
                    "model": "base",
                    "language": None,
                    "response_format": "json",
                    "temperature": 0.0,
                    "task": "transcribe",
                }
                if path.parent.name == "whisper-service":
                    parameters["initial_prompt"] = None
                else:
                    parameters["prompt"] = None

                with self.assertRaises(HTTPException) as raised:
                    asyncio.run(module.transcribe_audio(**parameters))

                self.assertEqual(raised.exception.status_code, 503)
                self.assertEqual(
                    raised.exception.detail["code"],
                    "CC_AGENT_EVOLUTION_INGRESS_FAILED",
                )
                self.assertEqual(upload.read_calls, 0)
                self.assertEqual(whisper_calls, [])

    def test_direct_model_load_is_also_default_denied(self):
        for path in SERVICE_PATHS:
            with self.subTest(service=path.parent.name):
                module, whisper_calls = _load_service(path)

                with self.assertRaises(HTTPException) as raised:
                    module.load_model("base")

                self.assertEqual(raised.exception.detail["code"], module.MODEL_EGRESS_ERROR_CODE)
                self.assertEqual(whisper_calls, [])

    def test_quick_test_cannot_bypass_service_governance(self):
        source = QUICK_TEST_PATH.read_text(encoding="utf-8")
        self.assertIn("CC_AGENT_EVOLUTION_INGRESS_FAILED", source)
        self.assertNotIn("whisper.load_model(", source)


if __name__ == "__main__":
    unittest.main()
