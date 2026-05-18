#!/usr/bin/env bash
# ============================================
# ChainlessChain Services Health Check
# For Git Bash / WSL on Windows
# ============================================

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo -e "${GREEN}========================================${RESET}"
echo -e "${GREEN}  ChainlessChain Services Status${RESET}"
echo -e "${GREEN}========================================${RESET}"
echo ""

# Function to check if port is in use
check_port() {
    local port=$1
    netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING &> /dev/null
}

# ============================================
# Check PostgreSQL
# ============================================
echo "[PostgreSQL]"
if check_port 5432; then
    echo -e "  Status: ${GREEN}RUNNING${RESET}"
    echo "  Port: 5432"
else
    echo -e "  Status: ${RED}STOPPED${RESET}"
fi
echo ""

# ============================================
# Check Redis
# ============================================
echo "[Redis]"
if check_port 6379; then
    echo -e "  Status: ${GREEN}RUNNING${RESET}"
    echo "  Port: 6379"
else
    echo -e "  Status: ${RED}STOPPED${RESET}"
fi
echo ""

# ============================================
# Check Qdrant
# ============================================
echo "[Qdrant Vector Database]"
if check_port 6333; then
    echo -e "  Status: ${GREEN}RUNNING${RESET}"
    echo "  Port: 6333 (HTTP), 6334 (gRPC)"
else
    echo -e "  Status: ${RED}STOPPED${RESET}"
fi
echo ""

# ============================================
# Check Project Service
# ============================================
echo "[Project Service (Java)]"
if check_port 9090; then
    echo -e "  Status: ${GREEN}RUNNING${RESET}"
    echo "  Port: 9090"
else
    echo -e "  Status: ${RED}STOPPED${RESET}"
fi
echo ""

# ============================================
# Check Port Usage
# ============================================
echo -e "${YELLOW}========================================${RESET}"
echo -e "${YELLOW}  Port Usage${RESET}"
echo -e "${YELLOW}========================================${RESET}"
netstat -ano 2>/dev/null | grep -E ":(5432|6379|6333|9090) " || echo "  No ports in use"
echo ""

echo -e "${GREEN}========================================${RESET}"
