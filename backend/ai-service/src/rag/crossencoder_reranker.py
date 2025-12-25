"""
CrossEncoder Reranker - 基于bge-reranker的重排序服务
使用sentence-transformers的CrossEncoder模型进行文档重排序
"""

from typing import List, Dict, Any
from sentence_transformers import CrossEncoder
import numpy as np


class CrossEncoderReranker:
    """CrossEncoder重排序器"""

    def __init__(self, model_name: str = "BAAI/bge-reranker-large"):
        """
        初始化CrossEncoder重排序器

        Args:
            model_name: 模型名称，默认使用bge-reranker-large
        """
        self.model_name = model_name
        self.model = None
        self._initialized = False

    def initialize(self):
        """延迟初始化模型（首次使用时加载）"""
        if self._initialized:
            return

        try:
            print(f"[CrossEncoderReranker] 加载模型: {self.model_name}")
            self.model = CrossEncoder(self.model_name, max_length=512)
            self._initialized = True
            print(f"[CrossEncoderReranker] 模型加载成功")
        except Exception as e:
            print(f"[CrossEncoderReranker] 模型加载失败: {e}")
            raise

    def is_ready(self) -> bool:
        """检查模型是否就绪"""
        return self._initialized and self.model is not None

    def rerank(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        重排序文档

        Args:
            query: 查询文本
            documents: 文档列表 [{"id": "...", "text": "..."}, ...]
            top_k: 返回top-K个文档

        Returns:
            重排序后的文档列表，包含分数
        """
        # 确保模型已初始化
        if not self.is_ready():
            self.initialize()

        if not documents:
            return []

        try:
            # 准备输入对 (query, document_text)
            sentence_pairs = [[query, doc.get("text", "")] for doc in documents]

            # 计算相关性分数
            scores = self.model.predict(sentence_pairs)

            # 将分数转换为numpy数组（如果不是的话）
            if not isinstance(scores, np.ndarray):
                scores = np.array(scores)

            # 创建结果列表
            results = []
            for idx, score in enumerate(scores):
                results.append({
                    "id": documents[idx].get("id", f"doc_{idx}"),
                    "text": documents[idx].get("text", ""),
                    "score": float(score),  # 转换为Python float
                    "original_index": idx,
                })

            # 按分数降序排序
            results.sort(key=lambda x: x["score"], reverse=True)

            # 返回top-K结果
            return results[:top_k]

        except Exception as e:
            print(f"[CrossEncoderReranker] 重排序失败: {e}")
            # 失败时返回原始顺序
            return [
                {
                    "id": doc.get("id", f"doc_{idx}"),
                    "text": doc.get("text", ""),
                    "score": 0.5,
                    "original_index": idx,
                }
                for idx, doc in enumerate(documents[:top_k])
            ]

    async def rerank_async(
        self,
        query: str,
        documents: List[Dict[str, Any]],
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        异步重排序（用于FastAPI）

        Args:
            query: 查询文本
            documents: 文档列表
            top_k: 返回top-K个文档

        Returns:
            重排序后的文档列表
        """
        # CrossEncoder.predict 不是真正的异步操作
        # 但我们提供async接口以便与FastAPI集成
        return self.rerank(query, documents, top_k)

    def get_model_info(self) -> Dict[str, Any]:
        """获取模型信息"""
        return {
            "model_name": self.model_name,
            "initialized": self._initialized,
            "available": self.is_ready(),
        }


# 全局单例
_reranker_instance = None


def get_reranker(model_name: str = "BAAI/bge-reranker-base") -> CrossEncoderReranker:
    """
    获取全局CrossEncoder重排序器实例

    Args:
        model_name: 模型名称，默认使用bge-reranker-base（更轻量）

    Returns:
        CrossEncoderReranker实例
    """
    global _reranker_instance

    if _reranker_instance is None:
        _reranker_instance = CrossEncoderReranker(model_name)

    return _reranker_instance
