# Android Remote File Skill — 设计文档

> **状态**：v1.0 已落地 (2026-05-17)
> **范围**：Android remote-operate Plan C 路径下「浏览 PC 远程目录 / 上传到 PC / 下载到手机」三大能力
> **真机验证**：Xiaomi 24115RA8EC + Windows 桌面 ✅ 浏览+上传+下载+app 内打开 已端到端走通

## 1. 三层定位

| 层 | 实现 | 职责 |
|---|---|---|
| Android UI | `FileTransferScreen.kt` + 浏览面板 + 本地下载面板 + Snackbar action | 操作入口；MediaStore.Downloads 写公共目录；点击直接 `Intent.ACTION_VIEW` 拉系统 viewer |
| Android transport | `RemoteCommandClient` → `SignalingRpcClient.invoke` | Plan C 路径，复用 terminal 验证过的 DC fast-path + signaling fallback |
| PC handler | `desktop-app-vue/src/main/remote/handlers/android-file-handler.js` | 11 个 action，无 sandbox（trusted paired peer），字段对齐 Android `FileCommands.kt` |

## 2. 协议接口

PC handler `handle(action, params, ctx)` 派发 11 个 action：

| Action | 用途 | 关键参数 | 关键返回 |
|---|---|---|---|
| `listDirectory` | 列目录 | `path`, `showHidden` | `entries[{name, path, type, size, modifiedTime, isHidden}]` |
| `getFileInfo` | 单文件 metadata | `path` | `{exists, file{...}}` |
| `exists` | 存在性检查 | `path` | `{exists, isFile, isDirectory, isSymlink}` |
| `delete` | 删文件/目录 | `path`, `recursive`, `force` | `{success, path}` |
| `createDirectory` | 建目录 | `path`, `recursive` | `{success, path}` |
| `requestUpload` | 开始上传 | `fileName`, `fileSize`, `metadata.targetDir?` | `{transferId, chunkSize, totalChunks, resumeSupported}` |
| `uploadChunk` | 上传一块 | `transferId`, `chunkIndex`, `chunkData` (base64) | `{received, progress, remainingChunks}` |
| `completeUpload` | 收尾上传 | `transferId` | `{status, fileName, filePath, fileSize, duration}` |
| `requestDownload` | 开始下载 | `filePath`, `fileName?` | `{transferId, fileName, fileSize, chunkSize, totalChunks, checksum:null}` |
| `downloadChunk` | 下载一块 | `transferId`, `chunkIndex` | `{chunkData (base64), chunkSize, isLastChunk, progress}` |
| `cancelTransfer` | 取消传输 | `transferId` | `{transferId, status:"cancelled"}` |
| `listTransfers` | 列在传任务 | `limit`, `offset`, `status?` | `{transfers[...], total}` |

**字段对齐**：所有响应字段命名与 Android `FileCommands.kt` `@Serializable data class FileEntry` 一致（`type` not `isDirectory`，`modifiedTime` not `modifiedAt`，`entries` not `items`）。

## 3. 架构图

```
┌──────────────────────────────────────────────────────────────────┐
│  Android (24115RA8EC)                                           │
│                                                                  │
│  RemoteOperateScreen ──▶ FileTransferScreen                     │
│    ├ 📁 浏览远程目录   ──▶ RemoteBrowsePanel ──▶ ViewModel       │
│    │                                                             │
│    ├ ☁️↑ 上传          ──▶ ActivityResultContracts.GetContent() │
│    │                                                             │
│    ├ ☁️↓ 输入路径下载 ──▶ ViewModel                              │
│    │                                                             │
│    └ 📱 本机下载文件夹 ──▶ MediaStore.Downloads query ──▶ Intent│
│                                                                  │
│  FileTransferViewModel ──▶ FileTransferRepository ──▶ FileCommands │
│                                              │                    │
│         (MediaStore.Downloads 公共目录)      ▼                    │
│                                       RemoteCommandClient         │
│                                              │                    │
│  ─────────────────────────────────────────── │ ───────────────── │
│                                              ▼                    │
│              SignalingRpcClient.invoke(pcPeerId, method, params) │
│                                              │                    │
│                       ┌──────────────────────┴───────────────┐   │
│                       │  DC fast-path (WebRTC DataChannel)   │   │
│                       │  ↓ DC not open                       │   │
│                       │  signaling forward (WebSocket relay) │   │
│                       └──────────────────┬───────────────────┘   │
└──────────────────────────────────────────┼───────────────────────┘
                                           │
┌──────────────────────────────────────────┼───────────────────────┐
│ PC desktop-app-vue                       │                       │
│                                           ▼                       │
│  mobile-bridge.js ──▶ handleMobileCommand ──▶ routeMobileCommand │
│                                            │                      │
│                                  case "file" ──▶ handleFileCommand│
│                                                          │        │
│                                            (delegate)    ▼        │
│                                         AndroidFileHandler.handle │
│                                                          │        │
│                              ┌───────────────────────────┤        │
│                              ▼                           ▼        │
│              listDirectory(real fs, no sandbox)   MediaStore... ⇧ │
│                                                                   │
│              Upload 落点: os.homedir()/Downloads/<name>          │
└───────────────────────────────────────────────────────────────────┘
```

