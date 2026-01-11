# Quick Start: Offline Voice Recognition

Get started with offline voice recognition in 5 minutes!

## Prerequisites

- Python 3.8+ installed
- FFmpeg installed
- 4GB+ RAM available

## Step 1: Install FFmpeg (if not already installed)

### macOS
```bash
brew install ffmpeg
```

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

### Windows
Download from https://ffmpeg.org/download.html

## Step 2: Start Whisper Service

### Option A: Using Docker (Easiest)

```bash
# Start the service
docker-compose up -d whisper-service

# Check if it's running
curl http://localhost:8002/health
```

### Option B: Using Python

```bash
# Navigate to service directory
cd backend/whisper-service

# Run the startup script (it handles everything!)
./start.sh
```

## Step 3: Test the Service

```bash
# Run the test script
cd backend/whisper-service
./test.sh
```

You should see:
```
✓ Service is healthy
✓ Transcription successful
✓ All Tests Passed
```

## Step 4: Use in ChainlessChain App

1. Open ChainlessChain desktop app
2. Go to **Settings → Voice Recognition**
3. Select **"Whisper Local"** as the engine
4. Start using offline voice recognition!

## Quick Test

Try transcribing an audio file:

```bash
curl -X POST http://localhost:8002/v1/audio/transcriptions \
  -F "file=@your-audio.mp3" \
  -F "model=base" \
  -F "language=zh"
```

## Troubleshooting

### Service won't start?
- Check if Python 3.8+ is installed: `python3 --version`
- Check if FFmpeg is installed: `ffmpeg -version`
- Check if port 8002 is available: `lsof -i :8002`

### Slow transcription?
- Use the `base` model (default) for best speed/accuracy balance
- Consider using GPU acceleration (see full documentation)

### Need help?
- Check logs: `docker-compose logs whisper-service`
- Run tests: `./test.sh`
- See full documentation: `docs/implementation/WHISPER_LOCAL_IMPLEMENTATION.md`

## What's Next?

- Try different models (tiny, small, medium, large)
- Enable GPU acceleration for 10-20x speedup
- Explore subtitle generation (SRT/VTT formats)
- Use voice commands in the desktop app

## Model Recommendations

- **Quick testing**: `tiny` model (~1s per minute of audio)
- **Daily use**: `base` model (~2s per minute, good accuracy) ✅ **Recommended**
- **High accuracy**: `small` or `medium` model
- **Maximum quality**: `large` model (requires more RAM)

---

**That's it!** You now have offline voice recognition running. 🎉

For advanced configuration and features, see the full documentation.
