"""
ChainlessChain AI Service
主入口文件 - FastAPI应用
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import os
import json
from dotenv import load_dotenv

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

# 初始化引擎
web_engine = WebEngine()
doc_engine = DocumentEngine()
data_engine = DataEngine()
intent_classifier = IntentClassifier()
rag_engine = RAGEngine()


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
                    if chunk.get("type") == "complete":
                        chunk["result"] = _encode_binary_files(chunk)

                    yield format_sse(chunk)

            elif project_type == "document":
                # TODO: 实现document引擎的流式生成
                result = await doc_engine.generate(
                    prompt=request.user_prompt,
                    context=intent_result
                )
                yield format_sse({
                    "type": "complete",
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


@app.post("/api/chat/stream")
async def chat_stream(
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    temperature: float = 0.7
):
    """
    流式对话接口（通用LLM聊天）

    Args:
        messages: 对话消息列表 [{"role": "user", "content": "..."}]
        model: 模型名称（可选）
        temperature: 温度参数

    Returns:
        Server-Sent Events流式响应
    """
    from src.utils.stream_utils import (
        stream_ollama_chat,
        stream_openai_chat,
        stream_custom_llm_chat
    )

    llm_provider = os.getenv("LLM_PROVIDER", "ollama")
    model_name = model or os.getenv("LLM_MODEL", "qwen2:7b")

    async def event_generator():
        try:
            if llm_provider == "ollama":
                async for chunk in stream_ollama_chat(
                    model=model_name,
                    messages=messages,
                    options={"temperature": temperature}
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
                    messages=messages,
                    temperature=temperature
                ):
                    yield format_sse(chunk)

            else:
                # 自定义LLM客户端
                from src.llm.llm_client import get_llm_client
                llm_client = get_llm_client()
                async for chunk in stream_custom_llm_chat(
                    llm_client=llm_client,
                    messages=messages,
                    temperature=temperature
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
