@echo off
REM 启动 ChromaDB 服务
echo ====================================
echo  启动 ChromaDB 向量数据库
echo ====================================
echo.

echo [1/3] 检查 Docker 是否运行...
docker ps >nul 2>&1
if errorlevel 1 (
    echo [错误] Docker 未运行，请先启动 Docker Desktop
    pause
    exit /b 1
)
echo [成功] Docker 正在运行

echo.
echo [2/3] 启动 ChromaDB 服务...
docker-compose up -d chromadb

if errorlevel 1 (
    echo [错误] ChromaDB 启动失败
    pause
    exit /b 1
)

echo.
echo [3/3] 等待服务就绪...
timeout /t 5 /nobreak >nul

echo.
echo [验证] 检查 ChromaDB 状态...
curl -s http://localhost:8000/api/v1/heartbeat >nul 2>&1
if errorlevel 1 (
    echo [警告] ChromaDB 可能尚未完全启动，请稍等片刻
) else (
    echo [成功] ChromaDB 运行正常！
)

echo.
echo ====================================
echo  ChromaDB 服务信息
echo ====================================
echo  容器名称: chainlesschain-chromadb
echo  访问地址: http://localhost:8000
echo  数据目录: ./data/chromadb
echo ====================================
echo.

echo [完成] 可以启动 Desktop App 了
echo.

pause
