# ChainlessChain - 启动指南

## 快速启动 (2步)

### 1. 安装依赖

```bash
cd desktop-app
npm install
```

### 2. 启动应用

```bash
npm run dev
```

应用将在几秒内自动启动！

## 登录信息

- **默认PIN码**: `123456`
- U盾模拟模式自动启用

## 使用说明

### 基本功能

1. **创建笔记**
   - 点击左上角 "新建笔记" 按钮
   - 输入标题和内容 (支持Markdown)
   - 自动保存，也可按 `Ctrl+S` 手动保存

2. **编辑笔记**
   - 点击左侧列表中的任意笔记
   - 在中间编辑器中修改内容
   - 点击 "预览" 按钮查看渲染效果

3. **搜索笔记**
   - 使用顶部搜索框输入关键词
   - 实时过滤笔记列表

4. **删除笔记**
   - 点击笔记列表项右侧的删除按钮
   - 确认删除

5. **AI对话**
   - 点击右上角 "AI助手" 按钮
   - 在聊天面板输入问题
   - 按 `Ctrl+Enter` 发送消息
   - 可选择是否使用当前笔记作为上下文

## 技术栈

- **前端**: React 18 + TypeScript + Ant Design
- **桌面框架**: Electron 28
- **状态管理**: Zustand
- **数据库**: 内存数据库 (MVP版本)
- **构建工具**: Vite + TypeScript

## MVP限制

当前版本为MVP演示版本，使用内存数据库：

- ❌ 数据不会持久化 (重启后丢失)
- ❌ AI功能需要Ollama服务 (可选)
- ❌ Git同步功能暂未启用
- ❌ 真实U盾硬件暂未集成

## 下一步

如需完整功能，请参考 `QUICK_START.md` 中的"可选: 启动AI服务"部分。

## 故障排除

### 端口被占用

如果5173端口被占用，修改 `vite.config.ts`:

```typescript
server: {
  port: 5174, // 改为其他端口
}
```

### 构建失败

清理并重新安装依赖:

```bash
rm -rf node_modules package-lock.json
npm install
```

### 应用无法启动

检查是否已构建主进程:

```bash
npm run build:preload
npm run build:main
```

## 帮助

如有问题，请查看:
- `QUICK_START.md` - 完整快速启动指南
- `docs/DEVELOPMENT.md` - 开发文档
- `docs/MVP_FEATURES.md` - MVP功能定义
