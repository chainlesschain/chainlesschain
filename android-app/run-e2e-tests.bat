@echo off
setlocal enabledelayedexpansion

REM ################################################################################
REM ChainlessChain Android E2E测试执行脚本 (Windows)
REM 版本: v0.30.0
REM 用途: 快速运行所有E2E测试并生成报告
REM ################################################################################

set TEST_SUITE=com.chainlesschain.android.e2e.AppE2ETestSuite
set RETRY_COUNT=3
set TEST_OUTPUT_DIR=app\build\outputs\androidTest-results
set COVERAGE_OUTPUT_DIR=app\build\reports\jacoco\jacocoE2ETestReport

REM ################################################################################
REM 打印函数
REM ################################################################################

:print_header
echo.
echo ========================================
echo %~1
echo ========================================
goto :eof

:print_info
echo [INFO] %~1
goto :eof

:print_success
echo [SUCCESS] %~1
goto :eof

:print_warning
echo [WARNING] %~1
goto :eof

:print_error
echo [ERROR] %~1
goto :eof

REM ################################################################################
REM 检查环境
REM ################################################################################

:check_environment
call :print_header "检查环境"

REM 检查Android SDK
if "%ANDROID_HOME%"=="" (
    call :print_error "ANDROID_HOME 未设置"
    exit /b 1
)
call :print_success "Android SDK: %ANDROID_HOME%"

REM 检查ADB
where adb >nul 2>nul
if %errorlevel% neq 0 (
    call :print_error "adb 命令未找到"
    exit /b 1
)
call :print_success "ADB 已安装"

REM 检查设备连接
adb devices | find "device" >nul
if %errorlevel% neq 0 (
    call :print_error "未找到连接的设备或模拟器"
    call :print_info "请启动模拟器或连接设备后重试"
    exit /b 1
)
call :print_success "找到设备"

REM 显示设备信息
call :print_info "设备列表:"
adb devices | find "device"

goto :eof

REM ################################################################################
REM 清理环境
REM ################################################################################

:clean_environment
call :print_header "清理环境"

REM 卸载旧版本应用
call :print_info "卸载旧版本应用..."
adb uninstall com.chainlesschain.android >nul 2>nul
adb uninstall com.chainlesschain.android.test >nul 2>nul

REM 清理构建缓存
call :print_info "清理构建缓存..."
call gradlew clean

call :print_success "环境清理完成"
goto :eof

REM ################################################################################
REM 构建应用
REM ################################################################################

:build_app
call :print_header "构建应用"

call :print_info "构建Debug APK..."
call gradlew assembleDebug
if %errorlevel% neq 0 (
    call :print_error "Debug APK构建失败"
    exit /b 1
)

call :print_info "构建Test APK..."
call gradlew assembleDebugAndroidTest
if %errorlevel% neq 0 (
    call :print_error "Test APK构建失败"
    exit /b 1
)

call :print_success "构建完成"
goto :eof

REM ################################################################################
REM 运行E2E测试
REM ################################################################################

:run_e2e_tests
call :print_header "运行E2E测试"

set test_type=%~1
if "%test_type%"=="" set test_type=all

set retry=0
set success=false

:retry_loop
if %retry% geq %RETRY_COUNT% goto :after_retry

if %retry% gtr 0 (
    call :print_warning "第 !retry! 次重试..."
)

if "%test_type%"=="all" (
    call :print_info "运行所有E2E测试 (62个测试)..."
    call gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=%TEST_SUITE% --stacktrace
    if %errorlevel% equ 0 set success=true
)

if "%test_type%"=="critical" (
    call :print_info "运行关键测试 (11个测试)..."
    call gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.annotation=com.chainlesschain.android.test.annotation.CriticalTest --stacktrace
    if %errorlevel% equ 0 set success=true
)

if "%test_type%"=="ui" (
    call :print_info "运行UI测试 (20个测试)..."
    call gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.chainlesschain.android.feature.p2p.e2e.SocialUIScreensE2ETest --stacktrace
    if %errorlevel% equ 0 set success=true
)

if "%test_type%"=="feature" (
    call :print_info "运行功能测试 (7个测试)..."
    call gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.annotation=com.chainlesschain.android.test.annotation.FeatureTest --stacktrace
    if %errorlevel% equ 0 set success=true
)

if "%success%"=="true" goto :after_retry

set /a retry+=1
goto :retry_loop

:after_retry
if "%success%"=="true" (
    call :print_success "测试执行成功"
    exit /b 0
) else (
    call :print_error "测试执行失败（已重试 %RETRY_COUNT% 次）"
    exit /b 1
)

REM ################################################################################
REM 生成覆盖率报告
REM ################################################################################

:generate_coverage_report
call :print_header "生成覆盖率报告"

call :print_info "运行JaCoCo覆盖率分析..."
call gradlew jacocoE2ETestReport

if exist "%COVERAGE_OUTPUT_DIR%\html\index.html" (
    call :print_success "覆盖率报告已生成"
    call :print_info "报告位置: %COVERAGE_OUTPUT_DIR%\html\index.html"

    REM 尝试在浏览器中打开
    start "" "%COVERAGE_OUTPUT_DIR%\html\index.html"
) else (
    call :print_warning "覆盖率报告生成失败"
)

