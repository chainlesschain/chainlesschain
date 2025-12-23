"""
文件索引器
遍历项目文件并创建向量索引
"""
import os
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
from src.rag.rag_engine import RAGEngine

logger = logging.getLogger(__name__)


class FileIndexer:
    """项目文件索引器"""

    # 支持的文本文件扩展名
    TEXT_EXTENSIONS: Set[str] = {
        '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c', '.h', '.go', '.rs',
        '.md', '.txt', '.json', '.yaml', '.yml', '.html', '.css', '.scss', '.sass',
        '.xml', '.sql', '.sh', '.bash', '.ps1', '.rb', '.php', '.swift', '.kt',
        '.vue', '.svelte', '.astro', '.conf', '.ini', '.toml', '.env'
    }

    # 需要跳过的目录
    SKIP_DIRS: Set[str] = {
        '.git', '.svn', '.hg', 'node_modules', 'venv', 'env', '__pycache__',
        '.idea', '.vscode', 'dist', 'build', 'out', 'target', '.next', '.nuxt',
        'coverage', '.pytest_cache', '.mypy_cache', 'vendor', 'bower_components'
    }

    def __init__(self, rag_engine: Optional[RAGEngine] = None):
        """
        初始化文件索引器

        Args:
            rag_engine: RAG引擎实例（如未提供则创建新实例）
        """
        self.rag_engine = rag_engine or RAGEngine()

    async def index_project(
        self,
        project_id: str,
        repo_path: str,
        file_types: Optional[List[str]] = None,
        force_reindex: bool = False,
        max_file_size: int = 1024 * 1024  # 1MB
    ) -> Dict[str, Any]:
        """
        索引项目所有文件

        Args:
            project_id: 项目ID
            repo_path: 项目路径
            file_types: 文件类型过滤（如 ['py', 'js']）
            force_reindex: 是否强制重新索引
            max_file_size: 最大文件大小（字节）

        Returns:
            索引结果统计
        """
        try:
            # 如果强制重新索引，先删除旧索引
            if force_reindex:
                await self.rag_engine.delete_by_project(project_id)

            # 收集要索引的文件
            files_to_index = self._collect_files(repo_path, file_types, max_file_size)

            logger.info(f"找到 {len(files_to_index)} 个文件待索引")

            # 索引统计
            indexed_count = 0
            skipped_count = 0
            error_count = 0
            total_chunks = 0

            # 遍历并索引每个文件
            for file_path in files_to_index:
                try:
                    # 读取文件内容
                    content = self._read_file(file_path)
                    if not content or not content.strip():
                        skipped_count += 1
                        continue

                    # 文本分块
                    chunks = self._chunk_text(content, file_path)

                    # 索引每个chunk
                    for i, chunk in enumerate(chunks):
                        try:
                            relative_path = str(Path(file_path).relative_to(repo_path))
                            file_ext = Path(file_path).suffix[1:] if Path(file_path).suffix else 'unknown'

                            await self.rag_engine.add_knowledge(
                                text=chunk['text'],
                                metadata={
                                    'file_path': relative_path,
                                    'file_type': file_ext,
                                    'chunk_index': i,
                                    'total_chunks': len(chunks),
                                    'file_name': Path(file_path).name
                                },
                                project_id=project_id
                            )
                            total_chunks += 1

                        except Exception as e:
                            logger.error(f"索引chunk失败 {file_path}[{i}]: {e}")
                            error_count += 1

                    indexed_count += 1
                    logger.debug(f"成功索引: {file_path} ({len(chunks)} chunks)")

                except Exception as e:
                    logger.error(f"处理文件失败 {file_path}: {e}")
                    error_count += 1

            logger.info(f"索引完成: 成功={indexed_count}, 跳过={skipped_count}, 错误={error_count}, 总chunks={total_chunks}")

            return {
                "success": True,
                "project_id": project_id,
                "indexed_files": indexed_count,
                "skipped_files": skipped_count,
                "error_files": error_count,
                "total_chunks": total_chunks,
                "total_files": len(files_to_index)
            }

        except Exception as e:
            logger.error(f"索引项目失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def update_file_index(
        self,
        project_id: str,
        file_path: str,
        content: str
    ) -> Dict[str, Any]:
        """
        更新单个文件的索引

        Args:
            project_id: 项目ID
            file_path: 文件路径（相对路径）
            content: 文件内容

        Returns:
            更新结果
        """
        try:
            # TODO: 实现增量更新（先删除旧的chunks，再添加新的）
            # 目前简化实现：直接添加新chunks

            chunks = self._chunk_text(content, file_path)
            file_ext = Path(file_path).suffix[1:] if Path(file_path).suffix else 'unknown'

            for i, chunk in enumerate(chunks):
                await self.rag_engine.add_knowledge(
                    text=chunk['text'],
                    metadata={
                        'file_path': file_path,
                        'file_type': file_ext,
                        'chunk_index': i,
                        'total_chunks': len(chunks),
                        'file_name': Path(file_path).name
                    },
                    project_id=project_id
                )

            return {
                "success": True,
                "file_path": file_path,
                "chunks_added": len(chunks)
            }

        except Exception as e:
            logger.error(f"更新文件索引失败: {e}")
            return {
                "success": False,
                "error": str(e)
            }

    async def get_index_stats(self, project_id: str) -> Dict[str, Any]:
        """
        获取项目索引统计

        Args:
            project_id: 项目ID

        Returns:
            统计信息
        """
        try:
            # 通过检索获取项目相关的所有点
            # 这是一个简化实现，实际应该有专门的统计API
            collection_stats = await self.rag_engine.get_collection_stats()

            # TODO: 添加项目特定的统计
            return {
                "project_id": project_id,
                "collection_stats": collection_stats,
                "indexed": True
            }

        except Exception as e:
            logger.error(f"获取索引统计失败: {e}")
            return {
                "project_id": project_id,
                "indexed": False,
                "error": str(e)
            }

    def _collect_files(
        self,
        root_path: str,
        file_types: Optional[List[str]],
        max_file_size: int
    ) -> List[Path]:
        """
        收集需要索引的文件

        Args:
            root_path: 根目录
            file_types: 文件类型过滤
            max_file_size: 最大文件大小

        Returns:
            文件路径列表
        """
        files = []
        root = Path(root_path)

        if not root.exists():
            logger.warning(f"路径不存在: {root_path}")
            return files

        # 构建文件类型过滤集合
        if file_types:
            allowed_extensions = {f'.{ft}' if not ft.startswith('.') else ft for ft in file_types}
        else:
            allowed_extensions = self.TEXT_EXTENSIONS

        for item in root.rglob('*'):
            # 跳过目录
            if item.is_dir():
                continue

            # 跳过特殊目录中的文件
            if any(skip_dir in item.parts for skip_dir in self.SKIP_DIRS):
                continue

            # 文件类型过滤
            if item.suffix not in allowed_extensions:
                continue

            # 文件大小过滤
            try:
                if item.stat().st_size > max_file_size:
                    logger.debug(f"文件过大，跳过: {item}")
                    continue
            except Exception:
                continue

            files.append(item)

        return files

    def _read_file(self, file_path: Path) -> Optional[str]:
        """
        读取文件内容

        Args:
            file_path: 文件路径

        Returns:
            文件内容（文本）
        """
        try:
            # 尝试多种编码
            encodings = ['utf-8', 'gbk', 'gb2312', 'latin-1']

            for encoding in encodings:
                try:
                    with open(file_path, 'r', encoding=encoding) as f:
                        return f.read()
                except UnicodeDecodeError:
                    continue

            logger.warning(f"无法读取文件（编码问题）: {file_path}")
            return None

        except Exception as e:
            logger.error(f"读取文件失败: {file_path}, {e}")
            return None

    def _chunk_text(
        self,
        content: str,
        file_path: str,
        chunk_size: int = 1000,
        overlap: int = 100
    ) -> List[Dict[str, Any]]:
        """
        文本分块（滑动窗口）

        Args:
            content: 文件内容
            file_path: 文件路径（用于日志）
            chunk_size: 块大小（字符数）
            overlap: 重叠大小

        Returns:
            分块列表
        """
        chunks = []

        # 按行分割
        lines = content.split('\n')

        current_chunk = []
        current_size = 0
        chunk_index = 0

        for line in lines:
            line_size = len(line)

            # 如果当前chunk加上新行会超过限制，保存当前chunk
            if current_size + line_size > chunk_size and current_chunk:
                chunks.append({
                    'text': '\n'.join(current_chunk),
                    'index': chunk_index,
                    'size': current_size
                })
                chunk_index += 1

                # 保留overlap的内容
                if overlap > 0 and current_chunk:
                    # 从末尾保留一些行
                    overlap_lines = []
                    overlap_size = 0
                    for l in reversed(current_chunk):
                        if overlap_size + len(l) > overlap:
                            break
                        overlap_lines.insert(0, l)
                        overlap_size += len(l)

                    current_chunk = overlap_lines
                    current_size = overlap_size
                else:
                    current_chunk = []
                    current_size = 0

            current_chunk.append(line)
            current_size += line_size

        # 添加最后一个chunk
        if current_chunk:
            chunks.append({
                'text': '\n'.join(current_chunk),
                'index': chunk_index,
                'size': current_size
            })

        return chunks if chunks else [{'text': content, 'index': 0, 'size': len(content)}]
