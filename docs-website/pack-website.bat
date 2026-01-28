@echo off
chcp 65001 > nul
echo ========================================
echo  ChainlessChain 官方网站打包工具
echo ========================================
echo.

set TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set OUTPUT_FILE=chainlesschain-website-%TIMESTAMP%.zip

echo [1/4] 准备打包...
echo.

REM 创建临时目录
if exist "temp_pack" rd /s /q "temp_pack"
mkdir "temp_pack"

echo [2/4] 复制网站文件...
echo.

REM 复制主文件
copy "index.html" "temp_pack\" > nul
if exist "logo.png" copy "logo.png" "temp_pack\" > nul
if exist "logo.svg" copy "logo.svg" "temp_pack\" > nul
if exist "robots.txt" copy "robots.txt" "temp_pack\" > nul
if exist "sitemap.xml" copy "sitemap.xml" "temp_pack\" > nul
if exist "demo.html" copy "demo.html" "temp_pack\" > nul

REM 复制CSS文件（包含所有新增的CSS）
if exist "loading-animation.css" copy "loading-animation.css" "temp_pack\" > nul
if exist "loading-animation-v2.css" copy "loading-animation-v2.css" "temp_pack\" > nul
if exist "loading-simple.css" copy "loading-simple.css" "temp_pack\" > nul
if exist "style-enhancements.css" copy "style-enhancements.css" "temp_pack\" > nul
if exist "visual-enhancements.css" copy "visual-enhancements.css" "temp_pack\" > nul
if exist "fix-center.css" copy "fix-center.css" "temp_pack\" > nul

REM 复制目录
xcopy "css" "temp_pack\css\" /E /I /Q > nul
xcopy "js" "temp_pack\js\" /E /I /Q > nul
xcopy "images" "temp_pack\images\" /E /I /Q > nul
xcopy "products" "temp_pack\products\" /E /I /Q > nul
xcopy "technology" "temp_pack\technology\" /E /I /Q > nul

echo [3/4] 打包压缩...
echo.

REM 使用PowerShell压缩
powershell -command "Compress-Archive -Path 'temp_pack\*' -DestinationPath '%OUTPUT_FILE%' -Force"

echo [4/4] 清理临时文件...
echo.
rd /s /q "temp_pack"

echo ========================================
echo  打包完成！
echo ========================================
echo.
echo 输出文件: %OUTPUT_FILE%
echo 文件位置: %cd%\%OUTPUT_FILE%
echo.

REM 显示文件大小
for %%A in (%OUTPUT_FILE%) do (
    set SIZE=%%~zA
)
set /a SIZE_MB=%SIZE% / 1048576
echo 文件大小: %SIZE_MB% MB
echo.

echo 按任意键退出...
pause > nul
