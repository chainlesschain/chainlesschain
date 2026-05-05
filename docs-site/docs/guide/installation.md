# 桌面版安装指南

本页解释 ChainlessChain 桌面版（Windows/macOS/Linux）安装与首次启动过程中的关键时间点和行为，帮助你**判断"正在工作"还是"卡住了"**。

> 太长不看：**首次安装预计 15–25 分钟**，**首次启动预计 30–60 秒**，**点关闭按钮 X 默认最小化到系统托盘**（应用没退出，右下角找图标）。这些都是当前正常表现，不是 bug。

---

## 一、安装阶段（双击 `Setup.exe` 之后）

### 实测时间

| 阶段 | 预期时长（Win10/11 + Defender 开启）|
|---|---|
| 卸载旧版（如有） | ~2 分钟 |
| 安装新版（覆盖装） | **15–25 分钟** |
| 首次启动到主窗口可见 | 30–60 秒 |

### 为什么这么慢

桌面版打包后含 **~110,000 个 node_modules 文件 / ~2.4 GB 实际占用**。NSIS 安装器在装包阶段需要：

1. 单文件解压（每个文件 LZMA 字典重置）
2. 单文件写盘（每个文件一次 NTFS 元数据事务）
3. 单文件 Defender 实时扫描

文件数 × ~10ms/文件 ≈ 18 分钟基准。这是当前 `asar:false` 散文件部署模式的结构性限制。

### 进度条不动 ≠ 卡死

NSIS 进度条在文件批次切换时会停滞数十秒。判断真假卡死的方法：
- **任务管理器** → 性能页 → 磁盘占用率：长期 > 30% 表示在写盘
- **资源监视器** → 磁盘 → 看 `Setup.exe` 子进程的写入字节数持续增长

### 建议

- **安装前**：关闭非必要程序，确保 C 盘有 5 GB 可用空间
- **安装中**：不要双击启动其它大型软件、不要做 Antivirus 全盘扫描
- **如已经超过 40 分钟**：才考虑取消重试

### 优化路线

把安装时间砍到 5 分钟内需要重启用 `asar:true`。前期 `asar:true` + `asarUnpack` glob 方案（[issue #6](https://github.com/chainlesschain/chainlesschain/issues/6)，已关）实测被 electron-builder walker 的 nested-only 决策证伪；剩余可行路径是 post-pack asar surgery，暂未排期。

---

## 二、首次启动（双击桌面图标之后）

### 启动流程

1. **0–3 秒**：闪屏（splash window）显示
2. **3–30 秒**：后台加载 158 个 Skill、初始化 P2P 节点、连接本地数据库
3. **30–60 秒**：主窗口出现
4. **60–90 秒**：渲染器完全 ready，可以交互

### "我等了 1 分钟还没看到窗口"

先做这两步：
1. **任务管理器** 看是否有 `ChainlessChain.exe` 进程在跑（应该有 4 个：主进程 + GPU + utility + renderer）
2. **应用日志**：`%APPDATA%\chainlesschain-desktop-vue\logs\chainlesschain-{今日日期}.log`，搜索 `[Main]` 关键字看是否还在加载

如果进程在跑、日志在涨，**继续等**（最多再等 1 分钟）。如果进程已退出，看下一节。

### 启动失败排查

应用日志同目录有 `error-logs/error-{日期}.log`，常见错误：

| 日志关键字 | 原因 | 修复 |
|---|---|---|
| `Cannot find package 'X'` | 安装包损坏 | 重新下载 Setup.exe，校验 sha256 |
| `EADDRINUSE: 127.0.0.1:18790` | 端口被占用（之前的实例残留） | 任务管理器 kill 所有 `ChainlessChain.exe`，重启 |
| `Better-SQLite3 ... bindings file` | 数据库 native 模块未就绪 | 通常应用已自动 fallback 到 sql.js，可忽略；持续报错请反馈 |

---

## 三、关闭按钮 X 行为（v1.1.0+ 重要变更）

### 默认行为：最小化到系统托盘

点窗口右上角 **X** 按钮，应用**不会退出**——主窗口隐藏到系统托盘（屏幕右下角时间区域附近的图标），后台仍在运行。

这是为了：
- 保持 P2P 节点在线接收消息
- 避免每次重启都等 30–60 秒首启
- 避免误关丢失正在进行的 AI 任务

### "我的窗口怎么消失了"

去系统托盘找 ChainlessChain 图标：
- **Windows**：屏幕右下角，可能在"显示隐藏的图标"（向上箭头）展开里
- **macOS**：屏幕右上角菜单栏
- **Linux**：取决于桌面环境

### 显示窗口的几种方式

- **单击**托盘图标 → 切换显示/隐藏
- **双击**托盘图标 → 显示窗口并聚焦
- **右键托盘图标** → 菜单 → "显示主窗口"

### 真正退出应用

- **托盘图标右键** → 菜单 → **"退出"**（推荐）
- **快捷键 `Ctrl+Q`**（Windows/Linux）/ `Cmd+Q`（macOS）
- 应用菜单栏 → 文件 → 退出
- 任务管理器 / `kill -9`（应急）

> **注**：托盘菜单的"退出"会触发完整 cleanup（关 P2P、停后端服务、刷写未保存数据）；任务管理器强 kill 会跳过这些。

### 改回"X 即退出"的旧行为

目前没有 UI 开关。如果你强烈希望 X 直接退出，请[反馈](https://github.com/chainlesschain/chainlesschain/issues/new)。后续可能加用户偏好开关。

---

## 四、卸载

### Windows

1. 控制面板 → 程序和功能 → ChainlessChain → 卸载
2. 或：直接运行 `C:\Program Files\ChainlessChain\Uninstall ChainlessChain.exe`
3. 静默卸载：`"Uninstall ChainlessChain.exe" /S`（仍需 UAC）

### 卸载耗时

约 **2 分钟**（删 110k 文件 + Defender 扫每个删除事件）。

### 卸载后保留的数据

应用数据**默认不会被卸载器删除**：

```
%APPDATA%\chainlesschain-desktop-vue\
  ├── data\          ← SQLite 数据库（笔记、对话、DID）
  ├── logs\          ← 运行日志
  ├── skills\        ← 已安装的 SKILL.md 自定义技能
  ├── plugins\       ← 用户插件
  └── config\        ← 应用配置
```

如果你确认完全清理，手工删除上述目录即可（无法恢复）。

---

## 五、系统要求

| 项 | 最低 | 推荐 |
|---|---|---|
| 操作系统 | Win 10 1809 / macOS 11 / Ubuntu 20.04 | Win 11 / macOS 13+ / Ubuntu 22.04+ |
| CPU | x86-64 双核 | 四核以上 |
| 内存 | 8 GB | 16 GB+ |
| 磁盘 | 5 GB（安装）+ 10 GB（数据增长预留） | 30 GB |
| 显卡 | 集成显卡 | 独立显卡（可选用于本地 LLM 推理） |

### 不支持的环境

- **Windows 7/8.x**：Electron 39 已不支持
- **macOS < 11**：Electron 39 不支持
- **32-bit Windows**：未提供安装包
- **ARM Windows**：未提供专门安装包，可能可用 x64 兼容层运行

---

## 六、相关文档

- [快速开始](/guide/getting-started) — CLI 安装、Docker 后端、配置 LLM
- [桌面版 V6 Chat-First Shell](/guide/desktop-v6-shell) — `/v6-preview` 路径预览
- [系统架构](/guide/architecture) — 整体技术栈说明
- [更新日志](/changelog) — 各版本变更
- [常见问题](/faq) — 综合 FAQ
