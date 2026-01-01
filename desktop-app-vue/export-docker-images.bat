@echo off
REM =============================================================================
REM Docker 镜像导出脚本 - 用于创建离线安装包
REM =============================================================================
REM 功能：导出所有需要的 Docker 镜像为 .tar 文件
REM 用途：用于创建离线安装包，避免用户首次启动时下载
REM =============================================================================

setlocal enabledelayedexpansion

echo.
echo ====================================================================
echo   Docker 镜像导出工具
echo ====================================================================
echo.
echo 此脚本将导出所有后端服务所需的 Docker 镜像
echo 导出的镜像文件可用于离线安装
echo.

REM 检查 Docker 是否运行
docker info >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Docker Desktop 未运行
    echo 请先启动 Docker Desktop，然后重新运行此脚本
    pause
    exit /b 1
)

REM 创建输出目录
set OUTPUT_DIR=docker-images-offline
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo 输出目录: %OUTPUT_DIR%\
echo.

REM =============================================================================
REM 定义需要导出的镜像
REM =============================================================================

echo [步骤 1/3] 定义需要导出的镜像...
echo.

REM 镜像列表（需要与 docker-compose.yml 保持一致）
set IMAGES=ollama/ollama:latest qdrant/qdrant:latest chromadb/chroma:latest postgres:16-alpine redis:7-alpine python:3.11-slim openjdk:17-slim

REM 显示镜像列表
echo 需要导出的镜像：
for %%I in (%IMAGES%) do (
    echo   - %%I
)
echo.

REM =============================================================================
REM 拉取镜像（确保是最新版本）
REM =============================================================================

echo [步骤 2/3] 拉取最新镜像...
echo.

for %%I in (%IMAGES%) do (
    echo 正在拉取: %%I
    docker pull %%I
    if !ERRORLEVEL! NEQ 0 (
        echo [WARNING] 拉取失败: %%I
        echo 将跳过此镜像
    ) else (
        echo   ✓ 拉取成功
    )
    echo.
)

REM =============================================================================
REM 导出镜像为 .tar 文件
REM =============================================================================

echo [步骤 3/3] 导出镜像为 .tar 文件...
echo.

set TOTAL_SIZE=0
set SUCCESS_COUNT=0

for %%I in (%IMAGES%) do (
    REM 将镜像名转换为文件名（替换特殊字符）
    set IMAGE_NAME=%%I
    set FILENAME=!IMAGE_NAME::=-!
    set FILENAME=!FILENAME:/=-!
    set FILENAME=!FILENAME:.=-!

    echo 正在导出: %%I
    echo   -> %OUTPUT_DIR%\!FILENAME!.tar

    docker save -o "%OUTPUT_DIR%\!FILENAME!.tar" %%I

    if !ERRORLEVEL! EQU 0 (
        echo   ✓ 导出成功

        REM 获取文件大小
        for %%F in ("%OUTPUT_DIR%\!FILENAME!.tar") do set FILE_SIZE=%%~zF
        set /a TOTAL_SIZE+=!FILE_SIZE!
        set /a SUCCESS_COUNT+=1

        REM 转换为 MB
        set /a SIZE_MB=!FILE_SIZE! / 1048576
        echo   文件大小: !SIZE_MB! MB
    ) else (
        echo   [ERROR] 导出失败
    )
    echo.
)

REM =============================================================================
REM 创建导入脚本
REM =============================================================================

echo 创建导入脚本...

