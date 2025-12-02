# ChainlessChain 安装部署

本指南将帮助您在不同平台上安装和配置ChainlessChain个人AI系统。

## 系统要求

### 硬件要求

#### PC端最低配置

- **CPU**: 双核 2.0GHz 或更高
- **内存**: 4GB RAM
- **硬盘**: 10GB 可用空间
- **网络**: 宽带网络连接

#### PC端推荐配置（含AI功能）

- **CPU**: 四核 3.0GHz 或更高（支持AVX2指令集）
- **内存**: 8GB+ RAM（运行大模型需要16GB+）
- **硬盘**: 50GB+ SSD（存储模型文件）
- **显卡**: NVIDIA RTX系列（可选，加速AI推理）
- **网络**: 稳定的宽带连接

#### 移动端要求

**Android**:
- 系统版本: Android 8.0 (API 26) 或更高
- 内存: 3GB RAM 或更高
- 存储: 5GB 可用空间
- 处理器: 64位ARMv8

**iOS**:
- 系统版本: iOS 14.0 或更高
- 设备: iPhone 8 或更新型号
- 存储: 5GB 可用空间

### 软件要求

#### PC端开发环境

- **Node.js**: 18.0 或更高版本
- **npm**: 9.0 或更高版本
- **Git**: 2.30 或更高版本
- **Docker**: 20.10 或更高版本（用于后端服务）

#### 可选软件

- **Ollama**: 本地AI模型运行环境
- **SQLite Browser**: 数据库查看工具
- **Postman**: API测试工具

---

## PC端安装

### Windows 安装

#### 方式一: 安装包安装（推荐）

1. **下载安装包**

