"""
Whisper Local Speech Recognition Service
FastAPI service for offline speech recognition using OpenAI Whisper
"""

import os
import tempfile
import logging
from pathlib import Path
from typing import Optional, List
import time

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import whisper
import torch
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Whisper Local Service",
    description="Offline speech recognition using OpenAI Whisper",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model cache
MODEL_CACHE = {}
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "base")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

logger.info(f"Using device: {DEVICE}")
logger.info(f"Default model: {DEFAULT_MODEL}")


def load_model(model_name: str = DEFAULT_MODEL):
    """Load Whisper model with caching"""
    if model_name not in MODEL_CACHE:
        logger.info(f"Loading Whisper model: {model_name}")
        start_time = time.time()

        try:
            model = whisper.load_model(model_name, device=DEVICE)
            MODEL_CACHE[model_name] = model

            load_time = time.time() - start_time
            logger.info(f"Model {model_name} loaded in {load_time:.2f}s")
        except Exception as e:
            logger.error(f"Failed to load model {model_name}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")

    return MODEL_CACHE[model_name]


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Whisper Local Service",
        "version": "1.0.0",
        "status": "running",
        "device": DEVICE,
        "models_loaded": list(MODEL_CACHE.keys())
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "device": DEVICE,
        "models_loaded": len(MODEL_CACHE)
    }


@app.get("/v1/models")
async def list_models():
    """List available Whisper models"""
    available_models = ["tiny", "base", "small", "medium", "large"]

    return {
        "models": [
            {
                "id": model,
                "object": "model",
                "owned_by": "openai",
                "permission": [],
                "loaded": model in MODEL_CACHE
            }
            for model in available_models
        ]
    }


@app.post("/v1/audio/transcriptions")
async def transcribe_audio(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    language: Optional[str] = Form(None),
    task: str = Form("transcribe"),
    temperature: float = Form(0.0),
    initial_prompt: Optional[str] = Form(None),
    response_format: str = Form("json")
):
    """
    Transcribe audio file using Whisper

    Compatible with OpenAI Whisper API format
    """
    temp_file = None

    try:
        # Validate model
        valid_models = ["tiny", "base", "small", "medium", "large"]
        if model not in valid_models:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model. Must be one of: {', '.join(valid_models)}"
            )

        # Validate task
        if task not in ["transcribe", "translate"]:
            raise HTTPException(
                status_code=400,
                detail="Task must be 'transcribe' or 'translate'"
            )

        # Save uploaded file to temporary location
        suffix = Path(file.filename).suffix
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
            content = await file.read()
            temp.write(content)
            temp_file = temp.name

        logger.info(f"Processing audio file: {file.filename} ({len(content)} bytes)")
        logger.info(f"Model: {model}, Language: {language}, Task: {task}")

        # Load model
        whisper_model = load_model(model)

        # Prepare transcription options
        options = {
            "task": task,
            "temperature": temperature,
        }

        if language:
            options["language"] = language

        if initial_prompt:
            options["initial_prompt"] = initial_prompt

        # Transcribe audio
        start_time = time.time()
        result = whisper_model.transcribe(temp_file, **options)
        transcription_time = time.time() - start_time

        logger.info(f"Transcription completed in {transcription_time:.2f}s")

        # Format response based on response_format
        if response_format == "json":
            return {
                "text": result["text"],
                "language": result.get("language", language),
                "duration": transcription_time,
                "segments": [
                    {
                        "id": seg["id"],
                        "seek": seg["seek"],
                        "start": seg["start"],
                        "end": seg["end"],
                        "text": seg["text"],
                        "tokens": seg["tokens"],
                        "temperature": seg["temperature"],
                        "avg_logprob": seg["avg_logprob"],
                        "compression_ratio": seg["compression_ratio"],
                        "no_speech_prob": seg["no_speech_prob"]
                    }
                    for seg in result.get("segments", [])
                ]
            }
        elif response_format == "text":
            return result["text"]
        elif response_format == "srt":
            return generate_srt(result["segments"])
        elif response_format == "vtt":
            return generate_vtt(result["segments"])
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid response_format: {response_format}"
            )

    except Exception as e:
        logger.error(f"Transcription error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        # Clean up temporary file
        if temp_file and os.path.exists(temp_file):
            try:
                os.unlink(temp_file)
            except Exception as e:
                logger.warning(f"Failed to delete temp file: {e}")


@app.post("/v1/audio/translations")
async def translate_audio(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    temperature: float = Form(0.0),
    initial_prompt: Optional[str] = Form(None),
    response_format: str = Form("json")
):
    """
    Translate audio to English using Whisper

    Compatible with OpenAI Whisper API format
    """
    return await transcribe_audio(
        file=file,
        model=model,
        language=None,
        task="translate",
        temperature=temperature,
        initial_prompt=initial_prompt,
        response_format=response_format
    )


def generate_srt(segments: List[dict]) -> str:
    """Generate SRT subtitle format"""
    srt_content = []

    for i, segment in enumerate(segments, 1):
        start = format_timestamp(segment["start"], srt=True)
        end = format_timestamp(segment["end"], srt=True)
        text = segment["text"].strip()

        srt_content.append(f"{i}\n{start} --> {end}\n{text}\n")

    return "\n".join(srt_content)


def generate_vtt(segments: List[dict]) -> str:
    """Generate WebVTT subtitle format"""
    vtt_content = ["WEBVTT\n"]

    for segment in segments:
        start = format_timestamp(segment["start"])
        end = format_timestamp(segment["end"])
        text = segment["text"].strip()

        vtt_content.append(f"{start} --> {end}\n{text}\n")

    return "\n".join(vtt_content)


def format_timestamp(seconds: float, srt: bool = False) -> str:
    """Format timestamp for subtitles"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)

    if srt:
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
    else:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


if __name__ == "__main__":
    # Get configuration from environment
    host = os.getenv("WHISPER_HOST", "0.0.0.0")
    port = int(os.getenv("WHISPER_PORT", "8000"))

    # Preload default model
    logger.info("Preloading default model...")
    try:
        load_model(DEFAULT_MODEL)
        logger.info("Default model loaded successfully")
    except Exception as e:
        logger.warning(f"Failed to preload model: {e}")

    # Start server
    logger.info(f"Starting Whisper service on {host}:{port}")
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
