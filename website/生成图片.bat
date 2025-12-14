@echo off
chcp 65001 >nul
echo ============================================
echo   ChainlessChain 图片资源生成器
echo ============================================
echo.

REM 检查Python是否安装
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到Python，请先安装Python 3.x
    echo.
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/3] 检查依赖...
pip show Pillow >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 正在安装Pillow...
    pip install Pillow
)

pip show qrcode >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 正在安装qrcode...
    pip install qrcode[pil]
)

echo.
echo [2/3] 开始生成图片...
echo.
python generate_images.py

if %errorlevel% equ 0 (
    echo.
    echo [3/3] 完成！
    echo.
    echo ✅ 所有图片已生成到以下目录：
    echo    - logo.png
    echo    - images/og-image.png
    echo    - images/qr/*.png
    echo    - images/products/*.png
    echo    - images/badges/*.png
    echo.
    echo 💡 提示：
    echo    1. 这些是临时占位图，建议替换为实际设计
    echo    2. 使用TinyPNG压缩图片以提升加载速度
    echo    3. 产品截图应使用真实界面截图
    echo.
) else (
    echo.
    echo ❌ 生成失败，请检查错误信息
    echo.
)

pause