(
echo @echo off
echo REM Docker 镜像导入脚本 - 离线安装使用
echo.
echo echo ====================================
echo echo   Docker 镜像导入工具
echo echo ====================================
echo echo.
echo.
echo REM 检查 Docker 是否运行
echo docker info ^>nul 2^>^&1
echo if %%ERRORLEVEL%% NEQ 0 ^(
echo     echo [ERROR] Docker Desktop 未运行
echo     echo 正在尝试启动 Docker Desktop...
echo     start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo     echo 请等待 Docker Desktop 启动完成，然后按任意键继续...
echo     pause ^>nul
echo
echo     REM 再次检查
echo     docker info ^>nul 2^>^&1
echo     if %%ERRORLEVEL%% NEQ 0 ^(
echo         echo [ERROR] Docker Desktop 启动失败
echo         echo 请手动启动 Docker Desktop 后重试
echo         pause
echo         exit /b 1
echo     ^)
echo ^)
echo.
echo echo 正在导入 Docker 镜像...
echo echo 这可能需要几分钟时间，请耐心等待
echo echo.
echo.
echo set SUCCESS=0
echo set FAILED=0
echo.
for %%I in (%IMAGES%) do (
    set IMAGE_NAME=%%I
    set FILENAME=!IMAGE_NAME::=-!
    set FILENAME=!FILENAME:/=-!
    set FILENAME=!FILENAME:.=-!

    echo echo [导入] %%I
    echo if exist "!FILENAME!.tar" ^(
    echo     docker load -i "!FILENAME!.tar"
    echo     if %%ERRORLEVEL%% EQU 0 ^(
    echo         echo   ✓ 导入成功
    echo         set /a SUCCESS+=1
    echo     ^) else ^(
    echo         echo   [ERROR] 导入失败
    echo         set /a FAILED+=1
    echo     ^)
    echo ^) else ^(
    echo     echo   [WARNING] 文件不存在: !FILENAME!.tar
    echo     set /a FAILED+=1
    echo ^)
    echo echo.
)
echo.
echo echo ====================================
echo echo   导入完成
echo echo ====================================
echo echo 成功: %%SUCCESS%% 个
echo echo 失败: %%FAILED%% 个
echo echo.
echo.
echo REM 列出已导入的镜像
echo echo 已导入的镜像：
echo docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
echo.
echo pause
) > "%OUTPUT_DIR%\import-docker-images.bat"

echo   ✓ 导入脚本已创建: %OUTPUT_DIR%\import-docker-images.bat
echo.

REM =============================================================================
REM 创建镜像清单
REM =============================================================================

echo 创建镜像清单...

(
echo # Docker 镜像清单
echo # 导出时间: %DATE% %TIME%
echo.
echo ## 包含的镜像
echo.
for %%I in (%IMAGES%) do (
    echo - %%I
)
echo.
echo ## 使用方法
echo.
echo 1. 将整个文件夹复制到目标机器
echo 2. 确保 Docker Desktop 已安装并运行
echo 3. 运行 `import-docker-images.bat`
echo 4. 等待导入完成
echo.
echo ## 注意事项
echo.
echo - 导入前请确保有足够的磁盘空间
echo - 导入过程中不要关闭 Docker Desktop
echo - 如果导入失败，请检查 Docker 日志
echo.
) > "%OUTPUT_DIR%\README.md"

echo   ✓ 镜像清单已创建: %OUTPUT_DIR%\README.md
echo.

REM =============================================================================
REM 压缩为单一文件（可选）
REM =============================================================================

echo.
set /p COMPRESS="是否压缩为单一 .zip 文件? (Y/N): "
if /i "%COMPRESS%"=="Y" (
    echo.
    echo 正在压缩...

    REM 检查 7-Zip 是否可用
    where 7z >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        7z a -tzip "chainlesschain-docker-images-offline.zip" "%OUTPUT_DIR%\*"
        echo   ✓ 压缩完成: chainlesschain-docker-images-offline.zip
    ) else (
        echo [WARNING] 7-Zip 未安装，跳过压缩
        echo 您可以手动压缩 %OUTPUT_DIR% 文件夹
    )
)

REM =============================================================================
REM 完成
REM =============================================================================

echo.
echo ====================================================================
echo   导出完成！
echo ====================================================================
echo.
echo 成功导出: %SUCCESS_COUNT% 个镜像
echo 输出目录: %OUTPUT_DIR%\
echo.

REM 计算总大小（MB 和 GB）
set /a TOTAL_MB=%TOTAL_SIZE% / 1048576
set /a TOTAL_GB=%TOTAL_SIZE% / 1073741824

echo 总大小: %TOTAL_MB% MB (约 %TOTAL_GB% GB)
echo.
echo 输出文件:
dir /b "%OUTPUT_DIR%\*.tar"
echo.
echo 下一步:
echo   1. 将 %OUTPUT_DIR% 文件夹包含到安装包中
echo   2. 或将其分发给离线用户
echo   3. 用户运行 import-docker-images.bat 导入镜像
echo.

pause
