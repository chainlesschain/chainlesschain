# 🚀 ChainlessChain 离线打包快速开始

## 方案优势

**传统方案问题**:
- ❌ 需要下载 JRE (45MB) + PostgreSQL (180MB) + Redis (5MB) + Qdrant (30MB)
- ❌ 网络连接失败导致无法打包
- ❌ 每个操作系统需要不同的依赖
- ❌ 包体积 ~400MB

**Docker离线方案优势**:
- ✅ 真正跨平台 (Windows/Mac/Linux 同一套)
- ✅ 用户完全离线安装使用
- ✅ 镜像一次导出，所有平台通用
- ✅ 易于版本管理和升级

---

## 📦 三步完成打包

### 步骤 1: 导出 Docker 镜像 (5分钟)

在**联网**的机器上运行：

```bash
cd D:/code/chainlesschain/packaging

# Windows
export-docker-images.bat

# Linux/Mac
chmod +x export-docker-images.sh
./export-docker-images.sh
```

**输出结果**:
```
packaging/docker-images/
├── postgres-16-alpine.tar        (~90 MB)
├── redis-7-alpine.tar            (~30 MB)
├── qdrant-qdrant-v1.12.5.tar     (~120 MB)
├── ollama-ollama-latest.tar      (~500 MB, 可选)
└── images-manifest.txt
```

---

### 步骤 2: 打包应用 (5分钟)

```bash
cd D:/code/chainlesschain/desktop-app-vue

# 设置跳过后端检查
export SKIP_BACKEND_CHECK=true

# Windows 打包
npm run make:win

# macOS 打包 (在 Mac 上)
npm run make

# Linux 打包 (在 Linux 上)
npm run make -- --platform=linux
```

**forge.config.js 会自动检测并包含 docker-images 目录！**

输出会显示：
```
[Packaging] ✓ Found Docker images directory - creating offline package
[Packaging] Docker images size: 740.00 MB
```

---

### 步骤 3: 分发安装包

打包结果在 `out/make/` 目录：

**Windows**:
```
out/make/squirrel.windows/x64/
└── ChainlessChain-Setup.exe  (约 1.2 GB)
```

**macOS**:
```
out/make/
└── ChainlessChain.dmg  (约 1.2 GB)
```

**Linux**:
```
out/make/
└── ChainlessChain.AppImage  (约 1.2 GB)
```

---

## 🎯 用户使用流程 (完全离线)

用户拿到安装包后：

### 1. 安装 Docker Desktop (一次性)

**Windows/Mac**: https://www.docker.com/products/docker-desktop/

**Linux**:
```bash
sudo apt-get install docker.io docker-compose
```

### 2. 安装 ChainlessChain

- Windows: 双击 `ChainlessChain-Setup.exe`
- macOS: 打开 `ChainlessChain.dmg` 拖拽安装
- Linux: `chmod +x ChainlessChain.AppImage && ./ChainlessChain.AppImage`

### 3. 加载 Docker 镜像 (自动/手动)

安装时会提示是否加载镜像，选择"是"即可。

或手动加载：

**Windows**:
```cmd
cd "C:\Program Files\ChainlessChain\resources"
load-docker-images.bat
```

**macOS**:
```bash
cd /Applications/ChainlessChain.app/Contents/Resources
./load-docker-images.sh
```

**Linux**:
```bash
cd ~/.local/share/ChainlessChain
./load-docker-images.sh
```

### 4. 启动服务并使用

**Windows**: 运行 `start-services.bat`
**Linux/Mac**: 运行 `./start-services.sh`

然后启动 ChainlessChain 应用即可！

---

## 📊 完整流程图

