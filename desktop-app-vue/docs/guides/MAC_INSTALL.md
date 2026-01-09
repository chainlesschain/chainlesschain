# ChainlessChain Mac 安装指南

## 系统要求

- macOS 11.0 (Big Sur) 或更高版本
- 8GB RAM（推荐16GB）
- 至少20GB可用磁盘空间
- Docker Desktop for Mac（用于后端服务）

## 安装步骤

### 1. 安装主应用

双击 `ChainlessChain.dmg`，将 ChainlessChain 拖拽到 Applications 文件夹。

### 2. 安装 Docker Desktop

如果还没有安装 Docker Desktop：

1. 访问 https://www.docker.com/products/docker-desktop/
2. 下载适合您Mac芯片的版本（Intel或Apple Silicon）
3. 安装并启动 Docker Desktop

### 3. 启动后端服务

打开终端，执行以下命令：

```bash
cd /Applications/ChainlessChain.app/Contents/Resources
docker-compose up -d
```

这将启动以下服务：
- **Ollama**: 本地大语言模型服务 (端口 11434)
- **Qdrant**: 向量数据库 (端口 6333)
- **PostgreSQL**: 关系型数据库 (端口 5432)
- **Redis**: 缓存服务 (端口 6379)
- **Project Service**: 项目管理服务 (端口 9090)
- **AI Service**: AI推理服务 (端口 8001)

### 4. 初始化大语言模型

首次使用时，需要下载LLM模型：

```bash
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

### 5. 启动应用

从 Applications 文件夹启动 ChainlessChain 应用。

## 常见问题

### Q: 提示"无法打开应用，因为它来自身份不明的开发者"

**解决方案**：
1. 右键点击应用图标
2. 选择"打开"
3. 在弹出的对话框中点击"打开"

或者，在终端中执行：
```bash
xattr -cr /Applications/ChainlessChain.app
```

### Q: Docker服务启动失败

**解决方案**：
1. 确保 Docker Desktop 正在运行
2. 检查端口是否被占用：
   ```bash
   lsof -i :11434
   lsof -i :6333
   lsof -i :5432
   lsof -i :6379
   ```
3. 如果端口被占用，停止占用进程或修改配置文件中的端口

### Q: 如何停止后端服务？

```bash
cd /Applications/ChainlessChain.app/Contents/Resources
docker-compose down
```

### Q: 如何查看后端服务日志？

```bash
cd /Applications/ChainlessChain.app/Contents/Resources
docker-compose logs -f
```

### Q: 如何重置所有数据？

**警告：此操作将删除所有数据，无法恢复！**

```bash
cd /Applications/ChainlessChain.app/Contents/Resources
docker-compose down -v
rm -rf ~/Library/Application\ Support/ChainlessChain
```

## 数据位置

- **应用数据**: `~/Library/Application Support/ChainlessChain/`
- **数据库文件**: `~/Library/Application Support/ChainlessChain/chainlesschain.db`
- **Docker数据卷**: 由Docker管理

## 卸载

1. 停止所有服务：
   ```bash
   docker-compose down -v
   ```

2. 删除应用：
   ```bash
   rm -rf /Applications/ChainlessChain.app
   ```

3. 删除应用数据（可选）：
   ```bash
   rm -rf ~/Library/Application\ Support/ChainlessChain
   ```

## 更新

1. 下载新版本的 DMG 文件
2. 拖拽覆盖 Applications 文件夹中的旧版本
3. 重启应用

**注意**：更新前建议备份数据目录

## 技术支持

- GitHub Issues: https://github.com/chainlesschain/chainlesschain/issues
- Gitee Issues: https://gitee.com/chainlesschaincn/chainlesschain/issues
- 文档: 查看应用内的帮助文档

## 许可证

MIT License

---

ChainlessChain Team © 2024
