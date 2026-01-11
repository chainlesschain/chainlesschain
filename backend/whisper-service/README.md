# Whisper Local Service

Offline speech recognition service using OpenAI Whisper.

## Features

- **Offline Processing**: No internet connection required
- **Multiple Models**: Support for tiny, base, small, medium, and large models
- **Multi-language**: Supports 99+ languages
- **GPU Acceleration**: CUDA support for faster processing
- **OpenAI API Compatible**: Drop-in replacement for OpenAI Whisper API
- **Subtitle Generation**: SRT and WebVTT format support

## Installation

### Prerequisites

- Python 3.8+
- FFmpeg (required for audio processing)

#### Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from https://ffmpeg.org/download.html

### Install Python Dependencies

```bash
cd backend/whisper-service
pip install -r requirements.txt
```

### GPU Support (Optional)

For NVIDIA GPU acceleration:

```bash
# Install CUDA-enabled PyTorch
pip install torch==2.1.2+cu118 torchaudio==2.1.2+cu118 --index-url https://download.pytorch.org/whl/cu118
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:
```bash
WHISPER_HOST=0.0.0.0
WHISPER_PORT=8000
WHISPER_MODEL=base  # tiny/base/small/medium/large
```

## Usage

### Start the Service

```bash
python main.py
```

Or with uvicorn:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### API Endpoints

#### Health Check
```bash
curl http://localhost:8000/health
```

#### List Models
```bash
curl http://localhost:8000/v1/models
```

#### Transcribe Audio
```bash
curl -X POST http://localhost:8000/v1/audio/transcriptions \
  -F "file=@audio.mp3" \
  -F "model=base" \
  -F "language=zh"
```

#### Translate to English
```bash
curl -X POST http://localhost:8000/v1/audio/translations \
  -F "file=@audio.mp3" \
  -F "model=base"
```

## Model Comparison

| Model  | Parameters | Size  | Speed | Accuracy | Use Case |
|--------|-----------|-------|-------|----------|----------|
| tiny   | 39M       | ~75MB | Fast  | Basic    | Quick transcription, testing |
| base   | 74M       | ~140MB| Fast  | Good     | **Recommended for most users** |
| small  | 244M      | ~460MB| Medium| Better   | Higher accuracy needed |
| medium | 769M      | ~1.5GB| Slow  | High     | Professional use |
| large  | 1550M     | ~2.9GB| Very Slow | Highest | Maximum accuracy |

## Performance Tips

1. **Use GPU**: 10-20x faster than CPU
2. **Choose Right Model**: `base` model offers best speed/accuracy balance
3. **Preload Models**: Models are cached after first use
4. **Batch Processing**: Process multiple files concurrently

## Integration with ChainlessChain

The Electron app automatically connects to this service when available:

1. Start the Whisper service
2. Open ChainlessChain desktop app
3. Go to Settings → Voice Recognition
4. Select "Whisper Local" as the engine
5. Start using offline voice recognition!

## Troubleshooting

### Service won't start
- Check if port 8000 is available
- Verify FFmpeg is installed: `ffmpeg -version`
- Check Python version: `python --version` (3.8+ required)

### Slow transcription
- Use smaller model (tiny or base)
- Enable GPU acceleration
- Reduce audio file size

### Out of memory
- Use smaller model
- Process shorter audio segments
- Increase system RAM

## API Documentation

Interactive API docs available at:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## License

MIT License - See main project LICENSE file
