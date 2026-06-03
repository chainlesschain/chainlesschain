@echo off
REM ###############################################################################
REM 外部设备文件管理功能 - 演示脚本 (Windows)
REM
REM 用途：快速启动演示环境并执行基本测试
REM ###############################################################################

setlocal enabledelayedexpansion

REM 颜色定义（使用颜色代码）
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

echo.
echo %GREEN%╔═══════════════════════════════════════════════════════════╗%NC%
echo %GREEN%║   外部设备文件管理功能 - 演示脚本                         ║%NC%
echo %GREEN%║   ChainlessChain Desktop App                              ║%NC%
echo %GREEN%╚═══════════════════════════════════════════════════════════╝%NC%
echo.

REM 切换到项目根目录
cd /d "%~dp0.."

REM 检查依赖
echo %BLUE%[INFO]%NC% 检查依赖...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[ERROR]%NC% Node.js 未安装
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[ERROR]%NC% npm 未安装
    exit /b 1
)

echo %GREEN%[SUCCESS]%NC% 依赖检查通过
echo.

REM 检查数据库Schema
echo %BLUE%[INFO]%NC% 检查数据库Schema...
findstr /C:"external_device_files" src\main\database.js >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[ERROR]%NC% 数据库Schema未包含 external_device_files 表
    exit /b 1
)

findstr /C:"file_transfer_tasks" src\main\database.js >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[ERROR]%NC% 数据库Schema未包含 file_transfer_tasks 表
    exit /b 1
)

findstr /C:"file_sync_logs" src\main\database.js >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[ERROR]%NC% 数据库Schema未包含 file_sync_logs 表
    exit /b 1
)

echo %GREEN%[SUCCESS]%NC% 数据库Schema检查通过
echo.

REM 检查核心文件
echo %BLUE%[INFO]%NC% 检查核心文件...

if not exist "src\main\p2p\file-sync-protocols.js" (
    echo %RED%[ERROR]%NC% 文件不存在: src\main\p2p\file-sync-protocols.js
    exit /b 1
)

if not exist "src\main\file\external-device-file-manager.js" (
    echo %RED%[ERROR]%NC% 文件不存在: src\main\file\external-device-file-manager.js
    exit /b 1
)

if not exist "src\main\file\external-device-file-ipc.js" (
    echo %RED%[ERROR]%NC% 文件不存在: src\main\file\external-device-file-ipc.js
    exit /b 1
)

if not exist "src\renderer\pages\ExternalDeviceBrowser.vue" (
    echo %RED%[ERROR]%NC% 文件不存在: src\renderer\pages\ExternalDeviceBrowser.vue
    exit /b 1
)

echo %GREEN%[SUCCESS]%NC% 核心文件检查通过
echo.

REM 检查路由配置
echo %BLUE%[INFO]%NC% 检查路由配置...
findstr /C:"external-devices" src\renderer\router\index.js >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED%[ERROR]%NC% 路由配置中未找到 external-devices
    exit /b 1
)

echo %GREEN%[SUCCESS]%NC% 路由配置检查通过
echo.

REM 询问是否运行测试
set /p run_tests="是否运行集成测试? (y/n): "
if /i "%run_tests%"=="y" (
    echo %BLUE%[INFO]%NC% 运行集成测试...
    if exist "tests\integration\external-device-file.test.js" (
        call npm test tests\integration\external-device-file.test.js
        if %errorlevel% neq 0 (
            echo %RED%[ERROR]%NC% 集成测试失败
            exit /b 1
        )
        echo %GREEN%[SUCCESS]%NC% 集成测试通过
        echo.
    ) else (
        echo %YELLOW%[WARNING]%NC% 集成测试文件不存在，跳过测试
        echo.
    )
)

REM 显示使用指南
echo.
echo %GREEN%=== 外部设备文件管理功能 - 使用指南 ===%NC%
echo.
echo %BLUE%1. 访问功能：%NC%
echo    在浏览器中打开：http://localhost:5173/#/external-devices
echo.
echo %BLUE%2. 基本操作：%NC%
echo    a^) 选择设备：从下拉列表选择Android设备
echo    b^) 同步索引：点击"同步索引"按钮获取文件列表
echo    c^) 浏览文件：使用分类过滤和搜索功能
echo    d^) 拉取文件：点击"拉取"按钮下载文件到本地
echo    e^) 导入RAG：点击"导入RAG"按钮将文件导入知识库
echo.
echo %BLUE%3. 测试场景：%NC%
echo    a^) 索引同步：测试全量和增量同步
echo    b^) 文件传输：测试小文件和大文件传输
echo    c^) 缓存管理：查看缓存统计和执行清理
echo    d^) RAG集成：导入文件并在AI聊天中测试检索
echo.
echo %BLUE%4. 查看日志：%NC%
echo    - 打开开发者工具（F12）
echo    - 切换到Console查看日志
echo    - 查看Network监控P2P消息
echo.
echo %BLUE%5. 数据库检查：%NC%
echo    sqlite3 data\chainlesschain.db
echo    SELECT * FROM external_device_files;
echo    SELECT * FROM file_transfer_tasks;
echo    SELECT * FROM file_sync_logs;
echo.
echo %GREEN%=== 常见问题 ===%NC%
echo.
echo %YELLOW%Q: 设备列表为空？%NC%
echo A: 检查网络连接和P2P服务状态
echo.
echo %YELLOW%Q: 同步索引失败？%NC%
echo A: 查看控制台错误日志，检查Android端权限
echo.
echo %YELLOW%Q: 文件传输中断？%NC%
echo A: 检查网络稳定性，保持设备唤醒
echo.
echo 更多帮助请查看：EXTERNAL_DEVICE_FILE_FEATURE.md
echo.

REM 询问是否启动开发服务器
echo %YELLOW%请确保：%NC%
echo   1. Android端应用已启动
echo   2. 两设备在同一WiFi/局域网
echo   3. Android端已授予文件访问权限
echo.

set /p start_server="是否启动开发服务器? (y/n): "
if /i "%start_server%"=="y" (
    echo.
    echo %BLUE%[INFO]%NC% 正在启动开发服务器...
    call npm run dev
) else (
    echo.
    echo %BLUE%[INFO]%NC% 已取消启动
)

endlocal
