#!/bin/bash

# Whisper Service Startup Script

set -e

echo "=== Whisper Local Service Startup ==="
echo ""

# Check Python version
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo "✓ Python version: $PYTHON_VERSION"

# Check if FFmpeg is installed
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VERSION=$(ffmpeg -version 2>&1 | head -n 1)
    echo "✓ FFmpeg installed: $FFMPEG_VERSION"
else
    echo "✗ FFmpeg not found!"
    echo ""
    echo "Please install FFmpeg:"
    echo "  macOS:   brew install ffmpeg"
    echo "  Ubuntu:  sudo apt install ffmpeg"
    echo "  Windows: Download from https://ffmpeg.org/download.html"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo ""
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo ""
echo "Installing dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Check if .env exists
if [ ! -f ".env" ]; then
    echo ""
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "✓ .env file created. You can edit it to customize settings."
fi

# Load environment variables
if [ -f ".env" ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Get configuration
HOST=${WHISPER_HOST:-0.0.0.0}
PORT=${WHISPER_PORT:-8000}
MODEL=${WHISPER_MODEL:-base}

echo ""
echo "=== Configuration ==="
echo "Host: $HOST"
echo "Port: $PORT"
echo "Model: $MODEL"
echo "Device: $(python3 -c 'import torch; print("CUDA" if torch.cuda.is_available() else "CPU")')"
echo ""

# Start the service
echo "=== Starting Whisper Service ==="
echo "API Documentation: http://localhost:$PORT/docs"
echo "Health Check: http://localhost:$PORT/health"
echo ""
echo "Press Ctrl+C to stop the service"
echo ""

python3 main.py
