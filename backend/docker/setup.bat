@echo off
REM ChainlessChain AI服务初始化脚本 (Windows)

echo ======================================
echo ChainlessChain AI服务初始化
echo ======================================
echo.

REM 检查Docker是否运行
docker info >nul 2>&1
if errorlevel 1 (
    echo 错误: Docker未运行,请启动Docker Desktop
    pause
    exit /b 1
)

echo [1/5] 启动Docker服务...
docker-compose up -d

echo.
echo [2/5] 等待服务就绪...
timeout /t 10 /nobreak >nul

echo.
echo [3/5] 检查Ollama连接...
curl -s http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 (
    echo × Ollama服务未就绪,请检查Docker日志
) else (
    echo √ Ollama服务已就绪
)

echo.
echo [4/5] 下载推荐模型...
echo 正在下载 qwen2:7b (这可能需要几分钟)...
docker exec chainlesschain-ollama ollama pull qwen2:7b

echo.
echo 正在下载 nomic-embed-text (Embedding模型)...
docker exec chainlesschain-ollama ollama pull nomic-embed-text

echo.
echo [5/5] 初始化向量数据库...
curl -X PUT "http://localhost:6333/collections/knowledge_base" -H "Content-Type: application/json" -d "{\"vectors\":{\"size\":768,\"distance\":\"Cosine\"}}"

echo.
echo ======================================
echo 初始化完成!
echo ======================================
echo.
echo 服务状态:
echo   - Ollama LLM:     http://localhost:11434
echo   - Qdrant向量DB:   http://localhost:6333
echo   - AnythingLLM:    http://localhost:3001
echo   - Gitea Git:      http://localhost:3000
echo.
echo 常用命令:
echo   - 查看日志: docker-compose logs -f
echo   - 停止服务: docker-compose down
echo   - 重启服务: docker-compose restart
echo.
pause
