# ChainlessChain Windows打包指南 - 快速参考

## 🚀 一键构建

```batch
# 在项目根目录运行
build-windows-package.bat
```

输出：`packaging/dist/ChainlessChain-Setup-*.exe`

---

## 📁 文件结构

### 已创建的文件

```
chainlesschain/
├── build-windows-package.bat           # 主构建脚本
├── packaging/
│   ├── README.md                       # 本文件
│   ├── BUILD_INSTRUCTIONS.md           # 详细构建说明
│   ├── WINDOWS_PACKAGE_DESIGN.md       # 设计文档
│   ├── scripts/
│   │   ├── start-backend-services.bat  # 启动所有后端服务
│   │   ├── stop-backend-services.bat   # 停止所有后端服务
│   │   └── check-services.bat          # 检查服务状态
│   ├── jre-17/                         # [需下载] Java运行时
│   ├── postgres/                       # [需下载] PostgreSQL
│   ├── redis/                          # [需下载] Redis
│   ├── qdrant/                         # [需下载] Qdrant
│   ├── config/                         # [自动生成] 配置文件
│   └── dist/                           # [输出] 最终安装包
└── desktop-app-vue/
    ├── forge.config.js                 # Electron Forge配置
    └── src/main/
        ├── backend-service-manager.js  # 后端服务管理器
        └── backend-integration.patch.js # 集成补丁说明
```

---

## ✅ 构建前检查清单

### 必需软件

- [x] Node.js 18+ 安装 → `node --version`
- [x] npm 安装 → `npm --version`

### 可选软件

- [ ] Maven 安装 → `mvn --version` (或使用预构建JAR)
- [ ] Java JDK 17 → `java -version` (或仅下载JRE)

### 第三方组件下载

运行构建脚本时会自动下载部分组件，或手动下载：

#### PostgreSQL (必需)
```
下载: https://get.enterprisedb.com/postgresql/postgresql-16.1-1-windows-x64-binaries.zip
解压到: packaging/postgres/
```

#### Redis (必需)
```
下载: https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip
解压到: packaging/redis/
```

#### Qdrant (必需)
```
下载: https://github.com/qdrant/qdrant/releases/download/v1.7.4/qdrant-x86_64-pc-windows-msvc.zip
解压到: packaging/qdrant/
```

#### JRE 17 (必需)
```
下载: https://adoptium.net/temurin/releases/?version=17
选择: Windows x64 JRE .zip
解压到: packaging/jre-17/
```

---

## 🔧 手动集成步骤

### 步骤 1: 修改 Electron 主进程

编辑 `desktop-app-vue/src/main/index.js`，按照 `backend-integration.patch.js` 中的说明添加代码：

1. **添加导入** (第67行左右):
```javascript
const { getBackendServiceManager } = require('./backend-service-manager');
```

2. **添加退出事件** (setupApp方法中):
```javascript
app.on('will-quit', async (event) => {
  event.preventDefault();
  const backendManager = getBackendServiceManager();
  await backendManager.stopServices();
  app.exit(0);
});
```

3. **启动服务** (onReady方法开始):
```javascript
const backendManager = getBackendServiceManager();
await backendManager.startServices();
```

4. **添加IPC** (registerCoreIPCHandlers中):
```javascript
ipcMain.handle('backend-service:get-status', async () => {
  const backendManager = getBackendServiceManager();
  return await backendManager.getServicesStatus();
});

ipcMain.handle('backend-service:restart', async () => {
  const backendManager = getBackendServiceManager();
  await backendManager.restartServices();
  return { success: true };
});
```

### 步骤 2: 构建 Java 后端 (可选)

如果已有JAR文件，跳过此步骤。否则：

```batch
cd backend\project-service
mvn clean package -DskipTests
```

输出：`backend/project-service/target/project-service.jar`

### 步骤 3: 运行构建脚本

```batch
cd C:\code\chainlesschain
build-windows-package.bat
```

---

## 📦 构建输出

成功后，在以下位置找到安装包：

```
packaging/dist/
├── ChainlessChain-Setup-0.16.0.exe  # Windows安装程序
└── VERSION.txt                       # 版本信息
```

---

## 🐛 常见问题

### Q: Maven构建失败怎么办？

A: 使用预构建的JAR文件，或安装Maven后重试。

### Q: 如何测试后端服务？

A: 运行以下脚本：
```batch
cd packaging\scripts
start-backend-services.bat  # 启动服务
check-services.bat          # 检查状态
stop-backend-services.bat   # 停止服务
```

### Q: 安装包太大怎么办？

A: 参考 `BUILD_INSTRUCTIONS.md` 中的轻量版方案，可以减小到 ~300MB。

### Q: 如何调试构建问题？

A: 查看构建日志 `packaging/build.log`

---

## 📚 文档索引

- **设计文档**: `WINDOWS_PACKAGE_DESIGN.md` - 完整的架构设计
- **构建说明**: `BUILD_INSTRUCTIONS.md` - 详细的步骤和故障排除
- **集成补丁**: `desktop-app-vue/src/main/backend-integration.patch.js` - 代码修改指南

---

## 🔄 下一步

### 立即可做

1. ✅ 下载第三方组件（PostgreSQL、Redis、Qdrant、JRE）
2. ✅ 修改 Electron 主进程集成后端服务管理器
3. ✅ 运行构建脚本 `build-windows-package.bat`
4. ✅ 测试生成的安装包

### 进阶优化

- [ ] 配置代码签名（避免SmartScreen警告）
- [ ] 实现自动更新功能
- [ ] 优化安装包大小
- [ ] 添加自定义安装界面（NSIS）
- [ ] 配置CI/CD自动构建

---

## 📞 技术支持

- 问题反馈: https://github.com/chainlesschain/chainlesschain/issues
- 讨论区: https://github.com/chainlesschain/chainlesschain/discussions

---

## ⚠️ 重要提示

### 生产环境部署前

1. **安全审计**
   - 检查所有依赖的安全性
   - 扫描恶意软件
   - 验证代码签名

2. **性能测试**
   - 测试后端服务启动时间
   - 测试资源占用（CPU、内存）
   - 测试并发用户数

3. **兼容性测试**
   - Windows 10 多版本测试
   - Windows 11 测试
   - 不同硬件配置测试

4. **备份和恢复**
   - 测试数据备份功能
   - 测试数据恢复流程
   - 验证加密数据的安全性

---

## 📝 版本历史

- **v0.16.0** - 初始打包方案
  - 完全本地化部署
  - 仅支持云LLM
  - 包含所有后端服务

---

## 📄 许可证

MIT License

---

**构建愉快！** 🎉
