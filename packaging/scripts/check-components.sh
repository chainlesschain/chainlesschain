#!/usr/bin/env bash
# ============================================
# Check all build components
# For Git Bash / WSL on Windows
# ============================================

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${CYAN}========================================${RESET}"
echo -e "${CYAN} ChainlessChain Build Components Check${RESET}"
echo -e "${CYAN}========================================${RESET}"
echo ""

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$SCRIPT_DIR/../.."
PACKAGING_DIR="$ROOT_DIR/packaging"
BACKEND_DIR="$ROOT_DIR/backend"

ALL_READY=1

# ============================================
# 1. Check PostgreSQL
# ============================================
echo -e "${YELLOW}[1/5] PostgreSQL Portable${RESET}"
if [ -f "$PACKAGING_DIR/postgres/bin/postgres.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
    echo "  Path: $PACKAGING_DIR/postgres/bin/postgres.exe"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    echo "  Download: https://www.enterprisedb.com/download-postgresql-binaries"
    echo "  Extract to: $PACKAGING_DIR/postgres/"
    ALL_READY=0
fi
echo ""

# ============================================
# 2. Check Redis
# ============================================
echo -e "${YELLOW}[2/5] Redis for Windows${RESET}"
if [ -f "$PACKAGING_DIR/redis/redis-server.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
    echo "  Path: $PACKAGING_DIR/redis/redis-server.exe"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    echo "  Download: https://github.com/tporadowski/redis/releases"
    echo "  Extract to: $PACKAGING_DIR/redis/"
    ALL_READY=0
fi
echo ""

# ============================================
# 3. Check Qdrant
# ============================================
echo -e "${YELLOW}[3/5] Qdrant Vector Database${RESET}"
if [ -f "$PACKAGING_DIR/qdrant/qdrant.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
    echo "  Path: $PACKAGING_DIR/qdrant/qdrant.exe"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    echo "  Download: https://github.com/qdrant/qdrant/releases"
    echo "  Extract to: $PACKAGING_DIR/qdrant/"
    ALL_READY=0
fi
echo ""

# ============================================
# 4. Check JRE 17
# ============================================
echo -e "${YELLOW}[4/5] Java Runtime Environment 17${RESET}"
if [ -f "$PACKAGING_DIR/jre-17/bin/java.exe" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
    echo "  Path: $PACKAGING_DIR/jre-17/bin/java.exe"
    if [ -x "$PACKAGING_DIR/jre-17/bin/java.exe" ]; then
        "$PACKAGING_DIR/jre-17/bin/java.exe" -version 2>&1 | head -n 1
    fi
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    echo "  Download: https://adoptium.net/temurin/releases/?version=17"
    echo "  Extract to: $PACKAGING_DIR/jre-17/"
    ALL_READY=0
fi
echo ""

# ============================================
# 5. Check Java Backend
# ============================================
echo -e "${YELLOW}[5/5] Java Backend Service (JAR)${RESET}"
if [ -f "$BACKEND_DIR/project-service/target/project-service.jar" ]; then
    echo -e "  Status: ${GREEN}✓ Ready${RESET}"
    echo "  Path: $BACKEND_DIR/project-service/target/project-service.jar"

    # Show JAR file size
    SIZE=$(du -h "$BACKEND_DIR/project-service/target/project-service.jar" | cut -f1)
    echo "  Size: $SIZE"
else
    echo -e "  Status: ${RED}✗ Missing${RESET}"
    echo ""
    # Check if Maven is available
    if command -v mvn &> /dev/null; then
        echo -e "  ${YELLOW}Maven is available. You can build it:${RESET}"
        echo "  cd $BACKEND_DIR/project-service"
        echo "  mvn clean package -DskipTests"
    else
        echo -e "  ${RED}Maven is not installed.${RESET}"
        echo "  Option 1: Install Maven from https://maven.apache.org/download.cgi"
        echo "  Option 2: Use a pre-built JAR file"
    fi
    ALL_READY=0
fi
echo ""

# ============================================
# Extra check: Development Tools
# ============================================
echo -e "${YELLOW}[Extra] Development Tools${RESET}"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "  Node.js: ${GREEN}✓ Installed ($NODE_VERSION)${RESET}"
else
    echo -e "  Node.js: ${RED}✗ Not found${RESET}"
    ALL_READY=0
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "  npm: ${GREEN}✓ Installed ($NPM_VERSION)${RESET}"
else
    echo -e "  npm: ${RED}✗ Not found${RESET}"
    ALL_READY=0
fi
echo ""

# ============================================
# Final result
# ============================================
echo -e "${CYAN}========================================${RESET}"
if [ $ALL_READY -eq 1 ]; then
    echo -e "${GREEN} ✓ All components are ready!${RESET}"
    echo ""
    echo -e "${GREEN} You can now run:${RESET}"
    echo "  cd $ROOT_DIR"
    echo "  ./build-windows-package.sh"
    echo ""
else
    echo -e "${RED} ✗ Some components are missing${RESET}"
    echo ""
    echo -e "${YELLOW} Please download the missing components above${RESET}"
    echo ""
    echo -e "${CYAN} For detailed instructions, see:${RESET}"
    echo "  $PACKAGING_DIR/CURRENT_STATUS.md"
    echo "  $PACKAGING_DIR/BUILD_INSTRUCTIONS.md"
    echo ""
fi
echo -e "${CYAN}========================================${RESET}"
echo ""
