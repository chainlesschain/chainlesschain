# ChainlessChain 浏览器扩展完整指南

本指南将带你完成 ChainlessChain Web Clipper 浏览器扩展的完整安装和配置过程。

---

## 📋 目录

1. [系统要求](#系统要求)
2. [安装步骤](#安装步骤)
3. [使用说明](#使用说明)
4. [故障排除](#故障排除)
5. [开发调试](#开发调试)

---

## 系统要求

### 必需组件

- ✅ **Node.js** (v16 或更高版本)
- ✅ **ChainlessChain 桌面应用** (已安装并可运行)
- ✅ **支持的浏览器**:
  - Google Chrome (版本 88+)
  - Microsoft Edge (版本 88+)
  - 其他基于 Chromium 的浏览器

### 可选组件

- 📦 npm 或 yarn (用于安装依赖)
- 🔧 Git (用于克隆项目)

---

## 安装步骤

### 第 1 步：准备 Readability 库

**为什么需要这步？**
Readability.js 是一个智能内容提取库，可以从网页中提取主要内容，去除广告和无关元素。

**如何操作：**

#### Windows (PowerShell)

```powershell
cd chainlesschain\desktop-app-vue\browser-extension\lib
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js" -OutFile "readability.js"
```

#### macOS/Linux

```bash
cd chainlesschain/desktop-app-vue/browser-extension/lib
curl -o readability.js https://cdn.jsdelivr.net/npm/@mozilla/readability@0.5.0/Readability.js
```

**验证：**

```bash
# 应该看到文件，大小约 70KB
ls -lh readability.js
```

---

### 第 2 步：安装 Native Messaging Host

**为什么需要这步？**
Native Messaging Host 是浏览器扩展与桌面应用通信的桥梁。没有它，扩展无法将网页内容发送到桌面应用。

**如何操作：**

#### 自动安装（推荐）

```bash
cd chainlesschain/desktop-app-vue
node scripts/install-native-messaging.js
```

**输出示例：**

```
============================================================
ChainlessChain Native Messaging Host 安装程序
============================================================

在 Windows 上安装 Native Messaging Host...
✓ 创建 Host 脚本包装器: C:\...\native-host.bat
✓ 创建 Manifest 文件: C:\...\native-host-manifest.json
✓ 已注册到 Chrome 注册表
✓ 已注册到 Edge 注册表

============================================================
✓ 安装成功！
============================================================
```

#### 手动安装（如果自动安装失败）

<details>
<summary>点击展开手动安装步骤</summary>

##### Windows

1. 创建 `native-host.bat`:
```batch
@echo off
node "C:\path\to\chainlesschain\desktop-app-vue\src\main\native-messaging\native-host.js" %*
```

2. 创建 `native-host-manifest.json`:
```json
{
  "name": "com.chainlesschain.clipper",
  "description": "ChainlessChain Web Clipper Native Messaging Host",
  "path": "C:\\path\\to\\native-host.bat",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
```

3. 注册到注册表:
```batch
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chainlesschain.clipper" /ve /t REG_SZ /d "C:\path\to\native-host-manifest.json" /f
```

##### macOS

1. 创建目录:
```bash
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
```

2. 创建 manifest:
```bash
cat > ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.chainlesschain.clipper.json << EOF
{
  "name": "com.chainlesschain.clipper",
  "description": "ChainlessChain Web Clipper Native Messaging Host",
  "path": "/path/to/native-host.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
EOF
```

##### Linux

同 macOS，但路径改为:
```bash
~/.config/google-chrome/NativeMessagingHosts/
```

</details>

---

### 第 3 步：安装浏览器扩展

#### Chrome / Edge

1. **打开扩展管理页面：**
   - Chrome: 地址栏输入 `chrome://extensions/`
   - Edge: 地址栏输入 `edge://extensions/`

2. **开启开发者模式：**
   - 点击右上角的"开发者模式"开关

3. **加载扩展：**
   - 点击"加载已解压的扩展程序"
   - 选择文件夹: `chainlesschain/desktop-app-vue/browser-extension`
   - 点击"选择文件夹"

4. **查看扩展 ID：**
   - 在扩展列表中找到 "ChainlessChain Web Clipper"
   - 记下扩展 ID (类似 `abcdefghijklmnopqrstuvwxyz123456`)

5. **（可选）固定扩展图标：**
   - 点击浏览器工具栏右侧的拼图图标
   - 找到 "ChainlessChain Web Clipper"
   - 点击图钉图标固定到工具栏

---

### 第 4 步：安装 axios 依赖

**为什么需要这步？**
Native Messaging Host 需要 axios 库来向桌面应用发送 HTTP 请求。

```bash
cd chainlesschain/desktop-app-vue
npm install axios
```

---

### 第 5 步：启动桌面应用

1. **启动应用：**
```bash
cd chainlesschain/desktop-app-vue
npm run dev
```

2. **验证 HTTP 服务器：**
在浏览器中访问 http://localhost:23456/api/ping

应该看到:
```json
{"success": true, "data": {"message": "pong"}}
```

---

## 使用说明

### 剪藏网页

1. **打开任意网页**
   - 例如：https://github.com/chainlesschain/chainlesschain

2. **点击扩展图标**
   - 工具栏中的 ChainlessChain 图标
   - 或使用快捷键 (如果已配置)

3. **查看页面信息**
   - 扩展会自动提取:
     - ✓ 页面标题
     - ✓ 发布日期
     - ✓ 作者信息
     - ✓ 内容摘要
     - ✓ 推荐标签

4. **配置选项**
   - **标题**: 可以修改标题
   - **类型**: 选择内容类型 (网页剪藏/文章/笔记/文档)
   - **标签**: 添加或修改标签 (逗号分隔)
   - **使用 Readability 提取** ✅ (推荐)
     - 智能提取正文，去除广告和无关内容
   - **包含图片** (开发中)
   - **自动添加到 RAG 索引** ✅
     - 自动向量化内容，供 AI 检索

5. **保存到知识库**
   - 点击"保存到知识库"按钮
   - 等待保存完成（通常 1-2 秒）
   - 看到 ✓ 成功提示

6. **在桌面应用中查看**
   - 点击"在应用中查看"（开发中）
   - 或直接在桌面应用的知识库中查找

---

## 故障排除

### 问题 1: 扩展显示"未连接到 ChainlessChain"

**可能原因：**
- 桌面应用未运行
- Native Messaging Host 未正确安装
- HTTP 服务器端口被占用

**解决方案：**

1. **确保桌面应用正在运行**
```bash
# 检查进程
# Windows:
tasklist | findstr node

# macOS/Linux:
ps aux | grep node
```

2. **测试 HTTP 服务器**
```bash
curl http://localhost:23456/api/ping
```
应该返回: `{"success":true,"data":{"message":"pong"}}`

3. **检查 Native Messaging Host 日志**
```bash
# Windows:
type %APPDATA%\chainlesschain-native-host.log

# macOS/Linux:
cat ~/chainlesschain-native-host.log
```

4. **重新安装 Native Messaging Host**
```bash
node scripts/install-native-messaging.js
```

5. **重启浏览器**
完全关闭浏览器后重新打开。

---

### 问题 2: Readability 提取失败

**可能原因：**
- `readability.js` 文件缺失
- 网页结构不支持 Readability

**解决方案：**

1. **检查文件是否存在**
```bash
ls browser-extension/lib/readability.js
```

2. **如果文件缺失，重新下载**
参考 [第 1 步](#第-1-步准备-readability-库)

3. **如果网页不支持 Readability**
取消勾选"使用 Readability 提取"选项，使用原始 HTML。

---

### 问题 3: 无法保存内容

**可能原因：**
- 数据库权限问题
- 内容为空
- HTTP 请求超时

**解决方案：**

1. **检查控制台错误**
   - 右键扩展图标 → "检查弹出内容窗口"
   - 查看 Console 标签页的错误信息

2. **检查桌面应用日志**
```bash
# 在桌面应用运行的终端中查看日志
```

3. **检查数据库**
```bash
# 确保数据库文件可写
ls -l ~/AppData/Roaming/chainlesschain/database.db  # Windows
ls -l ~/Library/Application\ Support/chainlesschain/database.db  # macOS
```

---

### 问题 4: 端口 23456 被占用

**解决方案：**

**方法 1: 找到占用进程并结束**

Windows:
```batch
netstat -ano | findstr :23456
taskkill /PID <PID> /F
```

macOS/Linux:
```bash
lsof -i :23456
kill -9 <PID>
```

**方法 2: 修改端口**

编辑 `src/main/native-messaging/http-server.js`:
```javascript
const DEFAULT_PORT = 23457; // 改为其他端口
```

然后重新启动桌面应用。

---

## 开发调试

### 扩展调试

#### Popup 调试
1. 点击扩展图标打开 popup
2. 右键 popup 窗口 → "检查"
3. 在 DevTools 中查看 Console、Network 等

#### Content Script 调试
1. F12 打开网页的 DevTools
2. 在 Console 中查看 `[ContentScript]` 前缀的日志
3. 使用 `debugger` 断点

#### Background Script 调试
1. 进入 `chrome://extensions/`
2. 找到扩展，点击"检查视图"下的"背景页"
3. 查看 `[Background]` 前缀的日志

### 日志位置

- **Native Host 日志**:
  - Windows: `%APPDATA%\chainlesschain-native-host.log`
  - macOS/Linux: `~/chainlesschain-native-host.log`

- **桌面应用日志**: 终端输出

- **浏览器扩展日志**: DevTools Console

### 重新加载扩展

修改代码后需要重新加载：

1. 进入 `chrome://extensions/`
2. 找到扩展，点击刷新图标 🔄
3. 或使用快捷键: `Ctrl+R` (在扩展管理页面)

---

## 高级配置

### 自定义扩展 ID

打包扩展后会获得固定的扩展 ID：

1. 生成 .crx 文件
2. 获取扩展 ID
3. 更新 `native-host-manifest.json` 中的 `allowed_origins`

### 快捷键配置

在 `manifest.json` 中添加:

```json
{
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Ctrl+Shift+C"
      },
      "description": "打开 Web Clipper"
    }
  }
}
```

### 自动剪藏

可以通过 Context Menu (右键菜单) 实现:

在 `manifest.json` 中添加:
```json
{
  "permissions": ["contextMenus"],
  ...
}
```

在 `background.js` 中添加右键菜单项。

---

## 常见问题 FAQ

<details>
<summary>Q: 是否支持 Firefox？</summary>

A: 目前仅支持基于 Chromium 的浏览器 (Chrome、Edge)。Firefox 支持需要修改 manifest 为 Manifest V2 格式，并调整 API。
</details>

<details>
<summary>Q: 可以剪藏需要登录的页面吗？</summary>

A: 可以。扩展在你的浏览器会话中运行，可以访问已登录页面的内容。
</details>

<details>
<summary>Q: 剪藏的图片存储在哪里？</summary>

A: 目前"包含图片"功能还在开发中。未来图片将存储在 `userData/images/` 目录。
</details>

<details>
<summary>Q: 如何卸载？</summary>

A:
1. 在扩展管理页面点击"移除"
2. 运行 `node scripts/uninstall-native-messaging.js` (待实现)
3. 手动删除注册表项 (Windows) 或 manifest 文件 (macOS/Linux)
</details>

---

## 相关链接

- [项目主页](https://github.com/chainlesschain/chainlesschain)
- [问题反馈](https://github.com/chainlesschain/chainlesschain/issues)
- [Readability.js 文档](https://github.com/mozilla/readability)
- [Chrome Extension 文档](https://developer.chrome.com/docs/extensions/)
- [Native Messaging 文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)

---

## 许可证

MIT License

---

**祝你使用愉快！** 🎉

如有问题，请提交 Issue: https://github.com/chainlesschain/chainlesschain/issues
