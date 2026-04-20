# 桌面版 UI 重构用户指南

> 面向最终用户、企业管理员和插件开发者

---

## 文档信息

| 项 | 内容 |
|---|---|
| 文档类型 | 用户指南（User Guide） |
| 适用版本 | v6.0+ |
| 状态 | 草案（随设计文档同步） |
| 最近更新 | 2026-04-20 |
| 关联文档 | `docs/design/桌面版UI重构_设计文档.md` |

---

## 1. 简介

### 1.1 ChainlessChain 桌面版是什么

ChainlessChain 桌面版是一款**以对话为主入口、以去中心化能力为动词、以硬件安全为环境**的个人办公客户端。它把 AI 对话、个人知识、DID 身份、P2P 通讯、钱包交易、文档签名整合到同一个界面中，让你在**不离开对话**的前提下完成一天的工作。

### 1.2 它不是什么

- 它**不是**一个简单的 ChatGPT / Claude 客户端——对话只是壳，后面连着你的私有数据、硬件密钥、去中心化网络。
- 它**不是**企业管理后台——企业能力通过 Profile 叠加得到，默认版本面向个人用户。
- 它**不是** CLI 或 Web 面板的替代——三端分工明确（详见 1.4）。

### 1.3 核心理念

| 理念 | 含义 |
|---|---|
| 对话优先 | 所有任务从对话开始，结果归档为 Artifact |
| 环境级安全 | U-Key / DID / 加密状态常驻，不跳独立页面 |
| 去中心化是动词 | "发消息" 默认 P2P、"存文档" 默认本地 + 可选 IPFS、"签名" 默认硬件 |
| 万物皆插件 | 内置模块与第三方插件同契约，按需启用 / 禁用 |
| 企业定制通过 Profile | 品牌 / 插件 / 策略打包为 `.ccprofile`，一键切换 |

### 1.4 与 CLI / Web 面板的分工

| 场景 | 推荐端 |
|---|---|
| 日常办公主力（写作、沟通、签文档、管钱包） | **桌面版** |
| 脚本 / CI / 服务端自动化 | CLI (`cc`) |
| 远程临时访问 | Web 面板 |

三端共享同一内核（skills、stores、RAG、DID），UI 各走各路。

---

## 2. 相比旧版的主要变化

| 维度 | 旧版（v5.x） | 新版（v6.0+） |
|---|---|---|
| 页面数 | 97 页 / 9 分组 | 3 区壳 + 按需展开 |
| 导航方式 | 多层侧栏 | 对话流 + 左栏（会话 / Spaces / 联系人） |
| 功能查找 | 翻菜单 | `Ctrl+K` 命令面板 + `/` + `@` |
| DID / 钱包 / P2P 入口 | 独立页面 | 对话内联 + Artifact + 状态栏 |
| 安全感知 | 设置页查看 | 状态栏常驻 + 操作位内联 |
| 主题 / 品牌 | 固定 | 可通过 Profile 覆盖 |
| 第三方扩展 | 有限 | 完整插件平台（UI / 能力 / 企业层） |

---

## 3. 新界面速览

```
┌──────────────┬────────────────────────────┬────────────────┐
│  左导航       │  中对话流（主角）            │  右 Artifact    │
│              │                             │  （按需展开）    │
│ + 新会话      │  [DID头像] 你: ...          │                │
│              │  [AI头像] Claude: ...       │  合同签名       │
│ 今日          │    ↳ 调用 /note ...         │  交易哈希       │
│ Spaces ▾     │                             │  知识图谱       │
│  · 工作       │                             │                │
│  · 财务       │  ┌─────────────────────┐    │                │
│  · 社交       │  │ / @ 📎 🔒U-Key ● ▶ │    │                │
│  · 学习       │  └─────────────────────┘    │                │
│ 联系人         │                             │                │
└──────────────┴────────────────────────────┴────────────────┘
 状态栏: U-Key ● · DID did:cc:xxx · P2P 12节点 · Ollama · $0.12
```

### 3.1 三区解释

| 区域 | 作用 |
|---|---|
| **左导航** | 新会话、今日、Spaces、联系人 |
| **中对话流** | 消息列表 + 输入框（唯一的主角） |
| **右 Artifact** | 对话产出的对象，按需展开；生成时自动展开 |

### 3.2 状态栏

底部状态栏常驻显示：

- **U-Key 指示灯**：绿 = 硬件在线；灰 = 软件降级；红 = 缺失
- **DID**：当前身份
- **P2P 节点数**：当前去中心化网络连接数
- **LLM Provider**：本地 Ollama / 云端 Claude / …
- **成本**：本次会话累计 Token 费用
- **租户**（企业版）：当前组织

---

## 4. 新交互模型

### 4.1 会话（Conversation）

- `+ 新会话` 创建对话；每条消息带发送方 DID 头像
- 会话默认归属当前 Space（见 4.2）
- 历史会话按时间分组在左栏

