#!/usr/bin/env bash
# ============================================
# ChainlessChain Windows Package Builder
# For Git Bash / WSL on Windows
# ============================================

set -e  # Exit on error

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN} ChainlessChain Windows Package Builder${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$SCRIPT_DIR"
PACKAGING_DIR="$ROOT_DIR/packaging"
BACKEND_DIR="$ROOT_DIR/backend"
DESKTOP_DIR="$ROOT_DIR/desktop-app-vue"
DIST_DIR="$PACKAGING_DIR/dist"
BUILD_LOG="$PACKAGING_DIR/build.log"

# Create necessary directories
echo -e "${YELLOW}[0/8] Creating directories...${RESET}"
mkdir -p "$PACKAGING_DIR"
mkdir -p "$DIST_DIR"
mkdir -p "$PACKAGING_DIR/jre-17"
mkdir -p "$PACKAGING_DIR/postgres"
mkdir -p "$PACKAGING_DIR/redis"
mkdir -p "$PACKAGING_DIR/qdrant"
mkdir -p "$PACKAGING_DIR/config"

# Initialize build log
echo "[$(date)] Build started" > "$BUILD_LOG"

# ============================================
# Step 1: Check required tools
# ============================================
echo ""
echo -e "${CYAN}[1/8] Checking required tools...${RESET}"
echo "[$(date)] Checking required tools" >> "$BUILD_LOG"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "  ${GREEN}✓ Node.js found: $NODE_VERSION${RESET}"
else
    echo -e "  ${RED}ERROR: Node.js not found. Please install Node.js first.${RESET}"
    echo "[$(date)] ERROR: Node.js not found" >> "$BUILD_LOG"
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "  ${GREEN}✓ npm found: $NPM_VERSION${RESET}"
else
    echo -e "  ${RED}ERROR: npm not found.${RESET}"
    exit 1
fi

# Check Maven (optional)
SKIP_JAVA_BUILD=0
if command -v mvn &> /dev/null; then
    MVN_VERSION=$(mvn --version | head -n 1)
    echo "  ${GREEN}✓ Maven found: $MVN_VERSION${RESET}"
else
    echo -e "  ${YELLOW}WARNING: Maven not found. Will skip Java backend build.${RESET}"
    echo -e "  ${YELLOW}         Please manually build backend/project-service.${RESET}"
    echo "[$(date)] WARNING: Maven not found" >> "$BUILD_LOG"
    SKIP_JAVA_BUILD=1
fi

# Check Java (optional)
if command -v java &> /dev/null; then
    JAVA_VERSION=$(java -version 2>&1 | head -n 1)
    echo "  ${GREEN}✓ Java found: $JAVA_VERSION${RESET}"
else
    echo -e "  ${YELLOW}WARNING: Java not found.${RESET}"
fi

echo ""

# ============================================
# Step 2: Build Java Backend Service
# ============================================
echo -e "${CYAN}[2/8] Building Java Backend Service...${RESET}"
echo "[$(date)] Building Java backend" >> "$BUILD_LOG"

if [ $SKIP_JAVA_BUILD -eq 1 ]; then
    echo -e "${YELLOW}Skipping Java build (Maven not available)${RESET}"
    # Check for any JAR file in target directory
    JAR_FILE=$(find "$BACKEND_DIR/project-service/target" -maxdepth 1 -name "*.jar" -type f 2>/dev/null | head -n 1)
    if [ -n "$JAR_FILE" ]; then
        echo -e "  ${GREEN}✓ Using existing JAR file: $(basename "$JAR_FILE")${RESET}"
    else
        echo -e "  ${RED}ERROR: No JAR file found and Maven not available${RESET}"
        echo -e "  ${RED}Please build backend/project-service manually${RESET}"
        echo "[$(date)] ERROR: No JAR file and no Maven" >> "$BUILD_LOG"
        exit 1
    fi
else
    cd "$BACKEND_DIR/project-service"
    if mvn clean package -DskipTests 2>&1 | tee -a "$BUILD_LOG"; then
        echo -e "  ${GREEN}✓ Java backend built successfully${RESET}"
        echo "[$(date)] Java backend built successfully" >> "$BUILD_LOG"
    else
        echo -e "${RED}ERROR: Java backend build failed${RESET}"
        echo "[$(date)] ERROR: Java backend build failed" >> "$BUILD_LOG"
        exit 1
    fi
    cd "$ROOT_DIR"
fi

echo ""

# ============================================
# Step 3: Prepare third-party components
# ============================================
echo -e "${CYAN}[3/8] Preparing third-party components...${RESET}"
echo "[$(date)] Preparing third-party components" >> "$BUILD_LOG"

# 3.1 PostgreSQL
echo "  [3.1] PostgreSQL..."
if [ -f "$PACKAGING_DIR/postgres/bin/postgres.exe" ]; then
    echo -e "    ${GREEN}✓ PostgreSQL ready${RESET}"
else
    echo -e "    ${YELLOW}PostgreSQL not found. Please download manually:${RESET}"
    echo "    https://www.enterprisedb.com/download-postgresql-binaries"
    echo "    Extract to: $PACKAGING_DIR/postgres/"
    echo ""
    read -p "Press Enter to continue (or Ctrl+C to abort)..."
fi

# 3.2 Redis
echo "  [3.2] Redis..."
if [ -f "$PACKAGING_DIR/redis/redis-server.exe" ]; then
    echo -e "    ${GREEN}✓ Redis ready${RESET}"
else
    echo -e "    ${YELLOW}Redis not found. Attempting to download...${RESET}"
    REDIS_URL="https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip"
    REDIS_ZIP="/tmp/redis.zip"

    if curl -L "$REDIS_URL" -o "$REDIS_ZIP"; then
        unzip -q "$REDIS_ZIP" -d "$PACKAGING_DIR/redis"
        echo -e "    ${GREEN}✓ Redis downloaded${RESET}"
    else
        echo -e "    ${YELLOW}Download failed. Please download manually:${RESET}"
        echo "    https://github.com/tporadowski/redis/releases"
        read -p "Press Enter to continue..."
    fi
fi

# 3.3 Qdrant
echo "  [3.3] Qdrant..."
if [ -f "$PACKAGING_DIR/qdrant/qdrant.exe" ]; then
    echo -e "    ${GREEN}✓ Qdrant ready${RESET}"
else
    echo -e "    ${YELLOW}Qdrant not found. Attempting to download...${RESET}"
    QDRANT_URL="https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip"
    QDRANT_ZIP="/tmp/qdrant.zip"

    if curl -L "$QDRANT_URL" -o "$QDRANT_ZIP"; then
        unzip -q "$QDRANT_ZIP" -d "/tmp/qdrant-temp"
        # Find and move qdrant.exe
        find /tmp/qdrant-temp -name "qdrant.exe" -exec mv {} "$PACKAGING_DIR/qdrant/" \;
        rm -rf /tmp/qdrant-temp
        echo -e "    ${GREEN}✓ Qdrant downloaded${RESET}"
    else
        echo -e "    ${YELLOW}Download failed. Please download manually:${RESET}"
        echo "    https://github.com/qdrant/qdrant/releases"
        read -p "Press Enter to continue..."
    fi
fi

# 3.4 JRE
echo "  [3.4] JRE 17..."
if [ -f "$PACKAGING_DIR/jre-17/bin/java.exe" ]; then
    echo -e "    ${GREEN}✓ JRE 17 ready${RESET}"
else
    echo -e "    ${YELLOW}JRE 17 not found. Please download manually:${RESET}"
    echo "    https://adoptium.net/temurin/releases/?version=17"
    echo "    Download: Windows x64 JRE .zip"
    echo "    Extract to: $PACKAGING_DIR/jre-17/"
    echo ""
    read -p "Press Enter to continue..."
fi

echo ""

# ============================================
# Step 4: Create configuration files
# ============================================
echo -e "${CYAN}[4/8] Creating configuration files...${RESET}"
echo "[$(date)] Creating configuration files" >> "$BUILD_LOG"

# Redis config
if [ ! -f "$PACKAGING_DIR/config/redis.conf" ]; then
    cat > "$PACKAGING_DIR/config/redis.conf" << EOF
port 6379
requirepass chainlesschain_redis_2024
appendonly yes
dir ./data/redis
EOF
    echo -e "  ${GREEN}✓ Redis config created${RESET}"
fi

# Qdrant config
if [ ! -f "$PACKAGING_DIR/config/qdrant.yaml" ]; then
    cat > "$PACKAGING_DIR/config/qdrant.yaml" << EOF
service:
  http_port: 6333
  grpc_port: 6334

storage:
  storage_path: ./data/qdrant
EOF
    echo -e "  ${GREEN}✓ Qdrant config created${RESET}"
fi

echo ""

# ============================================
# Step 5: Build Electron Application
# ============================================
echo -e "${CYAN}[5/8] Building Electron Application...${RESET}"
echo "[$(date)] Building Electron application" >> "$BUILD_LOG"

cd "$DESKTOP_DIR"

# Install dependencies
echo "  Installing dependencies..."
if npm install 2>&1 | tee -a "$BUILD_LOG"; then
    echo -e "  ${GREEN}✓ Dependencies installed${RESET}"
else
    echo -e "${RED}ERROR: npm install failed${RESET}"
    exit 1
fi

# Build renderer
echo "  Building renderer (Vue)..."
if npm run build:renderer 2>&1 | tee -a "$BUILD_LOG"; then
    echo -e "  ${GREEN}✓ Renderer built${RESET}"
else
    echo -e "${RED}ERROR: Renderer build failed${RESET}"
    exit 1
fi

# Build main process
echo "  Building main process..."
if npm run build:main 2>&1 | tee -a "$BUILD_LOG"; then
    echo -e "  ${GREEN}✓ Main process built${RESET}"
else
    echo -e "${RED}ERROR: Main process build failed${RESET}"
    exit 1
fi

echo -e "  ${GREEN}✓ Electron app built successfully${RESET}"
echo "[$(date)] Electron app built successfully" >> "$BUILD_LOG"

cd "$ROOT_DIR"
echo ""

# ============================================
# Step 6: Package Electron Application
# ============================================
echo -e "${CYAN}[6/8] Packaging Electron Application...${RESET}"
echo "[$(date)] Packaging Electron application" >> "$BUILD_LOG"

cd "$DESKTOP_DIR"

if npm run package 2>&1 | tee -a "$BUILD_LOG"; then
    echo -e "  ${GREEN}✓ Electron app packaged${RESET}"
    echo "[$(date)] Electron app packaged" >> "$BUILD_LOG"
else
    echo -e "${YELLOW}WARNING: Package failed, trying to continue...${RESET}"
fi

cd "$ROOT_DIR"
echo ""

# ============================================
# Step 7: Create Windows Installer
# ============================================
echo -e "${CYAN}[7/8] Creating Windows Installer...${RESET}"
echo "[$(date)] Creating Windows installer" >> "$BUILD_LOG"

cd "$DESKTOP_DIR"

if npm run make:win 2>&1 | tee -a "$BUILD_LOG"; then
    echo -e "  ${GREEN}✓ Installer created successfully${RESET}"
    echo "[$(date)] Installer created successfully" >> "$BUILD_LOG"
else
    echo -e "${RED}ERROR: Installer creation failed${RESET}"
    echo "[$(date)] ERROR: Installer creation failed" >> "$BUILD_LOG"
    exit 1
fi

cd "$ROOT_DIR"
echo ""

# ============================================
# Step 8: Organize output files
# ============================================
echo -e "${CYAN}[8/8] Organizing output files...${RESET}"
echo "[$(date)] Organizing output files" >> "$BUILD_LOG"

# Copy installer to dist directory
if ls "$DESKTOP_DIR/out/make/squirrel.windows/x64/"*.exe &> /dev/null; then
    cp "$DESKTOP_DIR/out/make/squirrel.windows/x64/"*.exe "$DIST_DIR/"
    echo -e "  ${GREEN}✓ Installer copied to packaging/dist/${RESET}"
fi

# Copy version info
VERSION=$(grep -o '"version": *"[^"]*"' "$DESKTOP_DIR/package.json" | cut -d'"' -f4)
cat > "$DIST_DIR/VERSION.txt" << EOF
Version: $VERSION
Build Date: $(date)
EOF

echo ""
echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  Build Completed Successfully!${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""
echo "Output files location:"
echo "  $DIST_DIR"
echo ""
ls -lh "$DIST_DIR"
echo ""
echo -e "${CYAN}Package size and location:${RESET}"
for file in "$DIST_DIR"/*.exe; do
    if [ -f "$file" ]; then
        SIZE=$(du -h "$file" | cut -f1)
        echo "  $(basename "$file") - $SIZE"
    fi
done
echo ""
echo -e "${GREEN}Ready to distribute!${RESET}"
echo ""
echo "[$(date)] Build completed successfully" >> "$BUILD_LOG"

exit 0
