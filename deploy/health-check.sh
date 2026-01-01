#!/bin/bash

##############################################
# ChainlessChain 健康检查脚本
# 用途: 检查所有服务的运行状态
# 使用: ./health-check.sh
##############################################

set +e  # 允许命令失败，继续执行

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 加载环境变量
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

echo "========================================="
echo "ChainlessChain 健康检查"
echo "时间: $(date)"
echo "========================================="

# 检查函数
check_service() {
    local service_name=$1
    local check_command=$2
    local expected=$3

    echo -n "检查 $service_name... "

    result=$(eval "$check_command" 2>&1)
    status=$?

    if [ $status -eq 0 ] && [[ "$result" == *"$expected"* ]]; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        echo "  原因: $result"
        return 1
    fi
}

# 检查计数器
TOTAL=0
PASSED=0
FAILED=0

# 1. 检查AI服务
echo ""
echo "[1] AI服务 (FastAPI)"
TOTAL=$((TOTAL + 1))
if check_service "AI Service HTTP" "curl -s -o /dev/null -w '%{http_code}' http://localhost:8001/health" "200"; then
    PASSED=$((PASSED + 1))

    # 获取详细信息
    AI_INFO=$(curl -s http://localhost:8001/health 2>/dev/null)
    if [ -n "$AI_INFO" ]; then
        echo "  详情: $AI_INFO"
    fi
else
    FAILED=$((FAILED + 1))
fi

# 2. 检查Project服务
echo ""
echo "[2] 项目服务 (Spring Boot)"
TOTAL=$((TOTAL + 1))
if check_service "Project Service HTTP" "curl -s -o /dev/null -w '%{http_code}' http://localhost:9090/actuator/health" "200"; then
    PASSED=$((PASSED + 1))

    # 获取详细信息
    PROJECT_INFO=$(curl -s http://localhost:9090/actuator/health 2>/dev/null)
    if [ -n "$PROJECT_INFO" ]; then
        echo "  详情: $PROJECT_INFO"
    fi
else
    FAILED=$((FAILED + 1))
fi

# 3. 检查PostgreSQL
echo ""
echo "[3] PostgreSQL 数据库"
TOTAL=$((TOTAL + 1))
if check_service "PostgreSQL Connection" \
    "docker exec chainlesschain_postgres pg_isready -U ${DB_USER:-chainlesschain}" \
    "accepting connections"; then
    PASSED=$((PASSED + 1))

    # 获取数据库大小
    DB_SIZE=$(docker exec chainlesschain_postgres psql -U ${DB_USER:-chainlesschain} -d ${DB_NAME:-chainlesschain} -t -c "SELECT pg_size_pretty(pg_database_size('${DB_NAME:-chainlesschain}'));" 2>/dev/null | xargs)
    if [ -n "$DB_SIZE" ]; then
        echo "  数据库大小: $DB_SIZE"
    fi
else
    FAILED=$((FAILED + 1))
fi

# 4. 检查Redis
echo ""
echo "[4] Redis 缓存"
TOTAL=$((TOTAL + 1))
if check_service "Redis Connection" \
    "docker exec chainlesschain_redis redis-cli -a ${REDIS_PASSWORD} ping" \
    "PONG"; then
    PASSED=$((PASSED + 1))

    # 获取Redis信息
    REDIS_KEYS=$(docker exec chainlesschain_redis redis-cli -a ${REDIS_PASSWORD} DBSIZE 2>/dev/null | grep -o '[0-9]*')
    REDIS_MEM=$(docker exec chainlesschain_redis redis-cli -a ${REDIS_PASSWORD} INFO memory 2>/dev/null | grep used_memory_human | cut -d: -f2 | tr -d '\r')
    if [ -n "$REDIS_KEYS" ]; then
        echo "  键数量: $REDIS_KEYS"
        echo "  内存使用: $REDIS_MEM"
    fi
else
    FAILED=$((FAILED + 1))
fi

# 5. 检查Qdrant
echo ""
echo "[5] Qdrant 向量数据库"
TOTAL=$((TOTAL + 1))
if check_service "Qdrant Connection" \
    "curl -s http://localhost:6333/healthz" \
    ""; then  # Qdrant healthz返回空响应但200状态码
    PASSED=$((PASSED + 1))

    # 获取集合信息
    COLLECTIONS=$(curl -s http://localhost:6333/collections 2>/dev/null)
    if [ -n "$COLLECTIONS" ]; then
        echo "  集合信息: $COLLECTIONS"
    fi
else
    FAILED=$((FAILED + 1))
fi

# 6. 检查Docker容器状态
echo ""
echo "[6] Docker 容器状态"
echo ""
docker-compose -f ${COMPOSE_FILE:-docker-compose.production.yml} ps

# 7. 检查磁盘空间
echo ""
echo "[7] 磁盘空间"
echo ""
df -h ./data 2>/dev/null || df -h .

DISK_USAGE=$(df -h ./data 2>/dev/null | awk 'NR==2 {print $5}' | sed 's/%//')
if [ -n "$DISK_USAGE" ] && [ $DISK_USAGE -gt 80 ]; then
    echo -e "${YELLOW}⚠ 警告: 磁盘使用率超过80%${NC}"
fi

# 8. 检查内存使用
echo ""
echo "[8] 内存使用"
echo ""
free -h

# 9. 检查最近的错误日志
echo ""
echo "[9] 最近的错误日志（最近10条）"
echo ""

# AI服务错误
echo "AI服务错误:"
docker logs chainlesschain_ai_service 2>&1 | grep -i error | tail -5 || echo "  无错误"

# Project服务错误
echo ""
echo "Project服务错误:"
docker logs chainlesschain_project_service 2>&1 | grep -i error | tail -5 || echo "  无错误"

# 10. 总结
echo ""
echo "========================================="
echo "健康检查总结"
echo "========================================="
echo -e "总计: $TOTAL"
echo -e "${GREEN}通过: $PASSED${NC}"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}失败: $FAILED${NC}"
else
    echo -e "失败: $FAILED"
fi
echo "========================================="

# 返回状态码
if [ $FAILED -gt 0 ]; then
    exit 1
else
    exit 0
fi
