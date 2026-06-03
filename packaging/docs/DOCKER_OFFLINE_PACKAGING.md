# Docker 镜像离线打包方案 📦

## 🎯 方案概述

**核心思路**: 将所有 Docker 镜像导出为 tar 文件，打包进安装包，用户安装时自动加载。

**优势**:
- ✅ 完全离线安装，无需联网
- ✅ 安装即用，零配置
- ✅ 避免网络问题和镜像下载失败
- ✅ 统一版本，确保兼容性

**预期包大小**:
```
桌面应用: 60MB
Docker镜像:
  - postgres:16-alpine      ~90MB
  - redis:7-alpine          ~30MB
  - qdrant/qdrant:v1.12.5   ~120MB
  - ollama/ollama:latest    ~500MB (可选)

总计: ~800MB (不含Ollama) 或 ~1.3GB (含Ollama)
```

---

## 📋 实施步骤

### 步骤 1: 导出 Docker 镜像

创建镜像导出脚本：

**`packaging/export-docker-images.sh`**:

```bash
#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="$SCRIPT_DIR/docker-images"

echo "=== Docker 镜像导出 ==="
echo ""

# 创建导出目录
mkdir -p "$IMAGES_DIR"

# 需要导出的镜像列表
IMAGES=(
    "postgres:16-alpine"
    "redis:7-alpine"
    "qdrant/qdrant:v1.12.5"
    # "ollama/ollama:latest"  # 可选，体积较大
)

# 导出镜像
for IMAGE in "${IMAGES[@]}"; do
    IMAGE_NAME=$(echo "$IMAGE" | sed 's/[:/]/-/g')
    TAR_FILE="$IMAGES_DIR/${IMAGE_NAME}.tar"

    echo "正在导出: $IMAGE"

    # 检查镜像是否存在
    if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
        echo "  镜像不存在，正在拉取..."
        docker pull "$IMAGE"
    fi

    # 导出镜像
    echo "  导出到: $TAR_FILE"
    docker save -o "$TAR_FILE" "$IMAGE"

    # 显示文件大小
    SIZE=$(du -h "$TAR_FILE" | cut -f1)
    echo "  ✓ 完成 (大小: $SIZE)"
    echo ""
done

# 创建镜像清单
cat > "$IMAGES_DIR/images-manifest.txt" << EOF
# ChainlessChain Docker 镜像清单
# 生成时间: $(date)

EOF

for IMAGE in "${IMAGES[@]}"; do
    IMAGE_NAME=$(echo "$IMAGE" | sed 's/[:/]/-/g')
    echo "${IMAGE_NAME}.tar|${IMAGE}" >> "$IMAGES_DIR/images-manifest.txt"
done

echo "========================================="
echo "✅ 所有镜像导出完成！"
echo "========================================="
echo ""
echo "导出位置: $IMAGES_DIR"
echo "文件列表:"
ls -lh "$IMAGES_DIR"/*.tar
echo ""
echo "总大小:"
du -sh "$IMAGES_DIR"
echo ""
echo "下一步: 将 docker-images 目录打包进安装包"
```

**`packaging/export-docker-images.bat`** (Windows):

```batch
@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "IMAGES_DIR=%SCRIPT_DIR%docker-images"

echo === Docker 镜像导出 ===
echo.

REM 创建导出目录
if not exist "%IMAGES_DIR%" mkdir "%IMAGES_DIR%"

REM 导出 PostgreSQL
echo [1/3] 导出 PostgreSQL...
docker pull postgres:16-alpine
docker save -o "%IMAGES_DIR%\postgres-16-alpine.tar" postgres:16-alpine
echo   完成！
echo.

REM 导出 Redis
echo [2/3] 导出 Redis...
docker pull redis:7-alpine
docker save -o "%IMAGES_DIR%\redis-7-alpine.tar" redis:7-alpine
echo   完成！
echo.

REM 导出 Qdrant
echo [3/3] 导出 Qdrant...
docker pull qdrant/qdrant:v1.12.5
docker save -o "%IMAGES_DIR%\qdrant-qdrant-v1.12.5.tar" qdrant/qdrant:v1.12.5
echo   完成！
echo.

REM 可选: 导出 Ollama (大文件，询问用户)
choice /C YN /M "是否导出 Ollama 镜像 (约500MB)?"
if errorlevel 2 goto :skip_ollama
if errorlevel 1 (
    echo [4/4] 导出 Ollama...
    docker pull ollama/ollama:latest
    docker save -o "%IMAGES_DIR%\ollama-ollama-latest.tar" ollama/ollama:latest
    echo   完成！
    echo.
)

:skip_ollama

REM 创建清单文件
echo # ChainlessChain Docker 镜像清单 > "%IMAGES_DIR%\images-manifest.txt"
echo # 生成时间: %date% %time% >> "%IMAGES_DIR%\images-manifest.txt"
echo. >> "%IMAGES_DIR%\images-manifest.txt"
echo postgres-16-alpine.tar^|postgres:16-alpine >> "%IMAGES_DIR%\images-manifest.txt"
echo redis-7-alpine.tar^|redis:7-alpine >> "%IMAGES_DIR%\images-manifest.txt"
echo qdrant-qdrant-v1.12.5.tar^|qdrant/qdrant:v1.12.5 >> "%IMAGES_DIR%\images-manifest.txt"

echo =========================================
echo 所有镜像导出完成！
echo =========================================
echo.
echo 导出位置: %IMAGES_DIR%
echo.
dir /s "%IMAGES_DIR%\*.tar"
echo.
pause
```

