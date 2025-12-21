"""
ChainlessChain AI Service
主入口文件 - FastAPI应用
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import base64
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 导入各个引擎
from src.engines.web_engine import WebEngine
from src.engines.doc_engine import DocumentEngine
from src.engines.data_engine import DataEngine
from src.nlu.intent_classifier import IntentClassifier
from src.rag.rag_engine import RAGEngine

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
    files = result.get("files")
    if isinstance(files, list):
        for file_item in files:
            content = file_item.get("content")
            if isinstance(content, (bytes, bytearray)):
                file_item["content"] = base64.b64encode(content).decode("ascii")
                file_item["content_encoding"] = "base64"
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
        # 1. 意图识别
        intent_result = await intent_classifier.classify(request.user_prompt)

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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