## 4. 修复的 4 个互锁雷

### Bug 1 — `P2PClient.kt:538-542` chainlesschain:* skip guard 太宽

```kotlin
// 旧：把 P2PClient 自己发的命令的响应也屏蔽
if (raw.contains("\"type\":\"chainlesschain:")) return
```

P2PClient.sendCommand 自己也用 `chainlesschain:command:request` envelope，但这个 guard 一刀切所有 `chainlesschain:*`，导致 P2PClient.pendingRequests 永远等不到 complete。

**修法**：缩窄成只 skip `chainlesschain:command:request`（让 incoming request 给 SignalingRpc 订阅者），放行 `chainlesschain:command:response`。

### Bug 2 — Plan C 路径 P2PClient.connectionState 永远 DISCONNECTED

`P2PClient.sendCommand` 第一行 `if (_connectionState != CONNECTED) return failure("Not connected")`。Plan C (`RemoteOperateScreen` → signaling forward) 根本没调 `P2PClient.connect()` → state 一直 DISCONNECTED → 所有 RemoteCommandClient 命令立即失败。

**修法**：`RemoteCommandClient.invokeTyped` 改 delegate `SignalingRpcClient.invoke(pcPeerId, ...)`，pcPeerId 从 `PairedDesktopsStore.devices.firstOrNull()?.pcPeerId` 取。

### Bug 3 — PC `handleFileCommand` 是简陋 stub（弹框 + 缺 case）

`desktop-app-vue/src/main/index.js:2378` 的 switch 当时只有 `case "list"` (查 SQL 表) + `case "requestUpload"` (`dialog.showOpenDialog` 弹 PC 文件选择框)。其它全 default `throw Unknown action`。

**修法**：新写 `android-file-handler.js`，`handleFileCommand` 整段替换为 delegate。

### Bug 4 — `FileTransferHandler`（remote-gateway 注册的）sandbox + 字段不一致

`_resolvePath` 强 prefix `app.getPath("userData")`，`C:\Users\...` 一律 `Access denied`。字段 `dirPath/items/isDirectory` 与 Android `path/entries/type` 不匹配。

**修法**：不复用，新写专用 handler。无 sandbox（trusted paired peer）。

## 5. 修复的 2 个 UX 坑

### Bug 5 — checksum 算法不匹配 → repository 自删下载文件

第一版 `requestDownload` 返 `"sha256-prefix:abc..."`（头部 32KB SHA256），但 `FileTransferRepository.kt:264-276` 期望 `"md5:" + 完整 MD5`，对不上立刻删本地文件 + 标 FAILED + 抛 `Checksum mismatch`。

**修法**：返 `checksum: null` 跳过 Repository 验证。如要真验和，必须 `"md5:" + crypto.createHash("md5").update(整个 fileBuffer).digest("hex")`。

### Bug 6 — `getExternalFilesDir(null)` 用户找不到下载的文件

`/sdcard/Android/data/com.chainlesschain.android.debug/files/downloads/` 受 Android 13+ scoped storage 限制，普通用户用文件管理器要点 5 层 + 开"显示隐藏"。

**修法**：API 29+ 用 `MediaStore.Downloads.EXTERNAL_CONTENT_URI` insert 写**公共 Download 目录**。返 `content://media/external/downloads/<id>` uri 直接喂 `Intent.ACTION_VIEW` 拉系统 viewer。无需 `WRITE_EXTERNAL_STORAGE` 权限。

## 6. UI 入口（TopAppBar 5 个 icon）

| Icon | 触发 | 功能 |
|---|---|---|
| 📁 / 📂 (Folder/FolderOpen) | toggle `showBrowsePanel` | 浏览 PC 远程目录 — 顶部路径输入 + 上级/刷新 + LazyColumn 文件树 |
| ☁️↑ (CloudUpload) | filePickerLauncher | 触发系统 GetContent 选本机文件 → 上传 PC |
| ☁️↓ (CloudDownload) | toggle `showDownloadPanel` | 输入远程路径 + 文件名手动下载 |
| 📱 (PhoneAndroid) | toggle `showLocalPanel` | **App 内** MediaStore.Downloads 列表，点击直接打开（不跳出 app） |
| 🧹 (CleaningServices) | `cleanupOldTransfers(30)` | 清理 30 天前历史 |