---

### 步骤 2: 创建镜像加载脚本

**`packaging/load-docker-images.sh`** (用户端):

```bash
#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_DIR="$SCRIPT_DIR/docker-images"
MANIFEST_FILE="$IMAGES_DIR/images-manifest.txt"

echo "========================================="
echo " ChainlessChain Docker 镜像加载"
echo "========================================="
echo ""

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ 错误: Docker 未运行"
    echo "请先启动 Docker Desktop 后再试"
    exit 1
fi

echo "✅ Docker 正在运行"
echo ""

# 检查镜像目录
if [ ! -d "$IMAGES_DIR" ]; then
    echo "❌ 错误: 找不到镜像目录: $IMAGES_DIR"
    exit 1
fi

# 读取清单并加载镜像
if [ ! -f "$MANIFEST_FILE" ]; then
    echo "❌ 错误: 找不到镜像清单: $MANIFEST_FILE"
    exit 1
fi

echo "🚀 开始加载镜像..."
echo ""

TOTAL=0
LOADED=0
FAILED=0

while IFS='|' read -r TAR_NAME IMAGE_NAME; do
    # 跳过注释和空行
    [[ "$TAR_NAME" =~ ^#.*$ ]] && continue
    [[ -z "$TAR_NAME" ]] && continue

    TOTAL=$((TOTAL + 1))
    TAR_FILE="$IMAGES_DIR/$TAR_NAME"

    echo "[$TOTAL] 加载: $IMAGE_NAME"

    if [ ! -f "$TAR_FILE" ]; then
        echo "  ⚠️  文件不存在: $TAR_FILE"
        FAILED=$((FAILED + 1))
        continue
    fi

    # 显示文件大小
    SIZE=$(du -h "$TAR_FILE" | cut -f1)
    echo "  文件大小: $SIZE"

    # 加载镜像
    if docker load -i "$TAR_FILE" > /dev/null 2>&1; then
        echo "  ✓ 加载成功"
        LOADED=$((LOADED + 1))
    else
        echo "  ✗ 加载失败"
        FAILED=$((FAILED + 1))
    fi
    echo ""
done < "$MANIFEST_FILE"

echo "========================================="
echo "镜像加载完成！"
echo "========================================="
echo ""
echo "统计:"
echo "  总计: $TOTAL"
echo "  成功: $LOADED"
echo "  失败: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ 所有镜像加载成功！"
    echo ""
    echo "下一步: 运行 ./start-services.sh 启动服务"
else
    echo "⚠️  部分镜像加载失败，请检查错误信息"
fi
```

**`packaging/load-docker-images.bat`** (Windows):

```batch
@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "IMAGES_DIR=%SCRIPT_DIR%docker-images"
set "MANIFEST_FILE=%IMAGES_DIR%\images-manifest.txt"

echo =========================================
echo  ChainlessChain Docker 镜像加载
echo =========================================
echo.

REM 检查 Docker 是否运行
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [31m 错误: Docker 未运行[0m
    echo 请先启动 Docker Desktop 后再试
    pause
    exit /b 1
)

echo [32m Docker 正在运行[0m
echo.

REM 检查镜像目录
if not exist "%IMAGES_DIR%" (
    echo [31m 错误: 找不到镜像目录[0m
    pause
    exit /b 1
)

echo [33m 开始加载镜像...[0m
echo.

set "TOTAL=0"
set "LOADED=0"
set "FAILED=0"

REM 读取清单并加载
for /f "usebackq tokens=1,2 delims=|" %%A in ("%MANIFEST_FILE%") do (
    set "TAR_NAME=%%A"
    set "IMAGE_NAME=%%B"

    REM 跳过注释行
    echo !TAR_NAME! | findstr /r "^#" >nul && goto :skip_line

    set /a TOTAL+=1
    set "TAR_FILE=%IMAGES_DIR%\!TAR_NAME!"

    echo [!TOTAL!] 加载: !IMAGE_NAME!

    if not exist "!TAR_FILE!" (
        echo   [33m 文件不存在[0m
        set /a FAILED+=1
        goto :skip_line
    )

    REM 加载镜像
    docker load -i "!TAR_FILE!" >nul 2>&1
    if !errorlevel! equ 0 (
        echo   [32m 加载成功[0m
        set /a LOADED+=1
    ) else (
        echo   [31m 加载失败[0m
        set /a FAILED+=1
    )
    echo.

    :skip_line
)

echo =========================================
echo 镜像加载完成！
echo =========================================
echo.
echo 统计:
echo   总计: %TOTAL%
echo   成功: %LOADED%
echo   失败: %FAILED%
echo.

if %FAILED% equ 0 (
    echo [32m 所有镜像加载成功！[0m
    echo.
    echo 下一步: 运行 start-services.bat 启动服务
) else (
    echo [33m 部分镜像加载失败，请检查错误信息[0m
)

echo.
pause
```

