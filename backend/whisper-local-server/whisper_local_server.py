"""
本地 Whisper 语音识别服务器
提供与 OpenAI Whisper API 兼容的接口

安装依赖:
pip install fastapi uvicorn python-multipart openai-whisper torch

运行服务器:
python whisper_local_server.py

或使用 uvicorn:
uvicorn whisper_local_server:app --host 0.0.0.0 --port 8000 --reload
"""

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import whisper
import torch
import tempfile
import os
import time
import logging
from typing import Optional
from pathlib import Path

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 创建 FastAPI 应用
app = FastAPI(
    title="Whisper Local Server",
    description="本地 Whisper 语音识别服务，兼容 OpenAI API",
    version="1.0.0"
)

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局变量
models_cache = {}
device = "cuda" if torch.cuda.is_available() else "cpu"
logger.info(f"使用设备: {device}")

# 支持的模型大小
SUPPORTED_MODELS = ["tiny", "base", "small", "medium", "large"]

# 支持的音频格式
SUPPORTED_FORMATS = [".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm"]


def load_model(model_size: str = "base"):
    """
    加载 Whisper 模型（带缓存）
    """
    if model_size not in SUPPORTED_MODELS:
        raise ValueError(f"不支持的模型大小: {model_size}。支持的模型: {SUPPORTED_MODELS}")

    if model_size not in models_cache:
        logger.info(f"加载 Whisper 模型: {model_size}")
        start_time = time.time()

        try:
            model = whisper.load_model(model_size, device=device)
            models_cache[model_size] = model

            load_time = time.time() - start_time
            logger.info(f"模型加载完成，耗时: {load_time:.2f}s")
        except Exception as e:
            logger.error(f"模型加载失败: {e}")
            raise HTTPException(status_code=500, detail=f"模型加载失败: {str(e)}")

    return models_cache[model_size]


@app.get("/")
async def root():
    """
    根路径
    """
    return {
        "message": "Whisper Local Server",
        "version": "1.0.0",
        "device": device,
        "loaded_models": list(models_cache.keys()),
        "supported_models": SUPPORTED_MODELS,
    }


@app.get("/health")
async def health_check():
    """
    健康检查
    """
    return {
        "status": "healthy",
        "device": device,
        "loaded_models": list(models_cache.keys()),
    }


@app.get("/v1/models")
async def list_models():
    """
    列出可用的模型
    """
    return {
        "models": [
            {
                "id": model,
                "object": "model",
                "owned_by": "openai",
                "permission": [],
            }
            for model in SUPPORTED_MODELS
        ]
    }


@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form("base"),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    response_format: str = Form("json"),
    temperature: float = Form(0.0),
    task: str = Form("transcribe"),
):
    """
    转录音频文件
    兼容 OpenAI Whisper API 接口

    参数:
    - file: 音频文件
    - model: 模型大小 (tiny/base/small/medium/large)
    - language: 语言代码 (如 zh, en)
    - prompt: 初始提示文本
    - response_format: 响应格式 (json/text/srt/vtt)
    - temperature: 温度参数 (0-1)
    - task: 任务类型 (transcribe/translate)
    """
    temp_file = None

    try:
        # 验证文件格式
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in SUPPORTED_FORMATS:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的音频格式: {file_ext}。支持的格式: {SUPPORTED_FORMATS}"
            )

        # 保存上传的文件到临时目录
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_file_path = temp_file.name

        logger.info(f"开始转录: {file.filename} (模型: {model}, 语言: {language})")
        start_time = time.time()

        # 加载模型
        whisper_model = load_model(model)

        # 准备转录选项
        transcribe_options = {
            "task": task,
            "temperature": temperature,
        }

        if language:
            transcribe_options["language"] = language

        if prompt:
            transcribe_options["initial_prompt"] = prompt

        # 执行转录
        result = whisper_model.transcribe(temp_file_path, **transcribe_options)

        duration = time.time() - start_time
        logger.info(f"转录完成，耗时: {duration:.2f}s")

        # 根据响应格式返回结果
        if response_format == "text":
            return result["text"]
        elif response_format == "srt":
            return generate_srt(result["segments"])
        elif response_format == "vtt":
            return generate_vtt(result["segments"])
        else:  # json
            return {
                "text": result["text"],
                "language": result.get("language", language),
                "duration": duration,
                "segments": result.get("segments", []),
                "model": model,
                "task": task,
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"转录失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"转录失败: {str(e)}")
    finally:
        # 清理临时文件
        if temp_file and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except Exception as e:
                logger.warning(f"清理临时文件失败: {e}")


@app.post("/v1/audio/translations")
async def translate_audio(
    file: UploadFile = File(...),
    model: str = Form("base"),
    prompt: Optional[str] = Form(None),
    response_format: str = Form("json"),
    temperature: float = Form(0.0),
):
    """
    翻译音频文件（翻译为英文）
    """
    return await transcribe_audio(
        file=file,
        model=model,
        language=None,
        prompt=prompt,
        response_format=response_format,
        temperature=temperature,
        task="translate",
    )


def generate_srt(segments):
    """
    生成 SRT 字幕格式
    """
    srt_content = []
    for i, segment in enumerate(segments, start=1):
        start_time = format_timestamp(segment["start"])
        end_time = format_timestamp(segment["end"])
        text = segment["text"].strip()

        srt_content.append(f"{i}")
        srt_content.append(f"{start_time} --> {end_time}")
        srt_content.append(text)
        srt_content.append("")

    return "\n".join(srt_content)


def generate_vtt(segments):
    """
    生成 VTT 字幕格式
    """
    vtt_content = ["WEBVTT", ""]

    for segment in segments:
        start_time = format_timestamp(segment["start"])
        end_time = format_timestamp(segment["end"])
        text = segment["text"].strip()

        vtt_content.append(f"{start_time} --> {end_time}")
        vtt_content.append(text)
        vtt_content.append("")

    return "\n".join(vtt_content)


def format_timestamp(seconds):
    """
    格式化时间戳 (HH:MM:SS,mmm)
    """
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)

    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


if __name__ == "__main__":
    import uvicorn

    # 预加载默认模型
    logger.info("预加载默认模型...")
    try:
        load_model("base")
        logger.info("默认模型加载完成")
    except Exception as e:
        logger.warning(f"默认模型加载失败: {e}")

    # 启动服务器
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )
