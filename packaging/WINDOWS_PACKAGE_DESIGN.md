# ChainlessChain Windows 完整安装包设计方案

## 📦 总体架构

### 安装包组成
```
ChainlessChain-Setup.exe
├── Electron Desktop App (主程序)
├── Java Backend Service (Spring Boot JAR)
├── Python AI Service (PyInstaller EXE)
├── PostgreSQL Embedded (数据库)
├── Redis Portable (缓存)
├── Qdrant Binary (向量数据库)
└── 配置和启动脚本
```

### 预计安装包大小
- **总大小**: ~800MB - 1.2GB
  - Electron App: ~200MB
  - Java Runtime (JRE 17): ~200MB
  - Python AI Service: ~150MB
  - PostgreSQL Portable: ~100MB
  - Redis: ~5MB
  - Qdrant: ~50MB
  - 其他依赖和配置: ~100MB

## 🏗️ 组件详细设计

### 1. Electron 主应用

**打包工具**: Electron Forge + Squirrel.Windows

**配置修改**:
- 使用 `extraResource` 包含所有后端服务
- 配置自动启动后端服务
- 添加托盘菜单控制服务启停

**目录结构**:
```
C:\Program Files\ChainlessChain\
├── ChainlessChain.exe (主程序)
├── resources\
│   ├── app.asar (Electron应用)
│   ├── backend\
│   │   ├── project-service.jar
│   │   ├── ai-service.exe
│   │   └── jre\ (内嵌Java运行时)
│   ├── database\
│   │   ├── postgres\
│   │   ├── redis\
│   │   └── qdrant\
│   └── config\
│       └── application.yml
└── data\ (用户数据目录)
    ├── chainlesschain.db (SQLite主数据库)
    ├── postgres\ (PostgreSQL数据)
    ├── redis\ (Redis持久化)
    └── qdrant\ (向量数据)
```

### 2. Java 后端服务

**打包方式**: Spring Boot Fat JAR + 内嵌 JRE

```xml
<!-- pom.xml 配置 -->
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <executable>true</executable>
        <layout>JAR</layout>
    </configuration>
</plugin>
```

**启动脚本** (`start-project-service.bat`):
```batch
@echo off
set JAVA_HOME=%~dp0jre
"%JAVA_HOME%\bin\java.exe" -jar project-service.jar ^
  --server.port=9090 ^
  --spring.profiles.active=production
```

**JRE 获取**:
- 使用 jlink 创建最小化 JRE (仅包含必需模块)
- 或直接打包 Adoptium JRE 17

### 3. Python AI 服务

**打包工具**: PyInstaller

**打包命令**:
```bash
cd backend/ai-service

# 创建 spec 文件
pyinstaller --name=ai-service \
  --onefile \
  --hidden-import=uvicorn \
  --hidden-import=fastapi \
  --hidden-import=qdrant_client \
  --add-data="config.py;." \
  --add-data="templates;templates" \
  main.py
```

**配置修改**:
- 移除 Ollama 相关代码（仅保留云LLM支持）
- 优化依赖（移除 sentence-transformers 等大型库）
- 使用云端 embedding API 替代本地模型

**支持的云LLM提供商**:
- 阿里云通义千问 (Dashscope)
- 智谱AI (ChatGLM)
- 百度千帆
- 腾讯混元
- 讯飞星火
- MiniMax
- DeepSeek
- OpenAI

### 4. PostgreSQL 数据库

**方案**: PostgreSQL Portable (无需安装)

**下载地址**:
- https://get.enterprisedb.com/postgresql/postgresql-16.1-1-windows-x64-binaries.zip

**配置**:
```ini
# postgresql.conf
port = 5432
max_connections = 20
shared_buffers = 128MB
data_directory = 'data/postgres'
```

**初始化脚本** (`init-postgres.bat`):
```batch
@echo off
cd /d "%~dp0postgres"
bin\initdb.exe -D data -U chainlesschain --encoding=UTF8 --locale=C
bin\pg_ctl.exe -D data -l logfile start
bin\psql.exe -U chainlesschain -c "CREATE DATABASE chainlesschain;"
```

### 5. Redis 缓存

**方案**: Redis for Windows (Memurai 或 Tporadek Redis)

**下载地址**:
- https://github.com/tporadowski/redis/releases (官方Windows移植)

**配置** (`redis.conf`):
```conf
port 6379
requirepass chainlesschain_redis_2024
appendonly yes
dir ./data/redis
```

### 6. Qdrant 向量数据库

**方案**: Qdrant Binary for Windows

