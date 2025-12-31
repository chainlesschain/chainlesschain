#!/usr/bin/env bash
# ============================================
# ChainlessChain Backend Services Stopper
# For Git Bash / WSL on Windows
# ============================================

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  Stopping Backend Services${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_DIR="$SCRIPT_DIR/../.."
DATA_DIR="$APP_DIR/data"

# Check if in packaged environment
if [ -d "$APP_DIR/resources/backend" ]; then
    DATA_DIR="$APP_DIR/data"
fi

# Create logs directory
mkdir -p "$DATA_DIR/logs"

LOG_DIR="$DATA_DIR/logs"
SHUTDOWN_LOG="$LOG_DIR/shutdown.log"

echo "[$(date)] Stopping ChainlessChain backend services..." > "$SHUTDOWN_LOG"

# ============================================
# 1. Stop Java Project Service
# ============================================
echo "[1/4] Stopping Project Service..."
if pgrep -f "project-service.jar" > /dev/null; then
    pkill -f "project-service.jar"
    echo -e "      ${GREEN}Project Service stopped${RESET}"
    echo "[$(date)] Project Service stopped" >> "$SHUTDOWN_LOG"
else
    echo "      Project Service was not running"
fi

# ============================================
# 2. Stop Qdrant
# ============================================
echo "[2/4] Stopping Qdrant..."
if pgrep -f "qdrant.exe" > /dev/null; then
    taskkill //F //IM qdrant.exe 2>/dev/null || pkill -f "qdrant.exe"
    echo -e "      ${GREEN}Qdrant stopped${RESET}"
    echo "[$(date)] Qdrant stopped" >> "$SHUTDOWN_LOG"
else
    echo "      Qdrant was not running"
fi

# ============================================
# 3. Stop Redis
# ============================================
echo "[3/4] Stopping Redis..."
if pgrep -f "redis-server.exe" > /dev/null; then
    taskkill //F //IM redis-server.exe 2>/dev/null || pkill -f "redis-server.exe"
    echo -e "      ${GREEN}Redis stopped${RESET}"
    echo "[$(date)] Redis stopped" >> "$SHUTDOWN_LOG"
else
    echo "      Redis was not running"
fi

# ============================================
# 4. Stop PostgreSQL
# ============================================
echo "[4/4] Stopping PostgreSQL..."
if pgrep -f "postgres.exe" > /dev/null; then
    # Try graceful shutdown first
    if [ -f "$APP_DIR/backend/postgres/bin/pg_ctl.exe" ]; then
        "$APP_DIR/backend/postgres/bin/pg_ctl.exe" -D "$DATA_DIR/postgres" stop -m fast 2>/dev/null
    elif [ -f "$APP_DIR/resources/backend/postgres/bin/pg_ctl.exe" ]; then
        "$APP_DIR/resources/backend/postgres/bin/pg_ctl.exe" -D "$DATA_DIR/postgres" stop -m fast 2>/dev/null
    fi
    sleep 3

    # Force kill if still running
    if pgrep -f "postgres.exe" > /dev/null; then
        taskkill //F //IM postgres.exe //T 2>/dev/null || pkill -9 -f "postgres.exe"
    fi
    echo -e "      ${GREEN}PostgreSQL stopped${RESET}"
    echo "[$(date)] PostgreSQL stopped" >> "$SHUTDOWN_LOG"
else
    echo "      PostgreSQL was not running"
fi

echo ""
echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  All services stopped successfully${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""

echo "[$(date)] Shutdown completed" >> "$SHUTDOWN_LOG"
