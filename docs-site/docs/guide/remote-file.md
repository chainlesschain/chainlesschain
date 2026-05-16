# 远程文件（Android 浏览/上传/下载 PC 文件）

> Android 手机配对桌面后，浏览 PC 任意目录、上传本机文件到 PC、下载 PC 文件到手机，并在 app 内打开查看。复用 #21 Remote Operate signaling 通道，零新基础设施。

## 1. 概述

ChainlessChain Android 端在 RemoteOperate 路径下提供完整的远程文件管理能力。Android 通过 `SignalingRpcClient` 把 `file.*` 命令转给桌面端，桌面端的 `AndroidFileHandler` 在主用户身份下访问真实文件系统（**不在 sandbox 内**），把结果回传。

- **入口**：Android 首页绿色"已连接桌面"卡片 → 「文件传输 / 浏览远程目录」按钮
- **三大功能**：浏览远程目录 / 上传到 PC / 下载到手机
- **打开下载文件**：app 内直接拉系统 viewer（图片→相册、PDF→阅读器…），无需跳出 app

## 2. 核心特性

| 特性 | 说明 |
|---|---|
| 浏览 PC 任意目录 | 支持 `~` 展开、Windows `C:/`、macOS/Linux `/`；目录在前按字母排序；隐藏文件可选 |
| 公共 Download 落点 | 下载文件经 `MediaStore.Downloads` 写到手机**公共 Download 目录**，原生文件管理器/相册/阅读器都能直接看到；无需 `WRITE_EXTERNAL_STORAGE` 权限 |
| 防覆盖上传 | PC 端同名文件自动加 `(1)` `(2)` 后缀 |
| chunk-based 协议 | 64KB chunk + base64 编码 + transferId 状态机，断点续传可后续扩展 |
| app 内打开 | Snackbar「打开」按钮直接 `Intent.ACTION_VIEW(content://...)` 拉对应 app；不跳浏览器/DocumentsUI |
| app 内本地下载浏览器 | TopAppBar 第 4 个图标 📱 列出手机 Download 目录所有文件，点行直接打开 |
| 复制 PC 路径 | 上传成功 Snackbar 显示 `PC: C:/Users/…/Downloads/<名>`，「复制路径」按钮一键到剪贴板 |

## 3. UI 入口（5 个图标）

进入「文件传输」屏后 TopAppBar 五个图标：

```
📁 / 📂   ☁️↑   ☁️↓    📱      🧹
浏览远程   上传   下载    本机    清理
```

| 图标 | 功能 |
|---|---|
| 📁 / 📂 | 切换「浏览远程目录」面板：输入 `~` / `C:/Users/...` → 进入；点目录递归；点文件直接下载；↑ 上级；🔄 刷新 |
| ☁️↑ | 系统文件选择器选本机文件 → 上传到 PC `~/Downloads/<名>` |
| ☁️↓ | 切换「下载面板」：输入远程路径 + 文件名 → 手动下载 |
| 📱 | 切换「本机下载文件夹」面板：app 内列出手机 Download 目录所有文件，点行直接打开 |
| 🧹 | 清理 30 天前的传输历史 |

## 4. 操作流程

### 浏览 PC 远程目录

1. 点 📁 → 默认浏览 `~`（PC 用户家目录）
2. 改路径栏输入 `C:/Users/<你>` 或 `C:/code/chainlesschain` → 「进入」
3. 点目录递归进入；点文件直接下载
4. 「↑」回上级目录；「🔄」刷新

### 上传本机文件到 PC

1. 点 ☁️↑ → 系统文件选择器
2. 选好文件 → 自动 chunk 上传
3. Snackbar 弹「文件上传成功: 文件名」+ 第二行 `PC: C:/Users/longfa/Downloads/文件名` + 「复制路径」按钮
4. 复制后，Windows 资源管理器粘贴 → Enter 直接定位文件

### 下载 PC 文件到手机

**方法 A — 在浏览面板里点文件**：

1. 浏览到包含目标文件的目录
2. 点文件行 → 触发下载
3. Snackbar 弹「文件下载成功: 文件名」+ `手机 Download/文件名` + 「打开」按钮
4. 点「打开」→ 系统按 MIME 拉起对应 app（图片→相册、PDF→阅读器…）

**方法 B — 手输路径**：

1. 点 ☁️↓ → 下载面板展开
2. 输入远程路径（如 `C:/Users/longfa/Documents/foo.pdf`）+ 文件名 → 点「开始下载」
3. 同上 Snackbar

### App 内打开已下载文件

1. 点 📱 → 「本机下载文件夹」面板展开
2. LazyColumn 列出手机 Download 目录所有文件（含你之前从 PC 下载的 + 浏览器等其它 app 下载的），按时间倒序
3. 点任意行 → 系统 viewer 拉起；**全程不跳出 app**

## 5. 已知限制

- **大文件**：当前走 signaling 转发 4 跳 + base64 chunk，> 10MB 可能 timeout。等 Plan A.1 WebRTC DataChannel 稳定后切 DC 路径。
- **API < 29 (Android 9)**：MediaStore.Downloads 不可用，下载落 app-private 路径，用户找不到。这部分老设备占比低，后续如有用户反馈再加 FileProvider 适配。
- **destructive action 无审批**：`delete` / `writeFile` 当前仅由 trusted paired peer 自动执行；未来加 mobile-approval-channel 二次确认。
- **无 checksum 验证**：靠 chunk 协议天然 1:1 对应；如有错乱反馈可补 `"md5:" + 全量 MD5`。

## 6. 设计文档

详细架构、协议接口、修复的 6 个 bug、测试覆盖、真机 E2E 8 场景：

→ [Android Remote File Skill 设计文档](/design/Android_Remote_File_Skill)