```
开发机器 (联网):
┌─────────────────────────────────────┐
│ 1. 导出 Docker 镜像                  │
│    export-docker-images.bat         │
│    ↓                                 │
│    生成 docker-images/*.tar         │
├─────────────────────────────────────┤
│ 2. 打包桌面应用                      │
│    npm run make:win                 │
│    ↓                                 │
│    自动包含 docker-images/          │
│    生成 ChainlessChain-Setup.exe    │
└─────────────────────────────────────┘
                ↓ 分发
用户机器 (离线):
┌─────────────────────────────────────┐
│ 1. 安装 Docker Desktop              │
├─────────────────────────────────────┤
│ 2. 安装 ChainlessChain              │
│    运行 Setup.exe                   │
├─────────────────────────────────────┤
│ 3. 加载 Docker 镜像                 │
│    load-docker-images.bat           │
│    ↓                                 │
│    docker load -i *.tar             │
├─────────────────────────────────────┤
│ 4. 启动服务                          │
│    start-services.bat               │
├─────────────────────────────────────┤
│ 5. 启动应用使用                      │
│    完全离线运行！                    │
└─────────────────────────────────────┘
```

---

## ⚡ 测试验证

在打包机器上测试完整流程：

```bash
# 1. 导出镜像
cd packaging && ./export-docker-images.bat

# 2. 验证镜像文件
ls -lh docker-images/*.tar

# 3. 测试加载镜像
./load-docker-images.bat

# 4. 验证镜像已加载
docker images | grep -E "postgres|redis|qdrant|ollama"

# 5. 测试启动服务
./start-services.bat

# 6. 验证服务运行
docker-compose -f docker-compose.production.yml ps

# 7. 打包应用
cd ../desktop-app-vue && npm run make:win

# 8. 检查打包大小
ls -lh out/make/squirrel.windows/x64/
```

---

## 🔧 故障排除

### Q: 导出镜像时提示网络超时？

**A**: 配置 Docker 镜像源加速
```
Docker Desktop > Settings > Docker Engine
添加:
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ]
}
```

### Q: 打包后安装包没有包含 docker-images？

**A**: 检查目录位置
```bash
# 确保在 packaging/docker-images/ 目录
ls -la D:/code/chainlesschain/packaging/docker-images/

# 重新打包
cd desktop-app-vue
npm run make:win
```

### Q: 用户加载镜像失败？

**A**: 检查 Docker 磁盘空间
```
Docker Desktop > Settings > Resources
磁盘镜像大小至少 30GB
```

---

## 💡 最佳实践

1. **定期更新镜像**
   ```bash
   docker pull postgres:16-alpine
   docker pull redis:7-alpine
   docker pull qdrant/qdrant:v1.12.5
   # 重新导出
   ./export-docker-images.bat
   ```

2. **版本锁定**
   - 使用固定版本号 (如 `v1.12.5`) 而非 `latest`
   - 确保所有用户使用相同版本

3. **压缩分发**
   ```bash
   # 可选：压缩镜像文件以减小传输体积
   tar -czf docker-images.tar.gz docker-images/
   ```

4. **验证完整性**
   ```bash
   # 生成校验和
   cd docker-images
   sha256sum *.tar > checksums.txt
   ```

---

## 📈 包大小对比

| 组件 | 在线方案 | 离线方案 |
|-----|---------|---------|
| 桌面应用 | 60 MB | 60 MB |
| Docker 镜像 | 用户下载 | 预打包 (~800MB) |
| 其他依赖 | 0 | 0 |
| **总计** | **60 MB** | **~860 MB** |
| **用户下载** | 需要 | 不需要 ✅ |
| **安装时间** | 15-30分钟 | 5分钟 ✅ |

---

## 🎉 总结

**离线打包方案**:
- ✅ 一次导出，处处使用
- ✅ 用户完全离线安装
- ✅ 跨平台统一方案
- ✅ 易于企业内网分发

**适用场景**:
- 企业内网环境
- 网络受限地区
- 需要统一版本管理
- 大批量部署

---

**准备好开始了吗？运行 `export-docker-images.bat` 即可！** 🚀
