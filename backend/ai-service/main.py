"""
ChainlessChain AI Service
主入口文件 - FastAPI应用
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError
from typing import Optional, List, Dict, Any
import base64
import os
import json
from dotenv import load_dotenv
import logging

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 加载环境变量
load_dotenv()

# 导入各个引擎
from src.engines.web_engine import WebEngine
from src.engines.doc_engine import DocumentEngine
from src.engines.data_engine import DataEngine
from src.nlu.intent_classifier import IntentClassifier
from src.rag.rag_engine import RAGEngine

# 导入流式工具
from src.utils.stream_utils import format_sse

# 导入Git管理器
from src.git.git_manager import GitManager
from src.git.commit_message_generator import generate_commit_message
from src.git.conflict_resolver import ConflictResolver

# 导入索引器
from src.indexing.file_indexer import FileIndexer

# 导入代码助手
from src.code.code_generator import CodeGenerator
from src.code.code_reviewer import CodeReviewer
from src.code.code_refactorer import CodeRefactorer

# 创建FastAPI应用
app = FastAPI(
    title="ChainlessChain AI Service",
    description="AI驱动的项目管理核心引擎",
    version="1.0.0"
)

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 添加验证异常处理器，记录详细的422错误
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理422验证错误，记录详细信息"""
    body = await request.body()
    logger.error(f"Validation error for {request.method} {request.url.path}")
    logger.error(f"Request body: {body.decode('utf-8') if body else 'empty'}")
    logger.error(f"Validation errors: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={
            "detail": exc.errors(),
            "body_preview": (body.decode('utf-8')[:500] if body else 'empty')
        }
    )

# 初始化引擎
web_engine = WebEngine()
doc_engine = DocumentEngine()
data_engine = DataEngine()
intent_classifier = IntentClassifier()
rag_engine = RAGEngine()

# 初始化Git管理器
git_manager = GitManager()
conflict_resolver = ConflictResolver()

# 初始化文件索引器
file_indexer = FileIndexer(rag_engine)

# 初始化代码助手
code_generator = CodeGenerator()
code_reviewer = CodeReviewer()
code_refactorer = CodeRefactorer()


# Encode binary file content so FastAPI can serialize the response.
def _encode_binary_files(result: Dict[str, Any]) -> Dict[str, Any]:
    import logging
    logger = logging.getLogger(__name__)

    files = result.get("files")
    if isinstance(files, list):
        for idx, file_item in enumerate(files):
            content = file_item.get("content")
            file_path = file_item.get("path", f"file_{idx}")

            if isinstance(content, (bytes, bytearray)):
                original_size = len(content)
                encoded = base64.b64encode(content).decode("ascii")
                encoded_size = len(encoded)

                logger.info(f"Encoding file {file_path}: {original_size} bytes -> {encoded_size} base64 chars")

                file_item["content"] = encoded
                file_item["content_encoding"] = "base64"
            else:
                logger.warning(f"File {file_path} content is not bytes: type={type(content)}, value={content if not isinstance(content, str) or len(content) < 100 else content[:100]+'...'}")

    return result


# ========================================
# 数据模型
# ========================================

class ProjectCreateRequest(BaseModel):
    """创建项目请求"""
    user_prompt: str  # 用户输入的自然语言指令
    project_type: Optional[str] = None  # 项目类型（如果用户明确指定）
    template_id: Optional[str] = None  # 模板ID
    metadata: Optional[Dict[str, Any]] = None  # 额外元数据


class TaskExecuteRequest(BaseModel):
    """执行任务请求"""
    project_id: str
    user_prompt: str
    context: Optional[List[Dict[str, str]]] = None  # 对话上下文


class IntentClassifyRequest(BaseModel):
    """意图识别请求"""
    text: str
    context: Optional[List[str]] = None


# ========================================
# API路由
# ========================================

@app.get("/")
async def root():
    """根路径"""
    return {
        "service": "ChainlessChain AI Service",
        "version": "1.0.0",
        "status": "running"
    }


@app.get("/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "engines": {
            "web": web_engine.is_ready(),
            "document": doc_engine.is_ready(),
            "data": data_engine.is_ready(),
            "nlu": intent_classifier.is_ready(),
            "rag": rag_engine.is_ready()
        }
    }


