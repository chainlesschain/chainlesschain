@echo off
REM 启用远程控制功能 - Windows 批处理脚本
REM 作用：将所有 .kt.disabled 文件重命名为 .kt

echo ========================================
echo 启用远程控制功能
echo ========================================
echo.

set BASE_DIR=app\src\main\java\com\chainlesschain\android\remote

echo 正在启用远程控制文件...
echo.

REM P2P WebRTC 客户端
if exist "%BASE_DIR%\p2p\P2PClientWithWebRTC.kt.disabled" (
    ren "%BASE_DIR%\p2p\P2PClientWithWebRTC.kt.disabled" "P2PClientWithWebRTC.kt"
    echo [OK] P2PClientWithWebRTC.kt
)

REM WebRTC 客户端
if exist "%BASE_DIR%\webrtc\WebRTCClient.kt.disabled" (
    ren "%BASE_DIR%\webrtc\WebRTCClient.kt.disabled" "WebRTCClient.kt"
    echo [OK] WebRTCClient.kt
)

REM UI 文件
if exist "%BASE_DIR%\ui\RemoteControlScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\RemoteControlScreen.kt.disabled" "RemoteControlScreen.kt"
    echo [OK] RemoteControlScreen.kt
)

if exist "%BASE_DIR%\ui\RemoteControlViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\RemoteControlViewModel.kt.disabled" "RemoteControlViewModel.kt"
    echo [OK] RemoteControlViewModel.kt
)

REM AI 相关界面
if exist "%BASE_DIR%\ui\ai\RemoteAIChatScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\ai\RemoteAIChatScreen.kt.disabled" "RemoteAIChatScreen.kt"
    echo [OK] RemoteAIChatScreen.kt
)

if exist "%BASE_DIR%\ui\ai\RemoteAIChatViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\ai\RemoteAIChatViewModel.kt.disabled" "RemoteAIChatViewModel.kt"
    echo [OK] RemoteAIChatViewModel.kt
)

if exist "%BASE_DIR%\ui\ai\RemoteAgentControlScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\ai\RemoteAgentControlScreen.kt.disabled" "RemoteAgentControlScreen.kt"
    echo [OK] RemoteAgentControlScreen.kt
)

if exist "%BASE_DIR%\ui\ai\RemoteAgentControlViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\ai\RemoteAgentControlViewModel.kt.disabled" "RemoteAgentControlViewModel.kt"
    echo [OK] RemoteAgentControlViewModel.kt
)

if exist "%BASE_DIR%\ui\ai\RemoteRAGSearchScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\ai\RemoteRAGSearchScreen.kt.disabled" "RemoteRAGSearchScreen.kt"
    echo [OK] RemoteRAGSearchScreen.kt
)

if exist "%BASE_DIR%\ui\ai\RemoteRAGSearchViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\ai\RemoteRAGSearchViewModel.kt.disabled" "RemoteRAGSearchViewModel.kt"
    echo [OK] RemoteRAGSearchViewModel.kt
)

REM 桌面相关界面
if exist "%BASE_DIR%\ui\desktop\RemoteDesktopScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\desktop\RemoteDesktopScreen.kt.disabled" "RemoteDesktopScreen.kt"
    echo [OK] RemoteDesktopScreen.kt
)

if exist "%BASE_DIR%\ui\desktop\RemoteDesktopViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\desktop\RemoteDesktopViewModel.kt.disabled" "RemoteDesktopViewModel.kt"
    echo [OK] RemoteDesktopViewModel.kt
)

REM 文件传输界面
if exist "%BASE_DIR%\ui\file\FileTransferScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\file\FileTransferScreen.kt.disabled" "FileTransferScreen.kt"
    echo [OK] FileTransferScreen.kt
)

if exist "%BASE_DIR%\ui\file\FileTransferViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\file\FileTransferViewModel.kt.disabled" "FileTransferViewModel.kt"
    echo [OK] FileTransferViewModel.kt
)

REM 历史记录界面
if exist "%BASE_DIR%\ui\history\CommandHistoryScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\history\CommandHistoryScreen.kt.disabled" "CommandHistoryScreen.kt"
    echo [OK] CommandHistoryScreen.kt
)

if exist "%BASE_DIR%\ui\history\CommandHistoryViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\history\CommandHistoryViewModel.kt.disabled" "CommandHistoryViewModel.kt"
    echo [OK] CommandHistoryViewModel.kt
)

REM 系统相关界面
if exist "%BASE_DIR%\ui\system\RemoteScreenshotScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\system\RemoteScreenshotScreen.kt.disabled" "RemoteScreenshotScreen.kt"
    echo [OK] RemoteScreenshotScreen.kt
)

if exist "%BASE_DIR%\ui\system\RemoteScreenshotViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\system\RemoteScreenshotViewModel.kt.disabled" "RemoteScreenshotViewModel.kt"
    echo [OK] RemoteScreenshotViewModel.kt
)

if exist "%BASE_DIR%\ui\system\SystemMonitorScreen.kt.disabled" (
    ren "%BASE_DIR%\ui\system\SystemMonitorScreen.kt.disabled" "SystemMonitorScreen.kt"
    echo [OK] SystemMonitorScreen.kt
)

if exist "%BASE_DIR%\ui\system\SystemMonitorViewModel.kt.disabled" (
    ren "%BASE_DIR%\ui\system\SystemMonitorViewModel.kt.disabled" "SystemMonitorViewModel.kt"
    echo [OK] SystemMonitorViewModel.kt
)

echo.
echo ========================================
echo 远程控制功能已启用！
echo ========================================
echo.
echo 下一步：
echo 1. 运行 gradlew clean
echo 2. 运行 gradlew assembleDebug
echo.
pause
