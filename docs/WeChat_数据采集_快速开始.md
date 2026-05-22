# 微信数据采集 — 快速开始

> 这份文档讲 **桌面 app 启动后，从哪里点到「添加 WeChat」、需要哪些前置文件、出错怎么反查**。是给真实想用这个功能的 user 看的，**不是给 dev 看的设计文档**。
>
> 想看技术内幕：[`docs/design/Adapter_WeChat_SQLCipher.md`](./design/Adapter_WeChat_SQLCipher.md) + [`docs/design/Personal_Data_Hub_Architecture.md`](./design/Personal_Data_Hub_Architecture.md)
>
> 想做真机 E2E：[`docs/design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](./design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md)

---

## 一、你需要先有什么

| # | 物品 | 为什么 | 不满足会怎样 |
|---|---|---|---|
| 1 | **已 root 的 Android 设备**（Magisk ≥ 25 + Zygisk on + DenyList `com.tencent.mm`） | WeChat 8.0+ 用 SQLCipher，密钥要从内存里 hook 出来；7.x 也得 adb pull `/data/data/com.tencent.mm/` 全目录 | env-probe 报 `suggestedKeyProvider=unsupported` |
| 2 | **frida-server 在手机上跑起来**（仅 WeChat 8.0+ 路径需要） | hook libWCDB.so 的 sqlite3_key_v2 拿密钥 | wizard 第 1 步红色 `frida-server 未运行` |
| 3 | **WeChat 真机数据 adb pull 到本地** | EnMicroMsg.db + `/data/data/com.tencent.mm/` 目录复制到桌面 | wizard 第 2 步填的路径打不开 |
| 4 | **Node.js 22.x LTS**（不要 v23 / v24） | `better-sqlite3-multiple-ciphers` 没 Node 23/24 ABI prebuild | `cc` 命令报 `NODE_MODULE_VERSION 140 vs 127` |
| 5 | **桌面 app v5.0.3.79+ 且 CLI `cc` 0.162.x+ 装好** | wizard 在 web-panel 里、依赖 `cc ui` 起 web-shell | sidebar 按钮点了弹"未发现 web-shell" |

> **不满足 1+2 怎么办**：先去看 [`Adapter_WeChat_SQLCipher_Frida_Setup.md`](./design/Adapter_WeChat_SQLCipher_Frida_Setup.md) §1-§2 — 那是手机端 frida-server 安装的逐步指南。**不要跳过**。

---

## 二、UI 路径（推荐）

### 步骤 1 — 启动 web-shell

打开一个终端，跑：

```bash
cc ui
```

这会启动 web-panel（含 WechatWizard）并在 `~/.chainlesschain/desktop.port` 写一个 JSON 文件，记录 web-shell 的 httpUrl。**这个文件是桌面 app 找 web-shell 的唯一线索**——没有它，桌面 sidebar 上的"个人数据中台"按钮会弹错。

终端会显示类似：
```
✓ web-shell started at http://127.0.0.1:54231
✓ desktop.port written
```

**不要关这个终端**——关了 web-shell 也跟着关。

### 步骤 2 — 启动桌面 app

```bash
cd desktop-app-vue
npm run dev    # 开发模式
```

或者直接双击装好的桌面 app 快捷方式。

桌面 app 默认进 **V6 shell**（也就是预览版的 Claude-Desktop 风格界面，从 v5.0.3.x 起 hard-flip 了）。

### 步骤 3 — 点开「个人数据中台」

桌面 app 左侧栏，找到带数据库图标 🗄️ 的「**个人数据中台**」按钮，点。

会弹一个独立的 BrowserWindow（标题"个人数据中台"），里面就是 web-panel 的 PDH 主页面，列出当前所有 adapter（邮件 / 支付宝 / AI 对话 / 微信 / Mock）。

> **点了没反应 / 弹错怎么办**：看下面的 §四 反查表。

### 步骤 4 — 点「添加 WeChat」

PDH 页面顶部有一排按钮，找到带微信图标的「**添加 WeChat**」，点。

弹出一个 3 步 wizard：

#### Step 1 — 探测环境

USB 接好已 root 的 Android 设备（开 USB 调试），点「🔍 探测环境」。

会显示：
- `suggestedKeyProvider`: `md5` / `frida` / `unsupported`
- `adb 设备`: 已连接 / 未连接 + 序列号
- `root`: 已 root + Magisk 标识
- `frida-server`: 运行中 + 端口
- `WeChat`: 版本号

如果 `suggestedKeyProvider=unsupported` 红色，下面会列具体原因（如 "MMKV-only 存储 — md5 和 frida 都不工作"）—— 这种情况说明设备 / WeChat 版本组合不支持，**回去看 setup runbook**。

绿色就点「下一步」。

#### Step 2 — 填路径

填 3 个字段：

- **UIN / wxid** — 你的 WeChat 数字 UIN 或 wxid（如何拿：在 setup runbook 里有 `adb shell` 命令）
- **dbPath** — 你 `adb pull` 下来的 `EnMicroMsg.db` 在桌面机上的**绝对路径**
- **wechatDataPath** — `/data/data/com.tencent.mm/` 整个目录 pull 下来后在桌面的本地路径
  - **MD5 路径必填**
  - **Frida 路径可空**

最下面有一个「强制 keyProvider」单选，**默认选「自动（推荐）」**，让 env-probe 决定。

填完点「**注册**」。

#### Step 3 — 结果

绿色 ✅ "WeChat 已接入 (uin=...)" + 显示 `chosenKeyProvider`(md5 还是 frida) — **完成**。

红色 ❌ — 看 `reason` + `message`，对照下面 §五 错误码表反查。

### 步骤 5 — 同步数据

注册成功后，回 PDH 主页面，找到 `wechat` 行，点「**立即同步**」（或者在 CLI 里 `cc hub sync-adapter wechat`）。

第一次 ingest 通常 5w 条消息 / 5 分钟。同步完成后：
- 联系人会进 `Person.subtype=contact`
- 消息会进 `Event.subtype=message`
- 群消息会进 `Event.subtype=group_message`

然后你就可以在 PDH 主页面顶部的 **Ask** 输入框里问问题，例如：
- "我和张三去年聊过哪些项目？"
- "最近一周提到「报销」的对话有哪些？"
- "@群名 里讨论度最高的话题是什么？"

回答会带 citation chip 指向具体的 wechat event。

---

## 三、CLI 路径（命令行用户）

不想用 wizard 也行，5 个 CLI 命令做完全一样的事：

```bash
# 一站式诊断（先跑这个，把 readiness 看清楚）
cc hub wechat doctor

# 仅探测环境（等同 wizard step 1）
cc hub wechat env-probe

# 注册（等同 wizard step 2-3）
cc hub wechat register \
  --uin <YOUR_UIN> \
  --db /local/path/to/EnMicroMsg.db \
  --wechat-data-path /local/path/to/com.tencent.mm/

# 列出已注册账号
cc hub wechat list

# 移除（不会删 vault 里的数据，只是停止 sync）
cc hub wechat unregister <YOUR_UIN>

# 拉数据
cc hub sync-adapter wechat
```

所有命令都支持 `--json` 输出便于脚本化。

---

## 四、「我看不到 / 点了没反应」反查表

| 症状 | 真因 | 修法 |
|---|---|---|
| 桌面 sidebar 没有「个人数据中台」按钮 | 你在 V5 shell（旧版） | 跑 `cc config set ui.useV6ShellByDefault true` 或直接访问 `/v6-preview` |
| 点「个人数据中台」弹"**未发现运行中的 web-shell**" | `~/.chainlesschain/desktop.port` 不存在 | 终端跑 `cc ui` 并保持终端开着 |
| 弹出的 BrowserWindow 空白 / 404 | web-panel dist 没构建好 / version mismatch | `cd packages/web-panel && npm run build` |
| Wizard step 1 「探测环境」转圈不结束 | adb 没安装 / 没在 PATH | 装 Android SDK platform-tools，确认 `adb version` 能跑 |
| Wizard step 1 显示「adb 设备: 未连接」 | USB 调试没开 / driver 缺 | 手机：开发者选项 → 开 USB 调试；Win：装 OEM USB driver |
| Wizard step 1 显示「frida-server: 未运行」 | frida-server 没起 / 端口被防火墙挡 | 看 [Frida Setup Runbook](./design/Adapter_WeChat_SQLCipher_Frida_Setup.md) §2 |
| Wizard step 1 显示 `suggestedKeyProvider=unsupported` | WeChat 版本太新（MMKV-only）/ 设备太老 | 看 reasons 里具体说啥；MMKV-only 当前无解 |
| Wizard step 2 点「注册」抛 `MD5_NEEDS_WECHAT_DATA_PATH` | 选了 md5 路径但 `wechatDataPath` 空 | 把 `/data/data/com.tencent.mm/` 整个 adb pull 到本地，填路径 |
| Wizard step 2 抛 `BOOTSTRAP_THREW` | adapter 内部异常（DB 解密 / frida hook 失败） | 看 `message`；常见：dbPath 文件不存在 / UIN 不对 / frida server 在错的端口 |
| `cc` 命令报 `NODE_MODULE_VERSION 140 vs 127` | Node v24 跑 ABI 127 的原生模块 | **切 Node 22 LTS**（22.12 或更新），跑 `npm rebuild` |

---

## 五、错误码对照表

WechatWizard step 3 失败时显示的 `reason`：

| reason | 含义 | 修法 |
|---|---|---|
| `ENV_UNSUPPORTED` | env-probe 判定环境不可用 | 回 step 1 看 reasons |
| `MD5_NEEDS_WECHAT_DATA_PATH` | md5 路径缺 wechatDataPath | 填 step 2 第 3 个字段 |
| `FRIDA_NEEDS_WXID` | frida 路径缺 uin/wxid | 填 step 2 第 1 个字段 |
| `ADAPTER_CTOR_FAILED` | adapter 构造失败（路径错 / 文件缺） | 看 message |
| `BOOTSTRAP_THREW` | bootstrap 编排层抛错 | 看 message；通常是 adb / frida-server 中途挂 |
| `UIN_REQUIRED` | uin 是必填的 | 填 step 2 第 1 个字段 |

---

## 六、相关资源

- **设备端 frida-server 安装** → [`design/Adapter_WeChat_SQLCipher_Frida_Setup.md`](./design/Adapter_WeChat_SQLCipher_Frida_Setup.md)
- **架构内幕** → [`design/Adapter_WeChat_SQLCipher.md`](./design/Adapter_WeChat_SQLCipher.md)
- **PDH 整体设计** → [`design/Personal_Data_Hub_Architecture.md`](./design/Personal_Data_Hub_Architecture.md)
- **真机 E2E 验收**（11 个场景） → [`design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md`](./design/Personal_Data_Hub_Phase_12_9_WeChat_RealDevice_E2E_Runbook.md)
- **其他 adapter 用户文档** → [`design/Personal_Data_Hub_E2E_Runbook.md`](./design/Personal_Data_Hub_E2E_Runbook.md)（邮箱 / 支付宝场景）

---

## 七、安全提醒

WeChat 数据极度敏感（含聊天记录 / 联系人 / 群对话），WechatAdapter 用 **sensitivity=high** 标签。Vault 里所有数据：
- SQLCipher AES-256 加密落盘
- 不上链、不发送到任何远程服务器
- 默认不允许走云端 LLM（你问 Ask 时桌面会拒绝走 Claude / GPT，强制本地 Ollama；除非你 explicit 加 `acceptNonLocal: true`）

`wechat-accounts.json`（记录的是 uin + 路径元信息，**不存任何密钥 / 消息内容**）落在：
- Windows: `%APPDATA%/chainlesschain-desktop-vue/.chainlesschain/hub/wechat-accounts.json` (mode 0o600)
- macOS: `~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/hub/wechat-accounts.json`
- Linux: `~/.config/chainlesschain-desktop-vue/.chainlesschain/hub/wechat-accounts.json`

unregister 只删 `wechat-accounts.json` 里的 row 和 in-memory registry 注册，**vault 里之前同步进来的数据不会动**。要彻底删 wechat 数据：`cc hub query-events --adapter wechat --json | xargs ...` 或者重置整个 vault。
