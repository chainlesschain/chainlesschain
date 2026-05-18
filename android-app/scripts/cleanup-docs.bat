@echo off
REM Android App 文档整理脚本 (Windows 版本)
REM 用法: cd android-app && scripts\cleanup-docs.bat

echo.
echo 🧹 开始整理 android-app 文档目录...
echo.

REM 检查是否在正确的目录
if not exist "build.gradle.kts" (
    echo ❌ 错误: 请在 android-app 根目录下执行此脚本
    exit /b 1
)

REM 1. 创建目录结构
echo 📁 创建文档目录结构...
if not exist "docs\development-phases" mkdir docs\development-phases
if not exist "docs\build-deployment" mkdir docs\build-deployment
if not exist "docs\ci-cd" mkdir docs\ci-cd
if not exist "docs\features\p2p" mkdir docs\features\p2p
if not exist "docs\optimization" mkdir docs\optimization
if not exist "docs\planning" mkdir docs\planning
if not exist "docs\ui-ux" mkdir docs\ui-ux

REM 2. 移动开发阶段文档
echo 📝 移动开发阶段文档...
if exist "PHASE*.md" (
    git mv PHASE*.md docs\development-phases\ 2>nul || move PHASE*.md docs\development-phases\ >nul
    echo   ✓ 已移动根目录下的 PHASE*.md
)

if exist "docs\PHASE*.md" (
    for %%f in (docs\PHASE*.md) do (
        git mv "%%f" docs\development-phases\ 2>nul || move "%%f" docs\development-phases\ >nul
    )
    echo   ✓ 已移动 docs\ 下的 PHASE*.md
)

REM 3. 移动构建部署文档
echo 🏗️  移动构建部署文档...
if exist "BUILD_REQUIREMENTS.md" (
    git mv BUILD_REQUIREMENTS.md docs\build-deployment\ 2>nul || move BUILD_REQUIREMENTS.md docs\build-deployment\ >nul
    echo   ✓ BUILD_REQUIREMENTS.md
)

for %%f in (DEPLOYMENT_CHECKLIST.md RELEASE_TESTING_GUIDE.md ANDROID_SIGNING_SETUP.md GOOGLE_PLAY_SETUP.md) do (
    if exist "docs\%%f" (
        git mv "docs\%%f" docs\build-deployment\ 2>nul || move "docs\%%f" docs\build-deployment\ >nul
        echo   ✓ docs\%%f
    )
)

REM 4. 移动 CI/CD 文档
echo 🔄 移动 CI/CD 文档...
for %%f in (ANDROID_CI_CD_GUIDE.md ANDROID_CI_CD_COMPLETE.md CI_CD_ARCHITECTURE.md CI_EMULATOR_FIX.md) do (
    if exist "docs\%%f" (
        git mv "docs\%%f" docs\ci-cd\ 2>nul || move "docs\%%f" docs\ci-cd\ >nul
        echo   ✓ docs\%%f
    )
)

REM 5. 移动 P2P 文档
echo 🔗 移动 P2P 文档...
if exist "P2P_INTEGRATION_SUMMARY.md" (
    git mv P2P_INTEGRATION_SUMMARY.md docs\features\p2p\ 2>nul || move P2P_INTEGRATION_SUMMARY.md docs\features\p2p\ >nul
    echo   ✓ P2P_INTEGRATION_SUMMARY.md
)

for %%f in (P2P_API_REFERENCE.md P2P_USER_GUIDE.md P2P_DEVICE_MANAGEMENT_IMPLEMENTATION.md) do (
    if exist "docs\%%f" (
        git mv "docs\%%f" docs\features\p2p\ 2>nul || move "docs\%%f" docs\features\p2p\ >nul
        echo   ✓ docs\%%f
    )
)

REM 6. 移动优化测试文档
echo ⚡ 移动优化测试文档...
if exist "OPTIMIZATION_SUMMARY.md" (
    git mv OPTIMIZATION_SUMMARY.md docs\optimization\ 2>nul || move OPTIMIZATION_SUMMARY.md docs\optimization\ >nul
    echo   ✓ OPTIMIZATION_SUMMARY.md
)

for %%f in (OPTIMIZATION_COMPLETE.md INTEGRATION_TESTING_COMPLETE.md) do (
    if exist "docs\%%f" (
        git mv "docs\%%f" docs\optimization\ 2>nul || move "docs\%%f" docs\optimization\ >nul
        echo   ✓ docs\%%f
    )
)

REM 7. 移动项目规划文档
echo 📋 移动项目规划文档...
if exist "ANDROID_PROJECT_ENHANCEMENT_PLAN.md" (
    git mv ANDROID_PROJECT_ENHANCEMENT_PLAN.md docs\planning\ 2>nul || move ANDROID_PROJECT_ENHANCEMENT_PLAN.md docs\planning\ >nul
    echo   ✓ ANDROID_PROJECT_ENHANCEMENT_PLAN.md
)

REM 8. 移动 UI/UX 文档
echo 🎨 移动 UI/UX 文档...
if exist "docs\APP_ICON_GUIDE.md" (
    git mv docs\APP_ICON_GUIDE.md docs\ui-ux\ 2>nul || move docs\APP_ICON_GUIDE.md docs\ui-ux\ >nul
    echo   ✓ docs\APP_ICON_GUIDE.md
)

REM 9. 显示整理结果
echo.
echo ✅ 文档整理完成！
echo.
echo 📊 整理统计：

REM 计数函数（Windows 批处理方式）
set count=0
for %%f in (docs\development-phases\*.md) do set /a count+=1
echo   - 开发阶段: %count% 个文件

set count=0
for %%f in (docs\build-deployment\*.md) do set /a count+=1
echo   - 构建部署: %count% 个文件

set count=0
for %%f in (docs\ci-cd\*.md) do set /a count+=1
echo   - CI/CD: %count% 个文件

set count=0
for %%f in (docs\features\p2p\*.md) do set /a count+=1
echo   - P2P 功能: %count% 个文件

set count=0
for %%f in (docs\optimization\*.md) do set /a count+=1
echo   - 优化测试: %count% 个文件

set count=0
for %%f in (docs\planning\*.md) do set /a count+=1
echo   - 项目规划: %count% 个文件

set count=0
for %%f in (docs\ui-ux\*.md) do set /a count+=1
echo   - UI/UX: %count% 个文件

echo.
echo 💡 下一步:
echo   1. 查看变更: git status
echo   2. 确认无误后提交: git add . ^&^& git commit -m "docs: reorganize android app documentation"
echo   3. 可以删除整理计划文件: del DIRECTORY_CLEANUP_PLAN.md
echo.

pause
