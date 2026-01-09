@echo off
chcp 65001 >nul
echo ========================================
echo ChainlessChain 快速启动脚本
echo ========================================
echo.

echo [1/4] 检查Docker服务...
docker ps >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker未运行，请先启动Docker Desktop
    pause
    exit /b 1
)
echo ✅ Docker服务正常

echo.
echo [2/4] 启动PostgreSQL和Redis...
cd /d "%~dp0config\docker"
docker-compose up -d postgres redis
if %errorlevel% neq 0 (
    echo ❌ 启动数据库服务失败
    pause
    exit /b 1
)
echo ✅ 数据库服务已启动

echo.
echo [3/4] 等待数据库就绪...
timeout /t 10 /nobreak >nul
docker ps --filter "name=chainlesschain-postgres" --filter "health=healthy" | findstr "healthy" >nul
if %errorlevel% neq 0 (
    echo ⚠️  PostgreSQL尚未就绪，请稍等...
    timeout /t 5 /nobreak >nul
)
echo ✅ 数据库已就绪

echo.
echo [4/4] 检查服务状态...
docker ps --filter "name=chainlesschain" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo.
echo ========================================
echo ✅ 环境准备完成！
echo ========================================
echo.
echo 📝 下一步操作：
echo.
echo 1. 使用IntelliJ IDEA打开项目：
echo    D:\code\chainlesschain\backend\project-service
echo.
echo 2. 运行主类：
echo    com.chainlesschain.project.ProjectServiceApplication
echo.
echo 3. 等待服务启动，看到日志：
echo    "Started ProjectServiceApplication in X seconds"
echo.
echo 4. 访问Swagger UI测试API：
echo    http://localhost:9090/swagger-ui.html
echo.
echo 📚 详细文档：
echo    - IDEA启动指南: IDEA_STARTUP_GUIDE.md
echo    - 测试指南: TESTING_GUIDE_2026-01-09.md
echo    - 最终总结: FINAL_SUMMARY_2026-01-09.md
echo.
pause
