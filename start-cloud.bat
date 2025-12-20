@echo off
REM ChainlessChain 云端模式快速启动脚本 (Windows版本)

echo =========================================
echo   ChainlessChain 云端算力模式启动
echo =========================================
echo.

REM 检查.env文件
if not exist .env (
    echo 未找到.env配置文件
    echo.
    set /p create_env="是否创建云端配置文件? (y/n): "

    if /i "%create_env%"=="y" (
        echo.
        echo 请选择云LLM服务商:
        echo 1. 硅基流动 ^(推荐，性价比最高 ￥0.0007/1K tokens^)
        echo 2. 阿里云通义千问 ^(国内稳定，有免费额度^)
        echo 3. 零一万物 ^(速度快 ￥0.02/1K tokens^)
        echo 4. OpenAI ^(国际用户^)
        echo.
        set /p provider_choice="请选择 (1-4): "

        copy .env.cloud.example .env > nul

        if "%provider_choice%"=="1" (
            echo.
            echo 已选择: 硅基流动
            echo.
            echo 请访问 https://siliconflow.cn/ 注册并获取API Key
            set /p api_key="请输入您的API Key: "

            powershell -Command "(Get-Content .env) -replace 'LLM_PROVIDER=openai', 'LLM_PROVIDER=openai' | Set-Content .env"
            powershell -Command "(Get-Content .env) -replace 'your_siliconflow_api_key_here', '%api_key%' | Set-Content .env"
            powershell -Command "(Get-Content .env) -replace 'OPENAI_BASE_URL=https://api.openai.com/v1', 'OPENAI_BASE_URL=https://api.siliconflow.cn/v1' | Set-Content .env"
            powershell -Command "(Get-Content .env) -replace 'LLM_MODEL=gpt-3.5-turbo', 'LLM_MODEL=Qwen/Qwen2-7B-Instruct' | Set-Content .env"

            echo 配置完成!
            echo 预计成本: 每月 ￥2-20
        )

        if "%provider_choice%"=="2" (
            echo.
            echo 已选择: 阿里云通义千问
            echo.
            echo 请访问 https://dashscope.aliyun.com/ 注册并获取API Key
            set /p api_key="请输入您的API Key: "

            powershell -Command "(Get-Content .env) -replace 'LLM_PROVIDER=openai', 'LLM_PROVIDER=dashscope' | Set-Content .env"
            powershell -Command "(Get-Content .env) -replace 'your_dashscope_api_key_here', '%api_key%' | Set-Content .env"

            echo 配置完成!
            echo 预计成本: 每月 ￥0 ^(免费额度充足^)
        )

        if "%provider_choice%"=="3" (
            echo.
            echo 已选择: 零一万物
            echo.
            echo 请访问 https://platform.lingyiwanwu.com/ 注册并获取API Key
            set /p api_key="请输入您的API Key: "

            powershell -Command "(Get-Content .env) -replace 'LLM_PROVIDER=openai', 'LLM_PROVIDER=openai' | Set-Content .env"
            powershell -Command "(Get-Content .env) -replace 'OPENAI_BASE_URL=https://api.openai.com/v1', 'OPENAI_BASE_URL=https://api.lingyiwanwu.com/v1' | Set-Content .env"
            powershell -Command "(Get-Content .env) -replace 'LLM_MODEL=gpt-3.5-turbo', 'LLM_MODEL=yi-large' | Set-Content .env"

            echo 配置完成!
            echo 预计成本: 每月 ￥10-50
        )

        if "%provider_choice%"=="4" (
            echo.
            echo 已选择: OpenAI
            echo.
            echo 请访问 https://platform.openai.com/ 注册并获取API Key
            set /p api_key="请输入您的API Key: "

            powershell -Command "(Get-Content .env) -replace 'your_openai_api_key_here', '%api_key%' | Set-Content .env"

            echo 配置完成!
            echo 预计成本: 每月 $6-20 ^(约￥42-140^)
        )

        echo.
    ) else (
        echo 配置已取消
        exit /b 1
    )
)

REM 检查Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo 未安装Docker，请先安装Docker Desktop
    pause
    exit /b 1
)

docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo 未安装Docker Compose，请先安装
    pause
    exit /b 1
)

echo.
echo 启动云端模式...
echo.

REM 创建数据目录
if not exist data mkdir data
if not exist data\postgres mkdir data\postgres
if not exist data\redis mkdir data\redis
if not exist data\qdrant mkdir data\qdrant
if not exist data\projects mkdir data\projects

REM 启动服务
docker-compose -f docker-compose.cloud.yml up -d

echo.
echo 等待服务启动...
timeout /t 5 /nobreak > nul

REM 显示服务状态
echo.
echo 服务状态:
docker-compose -f docker-compose.cloud.yml ps

echo.
echo 启动完成!
echo.
echo 服务地址:
echo    - AI Service: http://localhost:8001
echo    - Project Service: http://localhost:8080
echo    - Qdrant: http://localhost:6333
echo    - PostgreSQL: localhost:5432
echo.
echo 查看日志:
echo    docker-compose -f docker-compose.cloud.yml logs -f
echo.
echo 停止服务:
echo    docker-compose -f docker-compose.cloud.yml down
echo.
echo 详细文档: README-云端部署指南.md
echo.
pause
