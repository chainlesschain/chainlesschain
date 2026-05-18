@echo off
setlocal enabledelayedexpansion

REM ChainlessChain Docker 镜像加载脚本
REM 用于用户端首次安装后加载镜像

set "SCRIPT_DIR=%~dp0"
set "IMAGES_DIR=%SCRIPT_DIR%docker-images"
set "MANIFEST_FILE=%IMAGES_DIR%\images-manifest.txt"

echo =========================================
echo  ChainlessChain Docker 镜像加载
echo =========================================
echo.
echo 此过程将加载后端服务所需的 Docker 镜像
echo 预计时间: 2-5 分钟
echo.

REM 检查 Docker 是否运行
echo 检查 Docker 状态...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo [31m 错误: Docker 未运行[0m
    echo.
    echo 请按照以下步骤操作:
    echo   1. 启动 Docker Desktop
    echo   2. 等待 Docker 图标变为绿色
    echo   3. 重新运行此脚本
    echo.
    pause
    exit /b 1
)

echo [32m Docker 正在运行[0m
echo.

REM 检查镜像目录
if not exist "%IMAGES_DIR%" (
    echo [31m 错误: 找不到镜像目录[0m
    echo 路径: %IMAGES_DIR%
    echo.
    echo 请确保安装包完整，或重新下载安装
    pause
    exit /b 1
)

REM 检查清单文件
if not exist "%MANIFEST_FILE%" (
    echo [31m 错误: 找不到镜像清单文件[0m
    echo 路径: %MANIFEST_FILE%
    pause
    exit /b 1
)

echo [33m 开始加载镜像...[0m
echo.

set "TOTAL=0"
set "LOADED=0"
set "FAILED=0"

REM 读取清单并加载
for /f "usebackq tokens=1,2 delims=|" %%A in ("%MANIFEST_FILE%") do (
    set "TAR_NAME=%%A"
    set "IMAGE_NAME=%%B"

    REM 跳过注释行和空行
    echo !TAR_NAME! | findstr /r "^#" >nul && goto :continue
    if "!TAR_NAME!"=="" goto :continue

    set /a TOTAL+=1
    set "TAR_FILE=%IMAGES_DIR%\!TAR_NAME!"

    echo [!TOTAL!] 加载: !IMAGE_NAME!

    if not exist "!TAR_FILE!" (
        echo     [33m 跳过: 文件不存在[0m
        set /a FAILED+=1
        goto :continue
    )

    REM 显示文件大小
    for %%F in ("!TAR_FILE!") do set "SIZE=%%~zF"
    set /a SIZE_MB=!SIZE! / 1048576
    echo     文件大小: !SIZE_MB! MB

    REM 加载镜像
    echo     正在加载...
    docker load -i "!TAR_FILE!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [32m 加载成功[0m
        set /a LOADED+=1
    ) else (
        echo     [31m 加载失败[0m
        set /a FAILED+=1
    )
    echo.

    :continue
)

echo =========================================
echo 镜像加载完成！
echo =========================================
echo.
echo 统计:
echo   总计: %TOTAL%
echo   成功: %LOADED%
echo   失败: %FAILED%
echo.

if %FAILED% equ 0 (
    echo [32m 所有镜像加载成功！[0m
    echo.
    echo 下一步:
    echo   1. 运行 start-services.bat 启动后端服务
    echo   2. 启动 ChainlessChain 桌面应用
    echo.
) else (
    echo [33m 部分镜像加载失败[0m
    echo.
    echo 可能的原因:
    echo   - Docker 磁盘空间不足
    echo   - 镜像文件损坏
    echo.
    echo 建议: 检查 Docker Desktop 设置中的磁盘空间配置
    echo.
)

pause