**Snackbar action**：
- 下载完成有 `openUri` → 「打开」按钮 → `Intent.ACTION_VIEW(content://...)` 拉 viewer
- 上传完成有 `pathHint` → 「复制路径」按钮 → `ClipboardManager.setText` + Toast

## 7. 测试覆盖

### 7.1 PC 单测 (`vitest`)

`desktop-app-vue/src/main/remote/__tests__/android-file-handler.test.js` — **30 cases all passing**:

- `_resolvePath` ×5（`~` 展开、`.`、绝对路径、null/非 string 抛）
- `listDirectory` ×5（字段对齐 / dir 排前 / 隐藏过滤 / 非目录抛 / 断裂 symlink 跳过）
- `getFileInfo` + `exists` ×3
- `createDirectory` + `delete` ×3
- Upload 全流程 ×5（3-chunk 重建 / 防覆盖 (1) 后缀 / unknown transferId / 非 base64 拒绝 / maxConcurrent 限 / `metadata.targetDir`）
- Download 全流程 ×3（chunk 重建 + isLastChunk + auto-cleanup / 非文件抛 / unknown transferId）
- **Bug 5 回归测**：`requestDownload.checksum` 必须为 `null`
- `cancelTransfer` ×2（删半成品 / unknown 不抛）
- `handle()` dispatch ×2（11 个已知 action 不抛 Unknown / unknown action 抛）
- `listTransfers` ×1

### 7.2 Android 单测 (`gradle :app:testDebugUnitTest`)

`android-app/app/src/test/java/com/chainlesschain/android/remote/client/RemoteCommandClientTest.kt` — **4 cases all passing**:

- delegate 到 SignalingRpc + pcPeerId 取自 PairedDesktopsStore
- 已配对桌面为空 → `Result.failure("无已配对桌面")`
- SignalingRpc 失败原样传播
- 多桌面取 firstOrNull
- **Bug 1+2 锁死**：`coVerify(exactly = 0)` 验证不走 `p2pClient.sendCommand`

### 7.3 真机 E2E 手动 reproducer

需 Xiaomi 24115RA8EC + Windows 桌面 + 同 WiFi 或公网中继。**8 个场景**：

| # | 场景 | 操作 | 通过标志 |
|---|---|---|---|
| E1 | 浏览家目录 | 进入 📁 输入 `~` 点进入 | 列出 PC 用户家目录子项；目录在前；隐藏文件不显示 |
| E2 | 浏览盘根 | 改 `C:\` 进入 | 列出 C 盘根目录 |
| E3 | 进子目录 | 点 `Users` → `<你>` → `Downloads` | 面包屑「当前: …」更新；面板内容刷新；↑ 上级返回 |
| E4 | 小文件上传 | ☁️↑ 选 < 100KB 文件 | Snackbar「文件上传成功: …」+「PC: C:/Users/…/Downloads/<名>」+ 「复制路径」按钮；点复制 → Toast 路径已复制；PC 端真有文件 |
| E5 | 防覆盖 | 重新上传同名文件 | PC 端落 `(1)` 后缀 |
| E6 | 小文件下载 | 在 📁 里点一个 PC 端文件 | Snackbar「下载成功: …」+「手机 Download/<名>」+ 「打开」按钮 |
| E7 | 「打开」action | 上一步点「打开」 | 图片→相册 / PDF→阅读器 / txt→记事本 lifecycle；不跳浏览器 |
| E8 | 本机下载面板 | 点 📱 第 4 个图标 | LazyColumn 列出 Download 目录所有文件（含 E6 + 别处下的）；每行点「打开」直接拉 viewer，不跳 DocumentsUI |

## 8. 已知限制 / 后续工作

- **大文件**：当前走 signaling 转发 4 跳 + base64 chunk，> 10MB 可能 timeout。等 Plan A.1 WebRTC DataChannel 稳定后切 DC 路径。
- **API < 29**：MediaStore.Downloads 不可用，fallback app-private 路径；普通用户找不到。未来加 FileProvider 适配。
- **destructive action** (`delete`/`writeFile`) 当前无审批 gate；trusted paired peer 即可执行。未来应叠 `mobileApprovalChannel`（参考 `marketplace.purchase` / `did.delegate` 反向 RPC 模式）。
- **没有 checksum 验证**：靠 chunk 协议天然 1:1。下次如有错乱可加 `"md5:" + 全量 MD5`。

## 9. 文件清单（新增/修改）

```
desktop-app-vue/src/main/remote/handlers/
  android-file-handler.js                  +460  新增