### 4.2 Spaces（个人空间）

Space 是一个带独立 **RAG 知识库 + 提示词 + 联系人圈 + 权限策略 + 默认钱包** 的"身份上下文"。切 Space 即切身份。

**默认四个模板：**

| Space | 用途 |
|---|---|
| 工作 | 项目资料、工作联系人、办公提示词 |
| 财务 | 钱包、合约、交易记录、对账笔记 |
| 社交 | 好友、社区、公开发布 |
| 学习 | 学习笔记、RSS、知识图谱 |

可自建 Space，也可从企业 Profile 获取预置 Space（如"法务"、"财务审批"）。

### 4.3 Artifacts（对话产物）

对话中产生的对象会出现在右栏，按需展开。与其他 AI 产品的 Artifact 不同，ChainlessChain 的 Artifact 是**可签名、可路由、可加密的去中心化对象**。

| 类型 | 何时出现 | 典型动作 |
|---|---|---|
| Note / Doc | AI 生成文档 | 存本地 / 发 IPFS / 共享给 DID |
| Signed Message | 起草声明 | U-Key 签名 / 发布到社区 |
| Transaction | "给 Alice 转 100" | 预览 → U-Key 签 → 广播 |
| P2P Thread | "联系 Bob" | 展开聊天线程 |
| Credential (VC / ZKP) | "证明我 >18 岁" | 生成 ZKP → 发给验证方 |
| Knowledge Graph | "梳理这些笔记" | 可视化 / 回填 RAG |

### 4.4 Slash 命令（`/`）

在输入框键入 `/` 弹出动作面板，汇总了 skills + CLI 命令的常用子集。例如：

| 命令 | 作用 |
|---|---|
| `/note` | 将当前对话摘要保存为笔记 |
| `/sign` | 对选中内容发起硬件签名 |
| `/pay` | 打开转账向导 |
| `/publish` | 将内容发布到 IPFS / 社区 |
| `/cowork` | 启动多智能体协作 |
| `/search-notes` | 在 RAG 中检索 |

第三方插件可通过 `ui.slash` 扩展点注册更多命令。

### 4.5 Mention（`@`）

在输入框键入 `@` 引用对象。常见前缀：

| 前缀 | 含义 |
|---|---|
| `@联系人名` | 引用 DID 联系人 |
| `@笔记-xxx` | 引用 RAG 里的笔记 |
| `@tx-xxx` | 引用一笔交易 |
| `@合约-xxx` | 引用一个智能合约 |

### 4.6 命令面板（`Ctrl+K` / `Cmd+K`）

全局面板，同时搜索：会话、联系人、笔记、skills、设置项、插件页面。是查找一切的统一入口。

---

## 5. 常见使用场景

### 5.1 把笔记整理成周报，签名后发给老板

1. 在"工作" Space 开新会话
2. 拖入笔记文件夹
3. AI 回复，右栏出现 Artifact: 周报 Markdown
4. 点 Artifact 上的"签名"，输入框下方 U-Key 指示灯闪烁 → 硬件按键确认
5. Artifact 升级为 **Signed Doc**
6. 键入 `@老板` 选择 P2P 发送
7. 主流中出现 P2P Thread Artifact，可继续对话

**全程不离开对话，不跳模块。**

### 5.2 查账并转账

1. 在"财务" Space 问："上个月我总共花了多少 ETH？"
2. AI 调用 `/tx-summary`，右栏出现 Artifact: 月度支出报表
3. 追问："给 Alice 退 0.5 ETH"
4. 右栏出现 Transaction Artifact（预览）
5. 点"签名" → U-Key 硬件确认 → 广播
6. Artifact 升级为 **Broadcast TX**，含区块高度链接

### 5.3 用 ZKP 证明身份而不泄露信息

1. 在"社交" Space 问："帮我生成一个年龄 >18 的凭证"
2. AI 调用 `/zkp`，右栏出现 Credential Artifact
3. 键入 `@某平台`，选择发送凭证
4. 对方只得到"已满 18 岁"的证明，不知道你的具体生日

### 5.4 多智能体并行研究

1. 输入框输入 `/cowork`
2. 选模板（如"深度研究"），设定 4 个并行 Agent
3. 右栏出现 Artifact: Cowork 会话，流式显示各 Agent 进度
4. 结束后 Artifact 固化为可归档的研究报告

---

## 6. 企业用户指南

### 6.1 企业 Profile 是什么

Enterprise Profile 是一个 `.ccprofile` 包，包含：

- **品牌**：logo、应用名、配色、登录页
- **插件清单**：启用 / 禁用 / 替换默认插件
- **策略**：DLP 规则、数据保留、审计目标
- **预置 Space**：如"法务"、"财务审批"模板
- **企业 Skill 包**：定制 AI 能力
- **签名**：确保分发完整性

### 6.2 导入 Profile

**方法一：从 URL 导入（小企业试用）**

