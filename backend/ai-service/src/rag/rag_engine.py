"""
RAG Engine - 检索增强生成引擎
基于Qdrant向量数据库的语义检索
"""
import os
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from sentence_transformers import SentenceTransformer
import uuid


class RAGEngine:
    """RAG检索引擎"""

    def __init__(self):
        self.qdrant_host = os.getenv("QDRANT_HOST", "localhost")
        self.qdrant_port = int(os.getenv("QDRANT_PORT", "6333"))
        self.embedding_model_name = os.getenv("EMBEDDING_MODEL", "BAAI/bge-base-zh-v1.5")
        self.collection_name = "chainlesschain_knowledge"

        try:
            # 初始化Qdrant客户端
            self.client = QdrantClient(host=self.qdrant_host, port=self.qdrant_port)

            # 初始化Embedding模型
            self.embedding_model = SentenceTransformer(self.embedding_model_name)
            self.vector_size = self.embedding_model.get_sentence_embedding_dimension()

            # 创建或获取collection
            self._ensure_collection()

            self._ready = True
        except Exception as e:
            print(f"RAG engine initialization error: {e}")
            self._ready = False

    def _ensure_collection(self):
        """确保collection存在"""
        try:
            collections = self.client.get_collections().collections
            collection_names = [col.name for col in collections]

            if self.collection_name not in collection_names:
                # 创建新collection
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.vector_size,
                        distance=Distance.COSINE
                    )
                )
                print(f"Created collection: {self.collection_name}")
        except Exception as e:
            print(f"Error ensuring collection: {e}")
            raise

    def is_ready(self) -> bool:
        """检查引擎是否就绪"""
        return self._ready

    async def add_knowledge(
        self,
        text: str,
        metadata: Optional[Dict[str, Any]] = None,
        project_id: Optional[str] = None
    ) -> str:
        """
        添加知识到向量数据库

        Args:
            text: 知识文本
            metadata: 元数据（标题、作者、来源等）
            project_id: 关联的项目ID

        Returns:
            知识ID
        """
        if not self._ready:
            raise Exception("RAG engine not ready")

        try:
            # 生成embedding
            embedding = self.embedding_model.encode(text).tolist()

            # 生成唯一ID
            knowledge_id = str(uuid.uuid4())

            # 构建payload
            payload = {
                "text": text,
                "project_id": project_id,
                **(metadata or {})
            }

            # 插入Qdrant
            self.client.upsert(
                collection_name=self.collection_name,
                points=[
                    PointStruct(
                        id=knowledge_id,
                        vector=embedding,
                        payload=payload
                    )
                ]
            )

            return knowledge_id

        except Exception as e:
            print(f"Add knowledge error: {e}")
            raise

    async def search(
        self,
        query: str,
        project_id: Optional[str] = None,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        语义检索

        Args:
            query: 查询文本
            project_id: 过滤项目ID（可选）
            top_k: 返回top K结果

        Returns:
            检索结果列表
        """
        if not self._ready:
            raise Exception("RAG engine not ready")

        try:
            # 生成查询embedding
            query_embedding = self.embedding_model.encode(query).tolist()

            # 构建过滤条件
            search_filter = None
            if project_id:
                search_filter = Filter(
                    must=[
                        FieldCondition(
                            key="project_id",
                            match=MatchValue(value=project_id)
                        )
                    ]
                )

            # 执行检索
            search_results = self.client.search(
                collection_name=self.collection_name,
                query_vector=query_embedding,
                query_filter=search_filter,
                limit=top_k
            )

            # 格式化结果
            results = []
            for hit in search_results:
                results.append({
                    "id": hit.id,
                    "score": hit.score,
                    "text": hit.payload.get("text", ""),
                    "metadata": {
                        k: v for k, v in hit.payload.items()
                        if k not in ["text", "project_id"]
                    },
                    "project_id": hit.payload.get("project_id")
                })

            return results

        except Exception as e:
            print(f"Search error: {e}")
            return []

    async def delete_by_project(self, project_id: str) -> bool:
        """
        删除项目相关的所有知识

        Args:
            project_id: 项目ID

        Returns:
            是否成功
        """
        if not self._ready:
            raise Exception("RAG engine not ready")

        try:
            self.client.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="project_id",
                            match=MatchValue(value=project_id)
                        )
                    ]
                )
            )
            return True
        except Exception as e:
            print(f"Delete by project error: {e}")
            return False

    async def get_collection_stats(self) -> Dict[str, Any]:
        """获取collection统计信息"""
        if not self._ready:
            return {"ready": False}

        try:
            collection_info = self.client.get_collection(self.collection_name)
            return {
                "ready": True,
                "total_points": collection_info.points_count,
                "vector_size": collection_info.config.params.vectors.size,
                "distance": collection_info.config.params.vectors.distance
            }
        except Exception as e:
            print(f"Get stats error: {e}")
            return {"ready": False, "error": str(e)}

    async def enhanced_search(
        self,
        query: str,
        project_id: Optional[str] = None,
        top_k: int = 5,
        use_reranker: bool = False,
        sources: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        增强检索（支持多源和重排）

        Args:
            query: 查询文本
            project_id: 项目ID
            top_k: 返回结果数
            use_reranker: 是否使用重排器（TODO）
            sources: 检索来源列表 ['project', 'knowledge', 'conversation']

        Returns:
            增强检索结果
        """
        if not self._ready:
            raise Exception("RAG engine not ready")

        try:
            # 默认检索项目内容
            results = await self.search(query, project_id, top_k)

            # TODO: 实现多源检索和重排逻辑
            # 如果启用重排，使用更高级的模型重新排序
            if use_reranker and results:
                # Placeholder for reranker logic
                pass

            # 计算来源分布
            source_dist = {}
            for result in results:
                if result.get('project_id'):
                    source_dist['project'] = source_dist.get('project', 0) + 1
                else:
                    source_dist['knowledge'] = source_dist.get('knowledge', 0) + 1

            # 生成上下文摘要（可选，使用LLM）
            context_summary = None
            if results:
                # TODO: 使用LLM生成上下文摘要
                pass

            return {
                "query": query,
                "total_docs": len(results),
                "sources": source_dist,
                "context": results,
                "summary": context_summary
            }

        except Exception as e:
            print(f"Enhanced search error: {e}")
            return {
                "query": query,
                "total_docs": 0,
                "sources": {},
                "context": [],
                "error": str(e)
            }

    async def get_project_stats(self, project_id: str) -> Dict[str, Any]:
        """
        获取项目索引统计

        Args:
            project_id: 项目ID

        Returns:
            项目统计信息
        """
        if not self._ready:
            return {"ready": False}

        try:
            # 通过scroll API获取项目所有点
            # 这是一个简化实现
            results = await self.search(
                query="",  # 空查询，获取所有
                project_id=project_id,
                top_k=10000  # 大数量以获取所有
            )

            file_types = {}
            for result in results:
                file_type = result.get('metadata', {}).get('file_type', 'unknown')
                file_types[file_type] = file_types.get(file_type, 0) + 1

            return {
                "project_id": project_id,
                "total_chunks": len(results),
                "file_type_distribution": file_types,
                "indexed": len(results) > 0
            }

        except Exception as e:
            print(f"Get project stats error: {e}")
            return {
                "project_id": project_id,
                "indexed": False,
                "error": str(e)
            }
