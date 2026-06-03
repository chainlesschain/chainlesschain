# ChainlessChain Desktop (Vue版本)

基于 Electron + Vue 3 + Ant Design Vue 的个人AI知识库桌面应用。

## 技术栈

- **前端框架**: Vue 3 (Composition API)
- **UI组件库**: Ant Design Vue 4.x
- **状态管理**: Pinia
- **路由**: Vue Router 4
- **构建工具**: Vite 5
- **桌面框架**: Electron 28
- **数据库**: SQLite 3 (better-sqlite3)

## 项目结构

```
desktop-app-vue/
├── src/
│   ├── main/           # Electron主进程
│   │   ├── index.js    # 主进程入口
│   │   └── database.js # 数据库管理
│   ├── preload/        # 预加载脚本
│   │   └── index.js
│   ├── renderer/       # 渲染进程(Vue应用)
│   │   ├── components/ # 组件
│   │   ├── pages/      # 页面
│   │   ├── stores/     # Pinia状态管理
│   │   ├── router/     # 路由配置
│   │   ├── utils/      # 工具函数
│   │   ├── App.vue     # 根组件
│   │   ├── main.js     # 应用入口
│   │   ├── style.css   # 全局样式
│   │   └── index.html  # HTML模板
│   └── shared/         # 共享代码
│       └── types.js
├── scripts/            # 构建脚本
│   ├── build-main.js   # 主进程构建
│   └── test-database.js # 数据库测试
├── resources/          # 资源文件
├── package.json
├── vite.config.js
├── README.md
└── DATABASE.md         # 数据库文档
```

## 开发说明

### 安装依赖

```bash
cd desktop-app-vue
npm install
```

### 开发模式

```bash
npm run dev
```

这会启动：
1. Vite 开发服务器 (http://localhost:5173)
2. Electron 应用

### 构建

```bash
npm run build
```

### 打包

```bash
npm run package  # 打包应用
npm run make     # 制作安装包
```

## 功能特性

### 已实现功能

- ✅ 用户登录（U盾PIN码验证）
- ✅ 知识库管理（增删改查）
- ✅ SQLite 数据持久化
- ✅ 全文搜索（FTS5）
- ✅ 标签系统
- ✅ 统计数据
- ✅ 数据库备份
- ✅ 响应式布局
- ✅ 暗色侧边栏

### MVP简化版说明

当前版本为MVP简化版，以下功能使用模拟实现：

- **U盾验证**: 默认PIN码为 `123456`
- **LLM服务**: 返回模拟响应
- **Git同步**: 显示模拟状态

**✅ 已升级功能**：
- ~~数据存储~~: **现已使用 SQLite 持久化存储**

## 主要文件说明

### 主进程 (src/main/index.js)

Electron主进程，负责：
- 创建应用窗口
- 处理IPC通信
- 管理应用生命周期
- 数据库管理

### 数据库管理 (src/main/database.js)

SQLite 数据库管理类，负责：
- 数据库初始化和表创建
- 知识库项 CRUD 操作
- 全文搜索（FTS5）
- 标签管理
- 统计信息
- 数据库备份

**详细文档**: 查看 [DATABASE.md](./DATABASE.md)

### 预加载脚本 (src/preload/index.js)

暴露安全的API给渲染进程：
- `electronAPI.ukey.*` - U盾操作
- `electronAPI.db.*` - 数据库操作
- `electronAPI.llm.*` - LLM服务
- `electronAPI.system.*` - 系统操作

### 状态管理 (src/renderer/stores/app.js)

使用Pinia管理应用状态：
- 用户认证状态
- 知识库数据
- AI对话消息
- 系统配置

### 路由 (src/renderer/router/index.js)

页面路由配置：
- `/login` - 登录页
- `/` - 主页面（需要认证）
- `/knowledge/:id` - 知识项详情

## 开发技巧

### 调试

开发模式下会自动打开 DevTools，可以：
- 查看 Vue 组件树（需要安装 Vue DevTools 扩展）
- 调试 JavaScript
- 查看网络请求
- 检查控制台输出

### 热重载

- 渲染进程代码修改后会自动热重载
- 主进程代码修改后需要手动重启应用

### 样式定制

全局样式在 `src/renderer/style.css`，组件样式使用 `<style scoped>`。

## 数据库

### 数据存储

应用使用 SQLite 数据库存储数据，数据库文件位于：
- **Windows**: `C:\Users\<用户名>\AppData\Roaming\chainlesschain-desktop-vue\data\chainlesschain.db`
- **macOS**: `~/Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db`
- **Linux**: `~/.config/chainlesschain-desktop-vue/data/chainlesschain.db`

### 测试数据库

```bash
npm run test:db
```

这会运行数据库测试脚本，验证所有数据库功能。

### 查看数据

推荐使用 [DB Browser for SQLite](https://sqlitebrowser.org/) 查看和管理数据库。

### 备份数据

数据库支持备份功能，通过设置页面或直接复制数据库文件。

**详细说明**: 查看 [DATABASE.md](./DATABASE.md)

## 常见问题

### 1. 端口被占用

如果 5173 端口被占用，可以修改 `vite.config.js` 中的端口号。

### 2. Electron 启动失败

检查是否已经构建了主进程代码：
```bash
npm run build:main
```

### 3. 依赖安装失败

尝试清理缓存：
```bash
rm -rf node_modules package-lock.json
npm install
```

## 下一步计划

- [ ] 集成真实的数据库（SQLite）
- [ ] 实现U盾硬件集成
- [ ] 集成LLM服务（Ollama）
- [ ] 实现Git同步功能
- [ ] 添加Markdown编辑器
- [ ] 实现向量化搜索
- [ ] 添加AI对话功能

## 许可证

MIT License
