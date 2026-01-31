#!/bin/bash
# Whisper.cpp Server Startup Script

set -e

echo "==================================="
echo "  Whisper.cpp Server Starting...   "
echo "==================================="

# 配置
MODEL_DIR="${WHISPER_MODEL_DIR:-/app/models}"
MODEL_SIZE="${WHISPER_MODEL_SIZE:-base}"
SERVER_PORT="${WHISPER_SERVER_PORT:-8002}"

# 模型文件
MODEL_FILE="${MODEL_DIR}/ggml-${MODEL_SIZE}.bin"

# 检查模型文件
if [ ! -f "$MODEL_FILE" ]; then
    echo "Model not found: $MODEL_FILE"
    echo "Downloading model: $MODEL_SIZE ..."

    # 下载模型
    cd /whisper.cpp || cd /app
    bash models/download-ggml-model.sh "$MODEL_SIZE" || {
        echo "Model download script not found, trying wget..."
        MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL_SIZE}.bin"
        mkdir -p "$MODEL_DIR"
        wget -O "$MODEL_FILE" "$MODEL_URL" || {
            echo "Failed to download model. Please download manually:"
            echo "  wget -O $MODEL_FILE $MODEL_URL"
            exit 1
        }
    }

    echo "Model downloaded successfully!"
fi

# 检测 GPU
DEVICE="cpu"
if command -v nvidia-smi &> /dev/null; then
    if nvidia-smi &> /dev/null; then
        DEVICE="cuda"
        echo "GPU detected: CUDA enabled"
    fi
fi

echo "Configuration:"
echo "  Model: $MODEL_SIZE"
echo "  Model Path: $MODEL_FILE"
echo "  Device: $DEVICE"
echo "  Port: $SERVER_PORT"
echo "==================================="

# 启动服务
exec python3 server.py
