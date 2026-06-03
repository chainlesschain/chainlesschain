#!/bin/bash

echo "=========================================="
echo "  ChainlessChain Community Forum"
echo "  Starting all services..."
echo "=========================================="
echo ""

# 检查Docker
if ! command -v docker &> /dev/null; then
    echo "[ERROR] Docker is not installed."
    echo "Please install Docker first."
    echo "Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "[ERROR] Docker Compose is not installed."
    echo "Please install Docker Compose first."
    exit 1
fi

echo ""
echo "Starting Docker Compose..."

# 使用 docker compose 或 docker-compose
if docker compose version &> /dev/null; then
    docker compose up -d
else
    docker-compose up -d
fi

echo ""
echo "Waiting for services to be ready..."
sleep 30

echo ""
echo "=========================================="
echo "  Services started successfully!"
echo "=========================================="
echo ""
echo "  Frontend: http://localhost:8081"
echo "  Backend API: http://localhost:8082/api"
echo "  Swagger: http://localhost:8082/api/swagger-ui.html"
echo ""
echo "  MySQL: localhost:3306"
echo "  Redis: localhost:6379"
echo "  Elasticsearch: localhost:9200"
echo ""
echo "=========================================="
echo ""
echo "Checking service status..."

if docker compose version &> /dev/null; then
    docker compose ps
else
    docker-compose ps
fi

echo ""
echo "Press Ctrl+C to stop viewing logs..."
echo ""

if docker compose version &> /dev/null; then
    docker compose logs -f
else
    docker-compose logs -f
fi
