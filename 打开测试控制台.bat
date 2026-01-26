@echo off
chcp 65001 >nul
echo.
echo ════════════════════════════════════════════════════════════════
echo          ChainlessChain v0.26.2 - 打开测试控制台
echo ════════════════════════════════════════════════════════════════
echo.
echo 正在打开测试控制台...
echo.

start "" "http://127.0.0.1:5173/test-console.html"

timeout /t 2 /nobreak >nul

echo ✓ 测试控制台已在浏览器中打开！
echo.
echo 接下来请：
echo   1. 在打开的网页中点击 "▶️ 开始自动测试" 按钮
echo   2. 等待测试完成（约45秒）
echo   3. 查看测试结果
echo.
echo 测试页面地址：
echo   http://127.0.0.1:5173/test-console.html
echo.
pause
