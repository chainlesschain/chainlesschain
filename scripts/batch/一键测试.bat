@echo off
chcp 65001 >nul
echo ╔════════════════════════════════════════════════════════════════╗
echo ║         ChainlessChain v0.26.2 - 一键自动测试                 ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo 正在打开测试页面...
echo.

REM 打开一键测试页面
start "" "%~dp0RUN_TEST_NOW.html"

echo ✓ 测试页面已打开！
echo.
echo 接下来请：
echo   1. 在打开的网页中点击"开始自动测试"按钮
echo   2. 等待测试完成（约45秒）
echo   3. 查看测试结果
echo.
echo 或者直接访问可视化控制台：
echo   http://127.0.0.1:5173/test-console.html
echo.
pause
