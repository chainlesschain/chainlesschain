"""
FileIndexer._collect_files tests.

Regression (this fix): extension matching was case-SENSITIVE against the
all-lowercase TEXT_EXTENSIONS, so files with uppercase extensions (README.MD,
Query.SQL — common on Windows/macOS) were silently skipped from indexing. Now
matched case-insensitively. Also covers skip-dirs, extension filtering, size
cap, file_types override, and missing root.

file_indexer imports qdrant at module top (broken/heavy here), so stub it to
reach the pure file-walk logic; _collect_files uses a real temp dir.
"""
import os
import sys
import types
import tempfile
import shutil


def _stub():
    if "qdrant_client" not in sys.modules:
        qc = types.ModuleType("qdrant_client")
        qm = types.ModuleType("qdrant_client.models")
        qm.Filter = qm.FieldCondition = qm.MatchValue = object
        qc.models = qm
        sys.modules["qdrant_client"] = qc
        sys.modules["qdrant_client.models"] = qm
    if "src.rag.rag_engine" not in sys.modules:
        rg = types.ModuleType("src.rag.rag_engine")
        rg.RAGEngine = object
        sys.modules["src.rag.rag_engine"] = rg


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
_stub()
from src.indexing.file_indexer import FileIndexer


def fi():
    return FileIndexer.__new__(FileIndexer)


def _mkfile(d, rel, content="x"):
    p = os.path.join(d, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content)
    return p


class TestCollectFiles:
    def setup_method(self):
        self.d = tempfile.mkdtemp(prefix="fi-collect-")

    def teardown_method(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def _names(self, file_types=None, max_size=10_000_000):
        return sorted(p.name for p in fi()._collect_files(self.d, file_types, max_size))

    def test_case_insensitive_extensions(self):
        for n in ["readme.md", "NOTES.MD", "Query.SQL", "code.py", "App.JSX"]:
            _mkfile(self.d, n)
        got = self._names()
        # Regression: uppercase-extension files must be included.
        assert "NOTES.MD" in got
        assert "Query.SQL" in got
        assert "App.JSX" in got
        assert "readme.md" in got and "code.py" in got

    def test_skips_special_directories(self):
        _mkfile(self.d, "keep.js")
        _mkfile(self.d, os.path.join("node_modules", "dep.js"))
        _mkfile(self.d, os.path.join("src", "__pycache__", "x.py"))
        got = self._names()
        assert "keep.js" in got
        assert "dep.js" not in got
        assert "x.py" not in got

    def test_filters_by_extension(self):
        _mkfile(self.d, "doc.md")
        _mkfile(self.d, "data.xyz")  # not a known text extension
        got = self._names()
        assert "doc.md" in got
        assert "data.xyz" not in got

    def test_size_cap(self):
        _mkfile(self.d, "small.txt", "ab")
        _mkfile(self.d, "big.txt", "a" * 100)
        got = self._names(max_size=10)
        assert "small.txt" in got
        assert "big.txt" not in got

    def test_file_types_override_is_case_insensitive(self):
        _mkfile(self.d, "a.js")
        _mkfile(self.d, "b.JS")
        _mkfile(self.d, "c.py")
        got = self._names(file_types=["JS"])  # uppercase request
        assert got == ["a.js", "b.JS"]  # only js (either case), not py

    def test_missing_root_returns_empty(self):
        assert fi()._collect_files(os.path.join(self.d, "nope"), None, 10) == []
