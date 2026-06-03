@echo off
REM 新增菜单项 E2E 测试运行脚本 (Windows)
REM 用于快速验证 v0.26.2 新增的所有菜单项功能

echo ================================================
echo   ChainlessChain v0.26.2 新增菜单 E2E 测试
echo ================================================
echo.
echo 测试覆盖：
echo   √ 监控与诊断功能 (6项)
echo   √ MCP和AI配置 (2项)
echo   √ P2P高级功能 (6项)
echo.
echo 总计: 14个新菜单项 + 完整性验证
echo ================================================
echo.

REM 检查是否在正确的目录
if not exist "package.json" (
    echo × 错误: 请在 desktop-app-vue 目录下运行此脚本
    exit /b 1
)

REM 检查依赖是否已安装
if not exist "node_modules" (
    echo ⚠  警告: node_modules 不存在，正在安装依赖...
    call npm install
)

REM 确保主进程已构建
if not exist "dist\main\index.js" (
    echo 📦 构建主进程...
    call npm run build:main
)

echo 🚀 开始运行新增菜单项 E2E 测试...
echo.

REM 运行测试
call npx playwright test tests/e2e/menu/new-menu-items.e2e.test.ts --headed

REM 检查测试结果
if %ERRORLEVEL% equ 0 (
    echo.
    echo ================================================
    echo   √ 所有新增菜单项测试通过！
    echo ================================================
    echo.
    echo 测试结果摘要:
    echo   • 监控与诊断: 6/6 通过
    echo   • MCP和AI配置: 2/2 通过
    echo   • P2P高级功能: 6/6 通过
    echo   • 菜单集成完整性: 通过
    echo.
    echo 🎉 v0.26.2 新增功能已完全集成到UI！
) else (
    echo.
    echo ================================================
    echo   × 测试失败，请检查日志
    echo ================================================
    exit /b 1
)