访问 [ChainlessChain官网](https://chainlesschain.com/download) 下载Windows安装包：
- `ChainlessChain-Setup-1.0.0.exe` (约150MB)

2. **运行安装程序**

- 双击运行安装包
- 选择安装路径（默认: `C:\Program Files\ChainlessChain`）
- 勾选"创建桌面快捷方式"
- 点击"安装"

3. **首次启动**

- 启动ChainlessChain
- 完成初始化配置向导
- 插入U盾/SIMKey设备

#### 方式二: 从源码构建

1. **克隆项目**

```bash
# 克隆仓库
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
```

2. **安装依赖**

```bash
# 安装Node.js依赖
npm install

# 安装桌面端依赖
cd desktop
npm install
cd ..
```

3. **启动后端服务**

```bash
# 启动Docker服务（MySQL, Redis, Ollama等）
cd backend/docker
docker-compose up -d

# 等待服务启动（约30秒）
docker-compose ps
```

4. **启动PC端应用**

```bash
# 开发模式
npm run dev:desktop

# 或构建生产版本
npm run build:desktop
```

#### 常见问题

**问题1: 缺少Visual C++运行库**

解决方法:
```bash
# 下载并安装 Visual C++ Redistributable
# https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist
```

**问题2: 端口冲突**

解决方法:
```bash
# 检查端口占用
netstat -ano | findstr "3000"
netstat -ano | findstr "3306"

# 修改配置文件端口
# desktop/config.js
```

---

### macOS 安装

#### 方式一: DMG安装包（推荐）

1. **下载DMG文件**

访问官网下载macOS安装包：
- `ChainlessChain-1.0.0.dmg` (约140MB)

2. **安装应用**

- 双击打开DMG文件
- 将ChainlessChain拖到Applications文件夹
- 首次打开时，右键选择"打开"（绕过Gatekeeper）

3. **授予权限**

```bash
# 如果提示权限问题
xattr -cr /Applications/ChainlessChain.app
```

#### 方式二: Homebrew安装

```bash
# 添加ChainlessChain tap
brew tap chainlesschain/tap

# 安装ChainlessChain
brew install chainlesschain

# 启动应用
chainlesschain
```

#### 方式三: 从源码构建

```bash
# 克隆项目
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain

# 安装依赖
npm install

# 启动Docker服务
cd backend/docker
docker-compose up -d
cd ../..

# 启动开发模式
npm run dev:desktop
```

#### macOS特定配置

**允许USB设备访问**:

```bash
# 授予USB设备访问权限
sudo kextload -b com.apple.driver.usb.AppleUSBUHCI
```

**配置Ollama**:

```bash
# 安装Ollama
brew install ollama

# 启动Ollama服务
ollama serve

# 下载模型
ollama pull llama3
ollama pull qwen
```

---

### Linux 安装

#### Ubuntu/Debian 安装

1. **添加软件源**

```bash
# 添加ChainlessChain GPG密钥
curl -fsSL https://chainlesschain.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/chainlesschain.gpg

# 添加软件源
echo "deb [signed-by=/usr/share/keyrings/chainlesschain.gpg] https://repo.chainlesschain.com/apt stable main" | sudo tee /etc/apt/sources.list.d/chainlesschain.list

# 更新软件包列表
sudo apt update
```

2. **安装ChainlessChain**

```bash
# 安装
sudo apt install chainlesschain

# 启动
chainlesschain
```

#### AppImage安装（通用）

```bash
# 下载AppImage
wget https://chainlesschain.com/download/ChainlessChain-1.0.0.AppImage

# 添加执行权限
chmod +x ChainlessChain-1.0.0.AppImage

# 运行
./ChainlessChain-1.0.0.AppImage
```

#### 从源码构建

```bash
# 安装依赖
sudo apt install -y nodejs npm git docker.io docker-compose

# 克隆项目
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain

# 安装Node.js依赖
npm install

# 启动Docker服务
cd backend/docker
sudo docker-compose up -d
cd ../..

# 启动应用
npm run dev:desktop
```

#### 配置systemd服务（可选）

```bash
# 创建服务文件
sudo nano /etc/systemd/system/chainlesschain.service
```

内容:

```ini
[Unit]
Description=ChainlessChain Personal AI System
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/home/your-username/chainlesschain
ExecStart=/usr/bin/npm run start:desktop
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务:

```bash
sudo systemctl daemon-reload
sudo systemctl enable chainlesschain
sudo systemctl start chainlesschain
```

---

## 移动端安装

### Android 安装

#### 方式一: Google Play（推荐）

1. 打开Google Play商店
2. 搜索"ChainlessChain"
3. 点击"安装"
4. 打开应用并完成初始化

#### 方式二: APK安装

1. **下载APK**

访问官网下载Android安装包：
- `ChainlessChain-v1.0.0.apk` (约50MB)

2. **启用未知来源**

设置 → 安全 → 允许安装未知应用

3. **安装APK**

- 打开下载的APK文件
- 点击"安装"
- 等待安装完成

#### 方式三: 从源码构建

```bash
# 克隆项目
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain

# 安装依赖
npm install

# 构建Android应用
cd android
./gradlew assembleRelease

# APK文件位置
# android/app/build/outputs/apk/release/app-release.apk
```

**开发模式**:

```bash
# 启动开发服务器
npm run dev:android

# 在Android Studio中运行
# File -> Open -> chainlesschain/android
# 点击Run按钮
```

---

### iOS 安装

#### 方式一: App Store（即将上线）

1. 打开App Store
2. 搜索"ChainlessChain"
3. 点击"获取"
4. 等待安装完成

#### 方式二: TestFlight测试版

1. **加入TestFlight**

- 访问 https://testflight.apple.com/join/chainlesschain
- 安装TestFlight应用
- 接受测试邀请

2. **安装测试版**

- 在TestFlight中找到ChainlessChain
- 点击"安装"

#### 方式三: 从源码构建

**要求**:
- macOS系统
- Xcode 15+
- Apple Developer账号（用于真机调试）

**步骤**:

```bash
# 克隆项目
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain

# 安装依赖
npm install

# 安装CocoaPods依赖
cd ios
pod install
cd ..

# 在Xcode中打开项目
open ios/ChainlessChain.xcworkspace

# 在Xcode中:
# 1. 选择你的开发团队
# 2. 选择目标设备
# 3. 点击Run按钮
```

---

## 后端服务配置

### Docker部署（推荐）

ChainlessChain的后端服务使用Docker Compose部署，包括：

- **MySQL**: 数据库
- **Redis**: 缓存
- **Ollama**: 本地AI模型
- **MeiliSearch**: 全文搜索引擎

#### 启动所有服务

```bash
cd backend/docker
docker-compose up -d
```

#### 查看服务状态

```bash
docker-compose ps
```

应该看到:

```
NAME                STATUS          PORTS
chainless-mysql     Up 30 seconds   0.0.0.0:3306->3306/tcp
chainless-redis     Up 30 seconds   0.0.0.0:6379->6379/tcp
chainless-ollama    Up 30 seconds   0.0.0.0:11434->11434/tcp
chainless-meilisearch Up 30 seconds 0.0.0.0:7700->7700/tcp
```

#### 查看日志

```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f ollama
```

#### 停止服务

```bash
docker-compose down
```

#### 重启服务

```bash
docker-compose restart
```

### 手动安装后端服务

如果不使用Docker，可以手动安装各个服务。

#### MySQL 8.0

**Windows**:
```bash
# 下载MySQL Installer
# https://dev.mysql.com/downloads/installer/

# 创建数据库
mysql -u root -p
CREATE DATABASE chainlesschain DEFAULT CHARACTER SET utf8mb4;
```

**Linux**:
```bash
sudo apt install mysql-server
sudo mysql_secure_installation
mysql -u root -p
CREATE DATABASE chainlesschain DEFAULT CHARACTER SET utf8mb4;
```

#### Redis 7.0

**Windows**:
```bash
# 下载Redis for Windows
# https://github.com/microsoftarchive/redis/releases
```

**Linux**:
```bash
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

#### Ollama

**Windows/macOS/Linux**:
```bash
# 下载并安装Ollama
# https://ollama.com/download

# 启动Ollama
ollama serve

# 下载模型
ollama pull llama3
ollama pull qwen
```

#### MeiliSearch

```bash
# 下载MeiliSearch
curl -L https://install.meilisearch.com | sh

# 启动MeiliSearch
./meilisearch --http-addr 127.0.0.1:7700
```

---

## 初始化配置

### 首次启动向导

1. **欢迎页面**

- 选择语言（简体中文/English）
- 阅读用户协议
- 点击"开始配置"

2. **设备设置**

**选择设备类型**:
- U盾（USB Key）
- SIMKey（SIM卡密钥）
- 软件模拟（测试用）

**插入U盾**:
- 将U盾插入USB接口
- 系统自动检测设备
- 输入U盾PIN码（默认: 123456）

**SIMKey配置**:
- 插入SIMKey卡
- 输入PIN码
- 选择SIM卡槽

3. **创建身份**

**生成DID**:
```
did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH
```

**设置个人信息**:
- 昵称: 你的名字
- 头像: 上传或使用默认
- 简介: 可选

**备份助记词**（重要！）:
```
abandon ability able about above absent absorb abstract absurd abuse access accident
```

- 抄写到纸上
- 妥善保管
- 不要截图或电子存储
- 验证助记词

4. **配置AI模型**

**选择AI引擎**:
- Ollama（推荐）
- LLaMA.cpp
- 无（稍后配置）

**选择模型**:
- LLaMA 3 8B（推荐，4GB内存）
- Qwen 7B（中文优化，5GB内存）
- GLM-4 9B（对话优化，6GB内存）

**下载模型**:
```bash
正在下载模型...
[████████████████████] 100%
LLaMA 3 8B (4.7GB) - 下载完成
```

**测试AI**:
```
你: 介绍一下ChainlessChain
AI: ChainlessChain是一个去中心化的个人AI管理系统...
```

5. **数据同步**

**配置Git仓库**:
- 使用GitHub/GitLab
- 自建Git服务器
- 稍后配置

**GitHub示例**:
```bash
仓库URL: https://github.com/username/chainlesschain-data.git
用户名: your-username
Token: ghp_xxxxxxxxxxxxxxxxxxxx
```

**同步频率**:
- 实时同步（推荐）
- 每小时
- 每天
- 手动

6. **完成配置**

- 配置摘要确认
- 点击"完成"
- 进入主界面

---

## 配置文件

### 主配置文件

位置: `~/.chainlesschain/config.json`

```json
{
  "version": "1.0.0",
  "user": {
    "did": "did:key:z6Mkp...",
    "nickname": "张三",
    "avatar": "avatar.jpg"
  },
  "device": {
    "type": "UKEY",
    "path": "/dev/usb0",
    "pin": "encrypted_pin"
  },
  "ai": {
    "engine": "ollama",
    "model": "llama3",
    "apiUrl": "http://localhost:11434",
    "temperature": 0.7,
    "maxTokens": 2048
  },
  "sync": {
    "enabled": true,
    "remote": "https://github.com/user/data.git",
    "frequency": "realtime",
    "autoCommit": true
  },
  "database": {
    "path": "~/.chainlesschain/data.db",
    "backup": true,
    "backupInterval": "daily"
  },
  "network": {
    "p2p": {
      "enabled": true,
      "port": 4001,
      "bootstrap": [
        "/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ"
      ]
    },
    "relay": {
      "enabled": true,
      "servers": [
        "/ip4/relay.chainlesschain.com/tcp/443/wss/p2p/QmRelay"
      ]
    }
  },
  "ui": {
    "theme": "auto",
    "language": "zh-CN",
    "fontSize": 14
  }
}
```

### AI模型配置

位置: `~/.chainlesschain/ai-config.json`

```json
{
  "models": [
    {
      "name": "llama3",
      "path": "~/.ollama/models/llama3",
      "size": "4.7GB",
      "contextLength": 8192,
      "enabled": true
    },
    {
      "name": "qwen",
      "path": "~/.ollama/models/qwen",
      "size": "5.2GB",
      "contextLength": 32768,
      "enabled": false
    }
  ],
  "rag": {
    "enabled": true,
    "chunkSize": 512,
    "overlap": 50,
    "embeddingModel": "bge-small-zh",
    "topK": 5
  }
}
```

---

## 数据迁移

### 从其他笔记软件迁移

#### 从Notion导出

```bash
# 在Notion中导出为Markdown & CSV
# Settings -> Export all workspace content -> Markdown & CSV

# 导入到ChainlessChain
chainlesschain import --source notion --path ~/Downloads/Notion_Export.zip
```

#### 从Evernote导出

```bash
# 在Evernote中导出为ENEX格式
# File -> Export Notes -> ENEX

# 转换ENEX到Markdown
npm install -g evernote-to-md
evernote-to-md ~/Downloads/notes.enex ~/markdown/

# 导入
chainlesschain import --source markdown --path ~/markdown/
```

#### 从Obsidian迁移

```bash
# Obsidian使用Markdown，可直接导入
chainlesschain import --source markdown --path ~/ObsidianVault/
```

### 备份和恢复

#### 备份数据

```bash
# 完整备份
chainlesschain backup --output ~/Backups/chainless_backup_$(date +%Y%m%d).tar.gz

# 只备份笔记
chainlesschain backup --notes-only --output ~/Backups/notes.zip
```

#### 恢复数据

```bash
# 从备份恢复
chainlesschain restore --input ~/Backups/chainless_backup_20241202.tar.gz

# 恢复到新设备
chainlesschain restore --input ~/Backups/backup.tar.gz --new-device
```

---

## 故障排查

### 常见问题

#### 1. U盾/SIMKey无法识别

**症状**: 插入设备后无响应

**解决**:
```bash
# Windows: 检查驱动
# 设备管理器 -> 通用串行总线控制器

# Linux: 检查USB设备
lsusb

# 检查设备权限
sudo chmod 666 /dev/bus/usb/001/002

# 添加udev规则
sudo nano /etc/udev/rules.d/99-ukey.rules
# 添加: SUBSYSTEM=="usb", ATTR{idVendor}=="xxxx", MODE="0666"
sudo udevadm control --reload-rules
```

#### 2. AI模型加载失败

**症状**: "Failed to load model"

**解决**:
```bash
# 检查Ollama服务
curl http://localhost:11434/api/tags

# 重新下载模型
ollama rm llama3
ollama pull llama3

# 检查磁盘空间
df -h

# 检查内存
free -h
```

#### 3. Git同步失败

**症状**: "Failed to push to remote"

**解决**:
```bash
# 检查网络连接
ping github.com

# 检查Git配置
git config --list

# 重新设置远程仓库
git remote set-url origin https://github.com/user/repo.git

# 检查认证
git credential fill
```

#### 4. 数据库损坏

**症状**: "Database disk image is malformed"

**解决**:
```bash
# 备份数据库
cp ~/.chainlesschain/data.db ~/.chainlesschain/data.db.backup

# 修复数据库
sqlite3 ~/.chainlesschain/data.db
> PRAGMA integrity_check;
> .quit

# 如果无法修复，从备份恢复
chainlesschain restore --input ~/Backups/latest.tar.gz
```

---

## 性能优化

### PC端优化

```bash
# 增加Node.js内存限制
export NODE_OPTIONS="--max-old-space-size=4096"

# 启用GPU加速（NVIDIA）
export OLLAMA_GPU=1

# 禁用不需要的功能
# config.json
{
  "network": {
    "p2p": { "enabled": false }
  }
}
```

### 数据库优化

```sql
-- 定期清理
VACUUM;

-- 重建索引
REINDEX;

-- 分析表
ANALYZE;
```

---

## 下一步

- [知识库管理](/chainlesschain/knowledge-base) - 学习使用知识库
- [AI模型配置](/chainlesschain/ai-models) - 深入配置AI
- [Git同步](/chainlesschain/git-sync) - 设置跨设备同步
- [去中心化社交](/chainlesschain/social) - 开始P2P通讯

---

**安装完成，开始您的去中心化AI之旅！** 🚀
