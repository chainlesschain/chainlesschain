#!/usr/bin/env python3
"""
Whisper.cpp FastAPI Server

提供与 OpenAI Whisper API 兼容的本地语音识别服务

API 端点:
  POST /v1/audio/transcriptions  - 转录音频
  POST /v1/audio/translations    - 翻译音频到英文
  GET  /v1/models               - 获取可用模型
  GET  /health                  - 健康检查
"""

import os
import sys
import json
import time
import asyncio
import tempfile
import subprocess
import logging
from pathlib import Path
from typing import Optional, List, Literal
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import aiofiles
import soundfile as sf
import numpy as np

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 环境变量配置
MODEL_DIR = os.getenv('WHISPER_MODEL_DIR', '/app/models')
MODEL_SIZE = os.getenv('WHISPER_MODEL_SIZE', 'base')
SERVER_PORT = int(os.getenv('WHISPER_SERVER_PORT', 8002))
DEVICE = os.getenv('WHISPER_DEVICE', 'auto')
MAX_FILE_SIZE = int(os.getenv('WHISPER_MAX_FILE_SIZE', 50 * 1024 * 1024))  # 50MB

# 支持的模型大小
AVAILABLE_MODELS = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large', 'large-v2', 'large-v3']

# Whisper.cpp 可执行文件路径
WHISPER_MAIN = '/usr/local/bin/main'


class TranscriptionResponse(BaseModel):
    """转录响应"""
    text: str
    language: Optional[str] = None
    duration: Optional[float] = None
    segments: Optional[List[dict]] = None
    confidence: Optional[float] = None


class ModelInfo(BaseModel):
    """模型信息"""
    id: str
    object: str = "model"
    created: int
    owned_by: str = "whisper.cpp"


class ModelsResponse(BaseModel):
    """模型列表响应"""
    object: str = "list"
    data: List[ModelInfo]


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str
    model: str
    device: str
    version: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    logger.info(f"Whisper.cpp Server starting...")
    logger.info(f"Model directory: {MODEL_DIR}")
    logger.info(f"Default model: {MODEL_SIZE}")
    logger.info(f"Device: {DEVICE}")

    # 检查模型是否存在
    model_path = get_model_path(MODEL_SIZE)
    if not model_path.exists():
        logger.warning(f"Default model not found: {model_path}")
        logger.info(f"Please download model: whisper-cpp --model {MODEL_SIZE}")

    # 检查 whisper 可执行文件
    if not Path(WHISPER_MAIN).exists():
        logger.error(f"Whisper executable not found: {WHISPER_MAIN}")

    yield

    logger.info("Whisper.cpp Server shutting down...")


# 创建 FastAPI 应用
app = FastAPI(
    title="Whisper.cpp Server",
    description="Local speech recognition server compatible with OpenAI Whisper API",
    version="1.0.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_model_path(model_size: str) -> Path:
    """获取模型文件路径"""
    # whisper.cpp 模型文件格式: ggml-{model}.bin
    model_name = f"ggml-{model_size}.bin"
    return Path(MODEL_DIR) / model_name


def detect_device() -> str:
    """检测可用设备"""
    if DEVICE != 'auto':
        return DEVICE

    # 检查 CUDA
    try:
        result = subprocess.run(['nvidia-smi'], capture_output=True, timeout=5)
        if result.returncode == 0:
            return 'cuda'
    except Exception:
        pass

    return 'cpu'


async def run_whisper(
    audio_path: str,
    model_size: str = MODEL_SIZE,
    language: Optional[str] = None,
    task: str = 'transcribe',
    temperature: float = 0.0,
    initial_prompt: Optional[str] = None,
    output_format: str = 'json'
) -> dict:
    """
    运行 whisper.cpp 进行语音识别

    Args:
        audio_path: 音频文件路径
        model_size: 模型大小
        language: 语言代码
        task: transcribe 或 translate
        temperature: 温度参数
        initial_prompt: 初始提示
        output_format: 输出格式

    Returns:
        识别结果字典
    """
    model_path = get_model_path(model_size)

    if not model_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Model not found: {model_size}. Please download it first."
        )

    # 构建命令
    cmd = [
        WHISPER_MAIN,
        '-m', str(model_path),
        '-f', audio_path,
        '-oj',  # 输出 JSON
        '--no-prints',  # 减少输出
    ]

    # 添加语言参数
    if language:
        cmd.extend(['-l', language])

    # 翻译任务
    if task == 'translate':
        cmd.append('--translate')

    # 温度参数
    if temperature > 0:
        cmd.extend(['--temperature', str(temperature)])

    # 初始提示
    if initial_prompt:
        cmd.extend(['--prompt', initial_prompt])

    # 检测并使用 GPU
    device = detect_device()
    if device == 'cuda':
        cmd.extend(['--gpu'])

    logger.info(f"Running whisper command: {' '.join(cmd)}")

    start_time = time.time()

    # 运行命令
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    stdout, stderr = await process.communicate()
    duration = time.time() - start_time

    if process.returncode != 0:
        error_msg = stderr.decode('utf-8', errors='ignore')
        logger.error(f"Whisper error: {error_msg}")
        raise HTTPException(status_code=500, detail=f"Whisper error: {error_msg}")

    # 解析输出
    try:
        output = stdout.decode('utf-8', errors='ignore').strip()

        # whisper.cpp JSON 输出
        if output.startswith('{'):
            result = json.loads(output)
            text = result.get('transcription', [{}])[0].get('text', '')
            segments = result.get('transcription', [])
        else:
            # 纯文本输出
            text = output
            segments = []

        return {
            'text': text.strip(),
            'language': language or 'auto',
            'duration': duration,
            'segments': segments,
            'confidence': 0.9,  # whisper.cpp 不返回置信度
        }
    except json.JSONDecodeError:
        # 回退到纯文本
        return {
            'text': stdout.decode('utf-8', errors='ignore').strip(),
            'language': language or 'auto',
            'duration': duration,
            'segments': [],
            'confidence': 0.9,
        }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """健康检查端点"""
    return HealthResponse(
        status="ok",
        model=MODEL_SIZE,
        device=detect_device(),
        version="1.0.0"
    )


