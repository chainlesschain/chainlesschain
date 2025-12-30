@echo off
chcp 65001 > nul
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║         🎬 视频分类修复工具 🎬                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 请选择修复方式:
echo.
echo [1] 首次启动（无数据库，推荐）
echo [2] 更新现有数据库（保留数据）
echo [3] 删除数据库重新创建（丢失所有数据）
echo [4] 退出
echo.
set /p choice="请输入选项 (1-4): "

if "%choice%"=="1" (
    echo.
    echo 正在启动应用...
    echo 视频分类会自动创建
    call npm run dev
    goto :end
)

if "%choice%"=="2" (
    echo.
    echo 正在运行更新脚本...
    node update-video-category.js
    if errorlevel 1 (
        echo.
        echo ❌ 更新失败！
        pause
        goto :end
    )
    echo.
    echo ✅ 更新成功！
    echo.
    echo 正在启动应用...
    call npm run dev
    goto :end
)

if "%choice%"=="3" (
    echo.
    echo ⚠️  警告：这将删除所有现有数据！
    set /p confirm="确认删除？(Y/N): "
    if /i "%confirm%"=="Y" (
        if exist "..\data\chainlesschain.db" (
            del "..\data\chainlesschain.db"
            echo ✅ 数据库已删除
        ) else (
            echo ℹ️  数据库文件不存在
        )
        echo.
        echo 正在启动应用...
        call npm run dev
    ) else (
        echo 已取消
    )
    goto :end
)

if "%choice%"=="4" (
    goto :end
)

echo 无效选项
pause

:end
