"""
FileIndexer._chunk_text 分块大小正确性测试。

回归：current_size 只累加每行长度，从不计入 '\n'.join 插入的换行分隔符，导致
(1) 返回的 'size' 与实际 text 长度不符；(2) 分块超出 chunk_size，且误差随 overlap
跨块累积漂移。修复后维持不变式 current_size == len('\n'.join(current_chunk))。

file_indexer 顶层 `from qdrant_client.models import ...` 会拉起 portalocker→pywin32，
本机该 DLL 损坏导致整模块无法导入。_chunk_text 是纯函数、不依赖 qdrant，故在导入前
桩掉这些重依赖以隔离纯逻辑（不改变被测代码本身）。
"""
import os
import sys
import types


def _stub_heavy_imports():
    if "qdrant_client" not in sys.modules:
        m = types.ModuleType("qdrant_client")
        models = types.ModuleType("qdrant_client.models")
        models.Filter = models.FieldCondition = models.MatchValue = object
        m.models = models
        sys.modules["qdrant_client"] = m
        sys.modules["qdrant_client.models"] = models
    if "src.rag.rag_engine" not in sys.modules:
        rg = types.ModuleType("src.rag.rag_engine")
        rg.RAGEngine = object
        sys.modules["src.rag.rag_engine"] = rg


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
_stub_heavy_imports()

from src.indexing.file_indexer import FileIndexer


def make_indexer():
    # _chunk_text is pure; skip __init__ (which would build qdrant/rag clients).
    return FileIndexer.__new__(FileIndexer)


class TestChunkTextSize:
    def test_size_equals_text_length_no_overlap(self):
        idx = make_indexer()
        content = "\n".join(f"line{i:04d}" for i in range(60))
        chunks = idx._chunk_text(content, "test.txt", chunk_size=100, overlap=0)
        assert len(chunks) > 1  # must actually split
        for c in chunks:
            assert c["size"] == len(c["text"]), (c["index"], c["size"], len(c["text"]))

    def test_size_equals_text_length_with_overlap(self):
        idx = make_indexer()
        content = "\n".join("x" * 10 for _ in range(80))
        chunks = idx._chunk_text(content, "test.txt", chunk_size=90, overlap=30)
        assert len(chunks) > 2  # exercise overlap carry-over across many chunks
        for c in chunks:
            assert c["size"] == len(c["text"]), (c["index"], c["size"], len(c["text"]))

    def test_multiline_single_chunk_size_counts_newlines(self):
        idx = make_indexer()
        # 3 lines of 3 chars → joined "aaa\nbbb\nccc" = 11 chars (was reported as 9)
        content = "aaa\nbbb\nccc"
        chunks = idx._chunk_text(content, "test.txt", chunk_size=1000, overlap=0)
        assert len(chunks) == 1
        assert chunks[0]["text"] == content
        assert chunks[0]["size"] == len(content) == 11

    def test_chunks_do_not_drift_far_beyond_limit(self):
        idx = make_indexer()
        content = "\n".join("y" * 10 for _ in range(200))
        chunk_size = 100
        chunks = idx._chunk_text(content, "test.txt", chunk_size=chunk_size, overlap=20)
        # The triggering line is appended after the boundary check, so a chunk may
        # exceed chunk_size by at most one line (+ its separator); it must NOT drift
        # unboundedly as it did before the newline-accounting fix.
        for c in chunks:
            assert len(c["text"]) <= chunk_size + 11, (c["index"], len(c["text"]))