@app.get("/v1/models", response_model=ModelsResponse)
async def list_models():
    """列出可用模型"""
    models = []
    current_time = int(time.time())

    for model_name in AVAILABLE_MODELS:
        model_path = get_model_path(model_name)
        if model_path.exists():
            models.append(ModelInfo(
                id=model_name,
                created=current_time,
            ))

    return ModelsResponse(data=models)


@app.post("/v1/audio/transcriptions")
async def create_transcription(
    file: UploadFile = File(...),
    model: str = Form(default=MODEL_SIZE),
    language: Optional[str] = Form(default=None),
    prompt: Optional[str] = Form(default=None),
    response_format: str = Form(default='json'),
    temperature: float = Form(default=0.0),
):
    """
    转录音频文件

    兼容 OpenAI Whisper API
    """
    # 检查文件大小
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE / 1024 / 1024:.1f}MB"
        )

    # 保存临时文件
    suffix = Path(file.filename).suffix if file.filename else '.wav'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        tmp_path = tmp_file.name
        await aiofiles.open(tmp_path, 'wb').then(lambda f: f.write(content))

    try:
        # 将音频转换为 16kHz WAV（如果需要）
        wav_path = await convert_to_wav(tmp_path)

        # 运行 Whisper
        result = await run_whisper(
            audio_path=wav_path,
            model_size=model,
            language=language,
            task='transcribe',
            temperature=temperature,
            initial_prompt=prompt,
        )

        # 根据响应格式返回
        if response_format == 'text':
            return result['text']
        elif response_format == 'srt':
            return generate_srt(result['segments'])
        elif response_format == 'vtt':
            return generate_vtt(result['segments'])
        else:
            return TranscriptionResponse(**result)

    finally:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
            if wav_path != tmp_path:
                os.unlink(wav_path)
        except Exception:
            pass


@app.post("/v1/audio/translations")
async def create_translation(
    file: UploadFile = File(...),
    model: str = Form(default=MODEL_SIZE),
    prompt: Optional[str] = Form(default=None),
    response_format: str = Form(default='json'),
    temperature: float = Form(default=0.0),
):
    """
    翻译音频到英文

    兼容 OpenAI Whisper API
    """
    # 检查文件大小
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE / 1024 / 1024:.1f}MB"
        )

    # 保存临时文件
    suffix = Path(file.filename).suffix if file.filename else '.wav'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        tmp_path = tmp_file.name
        await aiofiles.open(tmp_path, 'wb').then(lambda f: f.write(content))

    try:
        # 转换音频
        wav_path = await convert_to_wav(tmp_path)

        # 运行 Whisper（翻译模式）
        result = await run_whisper(
            audio_path=wav_path,
            model_size=model,
            language='en',  # 翻译到英文
            task='translate',
            temperature=temperature,
            initial_prompt=prompt,
        )

        if response_format == 'text':
            return result['text']
        else:
            return TranscriptionResponse(**result)

    finally:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
            if wav_path != tmp_path:
                os.unlink(wav_path)
        except Exception:
            pass


async def convert_to_wav(input_path: str) -> str:
    """
    将音频转换为 16kHz 单声道 WAV

    whisper.cpp 要求 16kHz 单声道音频
    """
    output_path = input_path.rsplit('.', 1)[0] + '_16k.wav'

    # 使用 ffmpeg 转换
    cmd = [
        'ffmpeg', '-y',
        '-i', input_path,
        '-ar', '16000',
        '-ac', '1',
        '-c:a', 'pcm_s16le',
        output_path
    ]

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    await process.communicate()

    if process.returncode != 0 or not Path(output_path).exists():
        # 转换失败，尝试直接使用原文件
        return input_path

    return output_path


def generate_srt(segments: List[dict]) -> str:
    """生成 SRT 字幕格式"""
    srt_lines = []
    for i, segment in enumerate(segments, 1):
        start = format_timestamp_srt(segment.get('start', 0))
        end = format_timestamp_srt(segment.get('end', 0))
        text = segment.get('text', '').strip()

        srt_lines.append(f"{i}")
        srt_lines.append(f"{start} --> {end}")
        srt_lines.append(text)
        srt_lines.append("")

    return '\n'.join(srt_lines)


def generate_vtt(segments: List[dict]) -> str:
    """生成 WebVTT 字幕格式"""
    vtt_lines = ["WEBVTT", ""]
    for segment in segments:
        start = format_timestamp_vtt(segment.get('start', 0))
        end = format_timestamp_vtt(segment.get('end', 0))
        text = segment.get('text', '').strip()

        vtt_lines.append(f"{start} --> {end}")
        vtt_lines.append(text)
        vtt_lines.append("")

    return '\n'.join(vtt_lines)


def format_timestamp_srt(seconds: float) -> str:
    """格式化 SRT 时间戳"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_timestamp_vtt(seconds: float) -> str:
    """格式化 VTT 时间戳"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT)
