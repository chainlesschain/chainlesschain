@echo off
echo ========================================
echo ChainlessChain 应用状态检查
echo ========================================
echo.

echo [1] 检查 Vite 开发服务器 (端口 5173)
netstat -ano | findstr :5173 | findstr LISTENING
if %errorlevel% equ 0 (
    echo ✓ Vite 服务器正在运行
) else (
    echo × Vite 服务器未运行
)
echo.

echo [2] 检查 Electron 进程
tasklist | findstr "electron.exe" >nul 2>&1
if %errorlevel% equ 0 (
    echo ✓ Electron 进程正在运行
    echo 进程详情:
    tasklist | findstr "electron.exe"
) else (
    echo × Electron 进程未运行
)
echo.

echo [3] 测试网络连接
powershell -Command "try { $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -TimeoutSec 2 -UseBasicParsing; Write-Host '✓ Vite 服务器可访问 (HTTP' $response.StatusCode ')' } catch { Write-Host '× 无法连接到 Vite 服务器' }"
echo.

echo ========================================
echo 检查完成
echo ========================================
echo.
echo 快速操作:
echo   - 启动应用: cd desktop-app-vue ^&^& npm run dev
echo   - 访问URL: http://127.0.0.1:5173
echo   - MCP设置: http://127.0.0.1:5173/#/settings?tab=mcp
echo.
pause
