# ChainlessChain Web Clipper

ChainlessChain 的浏览器扩展，用于一键剪藏网页内容到知识库。

## 功能特性

- ✅ 一键保存网页内容
- ✅ 使用 Readability 智能提取正文
- ✅ 自动提取标题、作者、日期
- ✅ 智能推荐标签
- ✅ 与桌面应用实时通信
- ✅ 支持 Chrome/Edge 浏览器

## 安装步骤

### 1. 准备 Readability 库

由于许可证限制，Readability.js 需要手动下载：

```bash
cd browser-extension/lib
curl -o readability.js https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js
```

或者访问：https://github.com/mozilla/readability 下载最新版本。

### 2. 安装浏览器扩展

#### Chrome/Edge

1. 打开浏览器，进入扩展管理页面：
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

2. 开启"开发者模式"（右上角开关）

3. 点击"加载已解压的扩展程序"

4. 选择 `browser-extension` 目录

5. 扩展安装完成！

### 3. 配置 Native Messaging Host

扩展需要通过 Native Messaging 与 ChainlessChain 桌面应用通信。

#### Windows

运行配置脚本：

```bash
cd desktop-app-vue
node scripts/install-native-messaging.js
```

#### macOS/Linux

运行配置脚本：

```bash
cd desktop-app-vue
node scripts/install-native-messaging.js
```

### 4. 启动桌面应用

确保 ChainlessChain 桌面应用正在运行，扩展才能正常工作。

## 使用说明

### 剪藏网页

1. 打开任意网页
2. 点击浏览器工具栏中的 ChainlessChain 图标
3. 确认或修改标题、标签等信息
4. 点击"保存到知识库"
5. 完成！内容已保存到桌面应用

### 选项说明

- **使用 Readability 提取**：智能提取正文，去除广告和无关内容（推荐）
- **包含图片**：保存网页中的图片（开发中）
- **自动添加到 RAG 索引**：自动向量化内容，供 AI 检索

## 技术架构

```
┌─────────────┐
│ Browser Tab │ 网页
└─────────────┘
       │
       ↓ content-script.js (注入)
       │ - 提取页面信息
       │ - Readability 解析
       ↓
┌─────────────┐
│   Popup     │ 扩展弹窗
└─────────────┘
       │
       ↓ chrome.runtime.sendMessage
       │
┌─────────────┐
│ Background  │ 后台服务
└─────────────┘
       │
       ↓ Native Messaging
       │
┌─────────────┐
│ Native Host │ 桌面应用接口
└─────────────┘
       │
       ↓ IPC
       │
┌─────────────┐
│ Main Process│ Electron 主进程
└─────────────┘
```

## 开发指南

### 目录结构

```
browser-extension/
├── manifest.json          # 扩展清单
├── popup/
│   ├── popup.html        # 弹窗 UI
│   ├── popup.css         # 弹窗样式
│   └── popup.js          # 弹窗逻辑
├── content/
│   └── content-script.js # 内容脚本
├── background/
│   └── background.js     # 后台服务
├── lib/
│   └── readability.js    # Readability 库
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### 调试

1. **Popup 调试**：
   - 右键点击扩展图标 → 检查弹出内容窗口

2. **Content Script 调试**：
   - F12 打开网页开发者工具
   - 在 Console 中查看 `[ContentScript]` 日志

3. **Background 调试**：
   - 进入扩展管理页面
   - 点击"检查视图"下的"背景页"

### 消息流程

1. **Popup → Content Script**:
   ```javascript
   chrome.tabs.sendMessage(tabId, { action: 'getPageInfo' })
   ```

2. **Popup → Background**:
   ```javascript
   chrome.runtime.sendMessage({ action: 'clipPage', data })
   ```

3. **Background → Native Host**:
   ```javascript
   nativePort.postMessage({ action: 'clipPage', data })
   ```

## 常见问题

### 1. 扩展显示"未连接到 ChainlessChain"

**解决方案**：
- 确保桌面应用正在运行
- 确保已正确配置 Native Messaging Host
- 重启浏览器

### 2. Readability 提取失败

**解决方案**：
- 检查 `lib/readability.js` 是否存在
- 某些网页可能不支持 Readability，可以取消勾选该选项

### 3. 无法保存内容

**解决方案**：
- 检查控制台错误信息
- 确保桌面应用数据库可写
- 检查 Native Messaging Host 日志

## 许可证

MIT License

## 相关链接

- [ChainlessChain 项目](https://github.com/chainlesschain/chainlesschain)
- [Readability.js](https://github.com/mozilla/readability)
- [Chrome Extension 文档](https://developer.chrome.com/docs/extensions/)
- [Native Messaging 文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
