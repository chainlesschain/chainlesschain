@echo off
echo ========================================
echo 重置数据库并重新加载模板
echo ========================================
echo.
echo 警告: 此操作会删除当前数据库文件
echo 所有数据将丢失！
echo.
set /p confirm="确认继续吗? (输入 YES 确认): "

if /i "%confirm%" NEQ "YES" (
    echo 操作已取消
    pause
    exit /b
)

echo.
echo 正在备份当前数据库...
if exist "data\test-password.encrypted.db" (
    copy "data\test-password.encrypted.db" "data\test-password.encrypted.db.backup.%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
    echo ✓ 已备份到 data\test-password.encrypted.db.backup.*
)

echo.
echo 正在删除旧数据库...
if exist "data\test-password.encrypted.db" (
    del "data\test-password.encrypted.db"
    echo ✓ 已删除 test-password.encrypted.db
)

if exist "data\chainlesschain.db" (
    del "data\chainlesschain.db"
    echo ✓ 已删除 chainlesschain.db
)

echo.
echo ========================================
echo 数据库已重置
echo ========================================
echo.
echo 下一步操作:
echo 1. 重新启动桌面应用 (npm run dev)
echo 2. 系统会自动创建新数据库
echo 3. 模板会从 JSON 文件重新加载
echo 4. 如果需要加密，请在设置中重新配置数据库密码
echo.
pause