@app.post("/api/intent/classify")
async def classify_intent(request: IntentClassifyRequest):
    """
    意图识别接口

    Args:
        request: 包含待识别文本和上下文

    Returns:
        意图分类结果和实体抽取
    """
    try:
        result = await intent_classifier.classify(
            text=request.text,
            context=request.context
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/projects/create")
async def create_project(request: ProjectCreateRequest):
    """
    创建项目接口

    Args:
        request: 包含用户指令、项目类型等

    Returns:
        项目创建结果（项目ID、文件路径等）
    """
    try:
        # 1. 意图识别（如果已指定project_type，使用快速路径）
        intent_result = await intent_classifier.classify(
            request.user_prompt,
            project_type_hint=request.project_type
        )

        # 2. 根据意图选择引擎
        project_type = request.project_type or intent_result.get("project_type") or "web"
        if project_type == "unknown":
            project_type = "web"

        # 3. 调用相应引擎生成文件
        if project_type == "web":
            result = await web_engine.generate(
                prompt=request.user_prompt,
                context=intent_result
            )
        elif project_type == "document":
            result = await doc_engine.generate(
                prompt=request.user_prompt,
                context=intent_result
            )
        elif project_type == "data":
            result = await data_engine.generate(
                prompt=request.user_prompt,
                context=intent_result
            )
        else:
            raise HTTPException(status_code=400, detail=f"不支持的项目类型: {project_type}")

        return {
            "success": True,
            "project_type": project_type,
            "intent": intent_result,
            "result": _encode_binary_files(result)
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tasks/execute")
async def execute_task(request: TaskExecuteRequest):
    """
    执行任务接口

    Args:
        request: 包含项目ID、用户指令、上下文

    Returns:
        任务执行结果
    """
    try:
        # 1. 意图识别
        intent_result = await intent_classifier.classify(
            text=request.user_prompt,
            context=[msg["content"] for msg in (request.context or [])]
        )

        # 2. 任务规划（简化版，后续可扩展）
        task_type = intent_result.get("action", "unknown")

        # 3. 执行任务
        result = {
            "task_id": f"task_{intent_result.get('task_id', 'unknown')}",
            "status": "completed",
            "intent": intent_result,
            "message": f"任务 '{task_type}' 执行完成"
        }

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rag/query")
async def query_knowledge(query: str, project_id: Optional[str] = None):
    """
    RAG知识检索接口

    Args:
        query: 查询文本
        project_id: 项目ID（可选，用于过滤项目相关知识）

    Returns:
        检索到的相关知识
    """
    try:
        results = await rag_engine.search(
            query=query,
            project_id=project_id,
            top_k=5
        )
        return {
            "query": query,
            "results": results
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ========================================
# 流式生成API端点
# ========================================

@app.post("/api/projects/create/stream")
async def create_project_stream(request: ProjectCreateRequest):
    """
    流式创建项目接口（SSE）

    Args:
        request: 包含用户指令、项目类型等

    Returns:
        Server-Sent Events流式响应
    """
    async def event_generator():
        try:
            # 1. 意图识别
            yield format_sse({
                "type": "progress",
                "stage": "intent",
                "message": "正在识别意图..."
            })

            intent_result = await intent_classifier.classify(
                request.user_prompt,
                project_type_hint=request.project_type
            )

            yield format_sse({
                "type": "progress",
                "stage": "intent",
                "message": "意图识别完成",
                "intent": intent_result
            })

            # 2. 根据意图选择引擎
            project_type = request.project_type or intent_result.get("project_type") or "web"
            if project_type == "unknown":
                project_type = "web"

            yield format_sse({
                "type": "progress",
                "stage": "engine",
                "message": f"使用 {project_type} 引擎生成..."
            })

            # 3. 调用相应引擎进行流式生成
            if project_type == "web":
                async for chunk in web_engine.generate_stream(
                    prompt=request.user_prompt,
                    context=intent_result
                ):
                    # 对于complete类型，需要编码二进制文件
                    if chunk.get("type") == "complete" and "result" in chunk:
                        chunk["result"] = _encode_binary_files(chunk["result"])

                    yield format_sse(chunk)

            elif project_type == "document":
                # Document引擎的流式生成（带进度反馈）
                yield format_sse({
                    "type": "progress",
                    "stage": "outline",
                    "message": "正在生成文档大纲..."
                })

                # 调用文档生成引擎（非流式，但发送进度事件）
                result = await doc_engine.generate(
                    prompt=request.user_prompt,
                    context=intent_result
                )

                yield format_sse({
                    "type": "progress",
                    "stage": "content",
                    "message": "文档生成完成"
                })

                yield format_sse({
                    "type": "complete",
                    "project_type": project_type,
                    "result": _encode_binary_files(result)
                })

            elif project_type == "data":
                # TODO: 实现data引擎的流式生成
                result = await data_engine.generate(
                    prompt=request.user_prompt,
                    context=intent_result
                )
                yield format_sse({
                    "type": "complete",
                    "result": _encode_binary_files(result)
                })

            else:
                yield format_sse({
                    "type": "error",
                    "error": f"不支持的项目类型: {project_type}"
                })

        except Exception as e:
            yield format_sse({
                "type": "error",
                "error": str(e)
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # 禁用nginx缓冲
        }
    )


class ChatStreamRequest(BaseModel):
    """流式对话请求"""
    messages: List[Dict[str, str]]
    model: Optional[str] = None
    temperature: float = 0.7


@app.post("/api/chat/stream")
async def chat_stream(request: ChatStreamRequest):
    """
    流式对话接口（通用LLM聊天）

    Args:
        request: 包含消息列表、模型名称和温度参数

    Returns:
        Server-Sent Events流式响应
    """
    from src.utils.stream_utils import (
        stream_ollama_chat,
        stream_openai_chat,
        stream_custom_llm_chat
    )

    llm_provider = os.getenv("LLM_PROVIDER", "dashscope")
    model_name = request.model or os.getenv("LLM_MODEL", "qwen-turbo")

    async def event_generator():
        try:
            if llm_provider == "ollama":
                async for chunk in stream_ollama_chat(
                    model=model_name,
                    messages=request.messages,
                    options={"temperature": request.temperature}
                ):
                    yield format_sse(chunk)

            elif llm_provider == "openai":
                from openai import AsyncOpenAI
                openai_api_key = os.getenv("OPENAI_API_KEY")
                openai_base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")

                if not openai_api_key:
                    yield format_sse({
                        "type": "error",
                        "error": "OpenAI API key not configured"
                    })
                    return

                client = AsyncOpenAI(api_key=openai_api_key, base_url=openai_base_url)
                async for chunk in stream_openai_chat(
                    client=client,
                    model=model_name,
                    messages=request.messages,
                    temperature=request.temperature
                ):
                    yield format_sse(chunk)

            else:
                # 自定义LLM客户端
                from src.llm.llm_client import get_llm_client
                llm_client = get_llm_client()
                async for chunk in stream_custom_llm_chat(
                    llm_client=llm_client,
                    messages=request.messages,
                    temperature=request.temperature
                ):
                    yield format_sse(chunk)

        except Exception as e:
            yield format_sse({
                "type": "error",
                "error": str(e)
            })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ==================== Git Operations API ====================

class GitInitRequest(BaseModel):
    repo_path: str
    remote_url: Optional[str] = None
    branch_name: str = "main"


class GitCommitRequest(BaseModel):
    repo_path: str
    message: Optional[str] = None
    files: Optional[List[str]] = None
    auto_generate_message: bool = False


class GitPushRequest(BaseModel):
    repo_path: str
    remote: str = "origin"
    branch: Optional[str] = None


class GitPullRequest(BaseModel):
    repo_path: str
    remote: str = "origin"
    branch: Optional[str] = None


class BranchCreateRequest(BaseModel):
    repo_path: str
    branch_name: str
    from_branch: Optional[str] = None


class BranchCheckoutRequest(BaseModel):
    repo_path: str
    branch_name: str


class MergeRequest(BaseModel):
    repo_path: str
    source_branch: str
    target_branch: Optional[str] = None


class ConflictResolveRequest(BaseModel):
    repo_path: str
    file_path: Optional[str] = None  # 指定文件路径，不填则解决所有冲突
    auto_resolve: bool = False  # 是否自动应用解决方案
    strategy: Optional[str] = None  # 强制策略: accept_current/accept_incoming/merge_both


class CommitMessageRequest(BaseModel):
    repo_path: str
    staged_files: Optional[List[str]] = None
    diff_content: Optional[str] = None


@app.post("/api/git/init")
async def git_init(request: GitInitRequest):
    """初始化Git仓库"""
    try:
        result = git_manager.init_repo(
            request.repo_path,
            request.remote_url,
            request.branch_name
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/status")
async def git_status(repo_path: str):
    """获取Git状态"""
    try:
        result = git_manager.get_status(repo_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/commit")
async def git_commit(request: GitCommitRequest):
    """提交更改"""
    try:
        result = await git_manager.commit(
            request.repo_path,
            request.message,
            request.files,
            request.auto_generate_message
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/push")
async def git_push(request: GitPushRequest):
    """推送到远程"""
    try:
        result = git_manager.push(
            request.repo_path,
            request.remote,
            request.branch
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/pull")
async def git_pull(request: GitPullRequest):
    """从远程拉取"""
    try:
        result = git_manager.pull(
            request.repo_path,
            request.remote,
            request.branch
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/log")
async def git_log(repo_path: str, limit: int = 20):
    """获取提交历史"""
    try:
        result = git_manager.get_log(repo_path, limit)
        return {"commits": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/diff")
async def git_diff(repo_path: str, commit1: Optional[str] = None, commit2: Optional[str] = None):
    """获取差异"""
    try:
        result = git_manager.get_diff(repo_path, commit1, commit2)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/git/branches")
async def git_branches(repo_path: str):
    """列出所有分支"""
    try:
        result = git_manager.list_branches(repo_path)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/branch/create")
async def git_create_branch(request: BranchCreateRequest):
    """创建分支"""
    try:
        result = git_manager.create_branch(
            request.repo_path,
            request.branch_name,
            request.from_branch
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/branch/checkout")
async def git_checkout_branch(request: BranchCheckoutRequest):
    """切换分支"""
    try:
        result = git_manager.checkout_branch(
            request.repo_path,
            request.branch_name
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/merge")
async def git_merge(request: MergeRequest):
    """合并分支"""
    try:
        result = git_manager.merge_branch(
            request.repo_path,
            request.source_branch,
            request.target_branch
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/resolve-conflicts")
async def git_resolve_conflicts(request: ConflictResolveRequest):
    """解决冲突（AI辅助）"""
    try:
        if request.file_path:
            # 解决单个文件冲突
            import os
            full_path = os.path.join(request.repo_path, request.file_path)
            result = await conflict_resolver.resolve_file_conflicts(
                full_path,
                request.auto_resolve,
                request.strategy
            )
        else:
            # 解决整个仓库的冲突
            result = await conflict_resolver.resolve_repository_conflicts(
                request.repo_path,
                request.auto_resolve,
                request.strategy
            )

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/git/generate-commit-message")
async def git_generate_commit_message(request: CommitMessageRequest):
    """AI生成提交消息"""
    try:
        message = await generate_commit_message(
            request.repo_path,
            request.staged_files,
            request.diff_content
        )
        return {
            "message": message
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== RAG Indexing API ====================

class ProjectIndexRequest(BaseModel):
    project_id: str
    repo_path: str
    file_types: Optional[List[str]] = None
    force_reindex: bool = False


class FileIndexUpdateRequest(BaseModel):
    project_id: str
    file_path: str
    content: str


class EnhancedQueryRequest(BaseModel):
    project_id: str
    query: str
    top_k: int = 5
    use_reranker: bool = False
    sources: List[str] = ["project"]


@app.post("/api/rag/index/project")
async def index_project_files(request: ProjectIndexRequest):
    """索引项目所有文件"""
    try:
        result = await file_indexer.index_project(
            request.project_id,
            request.repo_path,
            request.file_types,
            request.force_reindex
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/rag/index/stats")
async def get_index_stats(project_id: Optional[str] = None):
    """获取项目索引统计"""
    try:
        if not project_id:
            # 返回所有项目的统计
            return {
                "message": "Please provide project_id parameter",
                "total_projects": 0
            }
        result = await file_indexer.get_index_stats(project_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rag/query/enhanced")
async def enhanced_query(request: EnhancedQueryRequest):
    """增强RAG查询（多源+重排）"""
    try:
        result = await rag_engine.enhanced_search(
            request.query,
            request.project_id,
            request.top_k,
            request.use_reranker,
            request.sources
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/rag/index/project/{project_id}")
async def delete_project_index(project_id: str):
    """删除项目索引"""
    try:
        result = await rag_engine.delete_by_project(project_id)
        return {"success": result, "project_id": project_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rag/index/update-file")
async def update_file_index(request: FileIndexUpdateRequest):
    """更新单个文件索引"""
    try:
        result = await file_indexer.update_file_index(
            request.project_id,
            request.file_path,
            request.content
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== CrossEncoder Reranker API ====================

class RerankRequest(BaseModel):
    query: str
    documents: List[Dict[str, Any]]
    top_k: int = 5


@app.post("/api/rerank")
async def rerank_documents(request: RerankRequest):
    """
    使用CrossEncoder模型重排序文档

    Args:
        request: 重排序请求，包含查询和文档列表

    Returns:
        重排序后的文档列表，按相关性分数降序排列
    """
    try:
        from src.rag.crossencoder_reranker import get_reranker

        # 获取reranker实例
        reranker = get_reranker()

        # 执行重排序
        results = await reranker.rerank_async(
            request.query,
            request.documents,
            request.top_k
        )

        return {
            "success": True,
            "query": request.query,
            "results": results,
            "count": len(results)
        }

    except Exception as e:
        # 如果CrossEncoder失败，返回原始顺序
        print(f"[API] Rerank失败: {e}")
        return {
            "success": False,
            "query": request.query,
            "results": request.documents[:request.top_k],
            "count": len(request.documents[:request.top_k]),
            "error": str(e)
        }


# ==================== Code Assistant API ====================

class CodeGenerateRequest(BaseModel):
    description: str
    language: str
    style: str = "modern"
    include_tests: bool = False
    include_comments: bool = True
    context: Optional[str] = None


class CodeReviewRequest(BaseModel):
    code: str
    language: str
    focus_areas: Optional[List[str]] = None


class CodeRefactorRequest(BaseModel):
    code: str
    language: str
    refactor_type: str = "general"
    target: Optional[str] = None


class CodeExplainRequest(BaseModel):
    code: str
    language: str


class BugFixRequest(BaseModel):
    code: str
    language: str
    bug_description: Optional[str] = None


class TestGenerateRequest(BaseModel):
    code: str
    language: str


class CodeOptimizeRequest(BaseModel):
    code: str
    language: str


@app.post("/api/code/generate")
async def generate_code(request: CodeGenerateRequest):
    """生成代码"""
    try:
        result = await code_generator.generate(
            request.description,
            request.language,
            request.style,
            request.include_tests,
            request.include_comments,
            request.context
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/code/review")
async def review_code(request: CodeReviewRequest):
    """代码审查"""
    try:
        result = await code_reviewer.review(
            request.code,
            request.language,
            request.focus_areas
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/code/refactor")
async def refactor_code(request: CodeRefactorRequest):
    """代码重构"""
    try:
        result = await code_refactorer.refactor(
            request.code,
            request.language,
            request.refactor_type,
            request.target
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/code/explain")
async def explain_code(request: CodeExplainRequest):
    """代码解释"""
    try:
        explanation = await code_refactorer.explain(
            request.code,
            request.language
        )
        return {"explanation": explanation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/code/fix-bug")
async def fix_bug(request: BugFixRequest):
    """修复Bug"""
    try:
        result = await code_refactorer.fix_bug(
            request.code,
            request.language,
            request.bug_description
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/code/generate-tests")
async def generate_tests(request: TestGenerateRequest):
    """生成单元测试"""
    try:
        # 利用代码生成器的内部方法
        result = await code_generator.generate(
            f"为以下代码生成完整的单元测试",
            request.language,
            include_tests=True,
            context=request.code
        )
        return {"tests": result.get("tests", result.get("code"))}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/code/optimize")
async def optimize_code(request: CodeOptimizeRequest):
    """性能优化"""
    try:
        result = await code_refactorer.optimize(
            request.code,
            request.language
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Project Conversation API ====================

class ProjectChatRequest(BaseModel):
    """项目对话请求"""
    project_id: str
    user_message: str
    conversation_history: Optional[List[Dict[str, str]]] = None  # 对话历史
    context_mode: str = "project"  # project | file | global
    current_file: Optional[str] = None  # 当前文件路径（file模式下使用）
    project_info: Optional[Dict[str, Any]] = None  # 项目信息
    file_list: Optional[List[Dict[str, Any]]] = None  # 文件列表


@app.post("/api/projects/{project_id}/chat")
async def project_chat(project_id: str, request: ProjectChatRequest):
    """
    项目对话接口 - 支持AI驱动的文件操作

    用户可以通过自然语言与AI对话，AI会根据需要执行文件操作（CREATE/UPDATE/DELETE/READ）

    Args:
        project_id: 项目ID
        request: 对话请求（包含用户消息、上下文模式等）

    Returns:
        {
            "response": "AI文本回复",
            "operations": [文件操作列表],
            "rag_sources": [RAG检索结果]
        }
    """
    try:
        from src.llm.llm_client import get_llm_client
        from src.engines.function_schemas import (
            FILE_OPERATIONS_SCHEMA,
            build_system_prompt_with_context
        )
        import json

        # 1. 获取LLM客户端
        llm_client = get_llm_client()

        # 2. RAG检索相关项目文件（如果启用）
        rag_context = []
        if request.context_mode == "project":
            try:
                query_result = await rag_engine.enhanced_search(
                    query=request.user_message,
                    project_id=project_id,
                    top_k=5,
                    sources=["project"]
                )
                rag_context = query_result.get("context", [])
            except Exception as e:
                logger.error(f"RAG query failed: {e}")
                # RAG失败不影响对话，继续执行

        # 3. 构建系统提示词
        project_info = request.project_info or {
            "name": f"Project {project_id}",
            "description": "A project managed by ChainlessChain",
            "type": "general"
        }

        system_prompt = build_system_prompt_with_context(
            project_info=project_info,
            file_list=request.file_list,
            rag_context=rag_context
        )

        # 4. 构建消息列表
        messages = [{"role": "system", "content": system_prompt}]

        # 添加对话历史（最多10条）
        if request.conversation_history:
            messages.extend(request.conversation_history[-10:])

        # 添加当前用户消息
        messages.append({"role": "user", "content": request.user_message})

        # 5. 调用LLM（尝试使用function calling）
        # 注意：不是所有LLM都支持function calling，这里先用基础版本
        # TODO: 后续可以根据不同LLM提供商使用不同的实现

        response_text = await llm_client.chat(
            messages=messages,
            temperature=0.7,
            max_tokens=2048
        )

        # 6. 解析响应提取文件操作
        # 简单实现：检查响应中是否包含JSON格式的操作指令
        operations = []

        # 尝试解析JSON格式的文件操作
        if "```json" in response_text.lower():
            try:
                # 提取JSON代码块
                json_start = response_text.lower().find("```json") + 7
                json_end = response_text.find("```", json_start)
                json_str = response_text[json_start:json_end].strip()
                parsed_json = json.loads(json_str)

                if "operations" in parsed_json:
                    operations = parsed_json["operations"]
                elif isinstance(parsed_json, list):
                    operations = parsed_json
            except Exception as e:
                print(f"Failed to parse JSON operations: {e}")

        # 7. 返回结果
        return {
            "success": True,
            "response": response_text,
            "operations": operations,
            "rag_sources": [
                {
                    "text": ctx.get("text", ""),
                    "file_path": ctx.get("file_path", ""),
                    "score": ctx.get("score", 0.0)
                }
                for ctx in rag_context[:5]
            ]
        }

    except Exception as e:
        import traceback
        print(f"Project chat error: {e}")
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