goto :eof

REM ################################################################################
REM 收集测试结果
REM ################################################################################

:collect_test_results
call :print_header "收集测试结果"

if exist "%TEST_OUTPUT_DIR%" (
    call :print_info "测试结果目录: %TEST_OUTPUT_DIR%"

    REM 尝试在浏览器中打开测试报告
    if exist "%TEST_OUTPUT_DIR%\connected\index.html" (
        call :print_success "测试报告已生成"
        start "" "%TEST_OUTPUT_DIR%\connected\index.html"
    )
) else (
    call :print_warning "未找到测试结果"
)

goto :eof

REM ################################################################################
REM 保存测试截图
REM ################################################################################

:save_test_screenshots
call :print_header "保存测试截图"

set screenshot_dir=test-screenshots-%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set screenshot_dir=%screenshot_dir: =0%
mkdir "%screenshot_dir%" 2>nul

call :print_info "从设备拉取测试截图..."
adb pull /sdcard/Pictures/Screenshots "%screenshot_dir%\" >nul 2>nul
adb pull /data/data/com.chainlesschain.android/files/screenshots "%screenshot_dir%\test-failures\" >nul 2>nul

if exist "%screenshot_dir%\" (
    dir /b "%screenshot_dir%" | findstr "^" >nul
    if %errorlevel% equ 0 (
        call :print_success "截图已保存到: %screenshot_dir%"
    ) else (
        call :print_info "没有截图需要保存"
        rmdir "%screenshot_dir%" 2>nul
    )
)

goto :eof

REM ################################################################################
REM 生成测试摘要
REM ################################################################################

:generate_test_summary
call :print_header "测试摘要"

set summary_file=test-summary-%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%.txt
set summary_file=%summary_file: =0%

(
echo ChainlessChain Android E2E测试报告
echo ========================================
echo 测试时间: %date% %time%
echo 版本: v0.30.0
echo.
echo 测试配置
echo ----------------------------------------
echo - 测试套件: %TEST_SUITE%
echo - 重试次数: %RETRY_COUNT%
echo.
echo 文件位置
echo ----------------------------------------
echo - 测试报告: %TEST_OUTPUT_DIR%\connected\index.html
echo - 覆盖率报告: %COVERAGE_OUTPUT_DIR%\html\index.html
echo.
echo ========================================
) > "%summary_file%"

call :print_success "测试摘要已保存到: %summary_file%"
type "%summary_file%"

goto :eof

REM ################################################################################
REM 主函数
REM ################################################################################

:main
set start_time=%time%

call :print_header "ChainlessChain Android E2E测试执行器 v0.30.0"

REM 解析参数
set test_type=%~1
if "%test_type%"=="" set test_type=all

set skip_build=%~2
if "%skip_build%"=="" set skip_build=false

set skip_clean=%~3
if "%skip_clean%"=="" set skip_clean=false

REM 执行流程
call :check_environment
if %errorlevel% neq 0 exit /b 1

if not "%skip_clean%"=="true" (
    call :clean_environment
)

if not "%skip_build%"=="true" (
    call :build_app
    if %errorlevel% neq 0 exit /b 1
)

call :run_e2e_tests "%test_type%"
if %errorlevel% equ 0 (
    call :generate_coverage_report
    call :collect_test_results
    call :save_test_screenshots
    call :generate_test_summary

    call :print_header "测试完成"
    call :print_success "测试执行成功！"

    echo.
    call :print_info "打开测试报告..."
    if exist "%TEST_OUTPUT_DIR%\connected\index.html" (
        start "" "%TEST_OUTPUT_DIR%\connected\index.html"
    )

    exit /b 0
) else (
    call :print_header "测试失败"
    call :collect_test_results
    call :save_test_screenshots
    exit /b 1
)

REM ################################################################################
REM 帮助信息
REM ################################################################################

:show_help
echo ChainlessChain Android E2E测试执行器 v0.30.0
echo.
echo 用法: %~nx0 [test_type] [skip_build] [skip_clean]
echo.
echo 参数:
echo   test_type    测试类型 (默认: all)
echo                - all:      运行所有测试 (62个)
echo                - critical: 运行关键测试 (11个)
echo                - ui:       运行UI测试 (20个)
echo                - feature:  运行功能测试 (7个)
echo.
echo   skip_build   跳过构建 (true/false, 默认: false)
echo   skip_clean   跳过清理 (true/false, 默认: false)
echo.
echo 示例:
echo   # 运行所有测试
echo   %~nx0
echo.
echo   # 仅运行UI测试
echo   %~nx0 ui
echo.
echo   # 运行关键测试，跳过构建
echo   %~nx0 critical true
echo.
echo   # 快速运行（跳过清理和构建）
echo   %~nx0 all true true
echo.
echo 报告位置:
echo   - 测试结果: %TEST_OUTPUT_DIR%\connected\index.html
echo   - 覆盖率: %COVERAGE_OUTPUT_DIR%\html\index.html
echo.
goto :eof

REM ################################################################################
REM 入口
REM ################################################################################

if "%~1"=="-h" goto :show_help
if "%~1"=="--help" goto :show_help
if "%~1"=="/?" goto :show_help

call :main %*
exit /b %errorlevel%
