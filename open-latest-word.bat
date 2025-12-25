@echo off
REM 快速打开最新生成的 Word 文档
echo 正在查找最新的 Word 文档...

REM 使用 PowerShell 找到最新修改的工作报告.docx
for /f "delims=" %%i in ('powershell -Command "Get-ChildItem -Path 'C:\code\chainlesschain\data\projects\*\工作报告.docx' -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName"') do (
    set "LATEST_WORD=%%i"
)

if not defined LATEST_WORD (
    echo 错误: 未找到工作报告.docx 文件
    pause
    exit /b 1
)

echo 找到文件: %LATEST_WORD%
echo 正在打开...

REM 使用默认程序打开
start "" "%LATEST_WORD%"

echo 已打开文件!
timeout /t 2 >nul
