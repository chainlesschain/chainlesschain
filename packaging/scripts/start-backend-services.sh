#!/usr/bin/env bash
# ============================================
# ChainlessChain Backend Services Starter
# For Git Bash / WSL on Windows
# ============================================

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  ChainlessChain Backend Services${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$SCRIPT_DIR/../.."
BACKEND_DIR="$APP_DIR/backend"
DATA_DIR="$APP_DIR/data"
CONFIG_DIR="$APP_DIR/config"

# Check if in packaged environment
if [ -d "$APP_DIR/resources/backend" ]; then
    BACKEND_DIR="$APP_DIR/resources/backend"
    CONFIG_DIR="$APP_DIR/resources/config"
fi

# Create data directories
mkdir -p "$DATA_DIR"
mkdir -p "$DATA_DIR/postgres"
mkdir -p "$DATA_DIR/redis"
mkdir -p "$DATA_DIR/qdrant"
mkdir -p "$DATA_DIR/logs"

LOG_DIR="$DATA_DIR/logs"
STARTUP_LOG="$LOG_DIR/startup.log"

echo "[$(date)] Starting ChainlessChain backend services..." > "$STARTUP_LOG"

# Function to check if port is in use
check_port() {
    local port=$1
    netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING &> /dev/null
}

# ============================================
# 1. Check and start PostgreSQL
# ============================================
echo -e "[1/4] ${GREEN}Checking PostgreSQL...${RESET}"
if check_port 5432; then
    echo "      PostgreSQL is already running"
    echo "[$(date)] PostgreSQL is already running" >> "$STARTUP_LOG"
else
    echo "      Starting PostgreSQL..."

    # Check if PostgreSQL is initialized
    if [ ! -f "$DATA_DIR/postgres/PG_VERSION" ]; then
        echo "      Initializing PostgreSQL database..."
        if [ -f "$BACKEND_DIR/postgres/bin/initdb.exe" ]; then
            "$BACKEND_DIR/postgres/bin/initdb.exe" -D "$DATA_DIR/postgres" -U chainlesschain -E UTF8 --locale=C 2>> "$STARTUP_LOG"
            echo "      PostgreSQL initialized successfully"
        else
            echo -e "      ${RED}ERROR: PostgreSQL binaries not found${RESET}"
            echo "[$(date)] ERROR: PostgreSQL binaries not found" >> "$STARTUP_LOG"
        fi
    fi

    # Start PostgreSQL
    if [ -f "$BACKEND_DIR/postgres/bin/pg_ctl.exe" ]; then
        "$BACKEND_DIR/postgres/bin/pg_ctl.exe" -D "$DATA_DIR/postgres" -l "$LOG_DIR/postgres.log" start &
        sleep 5
        echo -e "      ${GREEN}PostgreSQL started${RESET}"
        echo "[$(date)] PostgreSQL started successfully" >> "$STARTUP_LOG"
    fi
fi

# ============================================
# 2. Check and start Redis
# ============================================
echo -e "[2/4] ${GREEN}Checking Redis...${RESET}"
if check_port 6379; then
    echo "      Redis is already running"
    echo "[$(date)] Redis is already running" >> "$STARTUP_LOG"
else
    echo "      Starting Redis..."
    if [ -f "$BACKEND_DIR/redis/redis-server.exe" ]; then
        if [ -f "$CONFIG_DIR/redis.conf" ]; then
            "$BACKEND_DIR/redis/redis-server.exe" "$CONFIG_DIR/redis.conf" --dir "$DATA_DIR/redis" &
        else
            "$BACKEND_DIR/redis/redis-server.exe" --dir "$DATA_DIR/redis" --requirepass chainlesschain_redis_2024 &
        fi
        sleep 2
        echo -e "      ${GREEN}Redis started${RESET}"
        echo "[$(date)] Redis started successfully" >> "$STARTUP_LOG"
    else
        echo -e "      ${YELLOW}WARNING: Redis binaries not found, skipping${RESET}"
        echo "[$(date)] WARNING: Redis binaries not found" >> "$STARTUP_LOG"
    fi
fi

# ============================================
# 3. Check and start Qdrant
# ============================================
echo -e "[3/4] ${GREEN}Checking Qdrant...${RESET}"
if check_port 6333; then
    echo "      Qdrant is already running"
    echo "[$(date)] Qdrant is already running" >> "$STARTUP_LOG"
else
    echo "      Starting Qdrant..."
    if [ -f "$BACKEND_DIR/qdrant/qdrant.exe" ]; then
        if [ -f "$CONFIG_DIR/qdrant.yaml" ]; then
            "$BACKEND_DIR/qdrant/qdrant.exe" --config-path "$CONFIG_DIR/qdrant.yaml" &
        else
            "$BACKEND_DIR/qdrant/qdrant.exe" --storage-path "$DATA_DIR/qdrant" &
        fi
        sleep 3
        echo -e "      ${GREEN}Qdrant started${RESET}"
        echo "[$(date)] Qdrant started successfully" >> "$STARTUP_LOG"
    else
        echo -e "      ${YELLOW}WARNING: Qdrant binaries not found, skipping${RESET}"
        echo "[$(date)] WARNING: Qdrant binaries not found" >> "$STARTUP_LOG"
    fi
fi

# ============================================
# 4. Start Java Project Service
# ============================================
echo -e "[4/4] ${GREEN}Starting Project Service...${RESET}"
if pgrep -f "project-service.jar" > /dev/null; then
    echo "      Project Service is already running"
    echo "[$(date)] Project Service is already running" >> "$STARTUP_LOG"
else
    if [ -f "$BACKEND_DIR/jre/bin/java.exe" ] && [ -f "$BACKEND_DIR/project-service.jar" ]; then
        "$BACKEND_DIR/jre/bin/java.exe" \
            -Xms256m -Xmx512m \
            -Dspring.profiles.active=production \
            -Dlogging.file.name="$LOG_DIR/project-service.log" \
            -jar "$BACKEND_DIR/project-service.jar" &
        sleep 3
        echo -e "      ${GREEN}Project Service started${RESET}"
        echo "[$(date)] Project Service started successfully" >> "$STARTUP_LOG"
    else
        echo -e "      ${YELLOW}WARNING: Java runtime or JAR not found${RESET}"
        echo "[$(date)] WARNING: Java runtime or JAR not found" >> "$STARTUP_LOG"
    fi
fi

echo ""
echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  All backend services started!${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""
echo "Services status:"
echo "  - PostgreSQL: http://localhost:5432"
echo "  - Redis: http://localhost:6379"
echo "  - Qdrant: http://localhost:6333"
echo "  - Project Service: http://localhost:9090"
echo ""
echo "Log files location: $LOG_DIR"
echo ""

echo "[$(date)] Startup completed" >> "$STARTUP_LOG"
