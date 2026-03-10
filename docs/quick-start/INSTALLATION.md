# ChainlessChain 安装指南

本文档提供 ChainlessChain 在各个平台上的详细安装步骤。

## 目录

- [下载地址](#下载地址)
- [Mac 用户](#mac-用户)
- [Windows 用户](#windows-用户)
- [Linux 用户](#linux-用户)
- [从源码构建](#从源码构建)
- [Docker 部署](#docker-部署)
- [常见问题](#常见问题)

---

## 下载地址

### 官方下载渠道

- **GitHub Releases** (国际用户): [https://github.com/chainlesschain/chainlesschain/releases/latest](https://github.com/chainlesschain/chainlesschain/releases/latest)
- **Gitee Releases** (国内加速): [https://gitee.com/chainlesschaincn/chainlesschain/releases](https://gitee.com/chainlesschaincn/chainlesschain/releases)

---

## Mac 用户

### 系统要求

- macOS 10.13 High Sierra 或更高版本
- 至少 2GB 可用磁盘空间

### 选择对应版本

- **Intel 芯片 (x64)**: 下载 `ChainlessChain-darwin-x64-0.26.0.zip` (约1.4GB)
- **Apple Silicon (M1/M2/M3芯片)**: ARM64版本开发中，请使用Rosetta运行x64版本

### 安装步骤

1. **下载文件**
   - 访问上述下载地址
   - 下载 `ChainlessChain-darwin-x64-0.26.0.zip` 文件

2. **解压缩**
   - 双击 `.zip` 文件自动解压

3. **安装到应用程序**
   - 将 `ChainlessChain.app` 拖到"应用程序"文件夹

4. **首次运行**
   - 双击 `ChainlessChain.app` 启动

### 首次运行说明

**如果遇到"无法打开，因为无法验证开发者"提示：**

**方法1**（推荐）：

1. 右键点击 `ChainlessChain.app`
2. 选择"打开"
3. 在弹出的对话框中点击"打开"

**方法2**：

1. 打开"系统偏好设置" → "安全性与隐私"
2. 在"通用"标签页底部，点击"仍要打开"按钮

### 卸载方法

1. 打开"应用程序"文件夹
2. 将 `ChainlessChain.app` 拖到废纸篓
3. 清空废纸篓

### 数据位置

- 配置文件: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/`
- 数据库: `~/Library/Application Support/chainlesschain-desktop-vue/data/`
- 日志文件: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/logs/`

---

## Windows 用户

### 系统要求

- Windows 10 (64位) 或 Windows 11
- 至少 2GB 可用磁盘空间

### 下载版本

- **Windows x64 (64位系统)**: 下载 `ChainlessChain-win32-x64-0.26.0.zip` (约1.4GB)

### 安装步骤（便携版，无需安装）

1. **下载文件**
   - 访问上述下载地址
   - 下载 `ChainlessChain-win32-x64-0.26.0.zip` 文件

2. **解压到目标文件夹**

   ```
   推荐解压到: C:\Program Files\ChainlessChain\
   或任意你喜欢的位置
   ```

3. **运行应用**
   - 双击 `ChainlessChain.exe` 启动
   - 无需管理员权限

4. **创建桌面快捷方式**（可选）
   - 右键点击 `ChainlessChain.exe`
   - 选择"发送到" → "桌面快捷方式"

### 注意事项

- **便携版本**: 可以解压到U盘随身携带
- **数据存储**: 数据库文件位于应用目录下的 `data` 文件夹
- **防火墙**: 首次运行可能需要允许网络访问（用于P2P通信）
- **杀毒软件**: 部分杀毒软件可能误报，请添加信任

### 卸载方法

1. 关闭应用程序
2. 删除解压的文件夹
3. 删除数据文件夹（如需保留数据请备份）

### 数据位置

- 配置文件: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/`
- 数据库: `应用目录/data/`
- 日志文件: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/logs/`

### 从源码构建（可选）

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain/desktop-app-vue
npm install
npm run make:win
```

---

## Linux 用户

### 系统要求

- 64位 Linux 系统
- 至少 2GB 可用磁盘空间
- GLIBC 2.28 或更高版本

### 支持的发行版

- Ubuntu 20.04+ / Debian 11+
- Fedora 35+ / CentOS 8+
- Arch Linux / Manjaro
- 其他主流 Linux 发行版

### 下载版本

- **Linux x64 ZIP便携版**: `ChainlessChain-linux-x64-0.26.0.zip` (约1.4GB)
- **Linux x64 DEB安装包**: `chainlesschain-desktop-vue_0.26.0_amd64.deb` (约923MB) ⭐推荐

> ℹ️ 每次发布正式版本后，GitHub Actions 工作流会自动构建并上传最新的 Linux ZIP/DEB/RPM 包到 Release 页面。

### 安装步骤

#### 方式一：DEB安装包（推荐，适用于Ubuntu/Debian）

1. **下载deb文件**

   ```bash
   wget https://github.com/chainlesschain/chainlesschain/releases/download/v0.26.0/chainlesschain-desktop-vue_0.26.0_amd64.deb
   ```

2. **安装**

   ```bash
   sudo dpkg -i chainlesschain-desktop-vue_0.26.0_amd64.deb
   ```

3. **处理依赖问题**（如果有）

   ```bash
   sudo apt-get install -f
   ```

4. **启动应用**
   - 从应用菜单启动，或命令行运行：
   ```bash
   chainlesschain-desktop-vue
   ```

#### 方式二：ZIP便携版（适用于所有发行版）

1. **下载zip文件**

   ```bash
   wget https://github.com/chainlesschain/chainlesschain/releases/download/v0.26.0/ChainlessChain-linux-x64-0.26.0.zip
   ```

2. **解压到目标目录**

   ```bash
   unzip ChainlessChain-linux-x64-0.26.0.zip
   cd ChainlessChain-linux-x64
   ```

3. **赋予执行权限**

   ```bash
   chmod +x chainlesschain
   ```

4. **运行应用**
   ```bash
   ./chainlesschain
   ```

### 可选：创建桌面快捷方式

```bash
# 复制到/opt（可选）
sudo cp -r ChainlessChain-linux-x64 /opt/chainlesschain

# 创建符号链接
sudo ln -s /opt/chainlesschain/chainlesschain /usr/local/bin/chainlesschain

# 创建.desktop文件
cat > ~/.local/share/applications/chainlesschain.desktop <<'EOF'
[Desktop Entry]
Name=ChainlessChain
Comment=去中心化个人AI管理系统
Exec=/opt/chainlesschain/chainlesschain
Icon=/opt/chainlesschain/resources/app/build/icon.png
Terminal=false
Type=Application
Categories=Utility;Office;
EOF

# 更新桌面数据库
update-desktop-database ~/.local/share/applications/
```

### 依赖项检查

大多数现代Linux发行版已包含所需库。如遇到问题，可能需要安装：

```bash
# Ubuntu/Debian
sudo apt install libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6

# Fedora/CentOS
sudo dnf install gtk3 libnotify nss libXScrnSaver libXtst

# Arch Linux
sudo pacman -S gtk3 libnotify nss libxss libxtst
```

### 卸载方法

**DEB包安装**：

```bash
sudo apt remove chainlesschain-desktop-vue
```

**ZIP便携版**：

```bash
rm -rf /opt/chainlesschain
rm /usr/local/bin/chainlesschain
rm ~/.local/share/applications/chainlesschain.desktop
```

### 数据位置

- 配置文件: `~/.config/chainlesschain-desktop-vue/.chainlesschain/`
- 数据库: `~/.config/chainlesschain-desktop-vue/data/`
- 日志文件: `~/.config/chainlesschain-desktop-vue/.chainlesschain/logs/`

---

## 从源码构建

### 环境要求

- Node.js 20+
- npm 或 yarn
- Git

### 克隆项目

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

### 构建桌面应用

```bash
cd desktop-app-vue

# 安装依赖
npm install

# 开发模式运行
npm run dev

# 构建生产版本
npm run build

# 打包（根据平台）
npm run make:win    # Windows
npm run make:mac    # macOS
npm run make:linux  # Linux
```

### 启动后端服务（可选）

#### Docker方式（推荐）

```bash
# 返回项目根目录
cd ..

# 启动所有服务
docker-compose up -d

# 下载LLM模型
docker exec chainlesschain-ollama ollama pull qwen2:7b

# 查看服务状态
docker-compose ps
```

#### 手动启动

**Project Service (Spring Boot)**:

```bash
cd backend/project-service
mvn clean compile
mvn spring-boot:run
```

**AI Service (FastAPI)**:

```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

**Community Forum**:

```bash
# 后端
cd community-forum/backend
mvn spring-boot:run

# 前端
cd community-forum/frontend
npm install
npm run dev
```

---

## Docker 部署

### 使用 Docker Compose

```bash
# 启动所有服务
docker-compose up -d

# 服务包括:
# - Ollama (LLM引擎, 端口11434)
# - Qdrant (向量数据库, 端口6333)
# - PostgreSQL (端口5432)
# - Redis (端口6379)
# - Project Service (端口9090)
# - AI Service (端口8001)

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 下载 LLM 模型

```bash
# 下载 Qwen2-7B 模型
docker exec chainlesschain-ollama ollama pull qwen2:7b

# 下载其他模型
docker exec chainlesschain-ollama ollama pull llama3:8b
docker exec chainlesschain-ollama ollama pull glm4:9b
```

---

## 常见问题

### Q: 应用无法启动？

**Windows**:

- 检查是否有杀毒软件拦截
- 确保解压到英文路径（避免中文路径）
- 尝试以管理员身份运行

**macOS**:

- 参考"首次运行说明"解决安全限制
- 检查是否有足够的磁盘空间

**Linux**:

- 检查依赖库是否安装完整
- 查看终端错误信息
- 尝试 `chmod +x` 赋予执行权限

### Q: 数据库无法创建？

- 检查磁盘空间是否充足
- 确保有写入权限
- 查看日志文件：`.chainlesschain/logs/error.log`

### Q: P2P连接失败？

- 检查防火墙设置
- 确保网络允许 UDP 和 TCP 连接
- 尝试配置 STUN/TURN 服务器

### Q: LLM 模型下载慢？

- 使用国内镜像（如果有）
- 使用代理加速下载
- 手动下载模型文件后导入

### Q: 如何升级到新版本？

**便携版**:

1. 备份数据文件夹
2. 下载新版本并解压
3. 将旧版本的 `data` 文件夹复制到新版本

**安装包版**:

1. 下载新版本安装包
2. 安装时会自动保留数据

### Q: 如何迁移数据到其他设备？

1. 复制整个 `.chainlesschain` 目录
2. 复制 `data` 目录
3. 在新设备上放到相应位置

---

## 技术支持

如遇到安装问题：

- 📖 查看 [开发指南](./DEVELOPMENT.md)
- 🐛 提交 [GitHub Issue](https://github.com/chainlesschain/chainlesschain/issues)
- 📧 邮件联系: zhanglongfa@chainlesschain.com
- 💬 加入社区讨论

---

## 相关文档

- [返回主文档](../README.md)
- [功能详解](./FEATURES.md)
- [架构文档](./ARCHITECTURE.md)
- [开发指南](./DEVELOPMENT.md)
