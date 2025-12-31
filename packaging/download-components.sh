#!/usr/bin/env bash
# ============================================
# Download Third-Party Components Script
# For Git Bash / WSL on Windows
# ============================================

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN} ChainlessChain Components Downloader${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PACKAGING_DIR="$SCRIPT_DIR"
TEMP_DOWNLOAD="/tmp/chainlesschain-components"

# Create temporary download directory
mkdir -p "$TEMP_DOWNLOAD"

# ============================================
# 1. Download Redis for Windows
# ============================================
echo -e "${YELLOW}[1/4] Downloading Redis for Windows...${RESET}"
if [ -f "$PACKAGING_DIR/redis/redis-server.exe" ]; then
    echo -e "  ${GREEN}✓ Redis already exists, skipping${RESET}"
else
    echo "  Downloading Redis..."
    REDIS_URL="https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"

    if curl -L "$REDIS_URL" -o "$TEMP_DOWNLOAD/redis.zip"; then
        echo "  Extracting Redis..."
        mkdir -p "$PACKAGING_DIR/redis"
        unzip -q "$TEMP_DOWNLOAD/redis.zip" -d "$PACKAGING_DIR/redis"
        echo -e "  ${GREEN}✓ Redis downloaded and extracted${RESET}"
    else
        echo -e "  ${RED}✗ Redis download failed${RESET}"
        echo "  Please download manually from: https://github.com/tporadowski/redis/releases"
    fi
fi
echo ""

# ============================================
# 2. Download Qdrant
# ============================================
echo -e "${YELLOW}[2/4] Downloading Qdrant...${RESET}"
if [ -f "$PACKAGING_DIR/qdrant/qdrant.exe" ]; then
    echo -e "  ${GREEN}✓ Qdrant already exists, skipping${RESET}"
else
    echo "  Downloading Qdrant..."
    QDRANT_URL="https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip"

    if curl -L "$QDRANT_URL" -o "$TEMP_DOWNLOAD/qdrant.zip"; then
        echo "  Extracting Qdrant..."
        mkdir -p "$TEMP_DOWNLOAD/qdrant-temp"
        unzip -q "$TEMP_DOWNLOAD/qdrant.zip" -d "$TEMP_DOWNLOAD/qdrant-temp"

        # Find and move qdrant.exe
        mkdir -p "$PACKAGING_DIR/qdrant"
        find "$TEMP_DOWNLOAD/qdrant-temp" -name "qdrant.exe" -exec mv {} "$PACKAGING_DIR/qdrant/" \;

        echo -e "  ${GREEN}✓ Qdrant downloaded and extracted${RESET}"
    else
        echo -e "  ${RED}✗ Qdrant download failed${RESET}"
        echo "  Please download manually from: https://github.com/qdrant/qdrant/releases"
    fi
fi
echo ""

# ============================================
# 3. PostgreSQL (Manual Download Required)
# ============================================
echo -e "${YELLOW}[3/4] PostgreSQL (Manual Download Required)${RESET}"
if [ -f "$PACKAGING_DIR/postgres/bin/postgres.exe" ]; then
    echo -e "  ${GREEN}✓ PostgreSQL already exists${RESET}"
else
    echo -e "  ${YELLOW}PostgreSQL requires manual download:${RESET}"
    echo "  1. Visit: https://www.enterprisedb.com/download-postgresql-binaries"
    echo "  2. Download: PostgreSQL 16.x Windows x64 binaries"
    echo "  3. Extract to: $PACKAGING_DIR/postgres/"
    echo ""
    read -p "  Press Enter to open download page..." -r
    if command -v start &> /dev/null; then
        start https://www.enterprisedb.com/download-postgresql-binaries
    elif command -v xdg-open &> /dev/null; then
        xdg-open https://www.enterprisedb.com/download-postgresql-binaries
    else
        echo "  Please manually open: https://www.enterprisedb.com/download-postgresql-binaries"
    fi
fi
echo ""

echo -e "${YELLOW}[4/4] JRE 17 (Manual Download Required)${RESET}"
if [ -f "$PACKAGING_DIR/jre-17/bin/java.exe" ]; then
    echo -e "  ${GREEN}✓ JRE 17 already exists${RESET}"
else
    echo -e "  ${YELLOW}JRE 17 requires manual download:${RESET}"
    echo "  1. Visit: https://adoptium.net/temurin/releases/?version=17"
    echo "  2. Select: Windows x64 JRE .zip"
    echo "  3. Extract to: $PACKAGING_DIR/jre-17/"
    echo ""
    read -p "  Press Enter to open download page..." -r
    if command -v start &> /dev/null; then
        start https://adoptium.net/temurin/releases/?version=17
    elif command -v xdg-open &> /dev/null; then
        xdg-open https://adoptium.net/temurin/releases/?version=17
    else
        echo "  Please manually open: https://adoptium.net/temurin/releases/?version=17"
    fi
fi
echo ""

# ============================================
# Clean up temporary files
# ============================================
echo -e "${CYAN}Cleaning up temporary files...${RESET}"
rm -rf "$TEMP_DOWNLOAD"

# ============================================
# Check all components
# ============================================
echo ""
echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN} Component Status Check${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo ""

ALL_READY=1

echo "[PostgreSQL]"
if [ -f "$PACKAGING_DIR/postgres/bin/postgres.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    ALL_READY=0
fi

echo ""
echo "[Redis]"
if [ -f "$PACKAGING_DIR/redis/redis-server.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    ALL_READY=0
fi

echo ""
echo "[Qdrant]"
if [ -f "$PACKAGING_DIR/qdrant/qdrant.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    ALL_READY=0
fi

echo ""
echo "[JRE 17]"
if [ -f "$PACKAGING_DIR/jre-17/bin/java.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    ALL_READY=0
fi

echo ""
echo -e "${CYAN}========================================${RESET}"

if [ $ALL_READY -eq 1 ]; then
    echo -e "${GREEN} All components are ready! ${RESET}"
    echo -e "${GREEN} You can now run: ./build-windows-package.sh ${RESET}"
else
    echo -e "${YELLOW} Some components are missing. ${RESET}"
    echo -e "${YELLOW} Please download them manually. ${RESET}"
fi

echo -e "${CYAN}========================================${RESET}"
echo ""
