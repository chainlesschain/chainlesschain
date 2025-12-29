@echo off
REM ChainlessChain 文档快速更新脚本 v0.17.0
REM 使用方法: update-docs-quick.bat

echo ========================================
echo ChainlessChain 文档更新到 v0.17.0
echo ========================================
echo.

echo [1/5] 备份当前文档...
set BACKUP_DIR=docs-backup-%date:~0,4%%date:~5,2%%date:~8,2%
xcopy /E /I /Y docs "%BACKUP_DIR%" > nul
echo 备份完成: %BACKUP_DIR%
echo.

echo [2/5] 更新版本号...
REM 使用PowerShell进行文本替换
powershell -Command "(Get-Content 'docs\index.md') -replace 'version-v0\.9\.0', 'version-v0.17.0' | Set-Content 'docs\index.md'"
powershell -Command "(Get-Content 'docs\index.md') -replace 'progress-70%%', 'progress-92%%' | Set-Content 'docs\index.md'"
echo 版本号更新完成
echo.

echo [3/5] 更新版权年份...
powershell -Command "Get-ChildItem -Path docs -Filter *.md -Recurse | ForEach-Object { (Get-Content $_.FullName) -replace 'Copyright © 2024', 'Copyright © 2024-2025' | Set-Content $_.FullName }"
echo 版权年份更新完成
echo.

echo [4/5] 更新主页特性...
echo 请手动编辑 docs\index.md 以更新features列表
echo 参考: DOCS_UPDATE_v0.17.0.md 第1节
echo.

echo [5/5] 验证VitePress构建...
if exist "node_modules" (
    echo 运行: npm run docs:dev 进行测试
) else (
    echo 请先运行: npm install
)
echo.

echo ========================================
echo 更新完成！
echo ========================================
echo.
echo 下一步操作:
echo 1. 查看 DOCS_UPDATE_v0.17.0.md 了解详细更改
echo 2. 手动编辑关键文件（参考指南第1-5节）
echo 3. 运行 npm run docs:dev 测试
echo 4. 运行 npm run docs:build 构建
echo.
echo 详细文档: DOCS_UPDATE_v0.17.0.md
echo.

pause