**下载地址**:
- https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip

**配置** (`config.yaml`):
```yaml
service:
  http_port: 6333
  grpc_port: 6334

storage:
  storage_path: ./data/qdrant
```

## 🚀 启动流程设计

### 主启动脚本 (`start-all-services.bat`)

```batch
@echo off
title ChainlessChain Services Manager

REM 设置环境变量
set APP_DIR=%~dp0
set DATA_DIR=%APP_DIR%data

REM 1. 启动 PostgreSQL
echo [1/4] Starting PostgreSQL...
start /B cmd /c "%APP_DIR%database\postgres\bin\pg_ctl.exe -D %DATA_DIR%\postgres -l %DATA_DIR%\postgres\logfile start"
timeout /t 5

REM 2. 启动 Redis
echo [2/4] Starting Redis...
start /B cmd /c "%APP_DIR%database\redis\redis-server.exe %APP_DIR%config\redis.conf"
timeout /t 2

REM 3. 启动 Qdrant
echo [3/4] Starting Qdrant...
start /B cmd /c "%APP_DIR%database\qdrant\qdrant.exe --config-path %APP_DIR%config\qdrant.yaml"
timeout /t 3

REM 4. 启动 AI Service
echo [4/4] Starting AI Service...
start /B cmd /c "%APP_DIR%backend\ai-service.exe --port 8001"
timeout /t 3

REM 5. 启动 Project Service
echo [5/5] Starting Project Service...
start /B cmd /c "%APP_DIR%backend\jre\bin\java.exe -jar %APP_DIR%backend\project-service.jar"

echo.
echo All services started successfully!
echo ChainlessChain is ready to use.
pause
```

### Electron 自动启动后端

修改 `desktop-app-vue/src/main/index.js`:

```javascript
const { spawn } = require('child_process');
const path = require('path');

// 启动后端服务
function startBackendServices() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const appPath = process.resourcesPath;
    const startScript = path.join(appPath, 'backend', 'start-all-services.bat');

    const backend = spawn('cmd', ['/c', startScript], {
      detached: false,
      windowsHide: true
    });

    backend.stdout.on('data', (data) => {
      console.log(`Backend: ${data}`);
    });

    backend.stderr.on('data', (data) => {
      console.error(`Backend Error: ${data}`);
    });

    // 监听应用退出，关闭后端服务
    app.on('will-quit', () => {
      // 执行关闭脚本
      const stopScript = path.join(appPath, 'backend', 'stop-all-services.bat');
      execSync(stopScript);
    });
  }
}

app.whenReady().then(() => {
  startBackendServices();
  createWindow();
});
```

### 停止脚本 (`stop-all-services.bat`)

```batch
@echo off
echo Stopping ChainlessChain services...

REM 停止 Java 项目服务
taskkill /F /IM java.exe /FI "WINDOWTITLE eq project-service*"

REM 停止 Python AI 服务
taskkill /F /IM ai-service.exe

REM 停止 Qdrant
taskkill /F /IM qdrant.exe

REM 停止 Redis
taskkill /F /IM redis-server.exe

REM 停止 PostgreSQL
%~dp0database\postgres\bin\pg_ctl.exe -D %~dp0data\postgres stop

echo All services stopped.
```

## 📝 NSIS 安装程序脚本

创建 `installer.nsi`:

```nsis
!include "MUI2.nsh"

# 定义应用信息
!define APP_NAME "ChainlessChain"
!define APP_VERSION "0.16.0"
!define APP_PUBLISHER "ChainlessChain Team"
!define APP_URL "https://chainlesschain.com"

# 安装程序输出
OutFile "ChainlessChain-Setup-${APP_VERSION}.exe"
InstallDir "$PROGRAMFILES64\${APP_NAME}"

# 界面设置
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_HEADERIMAGE
!define MUI_WELCOMEPAGE_TITLE "欢迎安装 ChainlessChain"
!define MUI_WELCOMEPAGE_TEXT "这将在您的计算机上安装 ${APP_NAME} ${APP_VERSION}。$\r$\n$\r$\n点击「下一步」继续。"

# 页面
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

# 安装部分
Section "MainSection" SEC01
  SetOutPath "$INSTDIR"

  # 复制 Electron 主程序
  File /r "desktop-app-vue\out\ChainlessChain-win32-x64\*.*"

  # 复制后端服务
  SetOutPath "$INSTDIR\resources\backend"
  File "backend\project-service\target\project-service.jar"
  File "backend\ai-service\dist\ai-service.exe"

  # 复制 JRE
  SetOutPath "$INSTDIR\resources\backend\jre"
  File /r "jre-17\*.*"

  # 复制数据库
  SetOutPath "$INSTDIR\resources\database"
  File /r "packaging\postgres\*.*"
  File /r "packaging\redis\*.*"
  File /r "packaging\qdrant\*.*"

  # 复制配置文件
  SetOutPath "$INSTDIR\resources\config"
  File "packaging\config\*.conf"
  File "packaging\config\*.yaml"

  # 复制启动脚本
  SetOutPath "$INSTDIR\resources\backend"
  File "packaging\scripts\start-all-services.bat"
  File "packaging\scripts\stop-all-services.bat"

  # 创建数据目录
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\data\postgres"
  CreateDirectory "$INSTDIR\data\redis"
  CreateDirectory "$INSTDIR\data\qdrant"

  # 初始化 PostgreSQL
  ExecWait '"$INSTDIR\resources\database\postgres\bin\initdb.exe" -D "$INSTDIR\data\postgres" -U chainlesschain --encoding=UTF8'

  # 创建桌面快捷方式
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\ChainlessChain.exe"

  # 创建开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\ChainlessChain.exe"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\卸载.lnk" "$INSTDIR\Uninstall.exe"

  # 写入卸载信息
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayIcon" "$INSTDIR\ChainlessChain.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
SectionEnd

# 卸载部分
Section "Uninstall"
  # 停止所有服务
  ExecWait '"$INSTDIR\resources\backend\stop-all-services.bat"'

  # 删除文件
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR"

  # 删除快捷方式
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  # 删除注册表项
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
SectionEnd
```

## 🛠️ 构建流程

### 构建脚本 (`build-windows-installer.bat`)

```batch
@echo off
echo ========================================
echo ChainlessChain Windows Installer Builder
echo ========================================

REM 1. 构建 Electron 应用
echo [1/7] Building Electron App...
cd desktop-app-vue
call npm install
call npm run build
call npm run package
cd ..

REM 2. 打包 Java 后端
echo [2/7] Building Java Backend...
cd backend\project-service
call mvn clean package -DskipTests
cd ..\..

REM 3. 打包 Python AI 服务
echo [3/7] Building Python AI Service...
cd backend\ai-service
call pip install -r requirements.txt
call pyinstaller ai-service.spec
cd ..\..

REM 4. 下载并准备 PostgreSQL
echo [4/7] Preparing PostgreSQL...
if not exist "packaging\postgres" (
  echo Downloading PostgreSQL...
  REM 这里需要手动下载或使用 curl/wget
)

REM 5. 下载并准备 Redis
echo [5/7] Preparing Redis...
if not exist "packaging\redis" (
  echo Downloading Redis...
  REM 这里需要手动下载
)

REM 6. 下载并准备 Qdrant
echo [6/7] Preparing Qdrant...
if not exist "packaging\qdrant" (
  echo Downloading Qdrant...
  curl -L https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip -o qdrant.zip
  7z x qdrant.zip -opackaging\qdrant
)

REM 7. 构建安装程序
echo [7/7] Building Installer...
makensis installer.nsi

echo.
echo ========================================
echo Build completed!
echo Installer: ChainlessChain-Setup-0.16.0.exe
echo ========================================
pause
```

## 📋 待办事项

- [ ] 准备所有第三方组件的 Windows 二进制文件
- [ ] 修改 Python AI 服务移除 Ollama 依赖
- [ ] 创建服务管理器（系统托盘应用）
- [ ] 实现健康检查和自动重启
- [ ] 添加日志查看器
- [ ] 创建配置向导（首次运行时配置云LLM API Key）
- [ ] 测试完整安装和卸载流程
- [ ] 签名安装程序（代码签名证书）

## 🔄 替代方案

如果打包遇到困难，可以考虑：

1. **使用 electron-builder 替代 Electron Forge**
   - 更好的 extraResources 支持
   - 内置 NSIS 脚本生成

2. **使用 Docker Desktop for Windows**
   - 简化后端服务管理
   - 但增加了 Docker Desktop 依赖

3. **仅打包轻量版**
   - 只打包 Electron + Python AI (云LLM)
   - PostgreSQL/Redis 改用 SQLite 替代
   - 减小到 ~300MB

## 📊 预计时间表

- **准备组件**: 2-3天
- **打包脚本开发**: 2-3天
- **测试和调试**: 2-3天
- **文档和发布**: 1天

**总计**: 约 7-10 天