```
设置 → 企业 → 导入 Profile → 粘贴 URL
```

签名校验通过后应用。

**方法二：MDM 下发（大企业）**

IT 管理员通过 MDM 系统推送 `.ccprofile`；客户端启动时自动加载，用户无法禁用。

**方法三：私有 Registry**

管理员配置私有 Registry URL 后，客户端定期拉取并更新 Profile。

### 6.3 Profile 强制度

| 模式 | 行为 |
|---|---|
| `overlay`（默认） | 覆盖默认值，用户仍可启用公有插件 |
| `exclusive` | 只允许 Profile 内的插件，禁用公有 Marketplace |
| `locked` | 用户无权切 Space、禁用插件、修改主题 |

### 6.4 管理员控制台

企业版内置 `admin-console` 插件：

- 租户 / 组织 / 团队管理
- 插件白 / 黑名单
- 策略编辑器（DLP / 分级 / 保留）
- 审计事件查看 / 导出
- 强制 Profile 切换

---

## 7. 插件开发者指南（概述）

### 7.1 最小可用插件

```jsonc
// plugin.json
{
  "id": "com.acme.my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "vendor": "Acme Corp",
  "permissions": ["llm:query", "storage:write"],
  "contributes": {
    "slash": [
      { "trigger": "hello", "handler": "./hello.js" }
    ]
  }
}
```

放入 `~/.chainlesschain/plugins/` 重启即可。

### 7.2 扩展点一览

**UI 类**：`ui.page`、`ui.menu`、`ui.component`、`ui.space`、`ui.artifact`、`ui.slash`、`ui.mention`、`ui.status-bar`、`ui.home-widget`、`ui.composer-slot`

**能力类**：`ai.function-tool`、`ai.llm-provider`、`ai.skill-pack`、`data.importer`、`data.exporter`、`data.storage`、`data.crypto`、`auth.provider`、`net.transport`、`lifecycle.hook`

**企业 / 品牌类**：`brand.theme`、`brand.identity`、`compliance.audit-sink`、`compliance.policy`、`tenant.scope`

详细接口定义见设计文档 §4.2。

### 7.3 权限声明

插件需在 `permissions` 字段显式声明所需权限；首次调用需用户授权。访问 U-Key 等敏感能力需硬件确认。

### 7.4 三端共用

能力类插件（`ai.*` / `data.*` / `net.*` / `auth.*` / `compliance.*`）可同时在 CLI / Web 面板 / 桌面版运行；UI 类插件仅在支持的端生效。

---

## 8. 常见问题

**Q1：旧版的页面都去哪了？**
A：97 个旧页面在 P0-P5 阶段渐进归并。大部分合并进对话流 + Artifact，少数低频页作为"plugin 内部页"保留（通过 `ui.page` 注册）。

**Q2：没有 U-Key 怎么用？**
A：状态栏显示灰色指示灯，自动降级为软件密钥。所有需硬件签名的操作会显式标记风险等级；企业版可强制禁用降级。

**Q3：我能继续用公有 Marketplace 的插件吗？**
A：默认可以。企业版若将 Profile 强制度设为 `exclusive` 或 `locked` 则不可。

**Q4：桌面版和 Web 面板会合并吗？**
A：不会。两者共享插件内核，但 UI 定位不同——桌面面向日常主力、Web 面向远程轻量。

**Q5：我是个人用户，需要懂 Profile / DID / U-Key 吗？**
A：完全不需要。默认 Profile 即开即用，DID 自动生成，U-Key 缺失时软件降级。

**Q6：我的数据还是在本地吗？**
A：是。默认所有数据 SQLCipher 本地加密；IPFS / 云同步是可选行为，需显式选择。企业 Profile 可能调整默认存储策略。

---

## 9. 术语表

| 术语 | 含义 |
|---|---|
| Space | 带独立 RAG + 提示词 + 联系人圈 + 权限的个人空间 |
| Artifact | 对话产生的可签名 / 可路由 / 可加密对象 |
| Slash | `/` 动作面板 |
| Mention | `@` 对象引用 |
| Profile | 企业可分发定制包（`.ccprofile`） |
| DID | 去中心化身份（W3C 标准） |
| U-Key | 硬件安全密钥（支持 USB / NFC） |
| P2P | 点对点加密通讯 |
| IPFS | 星际文件系统（去中心化存储） |
| ZKP | 零知识证明 |
| VC | 可验证凭证（Verifiable Credential） |
| RAG | 检索增强生成（个人知识库检索） |
| Cowork | ChainlessChain 多智能体协作能力 |
| Ambient Security | "环境级安全"——安全状态常驻界面而非独立页面 |
| First-party Plugin | 官方内置、与第三方同契约的插件 |

---

## 10. 反馈与支持

- 设计文档：`docs/design/桌面版UI重构_设计文档.md`
- 提交建议：通过应用内"反馈"按钮或邮件
- 企业定制咨询：联系 ChainlessChain 企业支持团队
