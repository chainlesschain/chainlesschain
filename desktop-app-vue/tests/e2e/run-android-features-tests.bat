@echo off
REM 安卓端功能对应页面 E2E 测试运行脚本 (Windows)
REM 创建日期: 2026-01-25

echo =========================================
echo 安卓端功能对应页面 E2E 测试
echo =========================================
echo.

if "%1"=="" (
  echo 请指定要运行的测试类型:
  echo   run-android-features-tests.bat llm   - LLM功能测试
  echo   run-android-features-tests.bat p2p   - P2P功能测试
  echo   run-android-features-tests.bat all   - 所有测试
  exit /b 0
)

if "%1"=="llm" (
  echo 运行 LLM 功能测试...
  echo.
  call npm run test:e2e tests/e2e/llm/llm-test-chat.e2e.test.ts
  goto :end
)

if "%1"=="p2p" (
  echo 运行 P2P 功能测试...
  echo.
  call npm run test:e2e tests/e2e/p2p/
  goto :end
)

if "%1"=="all" (
  echo 运行所有安卓功能测试...
  echo.

  echo [1/8] 运行: LLM测试聊天
  call npm run test:e2e tests/e2e/llm/llm-test-chat.e2e.test.ts
  echo.

  echo [2/8] 运行: 设备配对
  call npm run test:e2e tests/e2e/p2p/device-pairing.e2e.test.ts
  echo.

  echo [3/8] 运行: 安全号码验证
  call npm run test:e2e tests/e2e/p2p/safety-numbers.e2e.test.ts
  echo.

  echo [4/8] 运行: 会话指纹验证
  call npm run test:e2e tests/e2e/p2p/session-fingerprint.e2e.test.ts
  echo.

  echo [5/8] 运行: 设备管理
  call npm run test:e2e tests/e2e/p2p/device-management.e2e.test.ts
  echo.

  echo [6/8] 运行: P2P文件传输
  call npm run test:e2e tests/e2e/p2p/file-transfer.e2e.test.ts
  echo.

  echo [7/8] 运行: 消息队列管理
  call npm run test:e2e tests/e2e/p2p/message-queue.e2e.test.ts
  echo.

  echo [8/8] 运行: Android功能测试入口
  call npm run test:e2e tests/e2e/test/android-features-test.e2e.test.ts
  echo.

  echo =========================================
  echo 所有测试运行完成
  echo =========================================
  goto :end
)

echo 未知的测试类型: %1
echo 用法: run-android-features-tests.bat [llm^|p2p^|all]
exit /b 1

:end
echo.
echo 测试运行完成!
