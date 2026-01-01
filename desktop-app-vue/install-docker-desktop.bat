@echo off
REM =============================================================================
REM Docker Desktop 自动安装脚本
REM =============================================================================
REM 功能：自动下载并安装 Docker Desktop for Windows
REM 用途：简化用户安装流程，无需手动下载
REM =============================================================================

setlocal enabledelayedexpansion

echo.
echo ====================================================================
echo   Docker Desktop 自动安装工具
echo ====================================================================
echo.

REM 检查是否已安装
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    echo Docker Desktop 已安装
    echo 位置: C:\Program Files\Docker\Docker\Docker Desktop.exe
    echo.

    set /p REINSTALL="是否重新安装？(Y/N): "
    if /i not "!REINSTALL!"=="Y" (
        echo 已取消安装
        pause
        exit /b 0
    )
)

echo.
echo 此脚本将：
echo   1. 下载 Docker Desktop 最新版本（约 500MB）
echo   2. 自动安装 Docker Desktop
echo   3. 启用 WSL2 后端（推荐）
echo.
echo 注意：
echo   - 需要管理员权限
echo   - 需要重启计算机
echo   - 安装时间约 5-10 分钟
echo.

set /p CONFIRM="是否继续？(Y/N): "
if /i not "%CONFIRM%"=="Y" (
    echo 已取消安装
    pause
    exit /b 0
)

REM =============================================================================
REM 检查管理员权限
REM =============================================================================

echo.
echo [1/4] 检查权限...

net session >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 需要管理员权限
    echo.
    echo 请右键点击此脚本，选择"以管理员身份运行"
    pause
    exit /b 1
)

echo   ✓ 管理员权限已确认
echo.

REM =============================================================================
REM 下载 Docker Desktop
REM =============================================================================

echo [2/4] 下载 Docker Desktop...
echo.

set DOCKER_INSTALLER=DockerDesktopInstaller.exe
set DOCKER_URL=https://desktop.docker.com/win/stable/Docker%%20Desktop%%20Installer.exe

echo 下载地址: %DOCKER_URL%
echo 保存位置: %TEMP%\%DOCKER_INSTALLER%
echo.
echo 正在下载...（约 500MB，请耐心等待）
echo.

REM 使用 PowerShell 下载（支持进度显示）
powershell -Command "& {$ProgressPreference = 'Continue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%DOCKER_URL%' -OutFile '%TEMP%\%DOCKER_INSTALLER%' -UseBasicParsing}"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] 下载失败
    echo.
    echo 请检查：
    echo   1. 网络连接是否正常
    echo   2. 防火墙是否允许下载
    echo.
    echo 您也可以手动下载：
    echo   https://www.docker.com/products/docker-desktop
    echo.
    pause
    exit /b 1
)

echo.
echo   ✓ 下载完成
echo.

REM =============================================================================
REM 检查 WSL2
REM =============================================================================

echo [3/4] 检查 WSL2...
echo.

REM 检查 WSL 是否已启用
wsl --status >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo WSL2 未安装，Docker Desktop 将使用 Hyper-V 后端
    echo.
    echo 建议安装 WSL2 以获得更好的性能：
    echo   1. 打开 PowerShell（管理员）
    echo   2. 运行: wsl --install
    echo   3. 重启计算机
    echo.

    set /p INSTALL_WSL="是否现在安装 WSL2？(Y/N，推荐): "
    if /i "!INSTALL_WSL!"=="Y" (
        echo 正在安装 WSL2...
        wsl --install
        echo.
        echo WSL2 安装完成，需要重启计算机
        echo 重启后请重新运行此脚本继续安装 Docker Desktop
        echo.
        set /p REBOOT="是否立即重启？(Y/N): "
        if /i "!REBOOT!"=="Y" (
            shutdown /r /t 30 /c "安装 WSL2 后需要重启计算机，30秒后自动重启"
            echo 30秒后将自动重启...
            echo 按任意键取消重启
            pause >nul
            shutdown /a
        )
        exit /b 0
    )
) else (
    echo   ✓ WSL2 已安装
)

echo.

REM =============================================================================
REM 安装 Docker Desktop
REM =============================================================================

echo [4/4] 安装 Docker Desktop...
echo.

echo 正在运行安装程序...
echo 请按照安装向导完成安装
echo.

REM 静默安装参数：
REM   install - 执行安装
REM   --quiet - 静默模式（不显示GUI）
REM   --accept-license - 自动接受许可协议
REM   --backend=wsl-2 - 使用 WSL2 后端（如果可用）

REM 检查是否应该使用静默安装
set /p SILENT="是否使用静默安装（无需手动操作）？(Y/N，推荐): "

if /i "%SILENT%"=="Y" (
    echo 使用静默安装模式...
    "%TEMP%\%DOCKER_INSTALLER%" install --quiet --accept-license --backend=wsl-2
) else (
    echo 使用交互式安装...
    "%TEMP%\%DOCKER_INSTALLER%"
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] 安装可能未成功完成
    echo 错误代码: %ERRORLEVEL%
    echo.
    echo 请检查安装日志或手动运行安装程序
    pause
    exit /b 1
)

echo.
echo   ✓ Docker Desktop 安装完成
echo.

REM =============================================================================
REM 清理
REM =============================================================================

echo 清理临时文件...
del "%TEMP%\%DOCKER_INSTALLER%" >nul 2>&1
echo   ✓ 清理完成
echo.

REM =============================================================================
REM 完成
REM =============================================================================

echo ====================================================================
echo   安装成功！
echo ====================================================================
echo.
echo 下一步：
echo   1. 重启计算机（强烈推荐）
echo   2. 启动 Docker Desktop
echo   3. 等待 Docker Desktop 完全启动（首次启动可能需要几分钟）
echo   4. 运行 ChainlessChain
echo.
echo Docker Desktop 位置:
echo   C:\Program Files\Docker\Docker\Docker Desktop.exe
echo.

set /p REBOOT_NOW="是否立即重启计算机？(Y/N): "
if /i "%REBOOT_NOW%"=="Y" (
    echo.
    echo 60秒后将自动重启...
    echo 请保存所有未保存的工作
    echo.
    shutdown /r /t 60 /c "安装 Docker Desktop 后需要重启计算机，60秒后自动重启。按任意键取消。"
    pause >nul
    shutdown /a
    echo 已取消自动重启
)

echo.
pause
