# ChainlessChain 浏览器扩展使用指南

## 概述

ChainlessChain浏览器扩展是一个强大的网页剪藏工具，可以将网页内容快速保存到你的ChainlessChain知识库中。

### 核心功能

- ✅ **选中文本剪藏** - 保存网页中选中的文本
- ✅ **整页剪藏** - 保存完整的网页内容（包括图片和链接）
- ✅ **截图保存** - 快速截图并保存
- ✅ **链接保存** - 保存网页链接
- ✅ **图片保存** - 保存网页图片
- ✅ **智能提取** - 自动识别文章主要内容
- ✅ **实时同步** - 与桌面应用实时同步
- ✅ **快捷键支持** - 键盘快捷操作
- ✅ **右键菜单** - 便捷的右键菜单

---

## 安装步骤

### 1. 安装桌面应用

首先确保已安装ChainlessChain桌面应用（v0.20.0+）。

### 2. 配置Native Messaging

#### macOS/Linux

```bash
# 进入桌面应用目录
cd desktop-app-vue

# 给启动脚本添加执行权限
chmod +x native-messaging/native-messaging-host

# 安装Native Messaging配置
# Chrome/Edge
mkdir -p ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts
cp native-messaging/com.chainlesschain.native.json ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/

# Firefox
mkdir -p ~/Library/Application\ Support/Mozilla/NativeMessagingHosts
cp native-messaging/com.chainlesschain.native.json ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/
```

#### Windows

```powershell
# 以管理员身份运行PowerShell

# Chrome/Edge
$chromeDir = "$env:LOCALAPPDATA\Google\Chrome\User Data\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $chromeDir
Copy-Item native-messaging\com.chainlesschain.native.json $chromeDir\

# Firefox
$firefoxDir = "$env:APPDATA\Mozilla\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $firefoxDir
Copy-Item native-messaging\com.chainlesschain.native.json $firefoxDir\
```

### 3. 安装浏览器扩展

#### 开发模式安装（Chrome/Edge）

1. 打开浏览器，访问 `chrome://extensions/`
2. 开启右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `browser-extension` 目录
5. 扩展安装完成！

#### 开发模式安装（Firefox）

1. 打开浏览器，访问 `about:debugging#/runtime/this-firefox`
2. 点击"临时载入附加组件"
3. 选择 `browser-extension/manifest.json` 文件
4. 扩展安装完成！

### 4. 获取扩展ID并更新配置

安装扩展后，需要更新Native Messaging配置：

1. 在扩展管理页面找到扩展ID（类似：`abcdefghijklmnopqrstuvwxyz123456`）
2. 编辑 `native-messaging/com.chainlesschain.native.json`
3. 将 `EXTENSION_ID_HERE` 替换为实际的扩展ID
4. 重新复制配置文件到系统目录

---

## 使用方法

### 快捷键

| 功能 | Windows/Linux | macOS |
|------|---------------|-------|
| 保存选中内容 | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| 保存整页 | `Ctrl+Shift+A` | `Cmd+Shift+A` |
| 截图 | `Ctrl+Shift+X` | `Cmd+Shift+X` |

### 右键菜单

在网页上右键点击，选择"ChainlessChain"菜单：

- **保存选中内容** - 保存选中的文本
- **保存整个页面** - 保存完整页面
- **保存链接** - 保存链接地址
- **保存图片** - 保存图片
- **截图保存** - 截图并保存
- **设置** - 打开扩展设置

### 浮动工具栏

选中网页文本后，会自动显示浮动工具栏：

- 📋 **保存** - 保存选中内容
- 🔍 **搜索** - 在知识库中搜索
- ✕ **关闭** - 关闭工具栏

### 扩展弹窗

点击浏览器工具栏中的扩展图标，打开弹窗：

- **快速操作** - 保存选中/整页/截图
- **最近剪藏** - 查看最近保存的内容
- **打开应用** - 打开桌面应用
- **设置** - 配置扩展选项

---

## 功能详解

### 1. 选中文本剪藏

**使用场景**：保存文章中的重要段落、引用等

**操作步骤**：
1. 在网页上选中要保存的文本
2. 使用快捷键 `Ctrl+Shift+S` 或点击浮动工具栏的保存按钮
3. 内容自动保存到知识库

**保存内容**：
- 选中的文本
- 网页标题
- 网页URL
- 保存时间

### 2. 整页剪藏

**使用场景**：保存完整的文章、教程、文档等

**操作步骤**：
1. 打开要保存的网页
2. 使用快捷键 `Ctrl+Shift+A` 或右键菜单选择"保存整个页面"
3. 扩展会智能提取主要内容并保存

**保存内容**：
- 文章正文（自动识别）
- 网页标题和URL
- 文章中的图片（最多10张）
- 文章中的链接（最多50个）
- 网页元数据（作者、发布日期等）

### 3. 截图保存

**使用场景**：保存网页截图、图表、设计等

**操作步骤**：
1. 打开要截图的网页
2. 使用快捷键 `Ctrl+Shift+X` 或右键菜单选择"截图保存"
3. 自动截取当前可见区域并保存

**保存内容**：
- 截图图片（PNG格式）
- 网页标题和URL
- 截图时间

### 4. 链接保存

**使用场景**：保存有用的链接、参考资料等

**操作步骤**：
1. 在链接上右键点击
2. 选择"ChainlessChain" > "保存链接"
3. 链接信息自动保存