---

### 步骤 3: 修改 Electron Forge 打包配置

**`desktop-app-vue/forge.config.js`** (添加额外资源):

```javascript
const { extraResources, missingResources, projectServiceJar } = collectExtraResources();

// 添加 Docker 镜像目录到打包资源
const dockerImagesDir = path.join(PACKAGING_DIR, 'docker-images');
if (fs.existsSync(dockerImagesDir)) {
  extraResources.push(dockerImagesDir);
  console.log('[Packaging] Including Docker images directory');
} else {
  console.warn('[Packaging] Docker images not found - package will require internet');
}

// 添加启动脚本
const scriptsToInclude = [
  'docker-compose.production.yml',
  'start-services.sh',
  'start-services.bat',
  'load-docker-images.sh',
  'load-docker-images.bat',
  '.env.example'
];

scriptsToInclude.forEach(script => {
  const scriptPath = path.join(PACKAGING_DIR, script);
  if (fs.existsSync(scriptPath)) {
    extraResources.push(scriptPath);
  }
});
```

---

### 步骤 4: 创建安装后自动加载脚本

**`packaging/post-install.js`** (Electron 安装后钩子):

```javascript
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// 检测操作系统
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

// 获取资源路径
const resourcesPath = process.resourcesPath || path.join(__dirname, '..', 'resources');
const loadScriptPath = isWindows
  ? path.join(resourcesPath, 'load-docker-images.bat')
  : path.join(resourcesPath, 'load-docker-images.sh');

console.log('[Post-Install] ChainlessChain 安装后配置');
console.log('[Post-Install] 检查 Docker 镜像...');

// 检查脚本是否存在
if (!fs.existsSync(loadScriptPath)) {
  console.log('[Post-Install] 未找到 Docker 镜像加载脚本，跳过');
  process.exit(0);
}

// 询问用户是否加载 Docker 镜像
const { dialog } = require('electron');

dialog.showMessageBox({
  type: 'question',
  buttons: ['是', '否', '稍后'],
  defaultId: 0,
  title: 'ChainlessChain 安装',
  message: '是否现在加载 Docker 镜像？',
  detail: '这将加载后端服务所需的 Docker 镜像（约 800MB）。\n\n' +
          '需要先启动 Docker Desktop。\n\n' +
          '选择"否"将跳过此步骤，您可以稍后手动运行 load-docker-images 脚本。'
}).then(result => {
  if (result.response === 0) {
    // 用户选择 "是"
    console.log('[Post-Install] 开始加载 Docker 镜像...');

    const loadCommand = isWindows
      ? `"${loadScriptPath}"`
      : `bash "${loadScriptPath}"`;

    exec(loadCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('[Post-Install] 加载失败:', error);
        dialog.showErrorBox(
          '镜像加载失败',
          '无法加载 Docker 镜像。请确保 Docker Desktop 正在运行，\n' +
          '然后手动运行 load-docker-images 脚本。'
        );
      } else {
        console.log('[Post-Install] 加载成功');
        console.log(stdout);
        dialog.showMessageBox({
          type: 'info',
          title: '安装完成',
          message: 'Docker 镜像加载成功！',
          detail: '您现在可以运行 start-services 启动后端服务，\n然后启动 ChainlessChain 应用。'
        });
      }
    });
  } else if (result.response === 2) {
    // 用户选择 "稍后"
    console.log('[Post-Install] 用户选择稍后加载镜像');
    dialog.showMessageBox({
      type: 'info',
      title: '提示',
      message: '您可以稍后手动加载镜像',
      detail: '运行安装目录下的 load-docker-images 脚本即可。'
    });
  }
});
```

---

### 步骤 5: 修改安装说明

**`packaging/README-OFFLINE.md`**:

```markdown
# ChainlessChain 离线安装包使用指南

## 📦 包含内容

本安装包包含：
- ✅ ChainlessChain 桌面应用
- ✅ 所有 Docker 后端服务镜像 (已预装)
- ✅ 启动脚本和配置文件

**无需联网即可安装使用！**

---

## 🚀 安装步骤

### 1. 安装 Docker Desktop (首次安装)

如果您的电脑还没有安装 Docker：

**Windows/Mac**:
- 下载: https://www.docker.com/products/docker-desktop/
- 安装并启动 Docker Desktop
- 等待 Docker 图标显示绿色 (正在运行)

**Linux**:
```bash
sudo apt-get update
sudo apt-get install docker.io docker-compose
sudo systemctl start docker
```

### 2. 安装 ChainlessChain

**Windows**:
- 双击 `ChainlessChain-Setup.exe`
- 按照向导完成安装
- 安装完成时会询问是否加载 Docker 镜像，选择"是"

**macOS**:
- 打开 `ChainlessChain.dmg`
- 拖拽到应用程序文件夹
- 首次运行时会自动提示加载镜像

**Linux**:
```bash
chmod +x ChainlessChain.AppImage
./ChainlessChain.AppImage
```

### 3. 加载 Docker 镜像 (如果安装时跳过)

如果安装时没有加载镜像，可以手动加载：

**Windows**:
```cmd
cd "C:\Program Files\ChainlessChain\resources"
load-docker-images.bat
```

**Linux/Mac**:
```bash
cd /Applications/ChainlessChain.app/Contents/Resources
./load-docker-images.sh
```

### 4. 启动后端服务

**Windows**:
```cmd
cd "C:\Program Files\ChainlessChain\resources"
start-services.bat
```

**Linux/Mac**:
```bash
cd /Applications/ChainlessChain.app/Contents/Resources
./start-services.sh
```

### 5. 启动应用

从开始菜单或应用程序文件夹启动 ChainlessChain。

---

## 📊 磁盘空间要求

- 安装包下载: 1.3 GB
- 安装后占用: 2.5 GB
  - 应用程序: 200 MB
  - Docker 镜像: 2.0 GB
  - 数据文件: 300 MB (会增长)

---

## ❓ 常见问题

### Q: 安装很慢，卡在某个步骤？
A: 正在加载 Docker 镜像，请耐心等待（约 2-5 分钟）

### Q: 提示 Docker 未运行？
A: 请先启动 Docker Desktop，等待图标变绿后再继续

### Q: 如何卸载？
A:
1. 停止服务: `docker-compose down`
2. 卸载应用: 通过系统控制面板卸载
3. 删除数据: `docker volume rm chainlesschain_*`

---

## 🎉 完成！

现在您可以完全离线使用 ChainlessChain了！
```

---

## 🏗️ 完整打包流程

### 流程图

```
1. 开发机器 (联网)
   ├─ 导出 Docker 镜像
   │  └─ docker save → *.tar 文件
   ├─ 打包桌面应用
   │  └─ npm run make:win
   └─ 合并为安装包
      └─ 包含应用 + 镜像 tar 文件

2. 用户机器 (离线)
   ├─ 下载安装包 (1.3GB)
   ├─ 安装应用
   ├─ 自动/手动加载镜像
   │  └─ docker load -i *.tar
   └─ 启动服务使用
```

---

## 📝 完整命令清单

### 在开发机器上 (联网):

```bash
cd D:/code/chainlesschain/packaging

# 1. 导出 Docker 镜像
chmod +x export-docker-images.sh
./export-docker-images.sh

# 2. 打包桌面应用 (包含镜像)
cd ../desktop-app-vue
export SKIP_BACKEND_CHECK=true
npm run make:win

# 3. 验证打包结果
ls -lh out/make/squirrel.windows/x64/
ls -lh ../packaging/docker-images/

# 4. 测试镜像加载
cd ../packaging
./load-docker-images.sh

# 5. 测试服务启动
./start-services.sh
```

---

## ⚖️ 方案对比

| 特性 | 离线打包方案 | 在线下载方案 |
|-----|------------|------------|
| 包大小 | ~1.3 GB | ~60 MB |
| 安装时间 | 5-10分钟 | 15-30分钟 |
| 网络要求 | ❌ 不需要 | ✅ 需要 |
| 首次启动 | ⚡ 即开即用 | ⏳ 需等待下载 |
| 适用场景 | 企业内网/离线环境 | 个人用户/良好网络 |

---

## ✅ 优势总结

1. **真正离线**: 无需任何网络连接
2. **统一版本**: 确保所有用户使用相同版本的镜像
3. **快速部署**: 企业内网可快速分发
4. **避免墙**: 无需担心网络限制
5. **可靠性高**: 不受 Docker Hub 服务状态影响

---

## 🎯 下一步

1. 创建导出脚本
2. 导出所有镜像
3. 测试镜像加载
4. 打包并测试完整流程

**准备好开始了吗？** 🚀
