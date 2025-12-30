@echo off
echo ========================================
echo 修复数据库并重启应用
echo ========================================
echo.

echo 步骤 1: 停止 Electron 进程...
taskkill /F /IM electron.exe /T 2>nul
timeout /t 2 /nobreak >nul

echo.
echo 步骤 2: 备份并删除加密数据库...
cd C:\code\chainlesschain\data
if exist chainlesschain.encrypted.db (
    move chainlesschain.encrypted.db chainlesschain.encrypted.db.backup_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2% >nul
    echo ✓ 已备份加密数据库
)

echo.
echo 步骤 3: 备份并删除加密配置...
cd C:\Users\longfa\AppData\Roaming\chainlesschain-desktop-vue
if exist db-key-config.json (
    move db-key-config.json db-key-config.json.backup >nul
    echo ✓ 已备份 db-key-config.json
)
if exist encryption-config.json (
    move encryption-config.json encryption-config.json.backup >nul
    echo ✓ 已备份 encryption-config.json
)

echo.
echo 步骤 4: 使用 sql.js 创建新数据库...
cd C:\code\chainlesschain\desktop-app-vue
node force-create-db-with-templates.js

echo.
echo 步骤 5: 启动应用...
echo 请手动启动应用: npm run dev
echo.
pause
