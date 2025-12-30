@echo off
chcp 65001 > nul
echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║     🎬 ChainlessChain 视频项目系统 v0.17.0 🎬            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 📊 系统配置:
echo    ├─ 视频模板: 29个
echo    ├─ 子分类: 15个
echo    ├─ 技能系统: 15个
echo    ├─ 工具系统: 20个
echo    └─ 关联映射: 28个
echo.
echo 🚀 启动步骤:
echo.
echo [1/3] 检查环境...
node --version > nul 2>&1
if errorlevel 1 (
    echo    ✗ Node.js 未安装！请先安装 Node.js
    pause
    exit /b 1
)
echo    ✓ Node.js 已安装

echo.
echo [2/3] 构建主进程...
call npm run build:main
if errorlevel 1 (
    echo    ✗ 构建失败！
    pause
    exit /b 1
)
echo    ✓ 主进程构建完成

echo.
echo [3/3] 启动应用...
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.
echo  🎯 应用启动中...
echo  📝 数据库迁移将自动执行
echo  ✨ 所有视频功能已就绪
echo.
echo  💡 提示: Ctrl+C 停止应用
echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

call npm run dev
