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

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见上文「1. 概述」。一句话：Android 配对桌面后，经 `SignalingRpcClient` 把 `file.*` 命令转发给桌面 `AndroidFileHandler`，在主用户身份下读写真实文件系统，实现浏览 / 上传 / 下载 / app 内打开。

### 2. 核心特性

见上文「2. 核心特性」表。要点：浏览 PC 任意目录、公共 Download 落点（`MediaStore.Downloads`，免存储权限）、防覆盖上传、64KB chunk + base64 协议、app 内 viewer 打开、复制 PC 路径。

### 3. 系统架构

```
Android（Compose 文件传输屏）
   │  file.list / file.read / file.write …
   ▼
SignalingRpcClient ──（复用 #21 Remote Operate signaling 通道，4 跳中继）──►
   ▼
Desktop AndroidFileHandler（主用户身份，非 sandbox）
   ▼
真实文件系统（~ 展开 / C:/ / Unix /）
```

下行下载经 `MediaStore.Downloads` 写入手机公共 Download 目录。

### 4. 系统定位

**复用现有 signaling、零新增基础设施的轻量文件桥**。不引入独立服务端口、不依赖局域网发现，直接搭车 Remote Operate 已建立的配对信道，适合「手机临时取 PC 上一个文件」这类高频小场景。

### 5. 核心功能

| 功能 | 入口 | 协议 |
|---|---|---|
| 浏览远程目录 | 📁 | `file.list` |
| 上传到 PC | ☁️↑ | chunk `file.write` |
| 下载到手机 | ☁️↓ / 点文件 | chunk `file.read` |
| app 内打开 | Snackbar「打开」/ 📱 | `Intent.ACTION_VIEW` |
| 清理历史 | 🧹 | 本地清理 30 天前传输记录 |

### 6. 技术架构

- **chunk 协议**：64KB / chunk + base64 编码 + `transferId` 状态机，为断点续传预留扩展点
- **落盘**：`MediaStore.Downloads`（API 29+）→ 公共 Download 目录，原生文件管理器 / 相册 / 阅读器可直接访问
- **打开**：`content://` URI + `Intent.ACTION_VIEW`，系统按 MIME 拉对应 app

### 7. 系统特点

- 免 `WRITE_EXTERNAL_STORAGE`（走 MediaStore）
- 防覆盖：PC 端同名自动加 `(1)` `(2)` 后缀
- 桌面侧在主用户身份执行（非 sandbox），可访问任意路径
- 不跳出 app：下载后 Snackbar / 本机面板直接 viewer

### 8. 应用场景

- 手机临时下载 PC 上的 PDF / 图片就地查看
- 把手机里的照片 / 文档上传到 PC `~/Downloads`
- 远程浏览 PC 项目目录确认文件是否存在

### 9. 竞品对比

| 维度 | 本功能 | AirDroid | KDE Connect | 微信文件传输 |
|---|---|---|---|---|
| 去中心化 P2P | ✅ 配对信道 | ❌ 云中转 | ✅ 局域网 | ❌ 云 |
| 免额外服务 | ✅ 复用 signaling | ❌ | ⚠️ 需同网 | ❌ |
| app 内 viewer | ✅ | ⚠️ | ❌ | ⚠️ |
| 浏览任意 PC 目录 | ✅ | ✅ | ⚠️ | ❌ |

### 10. 配置参考

无独立配置项——复用配对信任关系。下载落点固定为手机公共 Download 目录，上传落点固定为 PC `~/Downloads`。trust 由已配对 peer 决定。

### 11. 性能指标

- 单 chunk 64KB；小文件秒级
- **> 10MB 可能 timeout**（当前走 signaling 4 跳 + base64），等 Plan A.1 WebRTC DataChannel 稳定后切 DC 路径提速
- 见上文「5. 已知限制」

### 12. 测试覆盖

详见设计文档：协议接口、修复的 6 个 bug、单元测试与真机 E2E 8 场景。→ [Android Remote File Skill 设计文档](/design/Android_Remote_File_Skill)

### 13. 安全考虑

- 仅 **trusted paired peer** 可发起 `file.*`
- 桌面 `AndroidFileHandler` 在主用户身份执行（**不在 sandbox 内**），可访问任意路径——配对信任是唯一闸门
- **已知约束**：`delete` / `writeFile` 当前由 trusted peer 自动执行，无二次审批；未来接 mobile-approval-channel
- 无 checksum 验证（靠 chunk 1:1 对应），如需可补全量 MD5

### 14. 故障排除

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 浏览目录空白 | 路径不存在 / 无权限 | 换 `~` 或确认 PC 端目录可读 |
| 下载文件找不到 | API < 29 落 app-private 路径 | 老设备限制，见「5. 已知限制」 |
| 大文件下载中断 | > 10MB signaling timeout | 暂分卷，等 DC 路径 |
| 「打开」无反应 | 无对应 MIME 的 app | 装对应查看器 |

### 15. 关键文件

| 组件 | 说明 |
|---|---|
| Android `SignalingRpcClient` | 把 `file.*` 命令经 signaling 转发桌面 |
| 桌面 `AndroidFileHandler` | 主用户身份下读写真实文件系统 |
| Android 文件传输 Compose 屏 | 5 图标 UI（浏览 / 上传 / 下载 / 本机 / 清理）|

完整文件树见设计文档。

### 16. 使用示例

```text
# 浏览：点 📁 → 路径栏输入 C:/Users/<你>/Documents → 进入
# 上传：点 ☁️↑ → 选本机文件 → Snackbar 显示 PC: C:/Users/<你>/Downloads/<名>
# 下载：浏览面板点文件 → Snackbar「打开」→ 系统 viewer
# 本机：点 📱 → 列出手机 Download 目录 → 点行打开
```

### 17. 相关文档

- [远程终端（Android 操控桌面 PTY）](/guide/remote-terminal)
- [Android 用户操作手册](/guide/mobile-android-usage)
- [Android Remote File Skill 设计文档](/design/Android_Remote_File_Skill)
