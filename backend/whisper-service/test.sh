#!/bin/bash

# Whisper Local Service Test Script

set -e

echo "=== Whisper Local Service Test ==="
echo ""

# Configuration
WHISPER_URL="${WHISPER_LOCAL_URL:-http://localhost:8002}"
TEST_AUDIO_URL="https://github.com/openai/whisper/raw/main/tests/jfk.flac"
TEST_AUDIO_FILE="/tmp/test-audio.flac"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo "Test 1: Health Check"
echo "-------------------"
if curl -s -f "$WHISPER_URL/health" > /dev/null; then
    echo -e "${GREEN}✓ Service is healthy${NC}"
else
    echo -e "${RED}✗ Service is not responding${NC}"
    echo ""
    echo "Please start the Whisper service:"
    echo "  cd backend/whisper-service"
    echo "  ./start.sh"
    exit 1
fi
echo ""

# Test 2: List Models
echo "Test 2: List Available Models"
echo "-----------------------------"
MODELS=$(curl -s "$WHISPER_URL/v1/models" | python3 -m json.tool)
echo "$MODELS"
echo ""

# Test 3: Download Test Audio
echo "Test 3: Download Test Audio"
echo "---------------------------"
if [ ! -f "$TEST_AUDIO_FILE" ]; then
    echo "Downloading test audio file..."
    curl -L -o "$TEST_AUDIO_FILE" "$TEST_AUDIO_URL"
    echo -e "${GREEN}✓ Test audio downloaded${NC}"
else
    echo -e "${YELLOW}Test audio already exists${NC}"
fi
echo ""

# Test 4: Transcribe Audio
echo "Test 4: Transcribe Audio"
echo "------------------------"
echo "Transcribing test audio (this may take a few seconds)..."
RESULT=$(curl -s -X POST "$WHISPER_URL/v1/audio/transcriptions" \
    -F "file=@$TEST_AUDIO_FILE" \
    -F "model=base" \
    -F "language=en")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Transcription successful${NC}"
    echo ""
    echo "Result:"
    echo "$RESULT" | python3 -m json.tool
else
    echo -e "${RED}✗ Transcription failed${NC}"
    exit 1
fi
echo ""

# Test 5: Performance Test
echo "Test 5: Performance Test"
echo "------------------------"
START_TIME=$(date +%s%N)
curl -s -X POST "$WHISPER_URL/v1/audio/transcriptions" \
    -F "file=@$TEST_AUDIO_FILE" \
    -F "model=base" \
    -F "language=en" > /dev/null
END_TIME=$(date +%s%N)
DURATION=$(( (END_TIME - START_TIME) / 1000000 ))
echo -e "${GREEN}✓ Transcription completed in ${DURATION}ms${NC}"
echo ""

# Cleanup
echo "Cleanup"
echo "-------"
rm -f "$TEST_AUDIO_FILE"
echo -e "${GREEN}✓ Test audio file removed${NC}"
echo ""

echo "=== All Tests Passed ✓ ==="
echo ""
echo "Whisper Local Service is working correctly!"
echo "You can now use it in the ChainlessChain desktop app."
