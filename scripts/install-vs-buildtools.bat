@echo off
REM Visual Studio Build Tools 快速安装脚本 (Windows批处理版本)
REM 如果PowerShell脚本不能运行，使用此脚本

echo ========================================
echo   Visual Studio Build Tools 安装
echo ========================================
echo.
echo 此脚本将下载并安装 Visual Studio Build Tools 2022
echo 包含 C++ 编译工具，用于编译原生 Node.js 模块
echo.
echo 所需空间: ~10 GB
echo 预计时间: 15-30 分钟
echo.

REM 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo × 错误: 需要管理员权限
    echo.
    echo 请右键单击此脚本，选择 "以管理员身份运行"
    echo.
    pause
    exit /b 1
)

echo 正在下载 Visual Studio Build Tools...
echo.

REM 创建临时目录
set TEMP_DIR=%TEMP%\vs_buildtools
if not exist "%TEMP_DIR%" mkdir "%TEMP_DIR%"

REM 下载安装程序
set INSTALLER_URL=https://aka.ms/vs/17/release/vs_BuildTools.exe
set INSTALLER_PATH=%TEMP_DIR%\vs_BuildTools.exe

powershell -Command "& {Invoke-WebRequest -Uri '%INSTALLER_URL%' -OutFile '%INSTALLER_PATH%'}"

if not exist "%INSTALLER_PATH%" (
    echo × 下载失败
    echo.
    echo 请手动下载并安装 Visual Studio Build Tools:
    echo   URL: %INSTALLER_URL%
    echo.
    pause
    exit /b 1
)

echo √ 下载完成
echo.
echo 正在启动安装程序...
echo.
echo 重要提示：
echo   1. 在安装界面中，确保勾选 "Desktop development with C++"
echo   2. 等待安装完成（可能需要 15-30 分钟）
echo   3. 安装完成后需要重启电脑
echo.

REM 自动安装（静默模式）
"%INSTALLER_PATH%" --quiet --wait --norestart ^
    --add Microsoft.VisualStudio.Workload.VCTools ^
    --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 ^
    --add Microsoft.VisualStudio.Component.Windows11SDK.22621

if %errorLevel% equ 0 (
    echo.
    echo ========================================
    echo   √ 安装成功！
    echo ========================================
) else if %errorLevel% equ 3010 (
    echo.
    echo ========================================
    echo   √ 安装完成，需要重启系统
    echo ========================================
) else (
    echo.
    echo 警告: 安装退出代码为 %errorLevel%
    echo 请检查是否已成功安装
)

echo.
echo 下一步操作：
echo   1. 重启电脑（推荐）
echo   2. 重新打开命令提示符
echo   3. 验证安装: node-gyp configure
echo   4. 重新安装依赖: cd desktop-app-vue ^&^& npm install
echo.

REM 清理
choice /C YN /M "是否删除安装程序"
if %errorLevel% equ 1 (
    echo 正在清理临时文件...
    rd /s /q "%TEMP_DIR%" 2>nul
    echo √ 清理完成
)

echo.
echo 安装完成！
pause
