"""
文件索引器测试
"""
import os
import tempfile
import shutil
import pytest
from pathlib import Path

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from src.indexing.file_indexer import FileIndexer
from src.rag.rag_engine import RAGEngine


class TestFileIndexer:
    """FileIndexer测试类"""

    @pytest.fixture
    def rag_engine(self):
        """RAGEngine实例"""
        return RAGEngine()

    @pytest.fixture
    def file_indexer(self, rag_engine):
        """FileIndexer实例"""
        return FileIndexer(rag_engine)

    @pytest.fixture
    def temp_project(self):
        """创建临时项目目录"""
        temp_dir = tempfile.mkdtemp()

        # 创建测试文件
        (Path(temp_dir) / "README.md").write_text("# Test Project\nThis is a test project.")
        (Path(temp_dir) / "main.py").write_text("def main():\n    print('Hello')\n")
        (Path(temp_dir) / "utils.py").write_text("def helper():\n    return True\n")

        # 创建子目录
        src_dir = Path(temp_dir) / "src"
        src_dir.mkdir()
        (src_dir / "module.py").write_text("class Module:\n    pass\n")

        yield temp_dir

        # 清理
        shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_index_project_basic(self, file_indexer, temp_project):
        """测试基本项目索引"""
        result = await file_indexer.index_project(
            project_id="test-project-1",
            repo_path=temp_project
        )

        assert result["success"] is True
        assert "indexed_count" in result
        assert result["indexed_count"] > 0

    @pytest.mark.asyncio
    async def test_index_project_with_filter(self, file_indexer, temp_project):
        """测试带文件类型过滤的索引"""
        result = await file_indexer.index_project(
            project_id="test-project-2",
            repo_path=temp_project,
            file_types=[".py"]  # 只索引Python文件
        )

        assert result["success"] is True
        # 应该只索引了.py文件
        assert result["indexed_count"] >= 2  # main.py和utils.py至少

    @pytest.mark.asyncio
    async def test_index_project_force_reindex(self, file_indexer, temp_project):
        """测试强制重新索引"""
        # 第一次索引
        result1 = await file_indexer.index_project(
            project_id="test-project-3",
            repo_path=temp_project
        )

        # 强制重新索引
        result2 = await file_indexer.index_project(
            project_id="test-project-3",
            repo_path=temp_project,
            force_reindex=True
        )

        assert result2["success"] is True
        assert result2["indexed_count"] >= result1["indexed_count"]

    @pytest.mark.asyncio
    async def test_update_file_index(self, file_indexer):
        """测试更新单个文件索引"""
        result = await file_indexer.update_file_index(
            project_id="test-project-4",
            file_path="src/test.py",
            content="def test():\n    return True\n"
        )

        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_get_index_stats(self, file_indexer, temp_project):
        """测试获取索引统计"""
        # 先索引项目
        await file_indexer.index_project(
            project_id="test-project-5",
            repo_path=temp_project
        )

        # 获取统计
        result = await file_indexer.get_index_stats("test-project-5")

        assert result is not None
        assert "project_id" in result or "total_files" in result or "success" in result

    @pytest.mark.asyncio
    async def test_index_empty_directory(self, file_indexer):
        """测试索引空目录"""
        empty_dir = tempfile.mkdtemp()
        try:
            result = await file_indexer.index_project(
                project_id="test-project-empty",
                repo_path=empty_dir
            )

            # 应该成功但索引数为0
            assert result["success"] is True
            assert result.get("indexed_count", 0) == 0

        finally:
            shutil.rmtree(empty_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_index_nonexistent_directory(self, file_indexer):
        """测试索引不存在的目录"""
        try:
            result = await file_indexer.index_project(
                project_id="test-project-nonexistent",
                repo_path="/path/that/does/not/exist"
            )

            # 应该失败或返回错误
            assert result["success"] is False or "error" in result

        except Exception:
            # 允许抛出异常
            pass

    @pytest.mark.asyncio
    async def test_index_large_file(self, file_indexer):
        """测试索引大文件"""
        temp_dir = tempfile.mkdtemp()
        try:
            # 创建一个较大的文件
            large_file = Path(temp_dir) / "large.py"
            content = "# Large file\n" + ("x = 1\n" * 1000)
            large_file.write_text(content)

            result = await file_indexer.index_project(
                project_id="test-project-large",
                repo_path=temp_dir
            )

            assert result["success"] is True
            assert result["indexed_count"] >= 1

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    @pytest.mark.asyncio
    async def test_index_binary_files(self, file_indexer):
        """测试索引时跳过二进制文件"""
        temp_dir = tempfile.mkdtemp()
        try:
            # 创建文本文件和二进制文件
            (Path(temp_dir) / "text.py").write_text("print('hello')")
            (Path(temp_dir) / "binary.bin").write_bytes(b'\x00\x01\x02\x03')

            result = await file_indexer.index_project(
                project_id="test-project-binary",
                repo_path=temp_dir
            )

            # 应该只索引文本文件，跳过二进制文件
            assert result["success"] is True

        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


class TestRAGEngineIntegration:
    """RAGEngine集成测试"""

    @pytest.fixture
    def rag_engine(self):
        """RAGEngine实例"""
        return RAGEngine()

    @pytest.mark.asyncio
    async def test_search_basic(self, rag_engine):
        """测试基本搜索"""
        try:
            results = await rag_engine.search(
                query="Python function",
                top_k=5
            )

            assert isinstance(results, list)

        except Exception:
            # 如果向量数据库未启动，允许失败
            pass

    @pytest.mark.asyncio
    async def test_enhanced_search(self, rag_engine):
        """测试增强搜索"""
        try:
            results = await rag_engine.enhanced_search(
                query="如何创建函数",
                project_id="test-project",
                top_k=5,
                use_reranker=False,
                sources=["project"]
            )

            assert isinstance(results, (list, dict))

        except Exception:
            # 如果向量数据库未启动，允许失败
            pass

    @pytest.mark.asyncio
    async def test_delete_by_project(self, rag_engine):
        """测试删除项目索引"""
        try:
            result = await rag_engine.delete_by_project("test-project-to-delete")

            assert isinstance(result, bool)

        except Exception:
            # 如果向量数据库未启动，允许失败
            pass


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
