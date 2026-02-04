@echo off
chcp 65001 >nul
echo ========================================
echo 重置 ChainlessChain 数据库
echo ========================================
echo.
echo 这将备份并删除旧数据库，让应用重新创建干净的数据库。
echo.

set "DB_DIR=%APPDATA%\chainlesschain-desktop-vue\data"
set "DB_FILE=%DB_DIR%\chainlesschain.db"
set "BACKUP_FILE=%DB_DIR%\chainlesschain.db.backup_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%"

:: 去除备份文件名中的空格
set "BACKUP_FILE=%BACKUP_FILE: =0%"

echo 数据库位置: %DB_FILE%
echo.

if not exist "%DB_FILE%" (
    echo ❌ 数据库文件不存在，无需重置。
    echo.
    pause
    exit /b 0
)

echo ✓ 找到数据库文件
echo.

:: 备份数据库
echo 正在备份数据库...
copy "%DB_FILE%" "%BACKUP_FILE%" >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo ✓ 数据库已备份到: %BACKUP_FILE%
) else (
    echo ❌ 备份失败！请手动备份数据库后再继续。
    pause
    exit /b 1
)

echo.
echo 警告：即将删除旧数据库！
echo.
set /p CONFIRM="确认删除旧数据库吗？(输入 YES 继续): "

if /i not "%CONFIRM%"=="YES" (
    echo.
    echo ❌ 操作已取消。
    pause
    exit /b 0
)

:: 删除旧数据库
echo.
echo 正在删除旧数据库...
del /f /q "%DB_FILE%" >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo ✓ 旧数据库已删除
) else (
    echo ❌ 删除失败！请确保应用已关闭。
    pause
    exit /b 1
)

echo.
echo ========================================
echo ✓ 数据库重置完成！
echo ========================================
echo.
echo 备份文件保存在:
echo %BACKUP_FILE%
echo.
echo 请重启应用，它将自动创建新的数据库。
echo.
pause