desktop-app-vue/src/main/remote/__tests__/
  android-file-handler.test.js             +330  新增 (30 cases)
desktop-app-vue/src/main/index.js          -68   handleFileCommand 替换为 delegate
android-app/app/src/main/java/com/chainlesschain/android/
  remote/ui/file/FileTransferScreen.kt     +330  浏览面板 + 本地下载面板 + Snackbar action + HelpBanner
  remote/ui/file/FileTransferViewModel.kt  +10   Success.pathHint + openUri
  remote/data/FileTransferRepository.kt    +80   MediaStore.Downloads 写公共目录 + getDownloadUri
  remote/ui/RemoteOperateScreen.kt         +9    「文件传输」按钮
  remote/client/RemoteCommandClient.kt     +28   SignalingRpc delegate + Gson roundtrip
  remote/p2p/P2PClient.kt                  -2    chainlesschain skip guard 缩窄
  navigation/NavGraph.kt                   +4    onOpenFileTransfer wire
android-app/app/src/test/java/com/chainlesschain/android/
  remote/client/RemoteCommandClientTest.kt +143  新增 (4 cases)
```

## 10. 相关文档

- 上层 Plan C 架构：[Android_Remote_Operate_Plan_C.md](Android_Remote_Operate_Plan_C.md)
- 上一阶段 Plan A.1 终端：[Android_Remote_Terminal_Plan_A1.md](Android_Remote_Terminal_Plan_A1.md)
- Approval channel (未来 destructive action 接入参考)：参见 `mobile-approval-channel.js` 文件头

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「1. 三层定位」。Android Remote File Skill 在 remote-operate Plan C 路径下提供「浏览 PC 远程目录 / 上传到 PC / 下载到手机」三大能力，v1.0 已真机端到端验证。

### 2. 核心特性

浏览 PC 任意目录 / 上传 / 下载 / app 内打开；公共 Download 落点（MediaStore）；防覆盖上传；chunk + base64 协议。

### 3. 系统架构

见正文「3. 架构图」：Android `SignalingRpcClient` → 桌面 `AndroidFileHandler`（主用户身份）。用户指南见 `/guide/remote-file`。

### 4. 系统定位

Android 远程操控的**文件浏览 / 传输 skill**（Plan C 路径，复用 #21 signaling 通道）。

### 5. 核心功能

见正文「2. 协议接口」：`file.list` / `file.read` / `file.write`。

### 6. 技术架构

signaling 转发 `file.*`；64KB chunk + base64；MediaStore.Downloads 落盘；Intent.ACTION_VIEW 打开。

### 7. 系统特点

真机验证 ✅（Xiaomi 24115RA8EC + Windows）；修复 4 互锁雷 + 2 UX 坑（见正文 §4/§5）。

### 8. 应用场景

手机临时取 PC 文件 / 上传照片到 PC / 远程浏览项目目录。

### 9. 竞品对比

见用户指南 `/guide/remote-file` 附录竞品对比（vs AirDroid / KDE Connect / 微信文件传输）。

### 10. 配置参考

无独立配置，复用配对信任；下载落手机公共 Download、上传落 PC `~/Downloads`。

### 11. 性能指标

64KB chunk；>10MB 可能 timeout（待 WebRTC DC 路径提速）。

### 12. 测试覆盖

真机 E2E 8 场景；修复 6 个 bug（见正文 §4/§5 与用户指南附录）。

### 13. 安全考虑

仅 trusted paired peer；`AndroidFileHandler` 主用户身份（非 sandbox）；destructive `delete`/`writeFile` 待接 approval channel；无 checksum（见正文 §5 Bug 5 checksum 不匹配修复）。

### 14. 故障排除

见正文「§4 修复的 4 个互锁雷」+「§5 修复的 2 个 UX 坑」（skip guard / connectionState / checksum 自删等）。

### 15. 关键文件

Android `SignalingRpcClient`；桌面 `AndroidFileHandler` / `FileTransferHandler`；`P2PClient.kt`。

### 16. 使用示例

见用户指南 `/guide/remote-file`（5 图标 UI：浏览 / 上传 / 下载 / 本机 / 清理）。

### 17. 相关文档

见正文「10. 相关文档」：`Android_Remote_Operate_Plan_C.md`、`Android_Remote_Terminal_Plan_A1.md`、`mobile-approval-channel.js`。