**保存内容**：
- 链接URL
- 链接文本
- 来源页面信息

### 5. 图片保存

**使用场景**：保存网页中的图片、插图等

**操作步骤**：
1. 在图片上右键点击
2. 选择"ChainlessChain" > "保存图片"
3. 图片自动下载并保存

**保存内容**：
- 图片文件
- 图片URL
- 来源页面信息

---

## 高级功能

### 智能内容提取

扩展会自动识别网页的主要内容区域，优先提取：

1. `<article>` 标签内容
2. `<main>` 标签内容
3. `.article-content` 等常见类名
4. 最长的文本块

### 内容清理

保存时自动清理：

- 移除脚本和样式
- 移除广告和无关内容
- 移除内联样式
- 合并多余空格和换行

### 元数据提取

自动提取网页元数据：

- 标题（title）
- 描述（description）
- 作者（author）
- 发布日期（publish date）
- 关键词（keywords）
- Open Graph图片
- Favicon

---

## 配置选项

### 扩展设置

在扩展弹窗中点击"设置"，可以配置：

#### 基本设置

- **自动保存** - 是否自动保存剪藏内容
- **默认标签** - 自动添加的标签（默认：`web-clip`）

#### 内容设置

- **捕获图片** - 是否保存页面中的图片
- **捕获链接** - 是否保存页面中的链接
- **最大图片数** - 最多保存的图片数量（默认：10）
- **最大链接数** - 最多保存的链接数量（默认：50）

#### 连接设置

- **桌面应用路径** - 桌面应用的安装路径
- **连接超时** - 与桌面应用通信的超时时间（默认：30秒）

---

## 故障排查

### 问题1：扩展显示"未连接"

**原因**：
- 桌面应用未运行
- Native Messaging配置错误
- 扩展ID不匹配

**解决方法**：
1. 确保桌面应用正在运行
2. 检查Native Messaging配置文件路径是否正确
3. 确认配置文件中的扩展ID与实际ID一致
4. 重启浏览器

### 问题2：保存失败

**原因**：
- 网络连接问题
- 数据库错误
- 权限不足

**解决方法**：
1. 检查桌面应用日志：`~/.chainlesschain/native-messaging.log`
2. 确认数据库文件权限正常
3. 尝试重启桌面应用

### 问题3：无法截图

**原因**：
- 浏览器权限不足
- 页面使用了特殊保护

**解决方法**：
1. 确认扩展有"activeTab"权限
2. 刷新页面后重试
3. 某些特殊页面（如chrome://）无法截图

### 问题4：浮动工具栏不显示

**原因**：
- 内容脚本未加载
- 页面CSP策略限制

**解决方法**：
1. 刷新页面
2. 检查浏览器控制台是否有错误
3. 某些特殊页面可能无法注入内容脚本

---

## 开发和调试

### 查看日志

**浏览器扩展日志**：
1. 打开扩展管理页面
2. 点击"检查视图"或"背景页"
3. 查看控制台输出

**Native Messaging日志**：
```bash
# macOS/Linux
tail -f ~/.chainlesschain/native-messaging.log

# Windows
type %USERPROFILE%\.chainlesschain\native-messaging.log
```

### 调试技巧

1. **Background Script**：在扩展管理页面点击"背景页"
2. **Content Script**：在网页上右键 > 检查 > Console
3. **Popup**：在弹窗上右键 > 检查

### 重新加载扩展

修改代码后：
1. 打开扩展管理页面
2. 点击扩展的"重新加载"按钮
3. 刷新测试页面

---

## 最佳实践

### 1. 合理使用标签

为剪藏内容添加有意义的标签，便于后续检索：

```javascript
// 在设置中配置默认标签
defaultTags: ['web-clip', 'article', 'tech']
```

### 2. 定期清理历史

扩展会保留最近100条剪藏历史，建议定期清理：

```javascript
// 在扩展设置中点击"清空历史"
```

### 3. 使用快捷键

熟练使用快捷键可以大幅提升效率：

- `Ctrl+Shift+S` - 最常用，保存选中内容
- `Ctrl+Shift+A` - 保存整页
- `Ctrl+Shift+X` - 快速截图

### 4. 智能选择剪藏类型

- **选中文本** - 适合保存引用、重点段落
- **整页** - 适合保存完整文章、教程
- **截图** - 适合保存图表、设计、布局

---

## 更新日志

### v1.0.0 (2026-01-14)

- ✅ 初始版本发布
- ✅ 支持选中文本、整页、截图剪藏
- ✅ Native Messaging集成
- ✅ 浮动工具栏
- ✅ 右键菜单
- ✅ 快捷键支持
- ✅ 智能内容提取
- ✅ 元数据提取

---

## 相关文件

- **扩展目录**: `browser-extension/`
- **Manifest**: `browser-extension/manifest.json`
- **Background**: `browser-extension/src/background/background.js`
- **Content Script**: `browser-extension/src/content/content.js`
- **Popup**: `browser-extension/src/popup/`
- **Native Messaging**: `desktop-app-vue/native-messaging/`

---

## 技术支持

如有问题或建议，请：

1. 查看日志文件排查问题
2. 访问项目GitHub提交Issue
3. 加入社区讨论

---

**注意**：浏览器扩展需要与桌面应用配合使用，请确保两者版本兼容。
