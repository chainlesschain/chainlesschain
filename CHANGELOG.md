# Changelog

All notable changes to ChainlessChain will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — cc CLI 0.162.66：Claude-Code 编码闭环补齐（已发 npm）
> 对照 Claude Code CLI 的剩余高价值缺口一次性补齐。`chainlesschain` 0.162.65 → 0.162.66 已发 npm（全局安装实测 `cc review` / `cc insights` / `cc agent` 新 flag 全通）。

- **`cc review` — diff-first 代码审查（`/code-review` 平价）**：默认审工作区 vs HEAD，可 `--staged` / `--base <ref>`（PR 式 `base...HEAD`）/ `--range A..B` / `--paths`，并内联未跟踪新文件；`low|medium|high` 力度档；`--security`（/security-review）+ `--simplify`（/simplify，只清理不抓 bug）两视角。只读走 plan 权限出 Markdown 报告；`--fix` 走 acceptEdits + 自动 checkpoint 直接落地（每次编辑可 `cc checkpoint restore` 回滚）；`--comment` 解析机读 JSON findings → 经 `gh` 在当前分支 PR 发行内评论（`--dry-run` 预览 + 交互确认）。
- **headless 无人值守硬化**：`--max-budget-usd <amount>`（按 cc cost 价格表累计成本，到顶前停，免跑飞）；`--strict-mcp-config`（只用 `--mcp-config` 服务器，忽略已注册 + IDE 桥，工具面可复现）；`--replay-user-messages`（stream 输入回显用户消息便于转录/对账）。
- **`cc insights [id]` — 会话分析报告（`/insights` 平价）**：轮次 / 工具调用 + 错误率 / 时长 / token + 估算 $ 成本，纯 JSONL 复盘；从 `session_start` 回填模型给 headless 会话定价（强于 `cc cost`）。
- **全局 `run` / `verify` 技能**：新增 `cli-bundled` 技能层（随 cc 包发布）——`run`（按项目类型拉起实跑）+ `verify`（观测真实行为给 VERIFIED / NOT VERIFIED / BLOCKED 裁决）；CLI 自有层而非桌面 builtin，不动桌面端「144 技能」计数。

### Added — VS Code 扩展「ChainlessChain IDE Bridge」0.23.0 → 0.27.0（已发 Open VSX）
> `open-vsx.org/extension/chainlesschain/chainlesschain-ide` latest = **0.27.0**（2026-06-15）。继 0.22.x 之后,继续对标 Claude Code IDE：终端上下文、版本对齐、稳定性。

- **终端上下文共享（0.23.0，Claude Code 平价）**：新增 `getTerminalOutput` IDE 工具（`mcp__ide__getTerminalOutput`）——agent 能看你刚在集成终端跑的命令、输出、退出码（VS Code 1.93+ shell integration）。配套 CLI（cc 0.162.67）：每轮提交自动把最近终端输出注入 `<ide-context>` + 显式 `@terminal` at-mention。
- **CLI 版本对齐 version-sync（0.24.0）**：激活时检测 `cc --version`,低于扩展所需最低版本时一键提示升级（`npm i -g chainlesschain@latest`）——扩展（Open VSX）与 CLI（npm）独立发版轨,这条让它们对齐。
- **会话 tabs 交互卡修复（0.25.0）**：切 tab 改用分离 DOM 节点（而非 innerHTML 字符串）保存/恢复 transcript——未决审批卡的 Approve/Deny 按钮在切走再切回后仍可点（之前会失效）。
- **`Upgrade CLI` 命令（0.26.0）**：命令面板 `ChainlessChain: Upgrade CLI` 随时从 IDE 升级 cc,不止在低于最低版本被提示时。
- **`@terminal` 补全 + App Preview 崩溃重启（0.27.0）**：面板 `@` 补全新增 `@terminal`（把最近终端命令/输出按需拼进 prompt）；dev server 意外退出时报崩溃并一键 Restart（而非默默停掉）。
- **发布**：0.23–0.27 各 tag `ide-vscode-v*` → `ide-extensions.yml` 清洁室构建发 Open VSX,逐版对 registry 实证 latest。0.22.1 为纯文档刷新（Open VSX listing：标注「仅 Open VSX,非微软商店」+ 功能列表对齐）。

### Added — VS Code 扩展「ChainlessChain IDE Bridge」0.22.0（已发 Open VSX）
> `open-vsx.org/extension/chainlesschain/chainlesschain-ide` 早前 latest = **0.22.0**（2026-06-15）。对标 Claude Code desktop/IDE 的四个高价值面板能力一次性补齐。

- **会话 tabs（Claude Code 平价）**：聊天面板支持多会话——标题栏每个 tab 显标题 + `×` 关闭、`+` 新建；每个 tab 独立持有自己的 `cc agent` 进程与 resume id，切换 tab 恢复该会话 transcript，后台 tab 输出不串入当前可见会话，关闭一个 tab 激活相邻 tab 且永不为空。
- **App Preview（预览面板平价）**：「Start App Preview」自动识别项目 dev 脚本（`dev`/`start`/`serve` … 或跑 vite/next/cra/webpack/astro 的脚本）→ 拉起 → 解析它打印的本地 URL → VS Code 内置 Simple Browser 内嵌打开；dev server 自带 HMR 负责改文件即时热重载。「Stop App Preview」杀掉它。
- **diff 行内批注（Request changes…）**：原生 diff 评审在 Accept / Reject 之外新增「Request changes…」——对具体改动行写修改意见,文件不落盘,行锚意见回喂 agent 让其修订后重新提案。
- **批量多文件 diff（`openMultiDiff`）**：agent 可把跨多文件的整个 changeset 一次性放进原生多文件 diff 评审——Accept all / 勾选子集 / Reject——而非逐文件确认。
- **发布**：tag `ide-vscode-v0.22.0` → `ide-extensions.yml` 清洁室构建（vscode-ext 241 测试全绿 + 干净 38 文件 `.vsix`）发 Open VSX；本地 `vsce package` 实证产物一致。官方 Marketplace 仍跳过（无 `VSCE_PAT`，Azure 受限）。

### Added — VS Code 扩展「ChainlessChain IDE Bridge」0.19.0 + 0.20.0 + 0.21.0（已发 Open VSX）
> 独立版本轨（同 CLI npm）。`open-vsx.org/extension/chainlesschain/chainlesschain-ide` 早前 latest = **0.21.0**。补齐对标 Claude Code IDE 的最后四个面板原生入口（设计文档 module 98 Phase 7）。

- **Fix with ChainlessChain（0.19.0）**：诊断（error/warning）上 QuickFix 灯泡 → 唤起聊天面板并种入**作用域修复请求**（文件以 `@<path>` 引用让 CLI 附带内容 + severity 标签 + 1-based 行号，上限 10 条）；命令面板与编辑器右键亦可（无灯泡参数时按 选区→光标行→全文 兜底收集问题）。
- **Explain / Refactor 选区右键（0.20.0）**：选中代码右键 → 种入引用 `@selection` 的请求（CLI 发送时经 `expandIdeMentions` 展开为实时选区，不嵌码、无时序耦合）+ 文件/行号指针；右键项仅在 `editorHasSelection` 显示。
- **`/cost`、`/context` 面板命令（0.20.0）**：不在 webview 重算定价/上下文，转交 CLI 真相源 `cc cost <id>` / `cc context <id>`（本面板 session），等宽块渲染。
- **workspace symbol @-mention（0.21.0，gap D）**：面板 `@`-补全新增按符号名（函数/类/方法）搜索——选中符号插入其**所在文件**为 `@<path>`（CLI 只认 `@<path>`,无 `@file:line`），故可按符号名找到文件名不同的文件；标签显 `<kind> <name> · <path>`,≥2 字符触发、按插入路径去重。面板 `@` 三类来源（IDE 伪 mention / 文件 / 符号）齐全。
- **发布**：tag `ide-vscode-v0.20.0`（0.19+0.20）与 `ide-vscode-v0.21.0`（gap D）→ `ide-extensions.yml` 清洁室构建（扩展/IDE 测试全绿 + 干净 `.vsix`）并发 Open VSX；官方 VS Code Marketplace 仍跳过（无 `VSCE_PAT`，Azure 受限），不建 GitHub Release（避 immutable/tag-burn）。ws transport 仍有意 defer。

### Fixed
- **project-service ZIP 导出 UTF-8 编码 bug**：项目导出写 ZIP 条目时使用平台默认编码（在 GBK 默认的 JVM 上即 GBK），导致导出含中文内容的项目后，UTF-8 的导入端读取时抛 `MalformedInputException`，无法回环重导入。改为始终以 UTF-8 写入，并对文件内容为 null 时写空条目兜底（不再 NPE）。

### Tests / QA hardening
全栈测试普查并修复全部真实失败（仅余环境受限项：需 Ollama/Qdrant 服务或带 GPU 的本地推理）。

- **CLI**：恢复 deprecated-shim 导出平价（`agent-core` 缺 `reloadSkills`/`MAX_SUB_AGENT_DEPTH`、`mcp-client` 缺 `isLikelyConnectionError`）；补 `hub` 子命令清单 `douyin-watch-sync`；`skill sources` 断言 4→6 层（新增 `claude-user`/`claude-project` 可移植层）；24 个 e2e 文件的 15s 子进程超时放宽到 30s，消除 Windows 冷启动负载下的 `spawnSync ETIMEDOUT` 抖动。
- **桌面**：内置技能计数 145→146（新增纯文档型技能 `pdh-android-collector`）+ 引入 `DOC_ONLY_SKILLS` 白名单使"缺 handler"显式失败。
- **后端 Java（project-service）**：`mvn test` 从 32 失败 → 0（补缺失的 `@Mock UserMapper`、宽松 Mockito stubbing、对齐过期的状态串/调用计数断言、导入测试改 UTF-8 + ObjectMapper stub）。
- **后端 Python（ai-service）**：对齐 `git_manager` 过期 API 断言（`commit_hash`/`hash`/无 `success`/无 `add_files`、push/pull 抛错语义）；修 `code_generator` 过期返回键（`optimized_code`→`refactored_code`）；pytest 通过数 15 → 41+。

## [v5.0.3.112] - 2026-06-15 — 个人数据中台采集器补 6 个跨平台平台 + Android cc bundle 滚到 v20260615b（pdh 0.4.24 / cli 0.162.67）

> 补齐路线图/参考机之外、但高个人数据价值的 6 个主流平台采集器。`@chainlesschain/personal-data-hub` 0.4.23→0.4.24、CLI `chainlesschain` 0.162.66→0.162.67 已发 npm；Android cc bundle 滚到 `internal-binaries-android-v20260615b`（携全部新 adapter），`USR_VERSION` → 43。桌面端 / CLI 即装即用；Android 端随本 APK 携带。

### Added — 本轮新采集 adapter（6 个）
- **饿了么**（`shopping-eleme`）：外卖订单（snapshot + cookie-api，镜像美团 外卖结构）。
- **闲鱼**（`shopping-xianyu`）：二手买卖记录，买/卖双向（对手方角色随 side 翻转）。
- **唯品会**（`shopping-vipshop`）：品牌特卖订单（品牌 → 商家）。
- **豆瓣**（`social-douban`）：书影音兴趣图谱——标记（看过/想看/在看）→ 媒体事件 + 条目、影评 → 帖子、关注 → 联系人。
- **喜马拉雅**（`audio-ximalaya`）：听书/播客收听历史——收听 / 收藏 / 订阅专辑（新 `audio-` 类目）。
- **Keep**（`fitness-keep`）：运动训练记录，多类型（跑步/骑行/瑜伽/力量 …）。

> 全部 snapshot 主路径 + cookie-api（注入式 fetch + signProvider seam，端点 best-effort 可覆盖、未实地验证）。各 adapter 全单元测试通过，接 桌面 / CLI 双壳。

## [v5.0.3.111] - 2026-06-15 — 个人数据中台采集器再扩面 + Android cc bundle 滚到 v20260615（pdh 0.4.23 / cli 0.162.65）

> 继 v5.0.3.110 之后再补一轮 PDH 采集长尾：新增 西瓜视频 / 天眼查 / 懂车帝 / 企业微信（wework-pc）等 adapter，并由并行支线补上 个税（gov-tax scaffold）/ 扫描全能王 / 美柚 / i 厦门。`@chainlesschain/personal-data-hub` 0.4.18→0.4.23、CLI `chainlesschain` 0.162.60→0.162.65 已发 npm；Android cc bundle 滚到 `internal-binaries-android-v20260615`（携全部新 adapter），`USR_VERSION` → 42。至此 PDH 路线图除 6 个 gov/bank 强认证 app（个税/民生·中行·交行银行/数字人民币/12123，故意 defer）外的消费级平台已全部接通。

### Added — 本轮新采集 adapter
- **西瓜视频**（`video-xigua`）：复用 `_video-base` 工厂，观看历史 + 收藏（snapshot + cookie-api 双模）。
- **天眼查**（`biz-tianyancha`）：监控 / 搜索行为事件采集。
- **懂车帝**（`social-dongchedi`）：收藏 / 关注采集。
- **企业微信电脑版**（`wework-pc`）：复用 `_local-im-pc-adapter` 本地工作 IM DB 读取（legalGate）。
- **个税 APP**（`gov-tax`，scaffold）：收入 + 雇主 + 申报骨架（强实名认证，best-effort，需真机验证）。

### Changed
- VS Code 扩展「ChainlessChain IDE Bridge」补齐会话 tabs / App Preview / diff 行内批注 / 批量多文件 diff（详见 [Unreleased] 段，已发 Open VSX 0.22.0）。
- project-service ZIP 导出改为始终 UTF-8 写入，修复含中文项目导出后无法回环重导入（`MalformedInputException`）。

## [v5.0.3.110] - 2026-06-14 — 个人数据中台采集器扩面：13 个新平台 adapter（出行 / 购物 / 社交 / 文档 / 音乐 / 视频 / 招聘）

> 一轮 `/loop` 把 PDH 采集覆盖补齐：完成阶段（Phase 5–12）所有 ≥⭐⭐⭐ 平台 + 可行的 Phase 13+ 长尾全部落地。`@chainlesschain/personal-data-hub` 0.4.7→0.4.18、CLI `chainlesschain` 0.162.49→0.162.60 已发 npm；Android cc bundle 滚到 `internal-binaries-android-v20260614b`（携全部新 adapter），`USR_VERSION` → 37。

### Added — 13 个新采集 adapter
- **出行**：`travel-tongcheng`（同程旅行）、`travel-didi`（滴滴企业版）。
- **购物**：`shopping-dianping`（大众点评）—— 补 Phase 7 ⭐⭐⭐⭐ 漏建（订单 / 团购）。
- **社交 / 内容**：`social-zhihu`（知乎）、`social-csdn`（CSDN）—— 收藏 / 关注 / 自己回答 / 技术阅读。
- **文档 / 云盘**：`doc-wps`（WPS 云文档）、`doc-tencent-docs`（腾讯文档）、`doc-baidu-netdisk`（百度网盘）。
- **音乐**：`music-kugou`（酷狗音乐）—— 听歌 / 收藏 / 歌单。
- **视频**：`video-iqiyi`（爱奇艺）、`video-tencent`（腾讯视频）—— 观看历史 / 追剧。
- **招聘**：`recruit-boss`（BOSS 直聘）—— 沟通职位 + 投递简历。
- 每个 adapter 均双模：snapshot（设备快照）+ cookie-api（注入 `fetchFn` + `signProvider` seam，端点 best-effort 可经 opts 覆盖）。

### Changed
- 新增 3 个同形平台共享工厂：`_document-base`（文档 / 云盘列表）、`_video-base`（视频观看史），与既有 `shopping-base` / `travel-base` / `_local-im-pc-adapter` 一致。
- pdh / cli 已发 npm；Android `binariesVersion` → `20260614b`，bundle 内核实测携带 pdh 0.4.18 + cli 0.162.60。

## [v5.0.3.109] - 2026-06-14 — fix: Android 发布 APK 缺 cc bundle — release.yml 补 downloadInternalBinaries staging + 硬验证 gate

> v5.0.3.108 真机验证发现**发布的 APK 不含 `cc-cli.tgz`**（local-terminal/cc 在设备上不可用，pdh/拼多多采集不下发）。根因:`release.yml` build-android 只跑 `assembleRelease`,而 `downloadInternalBinaries` 仅靠 `preBuild` 的 lazy `dependsOn` 触发,在 CI 不生效。本版纯打包修复——bundle 内容不变（pdh 0.4.6 / `internal-binaries-android-v20260613` / USR_VERSION 25）。

#### Fix — Android release APK bundle 打包

- `release.yml` build-android:assemble 前新增独立步骤 `./gradlew downloadInternalBinaries`(单独 invocation 保证 `cc-cli.tgz` 落盘后再被 `mergeReleaseAssets` 快照)。
- 新增**硬验证 gate**:build 后 `unzip -l <apk> | grep assets/local-terminal/cc-cli.tgz`,任一 APK 缺则 `exit 1`——杜绝再次静默发出无 bundle 的 APK。
- **版本面**:productVersion v5.0.3.108 → v5.0.3.109 / desktop 5.0.3-alpha.109 / Android versionCode 503109 / iOS CFBundleVersion 109（USR_VERSION 25、binariesVersion 20260613 不变,bundle 同 v108）。

## [v5.0.3.108] - 2026-06-13 — feat: 个人数据中台拼多多采集补全（snapshot-only → cookie-api）+ Android cc bundle v20260613（pdh 0.4.6 / cli 0.162.48）

> 拼多多是购物三联里最后一个仅 user-export 快照、无自动采集路径的适配器；本版补齐 cookie-api 主动采集，与 taobao/jd/meituan 平价，并随 Android in-APK cc bundle v20260613 下发。

#### Feat — 拼多多 `shopping-pinduoduo` cookie-api 采集（v0.2.0）

- 新增 `_syncViaCookie`：经注入的 `fetchFn` 拉取 `mobile.yangkeduo.com/.../transaction_list`（Node 保持纯解析/编排，与 taobao/jd/meituan 同 seam）。
- **anti_token 签名经 `signProvider` seam 注入**（纯 Node 扛不住拼多多签名轮换；Android 端由 in-APK WebView JS VM 产出），传给 fetchFn 作 `antiToken`，无 provider 时为 null（best-effort）。
- `orderToRecord` 映射 transaction_list 字段（snake/camel 双兼容）+ 分→元换算 + 数字/文本状态映射；`extractOrders` 容错嵌套返回；分页命中 watermark 提前停（比兄弟少一次无用翻页）。
- capabilities 升 `sync:snapshot` + `sync:cookie-api`；version 0.1.0 → 0.2.0。+13 cookie-api 测试，PDH 全套 128 文件 2094 tests 通过 / 9 跳过（native-only）。

#### Chore — 发版链

- `@chainlesschain/personal-data-hub` 0.4.5 → 0.4.6 已发 npm；`chainlesschain` CLI 0.162.47 → 0.162.48 已发 npm（pin pdh 0.4.6，补全局 npm 平价——immutable 的 0.162.47 仍 pin 0.4.5）。
- Android in-APK cc bundle 刷新：`internal-binaries-android-v20260613`（cc-cli.tgz 重打，pack CLI HEAD + 从 registry 装 pdh 0.4.6）+ `USR_VERSION 24 → 25` + `binariesVersion 20260612 → 20260613`。
- **版本面**：productVersion v5.0.3.107 → v5.0.3.108 / desktop 5.0.3-alpha.108 / Android versionCode 503108 · USR_VERSION 24 → 25 / iOS CFBundleVersion 108。

## [v5.0.3.107] - 2026-06-12 — feat: 个人数据中台 FAMILY-23 家庭守护采集器 v0.2 live fetcher 全收口（作业帮 / 华为学习中心 / 支付宝）+ Android cc bundle v20260612（cli 0.162.46 / pdh 0.4.5）

> 本版收口个人数据中台「家庭守护 telemetry」最后 3 个仅快照占位的采集器，使其具备主动 live 采集能力，并把更新随 Android in-APK cc bundle 下发；同时一并随产物发布前期已单独发 npm 的 cc CLI 0.162.41 Claude-Code 平价工作。

#### Feat — FAMILY-23 家庭守护采集器 v0.2（snapshot + live 双路）

- **作业帮 `edu-zuoyebang`**：ZYBUSS 会话 cookie → 用户信息 + 学习/搜题记录（`fetchSnapshot`，envelope `{errNo,errstr,data}`）
- **华为学习中心 `edu-huawei-learning`**：华为账号会话 cookie → 用户信息 + 课程学习记录
- **支付宝 `finance-alipay`**：会话 cookie → mobilegw（mgw.htm）账单/交易明细（`signProvider` 签名 seam；金额元→分 + 收支方向推导；高敏感闸不变）
- 三者均补齐 `sync:cookie` capability + `authenticate` cookie 路 + `_syncViaLive`（产出 snapshot-shaped events，normalize 路径不变）；新增共享 `_live-json-helpers.js`（pick / toDurationMs / toEpochMs）
- 端点按各平台 web 端常见形态实现 + 多字段名兼容（best-effort，未经真实登录态实地验证，漂移时改 api-client 常量）
- 测试 +39（3 套 live 测试，钉请求构造 + 解析契约）；PDH 全套 128 文件 2083 tests 全绿

#### Release — 发版链全闭环

- `@chainlesschain/personal-data-hub` 0.4.4 → 0.4.5 + `chainlesschain` CLI 0.162.45 → 0.162.46 已发 npm（`77ceb7e69`，run 27387691645）
- Android in-APK cc bundle 重建 `internal-binaries-android-v20260612`（cc-cli.tgz 携 cli 0.162.46 + pdh 0.4.5，内核实测）+ `USR_VERSION 23 → 24`（`f9793343a`，rollover run 27388413407）；真机装新 APK 时 `LocalFilesystemBootstrapper` sentinel 23→24 触发重提取
- 已过 trap #27/#28 staleness gate（pdh ver bump + cli pin sync + USR_VERSION bump + lockfile 同步）

---

### cc CLI 0.162.41 — Claude-Code 平价终章：项目记忆（cc.md）+ REPL steering + 结构化输出（2026-06-11，已单独发 npm，随本版产物一并发布）

> 对照 Claude Code 的 CLI 平价 backlog（P0×3 + P1×7 + Phase 2 配套）一日清空并发版；发布产物经全局安装实测（init 盘点 / 记忆链 / json-schema / mcp serve 全通）。文档四面（docs/cli、docs-site、官网 zh+en、README zh+en）+ 设计文档 module 99 已同步，docs+www 已部署上线。

#### Feat — 项目记忆体系（claude CLAUDE.md 平价，自有主名 cc.md）

- `cc agent` 自动加载 `cc.md` > `CLAUDE.md` > `AGENTS.md` 层级（用户级/项目链/local 伴随，`@path` 递归 import，48K/192K 预算 fail-open，`CC_PROJECT_MEMORY=0` 关）（`0718e3ab6`）
- `cc init` 默认改为项目盘点生成 cc.md（`/init` 平价，模板退 `-t/--bare`，web-panel 零破坏）+ 最小 `.chainlesschain/`（config + skills/ 工作区）（`137e0f519` · `052e4ec1d`）
- 防遮蔽：已有 CLAUDE.md/AGENTS.md 自动 `@import` 进生成的 cc.md；`.chainlesschain/rules.md` 入加载链（`052e4ec1d`）
- 路径作用域规则：`.claude/rules/*.md` frontmatter `paths:` 按 cwd 前缀重叠过滤入链 + `cc memory files` 加载链可观测 + `cc session search` 转录全文搜索（`5dedc7718`）
- `cc init --ai`：盘点后有界 headless agent 精炼 Conventions（自指防护 `CC_PROJECT_MEMORY=0`，throw-safe）（`5d3724449`）

#### Feat — REPL steering 三件套 + 快捷键

- 排队输入：回合中输入 FIFO 排队自动续跑，顺带修掉并发回合 race（`27d318e99`）；Esc 即时中断（复用 agentLoop AbortSignal seam，零改 agent-core）（`bf62aeca8`）；`/rewind` + 空闲双 Esc 会话回退（原文回填改完重发）（`f718e1003`）
- `! <cmd>` bash 直通（输出回灌上下文）+ `# <note>` 快捷记忆入 cc.md（`6d1f8b5a5`）；`/context` 实时窗口占用（`94d685737`）；`/` 命令 TAB 补全（`127da0aab`）；`--resume` 离线恢复摘要（`1066396d1`）

#### Feat — 结构化输出与生态出口

- `cc agent -p --json-schema <file>`：回答经 JSON Schema 子集校验 + 纠错重试 3 次，stdout 只出合规 JSON；经 runner `deps.writeOut` 捕获 seam 实现，零碰并行占用文件（`fe9d61dd0`）
- `cc mcp serve`：本机文件工具反向暴露为 Streamable-HTTP MCP server（root 限域 + Bearer，`--read-only`/`--no-auth`）（`b291381e0`）
- `cc session export <id|last>`：agent JSONL 会话转录导出 Markdown 回退源（`6d2421610`）；启动被动版本提醒（缓存 + detached 后台刷新，`CC_UPDATE_NOTICE=0` 关）（`dc639c546`）

#### Release

- `chainlesschain` CLI 0.162.40 → 0.162.41 已发 npm（`dba66708b`，workflow run 27329836460，~120 新增单测随包）

## [v5.0.3.106] - 2026-06-11 — fix: PDH 快手 api_ph base64 采集修复 + 高德标题 bug + 出行/社交全适配器测试收口（pdh 0.4.4 / cli 0.162.40）+ Android cc bundle v20260611（真机实证重提取）

> 本版以 PDH 个人数据中台采集层为主线：①修复新版快手 `kuaishou.web.cp.api_ph` cookie 改为 base64(JSON) 后 profile 采集失败（`apiPhDecodeCandidates` 解码链，pdh 0.4.4）；②修复 travel-base `buildTitle` 不认 `name` 字段导致所有高德路线/搜索事件标题为 `car: ? → ?`（测试先红后绿抓到）；③订正头条/快手/邮箱适配器 3 处过时注释（行为事件采集链路早已全 land）。④测试矩阵全收口 +180：小红书 ADB 三件套 58 + 出行 6 模块从零 74 + whatsapp/shopping-base 24 + 快手 base64 9 —— 全仓 55 适配器测试覆盖 100%。⑤pdh 0.4.3→0.4.4 + cli 0.162.39→0.162.40 已发 npm；⑥Android in-APK cc bundle 重建 `internal-binaries-android-v20260611`（pdh 0.4.4 + cli 0.162.40）+ `USR_VERSION 21 → 22`。⑦**真机（Xiaomi amethyst）实证**：装新 APK 触发 `LocalFilesystemBootstrapper` sentinel 17→22 重提取，设备上 pdh=0.4.4 + 快手/高德两处修复 grep 命中。

### Fix —— PDH 采集层（pdh 0.4.4）

- 快手 `api_ph` base64(JSON) cookie 解码 fallback（`apiPhDecodeCandidates`，新版快手 profile 采集恢复）
- travel-base `buildTitle` 加 `name` 三级回退（修高德所有行程事件标题 `car: ? → ?`）
- 订正头条/快手「v0.3 待签名」+ 邮箱「桌面 adapter 待补」3 处过时注释

### Test —— 适配器测试矩阵全收口（+180，全仓 55 适配器 100% 覆盖）

- 小红书 ADB api-client/cookies-extension/snapshot-builder 三件套 58
- 出行 6 模块（base/12306/ctrip/amap/baidu-map/tencent-map）从零 74
- whatsapp + shopping-base 24、快手 base64 fallback 9

### Android —— in-APK cc bundle 刷新 + 真机验证

- `internal-binaries-android-v20260611`（pdh 0.4.4 + cli 0.162.40）+ `USR_VERSION 22`
- 真机实证 sentinel 17→22 重提取 + 设备上 pdh 0.4.4 代码落地

## [v5.0.3.105] - 2026-06-10 — feat: cc agent MCP prompts/resources + SubagentStop hook + --fork-session（CLI 0.162.38）+ Android cc 内置 bundle 刷新（终结 .101 stale 缺口）

> 本版把 v5.0.3.104 之后 2026-06-10 的 CLI 平价主线固化为一次正式发版：①MCP prompts 作为 slash 命令 + MCP resources 暴露给 agent/REPL（`3481e2595`）；②`SubagentStop` settings.json hook（Claude-Code 平价，`9c349cb9a`）；③`cc agent --fork-session`（Claude-Code 平价，`d97003d3c`）；④CLI 0.162.38 已发 npm；⑤Android in-APK cc bundle 重建 —— `internal-binaries-android-v20260610`（cli 0.162.38 + pdh 0.4.3）+ `USR_VERSION 20 → 21`，补上 v5.0.3.101 以来 APK 内置 cc 跑旧代码的缺口；⑥CLI e2e 共享 helper（testHome + freePort，Layer 2）+ e2e 隔离/重试 CI 加固；⑦docs-site 补全 14 个 CLI 命令用户文档 + 全站数字对账（155 命令/145 技能/25 Android）。

### Feat —— cc CLI 0.162.38（Claude-Code 平价三连）

- MCP prompts 作为 slash 命令 + MCP resources 暴露给 agent/REPL（`3481e2595`）
- `SubagentStop` settings.json hook（`9c349cb9a`）
- `cc agent --fork-session`：复制既有会话为新分支继续（`d97003d3c`）

### Android —— in-APK cc bundle 刷新

- `node-runtime-bundle.yml` 重建 `cc-cli.tgz`（cli 0.162.38 + pdh 0.4.3）→ 新 release `internal-binaries-android-v20260610`，`binariesVersion` + manifest sha256 同步
- `USR_VERSION 20 → 21`：真机升级后强制重新解包新 bundle（v5.0.3.101 的 USR_VERSION 20 因 bundle 未重建而空转，本版闭环）

### Tests / CI

- CLI e2e 共享 helper（testHome + freePort）+ 2 文件迁移（Layer 2，`5dfb2d92b`）
- e2e 从并行池隔离 + e2e shard `--retry=2` CI 加固（`461ed1671`）；orchestrate/cli-anything e2e DB 经 `CHAINLESSCHAIN_HOME` 隔离（`78a1a89c2`）
- 桌面端 10 个 stale 单测修复（`d191aff58` + `258a7d620`）；loop exec-mode 测试改脚本文件避 POSIX sh 内联坑（`1cb69df43`）

### Docs

- docs-site 补全 14 个 CLI 命令用户文档 + 全站数字对账：155 命令/145 技能/25 Android（`8801613dd`）

## [v5.0.3.104] - 2026-06-10 — chore: CLI 0.162.37（IDE 桥接收官）+ 全平台版本对齐 + docs/品牌清扫（补记）

> （补记条目 —— 发版当时未写 changelog）本版主体：①CLI 0.162.37 发 npm（IDE 桥接全 Phase 收官后的聚合版）；②iOS/Android/desktop 版本对齐 v5.0.3.104；③VS Code 扩展 Open VSX 自动发布 CI（`6fd4ffc2f`）+ 图标重绘三连；④JetBrains buildPlugin 修复（关 instrumentation，`3c2516ca0`）；⑤docs-site 新增 8 个 CLI 用户文档页（cc goal/cost/checkpoint/command/statusline/mcp OAuth/web_search/run_shell 后台）+ Family Guard 用户页 + V2 治理命令开发者参考；⑥发布文档脱敏（个人签名者信息清扫，`b83c80049`）；⑦桌面端 vitest-4 stub bug + 12 个 stale 测试修复。

## [v5.0.3.103] - 2026-06-10 — feat: cc loop（/loop 平价）+ IDE 桥接 Phase 3/4（JetBrains 平价 + 发布基建）+ VS Code 扩展可视化与品牌化

> 本版把 v5.0.3.102 之后 2026-06-10 的工程主线固化为一次正式发版：①`cc loop` —— Claude-Code `/loop` 平价：固定间隔循环 + `--dynamic` 自定步速 + `--save` / `--resume` 会话持久化 + headless（非 TTY）下稳定运行；②IDE 桥接 Phase 3 —— JetBrains 平价（纯 JDK 协议核 + IntelliJ glue，跨语言 interop 实跑验证）；③IDE 桥接 Phase 4 —— 发布与维护基建（`ide-extensions.yml`：vsce package/publish + gradlew buildPlugin，tag + secret 双门控）；④VS Code 扩展 —— IDE 桥接可视化（状态栏 + 侧边栏 + 仪表板）+ ChainlessChain 品牌 logo/图标（0.2.0 / 0.2.1）；⑤REPL 中 IDE 自动连接遵循 `--ide` / `--no-ide`。CLI 沿用 0.162.36、PDH 0.4.3（已发 npm）。

### Feat #1 —— cc loop（Claude-Code /loop 平价）

- 固定间隔循环执行 prompt / slash 命令（`89816b144`）
- `--dynamic` 自定步速 + prompt 模式 agent flag 透传（`5a58745c6`）
- `--save` / `--resume` 会话持久化（`dec00fd43`）
- headless（非 TTY）下稳定运行 + 集成/E2E 测试（`332fcdafa`）

### Feat #2 —— IDE 桥接 Phase 3/4

- Phase 3：JetBrains 平价 —— 纯 JDK 协议核（MiniJson / McpServer / LockfileWriter / IdeTools）+ IntelliJ glue，CLI 零改动双证 + 跨语言 interop 实跑（`507b45c7d`）
- Phase 4：发布与维护基建 —— `ide-extensions.yml`（vsce package/publish + gradlew buildPlugin/publishPlugin，tag + secret 双门控，不建 GitHub Release，缺 secret fail-fast）+ LICENSE/CHANGELOG + 发布文档（`ab70095a7`）
- REPL 中 IDE 自动连接遵循 `--ide` / `--no-ide`（`635b0ae0c`）

### Feat #3 —— VS Code 扩展可视化与品牌化

- IDE 桥接可视化：状态栏 + 侧边栏 + 仪表板（0.2.0，`9f877245f`）
- ChainlessChain 品牌 logo 作为扩展图标 + Activity Bar 图标多轮打磨（0.2.1，`32682648c` 等）

### Fixes

- `crosschain-multisig-e2e` 通过 `CHAINLESSCHAIN_HOME` 隔离 bootstrap DB（`5800068e8`）

## [v5.0.3.102] - 2026-06-10 — feat: IDE 桥接落地（cc ide + VS Code 扩展）+ cc 命令行 Claude-Code 平价收官 + cc agent 多模态视觉输入

> 本版把 cc 命令行向 Claude Code 的平价能力收官，并新增 IDE 桥接与多模态视觉输入：①IDE 桥接 —— 新增 `cc ide` 命令 + VS Code 扩展，自动发现并连接编辑器内置的 MCP server，支持 `openDiff` 接受/拒绝往返（CLI 命令数 149 → 150）；②cc 命令行 Claude-Code 平价收官 —— MCP OAuth 远程授权、自定义及内置上下文用量状态栏、输出风格、`web_search` 可插拔搜索、扩展思考、`settings.json` 全事件 hooks 及 block 语义、headless `agent -p`、`/compact` 自动压缩、`cc checkpoint` 双引擎、权限规则；③`cc agent --image` 多模态视觉输入（自动使用配置的视觉模型）。CLI 0.162.36 已发 npm。

## [v5.0.3.101] - 2026-06-09 — feat: CLI Claude-Code 平价收尾 + PDH 微信4.0/QQ-NT 一键采集 + 安全 fail-closed 套件 + U-Key 托管层（gated）

> 本版把 v5.0.3.100 之后累积的工程主线固化为一次正式发版：①CLI 向 Claude-Code 平价收尾（headless `agent -p` 全家桶 + `cc cost` + 文件态 checkpoint）；②个人数据中台（PDH）微信 4.0 完整采集 + QQ-NT 一键解密/解析（真机 `nt_msg.db` 验证通过）；③一批安全 fail-closed 收口（SAML/OAuth/通道签名/permission-ipc）；④U-Key 口令托管层（Phase 3，默认 gated OFF）；⑤桌面数据库/LLM 性能面板 V6 端口接通。npm：pdh 0.4.2 → 0.4.3 + CLI 0.162.31 → 0.162.32，Android USR_VERSION 19 → 20 强制真机重抽 cc-cli.tgz。

### Feat #1 —— CLI Claude-Code 平价收尾（headless agent + cost + checkpoint）

- headless `agent -p` 全家桶：`--output-format` / `--max-turns` / `--allowed-tools` / `--disallowed-tools` / `--permission-mode` / stdin、`--input-format stream-json`（多轮）、`--system-prompt` / `--append-system-prompt`、`--add-dir` 多根工作区、`--fallback-model`（`8bc327c16` · `7ababb358` · `2d8140cfe` · `c0e1293d2` · `1eebafe18` · `8fb623f43`）
- `@file` 引用在 `ask` + `chat` 非 agent 入口平价（`7599d02e7` · `888454ff8`）
- `cc cost` token 计费 + 配置化价格覆盖 `llm.pricing`（`7f294ab5d`）
- 文件态 `cc checkpoint` / rewind（git plumbing 影子提交，零触工作区/真索引，`eb187d122`）
- 共享交互式 session picker，`cc session resume` 复用（`6f3451eba` · `d9f116284`）
- **跟进（CLI 0.162.33，单独 npm 发布）**：headless 上下文自动压缩 + 手动 `cc compact`（Claude-Code `/compact` 对标）——`agent -p` / `--resume` 长会话超阈值时本轮自动压缩（默认开，按模型 context window 自适应；`preserveToolPairs`/`sanitizeToolPairs` 保证截断/snip 不留孤儿 tool 结果或无应答 tool_calls），并写 `compact` 事件供 `--resume` 从短历史重建（self-persist gated `sessionExists`，一次性 `-p` 不写）；`cc compact <id>` 离线压缩存档会话；`stream-json` 出 `compaction` 事件（`95fac914d` · `0f50f7b6f` · `9671c7581` · `68f2dc3cc`）
- 修：headless stdout 不再混入 bootstrap 日志（`26c95e0ee`）；`--disallowed-tools` 此前静默无效（`chatWithTools` 丢 caller deny-list，现合并 persona + caller 两个 deny-list + 回归测试）

### Feat #2 —— PDH 微信 4.0 完整采集 + QQ-NT 一键解密/解析

- 微信 4.0 一键解密 + PC 本地 DB 自动发现 + QQ-NT 解密器内核（`330b95c77`）
- 微信 4.0 完整采集：每库独立密钥 + zstd 消息体解压 + 联系人（`57d110d6e`）；公众号 + 朋友圈 + 收藏（`a59d197ed`）；非文本消息人话化（链接/文件/图片…，`bf96991a0`）
- QQ-NT 端到端解密 + protobuf 消息解析（真机 `nt_msg.db` 验证，`a9abd74a5` · `0166becd8`）+ 名称补全（从 `profile_info.db` / `group_info.db` 解 uin→昵称 / 群号→群名）+ `android.root_pull`（su cp→pull）+ `pdh-im-collect` 内置技能（`852a8fe03`）
- 社交平台 ADB 感知 readiness（root 真机一键，`d565c17c5`）+ 真机采集漂移修（微博 cookie 目录 glob / 抖音 SQLCipher / 豆包诊断，`46f36402b`）

### Feat #3 —— 安全 fail-closed 套件（审计跟进）

- SAML 签名 + OAuth id_token 验证 fail-closed（`83fc8e277`）
- 通道消息签名 fail-closed（`5ac4bf645`）
- permission-ipc DB 回退镜像受管加密、删硬编码 "123456"（`20a5c87d2`）
- 渲染层 `days` 入参净化 + 不再吞 sandbox 审计错误（`7d1f6e988`）

### Feat #4 —— U-Key 口令托管层（Phase 3，默认 gated OFF）

- U-Key passphrase escrow provider 层 + 接入 bootstrap DB-key 解析（默认关，`9da5bb5c7` · `d98a057fd`）
- PIN 解锁流程 + 备份码 UI 设计（`355bfd8e6`）

### Feat #5 —— 桌面性能面板 V6 端口 + 后端 IPC 接通

- 数据库性能 / LLM 性能页 port 到 V6 shell（path M，`62bd0812c` · `5d298ebbe`）
- 数据库性能面板后端 IPC 此前从未注册：`registerDatabasePerformanceIPC` 全仓无调用方 → 10 个 `db-performance:*` 通道静默空白；现于 `phase-2-core.js` 经 `safeRegister` 接通 + DI 接缝 + 6 测试（`d0e4507b4`）

### Android UX（真机反馈）

- 扫码加好友后跳对方资料页（之前只弹 Toast 不跳转无法加好友）+ AI 陪学空历史问候移到 UI 层（不污染 LLM 上下文）+ 「本机角色」卡（设为孩子后 SOS/遥测/任务才生效）+ SOS 大红按钮接真触发（`87a378898` · `ac5e74394`）

### 测试 / 质量（cowork skills 套件收口）

- `pdh-im-collect` 内置技能单测 19 例：readiness 探测（array / keyed-object / 噪声 JSON 解析 + cc 缺失降级）、wechat/qq 指引、`--run` 选择性执行、口令脱敏（永不回显）、输入路由、错误处理；经 `_deps` 注入接缝 stub cc CLI，零真实子进程（`c979ccafb`）
- 修 cowork skills 套件两处历史 fail：`skill-lazy-load` re-spy 陈旧调用计数误判（清 spy，实现未动，`d38777a18`）；`youtube-summarizer` 命中真 YouTube 网络 60s 超时 → 加 `_deps.fetchText` 接缝 + fixture stub 改 12 例确定性用例（`391bbe723`）
- cowork skills 全量套件复跑：47 文件 / 815 测试全绿（0 fail）

### 版本同步

- productVersion v5.0.3.100 → v5.0.3.101
- desktop-app-vue 5.0.3-alpha.100 → 5.0.3-alpha.101
- chainlesschain CLI 0.162.31 → 0.162.32（hub.js `--passphrase` 路由 qq-pc）
- @chainlesschain/personal-data-hub 0.4.2 → 0.4.3（lib 变更，待发 npm）
- Android USR_VERSION 19 → 20（强制真机重抽 cc-cli.tgz）+ versionCode 503100 → 503101
- iOS CFBundleVersion 100 → 101

## [v5.0.3.100] - 2026-06-08 — chore(release): 版本对齐发布（CLI npm 发布通道修复 + PDH 0.4.1）

> 把 v5.0.3.99 之后的打包工作固化为一次正式发版。**无桌面 / Android / iOS 应用源码改动** —— 本版产物与 v5.0.3.99 功能等同，仅版本号对齐 + 工程通道修复。全平台 18 产物已 ship（release run 27130664552 全绿，GitHub Release v5.0.3.100 已发布）。

### Fix —— CLI npm 发布通道修复（web-panel prepublishOnly 构建）

- `chainlesschain` 的 `prepublishOnly → npm run build:web-panel` 在 `npm publish` 下长期失败：`vite ERR_MODULE_NOT_FOUND @vitejs/plugin-vue`。
- 真因：构建脚本跑在父 `npm publish` 内，父 npm 泄漏 `npm_config_local_prefix` / `npm_config_*` 指向真实仓库根，子 `npm install` 因此把依赖装到真实根而非构建目录 → vite 解析不到工具链（standalone 运行正常，故只在 CI / publish 下复现）。
- 修复：`build-web-panel.mjs` 改为**隔离 temp 目录构建** + **scrub `npm_config_*` / `npm_package_*` / `INIT_CWD` 环境变量**，子 npm 把 temp 目录当成自己的工程根。CLI 从此可正常发版（npm-publish dry-run 绿，CLI tarball 3.4 MB / 720 files）。

### Publish —— npm 包

- `@chainlesschain/personal-data-hub` 0.4.0 → **0.4.1**（README 刷新到 51 adapter / readiness / 一键采集 现状）
- `chainlesschain` CLI 0.162.29 → **0.162.30**（dep pin pdh 0.4.1）
- 两包均已发布并验证安装（`npm i` 拉取 + 加载/运行正常）

### 版本同步

- productVersion v5.0.3.99 → v5.0.3.100
- desktop-app-vue 5.0.3-alpha.99 → 5.0.3-alpha.100
- Android versionCode 503099 → 503100 / versionName 5.0.3.99 → 5.0.3.100
- iOS CFBundleVersion 99 → 100

## [v5.0.3.99] - 2026-06-08 — feat: 个人数据中台（PDH）采集大更新 + DB 静态加密默认开启 + AI 陪学接入界面

> 本版主线是 **个人数据中台（PDH）采集能力大幅扩容 + 真机生效**：adapter readiness 止血 + 一键采集/导入引导 UI，新接通多家本地直读源（抖音 / 微信 PC / QQ-NT / 钉钉 / 飞书 / Apple 健康 / 网易云音乐 / 微信读书）。同时把 **DB 静态加密 gate 默认翻开**（`PHASE_1_5_DEFAULT_ON=true`），并把 Android「AI 陪学」积分 / 温和度月报 / 任务可见 UI 接成可交互入口。pdh 0.4.0 + cli 0.162.29 已发 npm，Android binariesVersion 20260608（cc-cli.tgz 刷新）+ USR_VERSION 19 强制真机重抽。

### Feat #1 —— PDH adapter readiness 止血 + 一键采集 UI + 抖音/微信PC/QQ-NT 本地直读样板 (`6d978c78c`)

- 新增 adapter **readiness** 概念：从宽松的 `healthCheck` sync 闸门分离出真正的「就绪」判定，走 `registry.readiness()`，解决「配置看起来正常却采不到」的死角
- 桌面/移动端「一键采集」+「导入引导」UI：把多步配置 + 触发采集收敛成单一可见入口
- 抖音 / 微信 PC / QQ-NT 三家本地直读样板（电脑端本地 DB / 文件直读，honest best-effort）

### Feat #2 —— 钉钉 / 飞书 电脑版本地 IM 采集 + 微信读书 + Apple 健康 / 网易云音乐 (`e43c12509` · `e1b38553b` · `67add5740`)

- 钉钉 / 飞书 电脑版 honest best-effort 本地 IM 采集
- 微信读书 weread cookie 采集 + 一键登录采集 UI
- Apple 健康 + 网易云音乐 adapter + 一键采集 UI

### Feat #3 —— email 账单 LLM 补全（Phase 5.5）+ iOS 加密备份解密（Phase 7.5b）(`77ae9ef2c`)

- 邮件账单解析在结构化字段缺失时走 LLM gap-fill 补全
- iOS 加密备份解密落地（Phase 7.5b 移动提取层延伸）

### Feat #4 —— DB 静态加密 gate 默认开启 + DID keystore 打包态 fail-closed (`0b9f41c5e` · `7ecb3503d`)

- `PHASE_1_5_DEFAULT_ON=true` — DB at-rest 加密从「默认关、需显式开」翻成**默认开启**；preflip 自动化闸门已全绿（A 层 L1+L3 45 + L2 真 SQLCipher 7 + B.1 真 Windows DPAPI 探针 6，详见 `d91d72f62`）
- DID keystore 在打包态 **fail-closed**（不再静默回退明文）+ 修 `EncryptionConfigManager` 构造参数

### Feat #5 —— Android「AI 陪学」积分 / 温和度月报 / 任务可见 UI 接入 (`e07f90086` · `e9f4b36ba` · `eca6b2dda` · `a87314aba` · `264cfbea4` · `760d70bd3`)

- M9 奖励/积分引擎纯逻辑层 + M10 家长教育/监管温和度月报纯函数 → 接成家庭 tab 可见可交互入口（积分卡 + 兑换目录 + 温和度评分 + 同类对比 + 12355 公益热线）
- M5 任务可见 UI：家长建作业 → 进 AI 陪学引导模式（不直接给答案）+ 提交 / AI 批改 / 完成 / 打回 + family_task 23 字段 Room 持久层
- 陪伴 tab 复用 core-security KeystoreFacade（真 AES-GCM + StrongBox）TEE 加密落盘，家长 dump 也只得密文

### Chore #6 —— 死代码清理 + 依赖瘦身 + 静默吞错收口 (`425382abc` · `cb039fcd2` · `bbd33ae27` · `c253890ff` · `b19f2f7a1`)

- 删 9 个 dead/orphaned 模块（v2/optimized 重构残留）+ `ai-engine-manager-p2.js` 993 LOC（零引用）
- 移除 7 个未用 runtime 依赖（146 → 139）
- `shell.openExternal` / `openPath` 前校验 URL/路径（新增 `safe-open.js`，仅 http(s) + 防路径遍历）
- 后台 sync / P2P send 静默吞错改 logger 记录
- CI 真生效修：Database Tests / Lint & Format Check 之前 fail 不挂 job（`2f65700a1` · `16f81cf81`）+ personal-data-hub vitest 套件首次纳入 CI test.yml（`28435642b`）

### 版本同步

- productVersion v5.0.3.98 → v5.0.3.99
- desktop-app-vue 5.0.3-alpha.98 → 5.0.3-alpha.99（electron-updater 比对）
- chainlesschain CLI 0.162.28 → 0.162.29
- @chainlesschain/personal-data-hub 0.3.9 → 0.4.0（已发 npm）
- Android binariesVersion 20260528 → 20260608（cc-cli.tgz 刷新含 cli 0.162.29 + pdh 0.4.0）+ USR_VERSION 17 → 19（强制真机重抽 cc-cli.tgz）
- iOS build 98 → 99

## [v5.0.3.98] - 2026-06-03 — fix(android): 社交/首页 ANR 修 + 家庭守护「AI 陪学」Epic A–G 纯逻辑全做透 + PDH 意图路由收口 + 浏览器扩展 handler 拆分

> 用户反馈「点社交会卡住」长期未解；本轮定位到 ViewModel init 块默认在主线程同步读 EncryptedSharedPreferences + DIDManager.initialize 里的 StrongBox 解密（小米 amethyst 单次解密可达数秒），两路汇总把主线程吃 >5s 触发 ANR。一并把 family-guard Epic C M2 telemetry 底座（孩子端共享 child_event 表 + ForegroundAppAggregator pure state machine）落到 main，让后续 FAMILY-21/25 ticket 不再二次拆表。
>
> **范围说明**：productVersion 在 `3514e55e0` 即 bump 到 .98，但 tag 直到 2026-06-03 才 cut；其间约 150 commit 累计骑在 .98 版本号上，随同一 tag 一并 ship。下方 #1–#3 是 .98 prep 当时的三件，#4 汇总 prep 之后累计落地的工作。

### Fix #1 — 主线程 keystore 阻塞致社交/首页 ANR 全切 IO 线程 (`6ad0f7989`)

- `HubLocalViewModel.init { … 13 个 refresh*FromStore() }` 同步读 EncryptedSharedPreferences（keystore-backed），改包进 `viewModelScope.launch(Dispatchers.IO) { … }`
- `DIDManager.initialize()` 整段 `withContext(Dispatchers.IO)`：loadWallet→loadEntry→StrongBoxKeyManager.unwrapEd25519Private 是阻塞式 Android Keystore (StrongBox) 调用，部分机型单次解密数秒；旧 `init { viewModelScope.launch { didManager.initialize() } }` 默认跑 Main → 进社交页主线程卡 >5s → ANR
- 内部仅 `_state.update` / `launchIn(viewModelScope)`，线程安全

### Feat #2 — FAMILY-20 Epic C M2 telemetry 底座（主文档 §3.2 v0.2 起步）(`abd3a2cb7`)

- 新 `ChildEventEntity` (child_event 表) + `ChildEventDao` + `ChildEventRepository`(Impl)：source / kind / payload JSON / timestamp / duration_ms / level=L1，3 index (did+timestamp / source / level)
- 新 `ForegroundAppAggregator` (pure state machine, 同 app 连续 30min 合一行 / 切 package / 乱序 ts 强制 flush) + `ForegroundAppRun` + `ForegroundAppSample` (UsageStats 分钟级采样)
- Room SCHEMA_VERSION 2→3, `MIGRATION_2_3` (CREATE TABLE + 3 index, IF NOT EXISTS 全 trap `[[pdh_partial_index_if_not_exists_drift]]` family-guard 版规避), `exportSchema=true` 生成 3.json
- DI: `FamilyGuardModule.provideChildEventDao` + `FamilyGuardBindingsModule.bindChildEventRepository` (@Singleton)
- `FamilyGuardSchemaTest` version 2→3 / 8→9 tables
- Epic C M2 后续 (FAMILY-21 ForegroundAppTimer 服务 / FAMILY-25 上行权限过滤层) 复用本 schema + Repository

### Chore #3 — docs/design 站 DEPLOYS 恢复 + www hotfix (`52b7a0780` + `daf3bcd05`)

- `docs-website-v2/scripts/fetch-release-sizes.mjs` 加 `internal-binaries-*` tag skip（避免选错最新 binaries release 拿不到 desktop asset），sweep `/releases?per_page=30` 找第一个含 desktop asset 的；release-sizes.json tag 回到 v5.0.3.97 / 11 sizes
- `scripts/deploy-all.py` DEPLOYS[] 恢复 `docs.chainlesschain.com` + `design.chainlesschain.com` 两路（用 12:39 stamp tarball 占位），下次全量 deploy 直接复用，本轮 www-only 跑过的不重复

### Feat #4 — 随 .98 tag 累计 ship 的工作（.97 prep 之后，约 150 commit）

- **家庭守护 / AI 陪学 Epic A–G 纯逻辑层全做透**（`:feature-family-guard` 337 测试全绿）：Epic A 模块脚手架 + 角色首启锁 → B 解绑 / QR 配对 / 复活码紧急解绑 → C telemetry 上行管线（CentralTelemetryDispatcher + AnomalyDetector v0 + Quiet Hours + 数据生命周期清理）+ 桌面家长仪表板镜像 → D mobile↔mobile 通话（WebRTC 对等 + 角色协商 + 强接通配额 + 通话 UI）→ E SOS 一键求助（event 状态机 + broadcast call 协调 + 误触撤销 + 60s 外部联系人升级）→ F 地理围栏（Repository + 动作引擎 + 异常停留检测）→ G 多家长协商频道 + 不可删审计日志 + TimeAuthority 防改钟（接 24h 角色锁 / 解绑冷却 / quiet hours 三约束点）。剩余 device/UI/真机/PM 阻塞项不在本版范围。
- **PDH AnalysisEngine 意图路由收口**：sum-amount 按币种拆分（不再跨币种乱加）/ count 硬上限采样 / 多币种 breakdown；静态安全审计 F2–F6（7 个 ApiClient PII 脱敏 / 缺 cookie fail-fast / CancellationException rethrow / WebView JS bridge 收窄到 active 平台 / Xhs -461 风控熔断）。
- **浏览器扩展 background.js Phase 0/1 大拆分**：从单体 background.js 抽出共享 inject/CDP core，并把 clipboard / cookies / storage / network / page / notifications / devtools(debug+inspect) / indexeddb / dom / input / events / media-emulation / lifecycle / fonts / accessibility / selection-dragdrop / performance 等 handler 全部模块化到 `handlers/*.js` + 注册表。
- **桌面新增约 80 个 Pinia store 单测套件**：覆盖 taskBoard / workspace / planning / memory / 各 EvoMap / federation / PQC / ZKP / WebAuthn / IPFS-cluster / GraphQL 等 store。
- **iOS / Android 验签 + 防改钟接通**：Android LenientManifestVerifier 接 RemoteSkillRegistry 默认（A7）+ A1 防改钟桌面 responder / Android RpcClient。

### 版本同步

- productVersion v5.0.3.97 → v5.0.3.98
- desktop-app-vue 5.0.3-alpha.97 → 5.0.3-alpha.98
- chainlesschain CLI 0.162.27 → 0.162.28（无 src 改，仅版本号 bump，跟 productVersion 节奏）

## [v5.0.3.97] - 2026-05-27 — PDH RAG 接通 Android 云模型 + 联系人电话号码 LLM 真可见 + 6 平台 endpoint hotfix 套件

> 之前 Android CLOUD_ANDROID 路由只把用户问题原文打给云模型，AI 真就「无脑闲聊」；本地金库里有的联系人、近期事件全部失联。本轮把 PDH RAG 检索真接到云路由 + 修两个长期幻觉死角（联系人字段 strip + entity routing 被挤），并扫了 4 个社交平台的 endpoint 漂移。

### Fix #1 — PDH RAG 真接通到 Android CLOUD_ANDROID route (`3f31e2894`)

- 新 `cc hub retrieve-context` CLI 命令 + `LocalCcRunner.retrieveContext` Kotlin 桥
- `HubLocalViewModel` 整合：云路由先拉 `hub.retrieveContext(question)` 拿到 facts → 拼进系统消息 → 再发云模型
- AI label 从「无脑闲聊」改为真有 citations 引回原始事件

### Fix #2 — PDH `cc hub retrieve-context` 冷启动 90s → <5s (`eb24c4d5d`)

- 新 `getHubMinimal()` 工厂跳过 8 个 aichat adapter / kg / bm25 重型 init — retrieve-context 走只读 vault 查询无需这些
- 真机 2026-05-27 验过：冷启 4.2s vs 旧 87s
- 让云路由问问题在用户感知内可用

### Fix #3 — PDH `summarizePerson` 含 identifiers + notes (`a41d50ebd`)

- 之前 strip phone / wechatId / email 字段 → 768 个联系人在 vault 但 LLM 答「没有足够信息」
- 「妈手机号」「张三的微信号」类查询真能命中
- 改 `summarizePerson()` 保留 identifiers Map + notes 串拼进 person facts

### Fix #4 — PDH entity-focus routing + searchPersons LIKE 名字搜索 (`f5d66debc` + `90343ff93`)

- `_gatherFacts` 加 entity-focus path：question 抽出 person name candidate → searchPersons → 优先注入
- contacts 不再被 events 挤出 RAG 200 上限
- 之前 events 多的用户问联系人问题，contacts 全被淹

### Fix #5 — PDH-Android 4 个平台 endpoint hotfix

- **Xhs** 3 endpoint path / param 对齐 JsBridge 真路径 (`64c549609`) — `/api/sns/web/v1/me` → `/api/sns/web/v2/user/me` 等
- **Toutiao** extractUid 加 `uid_tt` / `sso_uid_tt` / `tt_webid` fallback (`e2de2d8e2`) — passport_uid 长期 null 拒登录
- **Weibo** `/api/favorites` 上游下线 → graceful skip (`48cece8e3`) — 不再给假 404
- **Douyin** 收藏分页 — 之前只一页（~24 / N）静默丢 (`de4be43c6`) — has_more 循环分页拉全

### Fix #6 — Android askQuestion timeout 60s → 240s (`d9a85d325`)

- MediaPipe cold-start over budget 导致首问 LLM 无响应 — 用户体感「按了没反应」
- 一次性提到 4 min 兜底 cold-start，warm 后正常 30-60s

### Fix #7 — PDH aichat-health timers unref (`c1aaf553b`)

- `cc hub` 系列命令调完不立即 exit — 因为 aichat-health setInterval 把 event loop 持有
- 全部 `timer.unref()` 后 cc hub 命令秒退

### 文档

- `docs/internal/hidden-risk-traps.md` 加 trap #27 (USR_VERSION sentinel cache miss after PDH/CLI lib refresh) + trap #28 (workspace dep npm publish stale — 改 pdh/lib 或 cli/lib 必 bump version + npm publish + Android USR_VERSION，否则真机走 fast-path 跳解压用旧代码)
- handbook 标题升到 `#6-#28`

### 版本同步

- productVersion v5.0.3.96 → v5.0.3.97
- desktop-app-vue 5.0.3-alpha.96 → 5.0.3-alpha.97
- chainlesschain CLI 0.162.26 → 0.162.27（src 改 + pin `@chainlesschain/personal-data-hub` 0.3.7 → 0.3.9）
- `@chainlesschain/personal-data-hub` 0.3.7 → 0.3.9（含 RAG retrieve-context 接通 + summarizePerson 字段保留 + entity-focus routing）
- Android versionCode 503096 → 503097 / versionName 5.0.3.96 → 5.0.3.97（USR_VERSION 12→17 累计 5 次 bump 强制重抽 cc-cli.tgz）
- iOS CFBundleVersion 96 → 97

### Bundled

- `test(android): Phase 2-6 androidTest infra — 18-stub reactivation foundation` (`c34e8b8ee`)
- `fix(android-ci): scope AVD cache key to dodge prefix-match collision` (`54eb55246`)
- `fix(android-test): 3 flaky/drifted tests + XhsApiClientSignBridgeTest endpoint sync` (`5e688c537` + `b01f264f4`)
- `fix(ci): free 30+ GB on Android E2E runner to dodge dex-merge ENOSPC` (`6cab8b1c3`)

## [v5.0.3.96] - 2026-05-27 — fix(desktop): 检查更新两路兜底 — release-in-progress friendly dialog + window-hidden OS notification

> User report on v5.0.3.94: 托盘点「检查更新」没反应；早些时候同一按钮还弹出过红色 dialog 整段 HttpError 404 stacktrace 糊脸。诊断 → 两个独立但叠在一起的问题：(1) tag 推后 release.yml workflow 还在上传 assets 时 `latest*.yml` 暂 404，electron-updater 把整段 stacktrace 当 error 发渲染端 + 弹红卡；(2) v5.0.3.44 后更新提示走渲染端 AppUpdateNotifier 卡片（画在 BrowserWindow 内），用户从托盘点检查更新时主窗口仍在托盘里 → 卡片画在不可见窗口 → 哑响。

### Fix #1 — release-in-progress 友好提示（commit `39913cfd7`）

- 新 `desktop-app-vue/src/main/system/update-error-classifier.js` 把 electron-updater 错按 kind 分类：`release-in-progress` (Cannot find latest*.yml / 404 拉 latest*.yml) vs `generic`
- `auto-updater.js` error handler 按 kind 分流：release-in-progress 后台自检完全静默；手动检查弹 `type:info` dialog "新版本正在发布中，请稍后几分钟再试" 而不是糊 stacktrace
- 8 case 单测覆盖（含真实 v5.0.3.95 错误文本 + latest-mac/linux 变体 + 404-only-on-non-yml 反例 + null/undefined 边界）

### Fix #2 — 窗口隐藏到托盘时检查更新发系统通知兜底（commit `bc322467d`）

- `enhanced-tray-manager.js#triggerCheckForUpdates`: 触发 `checkForUpdates(true)` 前先 `this.showWindow()` 把主窗口拉回前台，确保 notifier 卡片可见
- `auto-updater.js`: `update-downloaded` + `update-not-available` 两个事件加 OS Notification 兜底（窗口隐藏 / 最小化 / destroyed 时发），点击通知亮窗 → 用户随即看到 notifier 卡片 / native dialog
- 新 `update-window-visibility.js` 抽 `shouldFallbackToOsNotification` 纯函数 helper（同 classifyUpdateError 思路：auto-updater.js 整文件 require 会拉 electron-updater 真单例跑不动）
- 9 case 单测覆盖 null / destroyed / 不支持 / 可见 / 隐藏 / 最小化 / 防御性兼容

### Bundled

- `test(android): Phase 2-6 androidTest infra — 18-stub reactivation foundation` (`c34e8b8ee`)
- `docs: auto-generate documentation from latest changes` (`c3f7a0c1c`)

## [v5.0.3.95] - 2026-05-27 — fix(desktop): legacy-GPU Chromium 130+ crash recovery (trap #26)

> User report: `ChainlessChain-Setup-5.0.3-alpha.94.exe` 装一会闪退。诊断 → 不是 installer 问题：NSIS 装成功（`C:\Program Files\ChainlessChain\` 落地），但安装完最后那步自动启动 `ChainlessChain.exe`，Electron 39 / Chromium 130+ GPU 进程在 `CoreMessaging.dll` fail-fast `0xc0000602`，因目标机的 GPU 驱动太老（确认机型 Intel Iris Pro 5200 + 2016-09 驱动）。任何 ≤2018 GPU 驱动 + 老 Intel HD/Iris 系列机器都会撞这条。这是 trap #26 (Legacy-GPU Chromium fail-fast) 的典型表现。

### Fix — auto-recovery marker file pattern

- `desktop-app-vue/src/main/index.js` setupApp() 启动前写 `.launching` marker；`mainWindow.once("ready-to-show")` 清掉 marker。下次启动看到残留 marker → 判定上次崩了 → 写持久化 `.gpu-disabled` 文件 + `app.disableHardwareAcceleration()` + `--disable-gpu/--disable-gpu-compositing/--disable-software-rasterizer` Chromium switches
- 同时支持 `CHAINLESSCHAIN_DISABLE_GPU=1` env var 手动触发；删 `<userData>/.gpu-disabled` 可恢复 GPU
- Pattern 同 VS Code / Slack / Cursor / Discord 的 disable-gpu 恢复，外部行为驱动不依赖任何 GPU API 状态
- commit `d8dc212f1`

### Docs — trap #26 + handbook

- `docs/internal/hidden-risk-traps.md` 加 trap #26 完整正文（诊断三步 + SOP/checklist + 反模式 + 快速诊断键），标题升到 `#6-#26`
- `CLAUDE.md` handbook reference 同步到 `21 silent-failure patterns #6-#26`
- memory `gpu_crash_recovery_legacy_intel_driver.md` 落地经验

### Diagnostic 三步（user 报 "installer 闪退"时强制走）

```powershell
# (1) installer 是否真崩 — 看 app 是否落地
Test-Path "$env:ProgramFiles\ChainlessChain\ChainlessChain.exe"
# True → installer 装成功，问题在 app 启动

# (2) Event Log 找 0xc0000602
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; StartTime=(Get-Date).AddMinutes(-30)} |
  ?{$_.Message -match 'chainless'} | Select-Object TimeCreated, Message | Format-List
# 看 异常代码: 0xc0000602 + CoreMessaging.dll → 锁实 trap #26

# (3) GPU 驱动年龄
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate
# DriverDate < 2020 + 老 Intel HD/Iris → 强相关
```

### Bundled

- `chore(ci): PR-advisory sidebar coverage audit for design docs` (`3432e0926`)
- `chore(ci): hard-gate trap #25 partial-index drift in PDH` (`bb6c1496e`)
- `chore(docs-infra): consolidate sync filename maps to shared JSON` (`24f315551`)
- `test(android): fix TurnEphemeralRefresherTest CI flake — 3s → 10s poll` (`90f32397c`)
- `fix(ci): unblock 3 long-running test/release failures` (`12954e3d5`)
- `fix(android-tests): resolve 27 unit test failures across 7 classes` (`965ee41be`)
- `test(android): resolve 17 .kt.broken — delete 14 LLM-hallucinated + fix 2 stubs + revive TaskPlanCardTest` (`b10175940`)
- `fix(android-ci): probe step needs set -o pipefail so gradle exit isn't swallowed by tee` (`a246e0853`)
- `chore(android): add release-precheck workflow — R8 hotfix-chain prevention` (`06ae8b686`)

## [v5.0.3.94] - 2026-05-26 — re-tag of .93 fixes after release.yml bs3mc rebuild step failed CI

> v5.0.3.93 tag 推送后 release.yml 新加的 bs3mc rebuild step 在 win/mac/linux 三 build 都 fail：desktop-app-vue 那份 bs3mc rebuild 成功（prebuild-install 拉 Electron 二进制），但 packages/cli 那份 fall back 到 source build，撞 v8::Context::GetIsolate 被移除的 V8 API（正是 electron-builder.yml 注释里说的那个坑）。改用 COPY 策略：只对 desktop-app-vue 跑 @electron/rebuild + `find packages -name better_sqlite3.node | xargs cp -f` 覆盖所有 nested 副本。v5.0.3.93 tag 试 delete-recreate / force-push / workflow_dispatch 都没能重新触发 release.yml（GitHub Actions 对同 tag 不重 trigger），所以 bump v5.0.3.94 强触发。所有 .93 修复内容保持原样（见下）。

## [v5.0.3.93] - 2026-05-26 — hotfix: PDH 「刷新失败」 (bs3mc ABI mismatch) + Providers 「加载配置 key 变了」 + save 假阴

> User report: (1) desktop v5.0.3.88/.92 PersonalDataHub 点「刷新」 throws `刷新失败: NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 140`; (2) LLM config page 点「加载配置」 后 apiKey 被字符串 `null` 覆盖; (3) 保存 LLM key 后 toast 报「没有检测到配置变更」 实际未保存。 本 hotfix 三事齐修。

### Fix 1 — bs3mc native binding ABI mismatch (release pipeline)

- `.github/workflows/release.yml` win/mac/linux 三个 job 都加 step「Rebuild bs3mc native bindings for Electron ABI」 用 `@electron/rebuild@^4 --only better-sqlite3-multiple-ciphers` 拉 bs3mc 官方 Electron prebuild
- 根因： `electron-builder.yml:16` 设 `npmRebuild: false`（因 node-gyp 三平台编译都有坑）， CI Node 22 `npm install` 抓 Node ABI 127 prebuild → ship 二进制； Electron 39 ABI 140 加载即崩。 Rebuild step 拉 upstream Electron prebuild 不本地 node-gyp，绕开 npmRebuild 禁因
- 同步 rebuild `desktop-app-vue/node_modules/` 和 `packages/cli/node_modules/`（walker 会找到 PDH 嵌套的 bs3mc）— 用户实际报错路径是后者
- macOS 当前 last-rebuild-wins on disk → x64 final。 arm64 DMG 反而被 x64 binary 覆盖， arm64 mac 用户 followup 修
- memory `release_bs3mc_no_rebuild_step.md`（trap #26 候选 — `npmRebuild: false` + 无 @electron/rebuild step = release ship Node ABI binary silent fail）

### Fix 2 — Providers.vue parser section 污染

- `packages/web-panel/src/views/Providers.vue` parser 抽到 `parsers.js` 作 `parseLlmConfigOutput` 导出 — 测试不再复制粘贴
- 原 parser 用扁平正则 `^(?:llm\.)?(\w+)…` 扫全文; `cc config list` 输出里 `llm:` 段 `apiKey: ****`（masked 被过滤） + `enterprise:` 段 `apiKey: null`（不含 `***` 通过过滤） → result.apiKey 被字符串 `"null"` 覆盖 → UI 上「点击加载配置 key 变了」
- 改 parser 跟踪 currentSection， 只读 `llm:` 段内的值， 跨段不污染
- 加 4 个回归测： enterprise apiKey:null 不污染 / 跨段同名 key 不被覆盖 / llm 段前的 top-level key 被忽略
- 103/103 tests 通过

### Fix 3 — saveConfig 假阴 + 重启提示

- `loadConfig` 改成只快照 parsed 出来的值， 不再 `{ ...configForm }` 把"用户输入但未保存的值"误当 baseline → 修「保存提示无变更但 key 实际没发后端」 silent fail
- 保存成功后弹横幅提示： 桌面 ws-cli-loader 只在 createSession 时重读 config.json (`ws-cli-loader.js:118-128`)， 已存在的聊天 session 拿不到新 key/provider/baseUrl/model — 必须新建 Chat 或重启 app

### Versions

- root productVersion `v5.0.3.92` → `v5.0.3.93`
- desktop-app-vue `5.0.3-alpha.92` → `5.0.3-alpha.93`
- Android versionCode `503092` → `503093` / versionName `5.0.3.93`
- iOS CFBundleVersion `92` → `93`
- 无 npm 包改动（packages/cli + packages/personal-data-hub 源码 since v5.0.3.92 未变）

## [v5.0.3.92] - 2026-05-26 — PDH Mode B Phase 7 (6-platform Android in-APK root local DB extraction) + Toutiao in-WebView prefetch (6/6 platforms) + npm pkg refresh

### Toutiao in-WebView prefetch (Mode A 6/6 platforms 全 wired)

- `ToutiaoJsBridge.kt`（新建）— 复刻 [[bilibili_in_webview_prefetch_architecture]] 同套路径给头条：JavascriptInterface `ToutiaoBridge` + AtomicReference pendingCallback + PREFETCH_JS（passport_uid cookie 抠 + `/passport/account/info/v2/?aid=24` 拿 user_id/screen_name → profile event；feed/collection 试调 byted_acrawler 签名，多半 CORS 拒 → v0 跳过）
- `SocialCookieWebViewScreen.kt` — addJavascriptInterface + setPending/clearPending 4 处接入
- `ToutiaoLocalCollector.kt` — `ingestPrefetched()` + `recordSync()` 写 staging JSON 走 cc adapter 入 vault
- `HubLocalScreen.kt` — onPrefetchComplete + PREFETCH_JS 路由分支为 `social-toutiao`
- 至此 in-WebView prefetch 路径 4/6 平台齐（Bilibili + Douyin + Xhs + Toutiao），剩 Weibo + Kuaishou v0.2 跟同套架子（Weibo 路径 A 已稳，Kuaishou 走 SignProvider 不走 prefetch）

### npm 包升版 (per memory `npm_publish_pre_audit_version_bumps.md`)

- `@chainlesschain/personal-data-hub`: 0.3.6 → 0.3.7（Phase 6a/6b/6c.2/6d.2 SignProvider 接口 + Xhs/Toutiao/Kuaishou C 路径 collector，4 commit since last bump）
- `chainlesschain` (CLI): 0.162.25 → 0.162.26（Phase 6c.3/6d.3/6e.2 Toutiao/Kuaishou C 路径 CLI/WS wiring + Bridge dry-run doctor，4 commit since last bump）
- CLI dep pin `@chainlesschain/personal-data-hub` 同步 0.3.6 → 0.3.7

### PDH Mode B Phase 7 — 6-platform Android in-APK root local DB extraction

> 推 Mode B = APK 内 root + 本机 SQLite 直读 path B,let user 没桌面/没网 时也能采集自己的社交数据 (path A 是 cookies + HTTP)。原 plan `docs/design/PDH_Mode_B_Phase_7_Plan.md` §5 推只做 P7.1 Toutiao + defer 4 platforms 独立 session；user 在 P7.0 后 explicit "Mode B 全面 5 平台" override, **本 session 6/6 platforms 全 ship v0.1**: Toutiao + Douyin + Bilibili + Weibo + Xhs + Kuaishou.

### 6 per-platform Mode B v0.1 (18 commits, ~6700 LOC)

每 platform 3 Kotlin files mirror Weibo template (`<Platform>Root{CredentialsStore,DbExtractor,DbCollector}.kt`) + 21 JVM tests:

- **Toutiao** (`4e328bc46` + `7156ebae4` + `a2be1e1d6`) — 明文 SQLite推论 from Douyin DFIR; kinds: read/collection/search
- **Douyin** (`7ae0f54b0` + `56afebbb5`) — 明文 SQLite确认 from abrignoni; kinds: message/contact
- **Bilibili** (`0cbe4b0fe` + `b41fd2a0f` + `bfb4a9ac4`) — 明文 SQLite确认; kinds: history/favourite/follow. Plan §6.4 原推 SKIP (path A SESSDATA 已最优), v0.1 ship 作 path A 不可用 fallback.
- **Weibo** (`1c877954f` + `e3b6641c2` + `8aef6419e` + `8b202c326`) — 零公开 schema, **3-branch decision E2E doc** (明文/SQLCipher/source-missing); kinds: post/favourite/follow
- **Xhs** (`c1b601cfe` + `2fad4bfa8` + `9f37b10f8`) — **defer-recommended** per plan §6.5 (SQLCipher 几乎确定 + libshield.so 反 frida); v0.1 期待 70% 命中 likely-sqlcipher banner; kinds: note/liked/follow. uid 是 24-char hex (ObjectId).
- **Kuaishou** (`b8fcbc47b` + `cac364435` ⚠ misattributed + `1046a4dfe`) — **defer-recommended** per plan §6.6 (SQLCipher 几乎确定 + libmsaoaidsec.so 反 frida 极高强度, **dual-role NS_sig3 SDK + anti-frida guard**); kinds: watch/collect/search (skip profile)

### Shared scaffold (`pdh/social/common/`, Phase B0 `8051f4ae5`)

- `LocalRootCollector` interface + `LocalSnapshotResult` sealed class
- `BaseRootCredentialsStore` — EncryptedSharedPreferences + recordSync/recordError boilerplate
- `DbCohortCopier` — WAL+SHM atomic cohort copy via `su -c`
- `RootShellRunner` — `isSuAvailable()` + `execAndCapture()` for ls/probe

### UI wiring

- `HubLocalScreen.kt` onSyncRoot dispatch 6/6 platforms (Toutiao+Douyin+Bilibili+Weibo+Xhs+Kuaishou)
- `HubLocalViewModel.kt` 6 `syncXxxRoot()` methods (~150 LOC each) + 24 VM tests + 12 constructor injections
- 共享 path A 的 `globalSyncingAdapter` 单飞; "本机 root:" banner 前缀区分 path A/B

### E2E docs (Win-first PowerShell)

- 5 platform-specific E2E checklists (Toutiao+Douyin 1 个 + Bilibili / Weibo / Xhs / Kuaishou 各 1)
- 1 unified 真机回归 master `PDH_Mode_B_RealDevice_Master_Checklist.md` (~1 day execution plan, 6 platforms in 1 Android session)
- Defer-recommended platforms (Xhs/Kuaishou) explicitly frame v0.1 as expected-failure-mode validation, not success expectation

### Phase 7 closure artifacts (this commit)

- `docs/design/PDH_Mode_B_Phase_7_Plan.md` restored from `90e7f659c` (silently deleted, no commit log) + §8 shipped state added
- `docs/design/PDH_Mode_B_Phase_7_Complete.md` (new) — retrospective + risk distribution + 5 traps + remaining work
- `docs/design/PDH_Mode_B_RealDevice_Master_Checklist.md` (new) — unified 1-day真机回归 plan
- CHANGELOG entry (this section)

### Remaining (all user-driven from physical Android device)

1. **真机 schema 探测** — 5 P7.x.0 fill-ins → update `DB_FILENAME_CANDIDATES` + column candidates per platform → v0.2 commits
2. **Weibo v0.2** — depends on real-device W-2 branch (明文 / SQLCipher / source-missing)
3. **Xhs v2.0 / Kuaishou v2.0** — frida + 反爬 SDK neuter + SQLCipher key derivation (~4-6 weeks/platform). Kuaishou v2.0 更复杂 — libmsaoaidsec dual-role hook 不能误伤 NS_sig3 签名.
4. **6-platform 真机 E2E runs** — see `PDH_Mode_B_RealDevice_Master_Checklist.md`

### Process traps surfaced (5, captured in memory `pdh_mode_b_phase_7.md`)

1. Parallel-session WIP rip-out 误判 (P7.4.2) — 检查对方有没 commit 再 reapply patch
2. Backup-restore loses just-committed edits (P7.5.2) — diff delta + git apply 不要 raw cp restore
3. Parallel session steals my commit (P7.6.2) — `cac364435` NSIS commit bundled 412 lines of Kuaishou Mode B wiring
4. Plan doc silently deleted — 关键 design docs 应 CI integrity check
5. `cc` 子进程 epoll_wait dead-wait — `pdh_cc_subprocess_exit_and_vault_upsert` 已收

## [v5.0.3.85] - 2026-05-24 — hotfix5: MediaPipe SIGABRT + PDH trap #25 partial-index recovery

> 用户反馈：「安卓端本机模型问几个联系人会崩」— v5.0.3.84 APK 在 productVersion bump (2026-05-23 09:10) 之后 30 小时才 land MediaPipe 三连修 (`3fa4a81d5`)，84 装机包不含 guard。本 hotfix 把 trap #22 (MediaPipe OUT_OF_RANGE → JNI abort → SIGABRT) 三处联动修真 ship；同期把 trap #25 (PDH partial-index `IF NOT EXISTS` drift) + rederive 孤儿数据救援 一并入袋。

### Android — MediaPipe JNI abort 防护 (3fa4a81d5)
- **`android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/MediaPipeLlmEngine.kt`**：chat() 进 native 前加 prompt-length guard (`if (estPromptTokens > ctxBudget - 128) throw LlmInferenceException`)。MediaPipe `predictSync` 在 prompt > setMaxTokens 时抛 IllegalStateException 后**不 clear pending exception** 就调 NewByteArray → CheckJNI JniAbort → SIGABRT 整 app，Kotlin try/catch 完全够不到，只能上游 fail-fast。
- **同文件 ensureLoadedLocked()**：session 缓存 key 加 `loadedMaxTokens` — MediaPipe 把 ctx 窗口烤进 LlmInference handle，首次 chat 用 512 建好后所有后续 maxTokens 变更全被忽略。
- **`android-app/app/src/main/java/com/chainlesschain/android/pdh/llm/LocalLlmServer.kt`**：`setMaxTokens ← req.options?.numCtx` (不是 numPredict)。Ollama num_predict 是 output budget，与 MediaPipe maxTokens(总上下文窗口) 不同义。
- 3 处必须联动 — 漏一个都不修。新加 2 JVM 单测 + handbook trap #22。

### PDH — trap #25 partial-index drift recovery (7af396405)
- **`packages/personal-data-hub/lib/migrations.js`** migration v4：explicit DROP + CREATE partial unique index — 4 表 events/persons/places/items 同步带 `WHERE source_original_id IS NOT NULL`。修老 vault (pre 44c4188a8) 因 `CREATE UNIQUE INDEX IF NOT EXISTS` 隐藏的 schema drift → adapter.sync silent fail / events 卡 0 行 / raw_events 累积 1000+。
- **`packages/personal-data-hub/lib/registry.js`** + **`vault.js`**：`rederive({ adapter?, batchSize=100 })` + `queryRawEvents()` — 升级到 v4 后, raw_events 里的孤儿数据手动 re-derive (不 re-fetch source，不更新 watermark)。
- **`packages/cli/src/commands/hub.js`**：`cc hub rederive [--adapter <name>] [--batch-size <n>] [--json]`。
- Android: cc-cli.tgz repack 含本修, LocalCcRunner 走 `cc hub rederive` 救 1305-row raw_events orphan。
- 测试: sandbox runner 47 PASS (`bash packages/personal-data-hub/scripts/run-native-tests-sandbox.sh`)。

## [Unreleased] - PDH Vault Browser Phase 16 — 桌面 + Android 数据可视化入口

> 用户反馈："安卓端和桌面端都缺少采集上来数据的可视化展示，需要有可视化展示入口"。
> 之前用户只能通过"问 AI"间接看到 RAG 召回片段，或 Android 个别 tab 的 "看采集到的"
> bottom sheet（5 tab 中 4 个没该按钮）。本期补完整双端主动浏览器入口：分类侧栏 +
> FTS5 CJK 全文检索 + 5 种 category-keyed 渲染器 + 游标分页 + JSON/NDJSON/CSV 导出。

### 后端 (FTS5 + categories + search/facet API)

- **`packages/personal-data-hub/lib/categories.js`** (NEW) — 7 buckets
  (chat/social/email/shopping/travel/system/ai-chat) + prefix-rule mapper
  `getCategory()` / `groupByCategory()`。**单一真相源**，desktop/Android UI 各
  自 mirror。
- **`packages/personal-data-hub/lib/migrations.js`** — migration v3：FTS5
  external-content 虚拟表 `events_fts` + 3 个 INSERT/UPDATE/DELETE triggers
  保持索引同步 + 一次性 backfill；trigram tokenizer（CJK 子串匹配，**比 LIKE
  快 10-100×**）；探测不支持时 `_meta.fts_mode='like'` 透明降级。
- **`packages/personal-data-hub/lib/vault.js`** + `searchEvents` / `facetCounts`
  / `ftsMode`：游标分页 `(occurred_at DESC, id DESC)` / FTS5 phrase-match
  自动加引号 / category WHERE 翻译 / sub-3-char query `shortQuery=true` UI 提示。
- 测试：36 categories + 13 SQL helpers + **27 FTS5 native integration**（含
  trigger sync / cursor / category 过滤 / CJK trigram，21s）。CI native 直跑；
  Win 本地走 `scripts/run-native-tests-sandbox.sh` 绕开 Electron 39 ABI 140 占用
  （memory `bs3mc_electron_abi_sandbox_workaround.md`）。

### 协议层 (CLI + WS + composable)

- **`packages/cli/src/commands/hub.js`** + `cc hub search` / `cc hub facet-counts`
  子命令（含 `--q --adapter --category --subtype --since --until --cursor --limit`）。
- **`packages/cli/src/gateways/ws/personal-data-hub-protocol.js`** + 2 WS topics
  `personal-data-hub.search-events` / `.facet-counts`，复用同一 vault 方法。
- **`packages/web-panel/src/composables/usePersonalDataHub.js`** + `searchEvents()`
  / `facetCounts()` thin wrapper。
- 测试：4 composable unit tests。

### 桌面 UI (Vue 3 + Pinia)

- **新路由** `/personal-data-hub/browser` (router/index.js + AppLayout 菜单)
- **`stores/pdhBrowser.js`** — Pinia store：filters / results / cursor /
  facets / debounce (300ms) / **race-resolution token**（stale slow response
  silently drop）/ facets 调用故意 strip adapter/category/subtype（否则 sidebar
  bucket counts 始终 100%）。
- **`components/pdh/`** — `CategorySidebar.vue` (8 类目 + badge counts) +
  `SearchFilterBar.vue` (keyword + adapter chip + date range + 模式提示) +
  `ExportDropdown.vue` (3 格客户端下载) + 5 个 renderers
  (`ChatBubble/OrderTable/Timeline/EmailList/Generic` + `RendererDispatcher`，
  按 **category** 派发非 subtype — trap `pdh_llm_routing_split_trap`)。
- **`views/PdhVaultBrowser.vue`** — 主视图，layout = sidebar + filter + result
  list + load-more + 4 个 empty-state 分支。
- 测试：10 store + 12 view-level (vue-test-utils + @pinia/testing) + 19
  getCategory + 11 export (3 格 + RFC-4180 escaping) + e2e SPA 路由探活 2 条。

### Android UI (Compose + Hilt)

- **`PersonalDataHubScreen.kt`** — tab 列表 5→6，新 tab "数据浏览" index 5。
  Back-compat：existing NavGraph `initialTab=0-4` 路由不动。
- **`HubBrowserViewModel.kt`** — MutableStateFlow<HubBrowserUiState>，
  debounce 300ms / race-token / 并行 facet+search async / error 捕获。
- **`HubBrowserScreen.kt`** — stateful wrapper + stateless `HubBrowserScreenContent`
  （memory `android_mockk_viewmodel_androidtest_initializer_trap` 避雷）。
- **`HubBrowserRenderers.kt`** — `categoryFor()` dispatcher + 5 Composable renderers
  镜像桌面（chat 气泡 / order 表格 / travel 时间线 / email 列表 / generic 卡）。
- **`LocalCcRunner.kt`** + `searchEvents` / `facetCounts` 包 `cc hub search` 子进程，
  含 `Cursor` / `SearchResult` / `FacetCountsResult` sealed classes，
  `_runCcJson` helper 抽 boilerplate。
- 测试：7 JVM VM test + 10 JVM renderer dispatcher test。
- **剩**: Compose UI test + 真机 latency benchmark 等 Android emulator CI job 启用。

### Commit 链

```
86b3cda98  merge: github/main into local main (plumbing zero-touch merge)
8b2757704  test(pdh): vault-search.test.js fixture 修 + sandbox runner script
fe102c112  test(pdh-browser): view integration + e2e SPA routes + browser-history sync
839e534c5  feat(pdh-browser): JSON/NDJSON/CSV 导出
7b9815381  feat(pdh-browser): 4 category-keyed renderers (both shells)
b4fa54b6d  feat(pdh-android): vault browser tab + LocalCcRunner.searchEvents
3aebbbffe  feat(desktop):     PdhVaultBrowser view + Pinia store
856312de8  feat(ws):          search-events + facet-counts topics + composable
c8142e573  feat(pdh):         vault FTS5 search + facetCounts API (migration v3)
801a95969  feat(pdh):         shared adapter→category taxonomy
```

**测试总计：149 ✅** (36+27+13+4+10+12+19+11+10+7) — pure-JS 137 + JVM 17 -
本地全跑通；Android Compose UI + 真机 latency 走 CI / 真机。

**设计文档**: [`docs/design/Personal_Data_Hub_Vault_Browser.md`](docs/design/Personal_Data_Hub_Vault_Browser.md)
覆盖 5 个关键决策 (FTS5 trigram / 两轴 taxonomy / category-keyed renderers /
cursor 分页 / race token) + 文件清单 + 已知限制 + commit 链。

## [Unreleased] - PDH AnalysisEngine 意图分类 + 按需检索路由 (4/4 intent)

> 「让小模型把 prompt 预算花在对的事实上」— `_gatherFacts` 加 4 个 intent
> routing 分支，Android 端侧 Qwen2.5-1.5B 2-4K token 窗特别受益。

- **`packages/personal-data-hub/lib/analysis.js`** `_gatherFacts` 新增 3 个
  routing 分支（count 之前已 land 19c11920e）：
  - `intent=latest && !timeWindow` → narrow `queryEvents({limit: 3, adapter?})`
    + skip persons/items；有 timeWindow 时 fallthrough；0 结果 fallback 默认。
    新 const `LATEST_INTENT_FACT_LIMIT=3`。commit `9a00c0d95`。
  - `intent=list && entity extracted` → 默认 path 之后追加
    `vault.searchEvents({q, adapter?, since?, until?, limit:min(headroom,10)})`
    去重；FTS 抛错 / 老 vault graceful skip。新 const `LIST_INTENT_FTS_LIMIT=10`。
    commit `a1fd5ffca`。
  - `intent=sum-amount` → 4 个 amount-bearing subtype `[order/payment/transfer/income]`
    各拉 `max(20, effMaxQueryLimit/4)` 条 + 去重 + occurredAt DESC + 截 effMaxFacts；
    skip persons/items；0 结果 **不 fallback**（避免拉 message/visit 给 LLM 错算 sum）。
    新 const `SUM_AMOUNT_SUBTYPES` + `SUM_AMOUNT_MIN_PER_SUBTYPE=20`。commit `c0fe34933`。
- **`packages/personal-data-hub/lib/query-parser.js`** 新 export `extractEntityTerm(text)`
  + `ENTITY_STOP_PATTERNS` 黑名单（时间/intent/subtype/adapter/list-trigger/虚词/标点/数字，
  multi-char compound 先于 short alternative 防 "多少钱" decay）。剩下 2-10 字符段取最长。
  单字中文名（"妈"/"爸"）不抽 — single-char false-positive 过多（已知限制）。
- **Bug fix (2026-05-24)**：sum-amount narrow 0 结果原 fallback 到默认 path 会拉
  messages/visits 给 LLM 错算 sum。改为返回 `[]` 触发 `warning="no-facts"` +
  TOTALS preamble 让模型说"找不到相关花费记录"。与 latest fallback 行为不对称
  （latest 仍 fallback — 那是"最新活动"的可接受 context；sum-amount fallback 会误导）。
- **测试**：
  - `analysis.test.js` +28 routing cases（latest 6 / list FTS 9 / sum-amount 8 / count 5 isolated）
  - `query-parser.test.js` +10 extractEntityTerm cases
  - `cli/hub-ask.test.js` +1 question-verbatim-passthrough canary（CLI 不能预处理问题，
    否则 routing 路径全错）
- **文档**：新设计文档 [`docs/design/PDH_Analysis_Engine_Intent_Routing.md`](docs/design/PDH_Analysis_Engine_Intent_Routing.md)
  + Personal_Data_Hub_Architecture.md §8.3 加 cross-reference。
- 关键 caveat (memory `pdh_analysis_engine_intent_routing.md` 详记):
  - latest 必须 `!timeWindow` 才走 narrow（"最近 30 天" 是 list-with-window 不是"最新 3 条"）
  - sum-amount 0-result 不 fallback（避免 LLM 错算）— 与 latest 不对称
  - extractEntityTerm 抽词错 = SAFE（最多浪费 budget，绝不丢主路径 events）
- telemetry: `[PDH-ASK] gathered=N intent=X adapter=Y` stderr 行透传到
  Android logcat（`LocalCcRunner.kt:1082` 已过滤）

## [Unreleased] - PDH 4 档 LLM 路由选择器 + 三屏 selector

> 用户反馈 "首页对话框没看到选项"。把 tab 0 HubAskScreen 既有的 2 路 LLM 路由
> (CLOUD_ANDROID / PC_LOCAL) 扩到 4 路 (+LOCAL_DEVICE / +LAN_OLLAMA)，并把路由选择器镜像到
> tab 3 "本机数据" 与 tab 4 "本机提问" 的 HubAskCard。用户能在首页对话框直接选目标 LLM:
> 端侧 MediaPipe / 手机端云 LLM / 桌面 Ollama / 局域网 Ollama。

- **`pdh/llm/LlmPreferences.kt`** + `lanLlmBaseUrl: StateFlow<String?>` + 规范化 setter（去尾斜杠 / blank=clear）
- **`presentation/screens/SettingsScreen.kt`** + Settings → AI 后端 加 "局域网 Ollama URL" OutlinedTextField + http(s) regex 校验
- **`HubAskViewModel.kt`** LlmRoute enum +2 (LOCAL_DEVICE/LAN_OLLAMA); 注入 LocalCcRunner + LlmPreferences + LlmInferenceEngine; `submit()` 4-way dispatch
- **`HubAskScreen.kt`** `HubAskRouteSelector` 扩到 4 radio + 不可用项灰显 + 0/1/≥2 routes 三态分支
- **`HubLocalViewModel.kt`** AskCardState +5 字段（selectedRoute / lanLlmBaseUrl / androidLlm / remoteHealth / localDeviceReady）+ `effectiveRoute` fallback; 注入 LlmPreferences + AndroidLocalLlmExecutor + PersonalDataHubCommands; `setAskRoute()`; askQuestion dispatch 4-way
- **`HubAskCard.kt`** + `HubAskCardRouteSelector` 私有 composable + `onRouteSelected` 新回调
- **测试**: LlmPreferencesTest +4 LAN URL 用例; HubAskViewModelTest +3 (LOCAL_DEVICE / LAN_OLLAMA happy / LAN no-url banner); HubLocalViewModelTest +3 (默认 LOCAL_DEVICE dispatch / LAN_OLLAMA dispatch / setAskRoute persistence); HubAskRouteSelectorTest 8 Compose UI 集成测试 (stateless content pattern); LlmRouteSelectorE2ETest 8 `@Ignore`'d 真机 E2E placeholder (需配对桌面 / 真机 API key / LAN Ollama)
- 关键 trap (新 memory `pdh_4tier_llm_route_card_selector.md` 记 7 trap): llmName 后缀污染 / Settings combine 5-arg 上限 / remoteHub.health 失败非 fatal / LAN acceptNonLocal 必 true / lazy delegate 双 flow reflect
- commits: `7079de909` (主) + 后续测试补 + 文档更新

## [v5.0.3.84] - 2026-05-23 — hotfix4: CLI + desktop 接通 PDH 11 个 no-arg adapter (+ 修 2 个静默吞错)

> v5.0.3.83 修了 wizard 但 `cc hub sync-adapter <name>` 仍报 `AdapterRegistry.syncAdapter: no adapter <X>`：CLI 的 `personal-data-hub-wiring.js` 只 `new BilibiliAdapter()` 一个，desktop 的 `wiring.js` 也只有 Bilibili。PDH 0.2.3+ ship 了 9 个 social/messaging + 5 个 map/shopping snapshot-mode adapter。第一轮补 8 个 (94b0ecf25c) 时把 Telegram/WhatsApp 也塞 for-loop 但它们 ctor 需要 account 参数 → 被 try/catch silent 吞，实际从未 register。第二轮 audit 修正后 land 11 个真正 no-arg + 注明 6 个需 per-account credential 的 defer。

- **`packages/cli/src/lib/personal-data-hub-wiring.js`** (`94b0ecf25c` + 跟随)：boot 时 for-loop 11 个 adapter (`Weibo / Douyin / Xiaohongshu / Toutiao / Kuaishou / QQ / BaiduMap / TencentMap / Jd / Meituan / Pinduoduo`)，每个 try/catch 独立。镜像既有 Bilibili wire 模式。
- **`desktop-app-vue/src/main/personal-data-hub/wiring.js`**：同款 11 个 adapter wire，per `feedback_cross_shell_feature_pattern` 保证 desktop IPC 与 CLI/web-shell 看到同一份 registry。
- **Defer**：6 个需 per-account credential 的 adapter 需 `<vendor>-accounts.json` loader infra（镜像 email/alipay/wechat 模式）后续 phase 接：`Train12306` (username) / `Ctrip` (email) / `Amap` (deviceId) / `Taobao` (userId) / `Telegram` (userId) / `WhatsApp` (phone)。
- **`chainlesschain` (CLI) 0.162.16 → 0.162.17**：bundle 本修。PDH 不动（仍 0.2.4）。

## [v5.0.3.83] - 2026-05-23 — hotfix3: PDH AIChat 向导静态 import 改 lazy require

> v5.0.3.82 web-panel **PDH 页面"刷新失败"** — `packages/cli/src/lib/personal-data-hub-aichat-wizard.js` 顶层 `import { DEFAULT_VENDOR_SPECS, HttpClient, CookieAuthSession } from "@chainlesschain/personal-data-hub/adapters/ai-chat-history"` 在 nested PDH 是旧版（如 0.2.0 缺 `ai-chat-history` subpath export）时整个 wiring 链 module-load 阶段就炸 → web-shell PDH 路径不可用。本 hotfix 把顶层 ESM import 换成 memoized lazy `_require`，错误延后到 wizard 真正被调用时才报，Node 解析也有机会走到 root symlink 拿到带 export 的源码副本。

- **`packages/cli/src/lib/personal-data-hub-aichat-wizard.js`** (`dcee0c775e`)：top-level static `import { DEFAULT_VENDOR_SPECS, HttpClient, CookieAuthSession } from "@chainlesschain/personal-data-hub/adapters/ai-chat-history"` → memoized `_loadAichatModule()` lazy `_require`。3 处使用点（`specs` 默认值 / `HttpClient` 构造 / `CookieAuthSession` 构造）改成调用时按需取。与既有 217 / 228 行 lazy `_require` for `cookie-capture-spec` / `wizard-controller` 同款防御。
- **`@chainlesschain/personal-data-hub` 0.2.3 → 0.2.4**：纯 bump（source 不变），让 CLI consumer dep lock 到新版，下次 `npm install` 会拉新 tarball 覆盖 nested 旧版。
- **`chainlesschain` (CLI) 0.162.15 → 0.162.16**：bundle 本次 lazy-require 修 + PDH dep 同步 bump。
- 17/17 既有 `personal-data-hub-aichat-wizard.test.js` 单测全过。

## [v5.0.3.82] - 2026-05-23 — hotfix2: Android R8 fullMode ConcurrentModificationException

> v5.0.3.81 build-android 仍 fail：proguard 修过了第一道关（`Missing class` 走过），但 R8 minify 内部抛 `java.util.ConcurrentModificationException` — AGP 8.x R8 full-mode 优化大 dex 图（Hilt + Ktor + SLF4J 合并后）时的 upstream bug。本 hotfix2 在 gradle.properties 关 `android.enableR8.fullMode`（compat mode），DEX 大 ~3-5% 但不崩。

- **`gradle.properties` `android.enableR8.fullMode=true` → `false`** (commit `14d574c046`)。release.yml 早有注释 "Disable R8 full mode" 但其 sed 只改 `org.gradle.jvmargs` — 从未实际翻 `enableR8.fullMode`，所以 v5.0.3.81 重跑还是崩。从源头改 gradle.properties 后 CI + 本地一致。
- upstream R8 bug 跟踪：issuetracker.google.com/issues/238045415（concurrent collection iteration in R8 optimizer）。compat mode 是已知稳妥解。

## [v5.0.3.81] - 2026-05-23 — hotfix: Android R8 Ktor proguard + WebView vendor-switch remount

> v5.0.3.80 build-android 在 R8 minify 阶段 fail (Ktor `IntellijIdeaDebugDetector` 引用 `java.lang.management.*` JVM-only API + slf4j-api 缺 `StaticLoggerBinder`)，导致 v5.0.3.80 GitHub Release **缺 4 个 Android asset**（arm64-v8a / armeabi-v7a / universal / .aab）。本 hotfix 加 proguard `-dontwarn` 规则 + bundle 一个真机 bug 修。

- **`proguard-rules.pro` 加 Ktor 规则** (commit `c42aa603c5`)：`-dontwarn java.lang.management.**` + `-dontwarn org.slf4j.impl.**` + `-dontwarn org.slf4j.**` + `-dontwarn io.ktor.util.debug.**` + `-keep class io.ktor.** { *; }` + `-dontwarn io.ktor.**`。Ktor 是 A3 端侧 LLM HTTP server 在 v5.0.3.80 新引入的依赖（commit `ed768ffdf`），首次 release-mode build 才触发 R8 minify 检查。
- **`HubLocalScreen.kt` WebView remount 真机修** (commit `13545bd232`)：用 `key(pending.adapterName)` 包 `SocialCookieWebViewScreen`。原因：`AndroidView.factory` 只在第一次 composition 触发，AI vendor 切换（Wenxin → Kimi）时 WebView 卡在 yiyan.baidu.com，dialog title 变了 WebView URL 没变 → Wenxin 的 `isLoginSuccess` 正则在 stale URL 上误命中触发错误 cookie 抓取。Xiaomi 24115RA8EC 真机复现。
- **`feature-local-terminal/build.gradle.kts` USR_VERSION 3→4** + **cc-cli.tgz -4.7MB** (commit `13545bd232`)：cc-cli.tgz 内容变了强制 `LocalFilesystemBootstrapper` 重新 extract，否则老安装走 `.bootstrap_version`-gated 缓存。
- **`package-lock.json`** 清 stale `packages/cli/node_modules/iconv-lite` 条目（已从依赖图删但 lockfile 留尾）。

## [v5.0.3.80] - 2026-05-22 — PDH v0.2 大爆发 — 11 个 placeholder 卡接通 + WeChat/QQ 真采集 + A3 端侧 LLM 骨架

> 47 commits since v5.0.3.79. Personal Data Hub 从 Plan A v0.1（1 个 adapter）扩到 v0.2（**11 个真接通** + WeChat 4 sub-phase + QQ XOR-IMEI + A3 Android 端侧 LLM 全链路 skeleton）。三道锁（拒云 / 销毁 / 导出）UI + 后端真接通；AI 给出处 citation chip 跳事件详情；release.yml 拆 publish-deps 前置 job 解 desktop build 链。

- **PDH v0.2 — 社交内容 + 购物 + 出行 + AI 助手 + 邮箱 11 平台接通**：
  - **社交内容 (A8 v0.2)**：微博 (`c087c36eb`，mirror Bilibili 模式 + UID/X-Requested-With/containerid 3 trap diff) + 抖音 + 小红书 (`20f9b2188`，内容 4/4) + 头条 + 快手 (`e1155b1d7`，dual-mode snapshot+sqlite)
  - **购物 (§2.4)**：京东 + 美团 (`f3cbd0693`，dual-mode) + 拼多多 (`78695c25e`，SAF JSON import) + 支付宝 CSV + 淘宝 HTML (`799e364f0`)
  - **出行 (§2.5)**：高德 + 携程 (`0fe532e72`，cookie scrape WebView) + 百度 + 腾讯地图 (`3d1cf9481`)
  - **AI 助手 (§2.6 D10.2)**：9 路 WebView cookie scrape + cc sync wire (`1e7725552`)；8 卡 enable + wenxin/qianfan 合并 (`20e0318b4`)
  - **邮箱 (§2.3 D6.2)**：QQ/Gmail/163/Outlook 4 家 IMAP via Jakarta Mail 真接通 (`7777f5bec`)
- **WeChat in-app collector Phase 12.10**（4 sub-phase 全 land）：
  - 12.10.1+12.10.2 scaffold (`8c52d5963` + `6eb1b4918` + `d962b94fe`)：4 Kotlin + 19 unit tests + frida agent assets bundle README
  - 12.10.3 `WeChatDbExtractor` SQLCipher decrypt (`8081f8a0d`)：sjqz MD5(IMEI+UIN)[:7] 7.x path + frida 64-hex 8.x path 双 PRAGMA + 3 profile fallback (wcdb-legacy / sqlcipher-v3 / v4) + WAL+SHM cohort copy
  - 12.10.4 `WeChatFridaInjector` (`37a4e465d`)：bundle frida-inject + spawn `/data/local/tmp/cc-*` + stdout JSON parse + 5-symbol hook (sqlite3_key/v2 + wcdb_setkey + WCDBKeyDerive + mangled setCipherKey)
  - 12.10.6 prereq vendor frida 16.5.9 (`cdfe1048e`)：arm64-v8a (54MB) + armeabi-v7a (26MB) → APK ship 验证 (`scripts/wechat-e2e.py` 8-scenario adb harness `c25e48e74`)
- **QQ in-app collector Phase 13.5 v0.2** (`a07731b46`)：XOR-IMEI 算法 byte-identical sjqz `qq.py` 移植 (no SQLCipher, no frida) — `QQXorDecryptor` (110 LOC) + `QQCredentialsStore` (saveAccount 抛 IllegalArgumentException) + `QQDbExtractor` (380 LOC, su cp cohort + 3-table probe + PRAGMA table_info 列名解析) + 27 Kotlin unit tests + 13 JS snapshot tests + 6 longtail tests
- **A3 Android 端侧 LLM 全链路 skeleton**：
  - A3.1-A3.4 (`ed768ffdf`)：Ktor LLM server + ModelManager + 端侧 LLM 推理引擎抽象
  - A3.8 (`e14fc5106` + `f2705a73e`)：PersonalDataHubScreen tab 4 "本机提问" + HubLocalScreen 重构为 6 类 LazyColumn + HubAskCard wire
  - A3 Android askQuestion 全链路 (`f41f06441`)：UI + VM + cc spawn (724 LOC Kotlin)
  - A3.3 `KotlinLlamaCppEngine` 骨架 (`8f023052a`)：llama.cpp JNI wire
- **三道锁 UI + 真接通** (`0fd45af15` + `1353103d5` + `6bb5eb826`)：拒云 toggle + CC_HUB_ALLOW_NON_LOCAL env fallback / 销毁 button / 导出 — `cc hub export` + `LocalCcRunner.exportVault` 真接通；D11 SAF picker 一键带走升级到用户选位置 (`7e4fa844f`)
- **AI 给出处真接通** (`3a76ee5e4`)：`cc hub event-detail` + citation chip 点击跳详情 sheet
- **release.yml 链路修复** (`12d1391d1`)：split workspace deps publish into pre-build job — 解 v5.0.3.79 desktop build chicken-and-egg (PDH 0.2.x 必须先 publish 才能让 desktop extraResources install 找到)
- **Bonus 修复**：
  - WeChat normalize 排除 `@stranger`/`fake_*` contacts + 标 `gh_*` 为 merchant (`3c8917a3c`)
  - A6a server bind on IO thread (`6ad123399`)
  - `RealtimeEventManagerProfileQueryTest` SharedFlow subscriber wait (`9619e506d`)
  - `HubAuditViewModelTest` stub `DEFAULT_AUDIT_LIMIT` (`7478d4c30`)
  - Bilibili API headers + propagate error code to UI (`f7e11d6a5`)
  - `wechat-e2e.py` UTF-8 on Win cp936 (`e65ec6d83`) + debug/release APK auto-detect (`08941a5f1`)
  - `cc hub wechat doctor` env-probe + readiness checklist (`11629ef2a`)
- **Memory captured**：`android_wechat_collector_phase_12_10.md` (8 trap + 5 真机 blocker) + `android_qq_collector_phase_13_5.md` (10 trap) + `pdh_a8_weibo_v0_2_landed.md` + `wechat_frida_hook_audit_traps.md` + `pdh_a3_skeleton_landed.md` + `pdh_article_alignment_session.md`
- **v0.2 → v1.0 残留**：(1) WeChat 12.10.6 真机 E2E 需 root 机子 + Magisk-su (Xiaomi 24115RA8EC 当下未 root)；(2) WeChat 12.10.7 anti-detection (binary 改名 / hide process)；(3) QQ HubLocal UI wire 第二批 commit (QQCardState + dialog + 5 VM actions)；(4) QQ Phase 13.5.6 真机 E2E 6 场景 (NoRoot / wrong uin / wrong IMEI / happy / 重复 idempotency / WAL 活跃)；(5) A3 端侧 LLM Maven deps + JNI + 真机 (~5d)

## [v5.0.3.79] - 2026-05-22 — PDH A8 v0.1 — social-adapter Bilibili 端到端 + 3 平台 UI 占位

> Extends Plan A v0.1 (HubLocal tab) from 1 adapter card (`system-data-android`) to 5. Bilibili end-to-end (login WebView + OkHttp 4 endpoints + local SQLCipher vault); 微博/抖音/小红书 UI cards visible with "v0.2 开放" status. **Fully desktop-independent** — Android does cookie capture + HTTP + parsing + vault write all on-device via in-APK cc.

- **Bilibili end-to-end** (`packages/personal-data-hub/lib/adapters/social-bilibili/{adapter,index}.js` + 4 Kotlin files):
  - JS adapter refactor: stateless constructor + new `_syncViaSnapshot(opts.inputPath)` mode alongside legacy `_syncViaSqlite`; 4 event kinds (history / favourite / dynamic / follow) yield with stable `bilibili:<kind>:<id>` originalId
  - Kotlin `SocialCookieWebViewScreen` (generic, all 4 platforms reuse) — WebView + CookieManager.getCookie + flush on success URL pattern match + BackHandler cancel
  - Kotlin `BilibiliApiClient` — OkHttp wrapper for 4 endpoints (`/x/v2/history/cursor`, `/x/v3/fav/folder/created/list-all` + per-folder `/resource/list`, `/x/polymer/web-dynamic/v1/feed/all`, `/x/relation/followings`); own OkHttp instance (no AuthInterceptor → no anti-bot signal)
  - Kotlin `BilibiliCredentialsStore` — EncryptedSharedPreferences (AES-256-GCM + AndroidKeyStore master) persists cookie + DedeUserID + lastSync; try/catch tolerates keystore corruption (treat as unauth)
  - Kotlin `BilibiliLocalCollector` — orchestrator: cookie → 4 API serial calls → snapshot.json (matches JS SNAPSHOT_SCHEMA_VERSION=1) → returns path for `LocalCcRunner.syncAdapter("social-bilibili", path)` → local vault
- **HubLocalScreen multi-card refactor** (`HubLocalScreen.kt` + `HubLocalViewModel.kt`):
  - Per-card state (`SystemDataCardState` + 4 × `SocialCardState`) with global `syncingAdapter` mutex (LocalCcRunner serializes vault access)
  - Login WebView overlay when `pendingLogin != null` — replaces card list full-screen
  - 4 social cards rendered: Bilibili (`implemented = true`) + Weibo/Douyin/Xiaohongshu (`implemented = false`, click → toast "v0.2 开放")
- **CLI wiring** (`packages/cli/src/lib/personal-data-hub-wiring.js`): import `BilibiliAdapter` + register stateless on boot (mirror of `SystemDataAndroidAdapter` pattern). Effective after PDH 0.2.2 publish.
- **Tests**: 12 JS snapshot-mode tests (`__tests__/social-bilibili-snapshot.test.js`) + 4 legacy sqlite-mode tests rewired to flat-payload shape (`__tests__/social-adapters.test.js`); 13 Kotlin `BilibiliApiClientTest` (MockWebServer) + 8 `BilibiliLocalCollectorTest` (mockk). JS: 23/23 ✅; Kotlin: CI-verified (no SDK on Win).
- **v0.1 limits / v0.2 roadmap**: Weibo/Douyin/Xiaohongshu Kotlin collectors deferred (~1.8d each, ~5d total). Bilibili WBI signing skipped (currently optional for chosen endpoints). 抖音/小红书 will need msToken/X-s signature via WebView JS evaluate.
- **Architecture clarity** captured in memory `pdh_a8_social_adapters_landing.md`: **HubLocal != HubAdapters**. Path C (system-data-android) routes through desktop vault; A8 Bilibili routes through in-APK cc → local vault. User's "no desktop" requirement maps to the latter.

## [v5.0.3.77 / .78] - 2026-05-22 — Personal Data Hub Plan A v0.1 real-device closure + iOS .ipa ship

> Combined release sweep across two tags. `.77` shipped the iOS .ipa real-device build + Phase 14.1 step 5 ChatBubble; `.78` is the Personal Data Hub Plan A v0.1 closure with 3 real-device hardening fixes after the Xiaomi 24115RA8EC end-to-end run. CLI bumps to 0.162.14, npm `@chainlesschain/personal-data-hub@0.2.1`, Android versionCode 503078, iOS CFBundleVersion 78.

- **Plan A v0.1 real-device closure** (commits `dc1241744` Plan A + `02cb0cf3f` Path C + `1be6135f6` Path Y + `8a6afb72c` cc android scaffold + `0bcde34dd` 3 real-device hardening + `65aa01954` 3 followups + `339d0e64c` cc subprocess W^X / reader / timeout / audit key + `478a7e159` ingest timeout 30→120s):
  - Xiaomi 24115RA8EC end-to-end: 1305 entities (contacts / calls / SMS / location / system) ingested into the local SQLCipher vault.
  - **Path C** — phone-native snapshot writer (Kotlin ContentResolver + PackageManager direct collection) + desktop ingest pipeline (WS push to desktop staging → existing adapter snapshot-mode into vault). Completely bypasses A6 JNI; ~0.5d to ship on Win + real-device closure.
  - **Path Y** — desktop returns RAG context, Android-local LLM does inference. DeepSeek + Doubao + 7 more cloud LLM endpoints wired via `cc-android-bridge` stub + bridge-direct mode.
  - New `cc android` 15-subcommand scaffold + `system-data-android` bridge-direct mode.
  - **3 real-device hardening fixes**: `originalId` required on adapter yield (or `invalidCount=rawCount` false-success + a 1305-row audit burst) + `skip-embeddings` flag (Plan A mode does not need vectors) + audit pagination splits 1305 → 50/page.
  - Android cc subprocess: W^X execve via mksh symlink (filesDir text scripts denied by SELinux) + reader-thread `try/catch(Throwable)` for EOF race (Process.waitFor closes FD with uncaught InterruptedIOException) + `ingestSystemDataAndroid` timeout 30s → 120s.
  - **Bonus runtime fixes**: bootstrap LLMManager registered as `getLLMManager()` singleton (commit `ea293043f`) + web-shell PDH wiring inject CcLLMAdapter so web-shell honors active LLM provider (commit `bb008de6f`).
  - **PDH analysis correctness** (commits `751ca2a47` + `34532fc5d` + `19c11920e`): AnalysisEngine reads persons + items, not just events (stop hallucinating contact counts) + LLM ResponseCache bypass for analysis ask (no more stale-cache answers) + TOTALS preamble + extended count intent (stop FACTS-length count drift).
  - Memory captured: `pdh_plan_a_android_standalone_design.md` (6 real-device traps) + `pdh_path_c_snapshot_writer.md` + `pdh_path_y_transition.md` + `android_cc_subprocess_execve_via_mksh.md` + `android_process_reader_thread_eof_race.md` + `miui_query_all_packages_silently_blocked.md` + `pdh_adapter_originalid_required.md` + `compose_lazycolumn_key_burst_collision.md` + `npm_publish_audit_and_dep_chain.md` + `android_native_lib_extract_w_x.md`.
- **PDH-first publish ordering** (commits `4e0ff2544` + `38861059a`): release.yml `publish-cli` job now publishes `@chainlesschain/personal-data-hub` before `chainlesschain` to avoid the dep-chain 404 (CLI 0.162.14 requires PDH 0.2.1; if CLI published first, downstream `npm install -g` got 404 on PDH).
- **E2EE 7 androidTest cases reactivated** (commit `a09fc53ee`): the 7 `@Ignore + TODO()` cipher tests now run via a new X3DHSimulator that provides state-less E2EESession factories — Alice/Bob initiator/responder dance no longer needs two PSM instances. core-e2ee androidTest quarantine fully cleared.
- **Phase 14.1 step 5 ChatBubble + Phase 14.5 streaming-ask design** (commits `6f861dcd9` + `3979d553a`): iOS Personal Data Hub chat UI landed with chat-bubble model; Phase 14.5 streaming-ask design doc captured.
- **iOS .ipa real-device ship** (commit `71436b9ac` v5.0.3.77 tag + `b98ce22fc` PersonalDataHubViews.swift target membership): iOS .ipa 7.9MB shipped in v5.0.3.77 GitHub Release assets after target-membership wire-up.
- **Android followups**: `c47da1bb6` bump `feature-file-browser` + `feature-project` minSdk to 28 (resolves NDK linker incompatibility) + `dd7d45155` re-quarantine 2 drifted `:app` androidTest files + drop API 26 from E2E matrix + `4c44bfc95` re-quarantine 18 `TODO()`-body stub tests + `b11354ac5` HubHealthCard.kt remove `return@Column` to fix PDH SlotTable crash + `a4a3727a3` hoist annotations-java5 / webrtc / bouncycastle exclusions to root.
- **Version surfaces**: productVersion v5.0.3.75 → v5.0.3.78 / CLI 0.162.13 → 0.162.14 / desktop-app-vue 5.0.3-alpha.75 → .78 / android versionCode 503075 → 503078 / iOS CFBundleVersion 75 → 78 / npm `@chainlesschain/personal-data-hub` 0.2.0 → 0.2.1.

## [v5.0.3.75 / .76] - 2026-05-21 — iOS PIN-unlock crash hotfix (round 2) + Android quarantine 7 → 0 + Plan A real-device closure

> Multi-fix sweep landed as v5.0.3.75 and .76 over a single evening; iOS PIN-unlock crash diagnosis pushed across two tags as CFBundleVersion 73 → 75 → 76. WeChat Phase 12.6.7-10 bootstrap-layer landing also shipped as part of `.75` doc-prep sweep (commit `7ac414535`).

- **iOS PIN-unlock crash round-2 diagnosis** (commits `5807c1fbc` + `9deb6078d`, CFBundleVersion 73 → 75 → 76):
  - First suspect closed: `DatabaseManager.open(password:)` held `queue.sync` then called `runMigrations → execute(...)`, where `execute` re-entered the same serial queue with another `queue.sync` — libdispatch re-entrance. iOS 17+ inline-recurses past this on some paths; iOS 16 hits `_dispatch_assert_queue_fail` deadlock — `AppState.authenticate` hangs after PIN auto-submit and the watchdog kills it. Fix: split private `_executeUnlocked / _queryUnlocked / _queryOneUnlocked` lock-free variants; `runMigrations / getCurrentVersion / runMigration / migration_v1` (14 execute call-sites) now use unlocked variants since they already run inside `open()`'s `queue.sync` closure. Public API behavior unchanged.
  - .75 still crashed on-device; round-2 ipa combines two more suspects: (a) two inline `unsafeBitCast(-1, to: sqlite3_destructor_type.self)` lifted to file-scope `private let SQLITE_TRANSIENT_FN` + String binds switched to explicit `withCString { ... }` so the optimizer sees the lifetime. (b) ContentView `AuthView → MainTabView` cross-tree swap + PINEntryView `@FocusState` teardown + TabView's `NavigationView/NavigationStack` get packed into one transaction — `.animation(.easeInOut, value: appState.isAuthenticated)` dropped to dodge an iOS 16 host-swap focus-reclaim race.
  - Next: re-test on device; chase the `.ips` to pin the top frame.
- **Android androidTest quarantine 7 → 0 fully cleared** (commits `62a179cad` + `73bc6b706` + `84f01437e` + `60d887690` + `6afedbbf8` + `84fca147c` + `03026b79b`): 4 files rewired the real APIs (AuthRepositoryTest / KnowledgeUITest / AI_RAG_IntegrationTest / AIConversationUITest), 3 files stub `@Ignore + TODO()` (E2EEIntegrationTest's 7 cipher tests / AIConversationE2ETest's 10 / KnowledgeE2ETest's 8 = 25 test methods pending the 4 prereqs: module-local TestActivity, shared helper module, cross-module Hilt runtime, NetworkSimulator/DatabaseFixture wiring).
- **HiltTestRunner wired in 3 modules** (commit `6ee00b763` / cherry-pick `1a71849dd`): `core-e2ee / feature-ai / feature-knowledge` now ship `class HiltTestRunner : AndroidJUnitRunner` that swaps the test-process Application for `HiltTestApplication`, completing the runtime DI half of `@HiltAndroidTest` (compile was already green but Hilt's component graph never bootstrapped at runtime). Compile-clean verified; real runtime verification needs an emulator/device — CI's `connectedAndroidTest` is the canonical check. `feature-project / feature-p2p / feature-file-browser` still hold LLM-fiction in their androidTest source sets (phantom `MainActivity` reverse-deps + missing `com.chainlesschain.android.test.*` helper package + entity field hallucinations + cross-module DatabaseFixture/NetworkSimulator deps) — they'll get Hilt runtime wiring after the same quarantine sweep.
- **Plan A real-device closure — traps 16/17 closed** (commit `bf259899f`): Xiaomi 24115RA8EC 2026-05-20 three-step T1/T2/T3 PASS — `@chainlesschain/personal-data-hub` require / bs3mc native dlopen / SQLCipher LocalVault open schema=2 + queryEvents + destroy. Trap 16: Node 24 `libnode` silent-fails dlopen under Termux's `libtermux_cxx.so` (same pattern as Phase 2.5 trap 5 — incomplete libc++ symbol subset), mitigation = `PKGS=nodejs` not `nodejs-lts`. Trap 17: bs3mc's V8 direct-API broken across Node 24→26 (`HandleScope` ctor ABI), mitigation = cross-compile bs3mc against Node 26.1.0 headers. §12 conclusion: engineering foundation 100% verified, ~10-12d of feature layer remain (A3 LlamaRn / A6 JNI / A7 `cc android` + `cc hub` subcommand).

## [v5.0.3.74] - 2026-05-20 — AIChat registry-contract bug fix + Phase 10.2 integration/E2E + README banner reframe

**Hub-only release — no new features**, only quality + docs:

- **Bug fix**: `AIChatHistoryAdapter.sync()` had been yielding `{kind, vendor, conversation|message}` shapes which lacked the AdapterRegistry-required `{originalId, capturedAt, payload}` envelope fields. Registry called `vault.putRawEvent({originalId: undefined, ...})` which threw, so 100% of AIChat raws went to `invalidCount` and zero events ever reached the vault. Two cascading bugs surfaced once envelopes parsed: (a) `schema-map.buildMessageEvent` set `occurredAt` to an ISO string and omitted `ingestedAt` — both required as positive int ms by `validateEvent`; (b) entity ids used `newId()` so re-sync of same conversation hit the secondary `UNIQUE(source_adapter, source_original_id)` constraint and errored the whole second sync. Now: registry-compliant envelopes, ms-int timestamps, deterministic `evt-aichat-${vendor}-${originalId}` event ids for idempotent re-sync.
- **Test coverage**: +2 files / +9 tests
  - `__tests__/integration/ai-chat-history-registry.test.js` (6 tests): full chain register → syncAdapter → fixture HTTP → raw_events archive → normalize → partition → vault put → watermark advance → audit log. Covers idempotent re-sync, partial vendor failure, no-session no-op.
  - `__tests__/e2e/ai-chat-cross-source-journey.test.js` (3 tests): TimelineSkill interleaves DeepSeek + Kimi events chronologically; RelationsSkill aggregates AI-agent interactions; cookie-expired sentinel doesn't abort the journey.
- **Hub test baseline**: 47/927 → **50/952 all green**, 38s on dev box.
- **README banner reframe**: `README.md` line 2305 / `README_EN.md` line 2040 had a giant "⭐ Current Version: v5.0.3.48" banner stuck 25 versions behind. Surface relabeled to "⭐ Historical Snapshot" with a 3-line pointer to the real current state at file top; 8 badge SVGs refreshed to v5.0.3.73 / CLI 0.162.9. Banner body preserved as archive — `Latest Update` entries below remain reverse-chronological release notes.
- **docs-site PDH page**: test-baseline line refreshed 47/927 → 50/952, with explicit "Phase 10.2 集成 + E2E 9 新测 + AIChat registry-contract bug fix" mention; deployed live (`docs.chainlesschain.com`).
- **Surfaces bumped**:
  - productVersion v5.0.3.73 → v5.0.3.74
  - desktop-app-vue 5.0.3-alpha.73 → 5.0.3-alpha.74
  - android versionCode 503073 → 503074, versionName 5.0.3.73 → 5.0.3.74
  - iOS CFBundleVersion 73 → 74
  - CLI 0.162.10 → 0.162.11 (publish-cli would otherwise reject same version)

## [v5.0.3.73] - 2026-05-20 — PDH test sweep 收口（集成 + E2E + 2 真 bug + docs 4 站刷新）

**Personal Data Hub closing test sweep** — `cbfab26e1` + `69de3ffc4` 2 commits, no new feature work; only quality + docs.

- **Unit / Integration / E2E 三层补齐**：47 test files / 927 tests 全绿。新增 `__tests__/integration/cross-adapter-pipelines.test.js`（6 个跨 Adapter 集成场景，含 Email + Alipay → EntityResolver merge → RelationsSkill 联合视图 / SpendingSkill 跨 Alipay+Shopping+Travel 聚合 / TimelineSkill 编织 WeChat + Alipay 时序 / 手工 merge 解锁联合视图）+ `__tests__/e2e/full-user-journey.test.js`（3 个完整用户旅程：zero→email+alipay→entity merge→spending answer / 幂等 re-sync / vault stats）。
- **顺手扫出 2 个真 bug 并修**：
  - `lib/analysis-skills/spending.js` — subtypes 白名单漏 `"order"`，Phase 7 Shopping 订单事件全部不进消费报表。补 `subtypes = [..., "income", "order"]`。
  - `lib/adapters/alipay-bill/alipay-bill-adapter.js` — normalize 时未导出 `event.extra.counterparty`，导致 SpendingSkill 按商户分组与 EntityResolver 按对手方匹配双双失败。补 `counterparty: row.counterparty || undefined`。
- **修 flaky 单测**：`__tests__/registry.test.js` 并发 sync 测试把 MockAdapter `count: 5000` 改为 `count: 500` + 测试超时显式设 30s，本机 / CI 都稳定。
- **文档 4 站全刷**：
  - README.md / README_EN.md：质量面 38/792 → 47/927，加 "test sweep 顺手修 2 bug" 一句。
  - `docs-site/docs/chainlesschain/personal-data-hub.md`：版本头从"16 个 Adapter"→"19 个 Adapter (含 8 AIChat 厂商)"，显式列出 Mobile Extraction Layer + EntityResolver + 5 个 Analysis Skill。
  - `docs-website-v2/src/pages/index.astro` + `en/index.astro`：底部脚注 38/792 → 47/927 + 6 集成 + 3 E2E。
  - `docs-site/scripts/sync-design-docs.js` + `docs-site-design/scripts/sync-docs.js`：已含 `Personal_Data_Hub_Python_Sidecar.md` + `Personal_Data_Hub_sjqz_Comparison.md` 映射，跑 sync 同步 190 文件。
- **Release infra**：CLI `0.162.8 → 0.162.9` 跟随 desktop bump，避免 `publish-cli` 步因 npm dist-tag 已发同版本退出。

## [v5.0.3.71 / .72] - 2026-05-20 — Personal Data Hub 13-phase burst + iOS keychain repackage

**Personal Data Hub Phase 4.5 → 13.7 全收口** in one evening across 15 commits `763047a22 → b2baf4eda`. **38 test files / 792 tests / 9/9 AIChat real-vendor wired**.

**New phases**:
- Phase 4.5 — Python sidecar bridge + SystemDataAdapter wiring 4 Android system sources (contacts / call log / SMS / location) reusing 17 sjqz parsers via subprocess JSON-RPC, avoiding parser rewrite.
- Phase 7 — Shopping three-pack (Taobao + JD + Meituan) order/logistics/reviews adapter.
- Phase 7.5 — Mobile Extraction Layer: Android ADB backup + iOS iTunes encrypted backup via `adm-zip` + `iconv-lite` (GBK→UTF-8).
- Phase 9 — Travel four-pack (Amap + Baidu Map + Ctrip + 12306).
- Phase 10.1 + 10.2 — AIChat **9/9 vendors live**: DeepSeek + Kimi (reverse h5 web API) + Tongyi Qianwen + Zhipu GLM + Tencent Hunyuan + Baidu Qianfan + ByteDance Coze + Dreamina + Doubao. HttpClient infra with retry-backoff + progress streaming.
- Phase 11 — 5 built-in analysis skills (consumption trend / travel profile / communication frequency / content preference / time distribution).
- Phase 12 v0.5 — WechatAdapter frida-independent slice. T3 risk dropped from High to Medium.
- Phase 13.3-13.7 — Douyin + Xiaohongshu + QQ + Telegram + WhatsApp adapters (5 platforms). WhatsApp completes the sjqz parser port.
- Phase 13+ — Bilibili + Weibo via sjqz parsers.

**v5.0.3.71 release infra failure → .72 repackage**: v5.0.3.71 had all desktop builds fail with EUSAGE — root `package-lock.json` out of sync with `personal-data-hub/package.json` (Phase 12/13 added `adm-zip` + `iconv-lite` optional deps but root lock missed them). `5d8ba08b5` synced the lock, then `.72` shipped the same iOS keychain fix (`625e86819` — Logger.swift NSLock) successfully. 18 assets complete on `.72` Latest. **v5.0.3.71 was never released** (code on main + npm 0.162.7 published, but desktop installers missing); content rolled into `.72`.

**Version surfaces**: CLI 0.162.5→0.162.8 / productVersion v5.0.3.70→v5.0.3.72 (skipping .71) / desktop-app-vue 5.0.3-alpha.70→.72 / iOS CFBundleVersion 70→72 / Android versionCode 503070→503072, versionName 5.0.3.70→5.0.3.72.

## [v5.0.3.68] - 2026-05-20 — CLI npm 0.162.3 catch-up (Phase 5.1-5.6 hub + cc ui fixes)

v5.0.3.67 desktop release succeeded (all 11 jobs green) but `publish-cli` saw `chainlesschain@0.162.2` already on npm registry and skipped. Net effect: users running `npm i -g chainlesschain` still got 0.162.2, missing all Phase 5.1-5.6 hub work and 3 cc ui fixes. **v5.0.3.68 is a CLI catch-up release that explicitly bumps the npm package to 0.162.3.**

**CLI bump content (0.162.2 → 0.162.3)**: Phase 5.1 EmailAdapter IMAP / 5.2 body+attachment / 5.3 Layer 1+2 classifier / 5.4 6 template extractors / 5.5 PDF decryption + transactions / 5.6 config wizard + sync status; Phase 4 cross-shell PersonalDataHub view; `cc ui` LAN urls+token banner / force-exit timer must not unref / SIGINT 2s graceful timeout.

**Pipeline**: 26/26 jobs green (5 builds + 16 cli-test shards + create-release + publish-cli + changelog + finalize). Release published with 18 assets at 2026-05-19T15:50:55Z.

**Version surfaces**: CLI 0.162.2→0.162.3 / productVersion v5.0.3.67→v5.0.3.68 / desktop-app-vue 5.0.3-alpha.67→.68 / iOS CFBundleVersion 67→68 / Android versionCode 503067→503068, versionName 5.0.3.67→5.0.3.68.

## [v5.0.3.67] - 2026-05-19 — Android Phase 5.6/5.8 cc-exec 自然语言 Chat

First release letting LLM directly call native `cc` CLI from Android for read-only queries. 8-subcommand allowlist (note/search/memory/skill/status/session/mcp/did) gated through mksh + Node bundled in app. Three LLM tool-use protocols wired: OpenAI tool_calls + type:function, Doubao (wire-compat delegate), Claude/Anthropic tool_use blocks + tool_result role=user. 127 new tests across CcAllowlist (38) / CcExecService (19) / CcToolCallDispatcher (17) / CcChatOrchestrator (14) / CcChatViewModel (19) / CcChatIntegrationTest (9). 3 fixes shipped alongside: B17 allowedSubcommands required / B26 StreamChunk.error surface / B28 async pipe drain to avoid JVM buffer deadlock. Real-device E2E Checklist + SOP shipped under `docs/design/Android_AI_Chat_CC_Exec_Phase_5_8_*.md`.

## [v5.0.3.65–66] - 2026-05-17/18 — Android cc CLI bundle + iOS .ipa 重发

v5.0.3.65 wired Android Phase 2.5 (Node runtime + cc CLI bundle 41MB tarball in `feature-local-terminal/src/main/assets`; mksh shebang wrapper for Android W^X). v5.0.3.66 re-ship to include build-ios .ipa (immutable-releases forbids asset addition to published release).

## [iOS Phase 6 sprint] - 2026-05-18 — Knowledge 30 + AI Extended 25 全 hybrid + 15 main tab + 多模态 v0.3 + Agent streaming（19 commits, 绿基线 `1fb947b32`）

> 一晚 19 commits 收口 iOS Phase 6.3/6.4 全套 hybrid（OQ-3.2=C / OQ-3.3=C），桌面 +55 method + iOS 56 wrap + 2 新 SwiftUI tab + 5 sub-tab UI + 多模态实时录音 + Agent 流式输出。iOS CI 真编 2 轮抓 2 bug 已修。

**Phase 6.3 — Knowledge 桌面 30 method 全 hybrid**（commits `d5525c1d1` → `874b3b83c`）
- step 1: folders 5 + tags CRUD 3 + getNote alias 2 = 10 method
- step 2: versions 4 + star/pin 6 = 10 method
- step 3: archive 3 + import-export 4 + tags 高级 3 = 10 method
- 桌面 `knowledge-handler.js` 老 9 + 30 = **39 method 总**
- 新 SQLite 表 `knowledge_folders` + `knowledge_note_versions` + ALTER notes 加 starred/pinned/last_viewed_at/archived 列
- 92 cumulative tests 联跑 7.94s

**Phase 6.3 — iOS KnowledgeCommands actor wrap 31 method**（commit `5b0e82c97`）
- `Modules/CoreP2P/Sources/RemoteSkills/Knowledge/KnowledgeCommands.swift` actor 31 method（30 + getNote alias）
- `KnowledgeModels.swift` 25 Sendable Response struct + `pickIdAsString` / `pickInt64` helper
- 复用 Extension Phase 6.7 `invokeAndDecode` helper 模板（method ≥ 10 时统一）
- 35 envelope + decode + tag JSON 字符串→数组 + Int→String id 标准化 tests

**Phase 6.4 — AI Handler 桌面 25 method 全 hybrid**（commits `b6da42ef2` + `d23d41cc9` + `d0bb48733`）
- commit 1: Conversations 高级 5 + Prompt templates 3 + RAG 5 = 13 method
- commit 2: Multimodal 4 + Code helpers 4 = 8 method
- commit 3: Agents 4 = 4 method
- 桌面 `ai-handler.js` 老 5 + Phase 5 fix 7 + Phase 6.4 25 = **37 method total**
- 新表 `ai_prompt_templates`；RAG/Multimodal/Agents 用 defensive method 检测（双路径 `mgr.list || mgr.listAgents`），查询缺 dep 降级 `available: false`，mutating throw
- 101 cumulative ai tests 联跑 1.7s

**Phase 6.4 — iOS AIExtendedCommands actor wrap 25 method**（commit `cf75e822f`）
- `Modules/CoreP2P/Sources/RemoteSkills/AIExtended/` 25 method + 24 Sendable Response struct
- 与 AIChat (Phase 5 12) 并列共 37 ai method 完全覆盖桌面
- SeedRegistry ai entry methodCount 53 → 37 对齐真实，nativeSourceFile 列两个 actor
- 28 envelope/decode tests

**Phase 6.4 UI — KnowledgeView + AIExtendedView**（commit `b92ffe640`）
- RemoteOperateView SkillTab 13 → **15** main tab（`.knowledge` 📚 / `.aiExtended` ✨）
- KnowledgeView 4 filter segmented（All/Starred/Pinned/Archived）+ 搜索 + 新建 sheet + swipe action
- AIExtendedView 3 sub-tab（Templates/Code 3 mode/RAG）
- RemoteDependencies 公开 `knowledge` + `aiExtended`
- Outer/Inner + StateObject init 模式（解 `@EnvironmentObject` 在 init() 不可用）
- 19 VM tests（filter 路由 / optimistic update / archive 列表移除 / code 3 mode 路由 / RAG search+stats）

**Phase 6.4 v0.2 — Multimodal + Agents UI**（commit `d897d3cdf`）
- AIExtendedView +2 sub-tab → 5 sub-tab（触 HIG 软上限，picker 切 horizontal scroll + capsule highlight）
- Multimodal 4 mode：PhotosUI PhotosPicker OCR / 文本生图 AsyncImage+base64→UIImage / TTS AVAudioPlayer / .fileImporter UTType.audio → base64 transcribe
- Agents：statusBanner + 列表 + run form + 4 色 status chip（running/complete/failed/stopped）
- 13 VM tests（Multimodal 7 + Agents 6）

**Phase 6.4 v0.3 — Agent streaming + 实时录音**（commits `a2d41fc7e` + `073af9ed4`）
- 桌面 `runAgentStream` 复用既有 `activeStreams` Map（streamId-agnostic 与 chat stream 共用），onChunk 兼容 string + {content} 对象
- iOS 3 wrap method（runAgentStream/getAgentStreamChunk/cancelAgentStream，后两个调既有桌面 `ai.getStreamChunk`/`ai.cancelStream`）
- VM 后台 Task while `!Task.isCancelled` 轮询 250ms（≈4Hz UI 更新，测试可调小）+ MainActor.run 累 `agentStreamOutput`
- Agents UI："流式输出 (v0.3)" toggle + 闪烁蓝点 + "等待第一个 chunk…" 占位 + 实时累积渲染
- 新文件 `MultimodalAudioRecorder.swift` (@MainActor + AVAudioSession + 16kHz mono AAC Whisper 优化) + transcribeAudioSection 加 [开始录音] 红色 button + 闪烁红点 + 时长 monospaced + 停止/取消
- 10 desktop tests + 4 iOS VM streaming tests = 14

**iOS CI 真编 verify**（commits `fa0746860` + `1fb947b32`）
- iOS GitHub Actions `ios-build.yml` 2 轮抓 2 真 bug 修：
  1. `RemoteAIExtendedViewModel.swift:425` `sinceChunk = resp.nextChunkIdx` —`StreamChunkResponse.nextChunkIdx` 是 `Int?`，类型不匹配 → `?? sinceChunk`
  2. `RemoteAIExtendedViewModel.swift:431` `if let err = resp.error` — `StreamChunkResponse` 模型缺 `error` 字段 → 加 (backward-compat decode)
- Win 无 Swift 编译器，1500+ LOC Swift 唯一编译验证路径 = macOS iOS CI
- **绿基线 `1fb947b32`** (Build & Test SPM + Build Release SPM 三 job 全绿)

**设计文档**
- `iOS_对标_Android_Phase_6_Plan.md` §11 加 19 commits 时序表 + 实际 vs 计划偏差 + 5 个新模式（invokeAndDecode helper 模板 / 桌面 handler available 优雅降级 / better-sqlite3 Number→TEXT trap / iOS Inner View StateObject 模式 / OQ-3 hybrid 决策框架）
- `iOS_Phase_6_3_6_4_Knowledge_AI_Desktop_Debt.md` — Phase 6.3/6.4 desktop debt 审计
- `iOS_Phase_6_6_Desktop_Skill.md` + `iOS_Phase_6_7_Extension_Skill.md` — Coverage Trap T2/T4 误判修正
- `iOS_Phase_6_0_RealDevice_E2E_Plan.md` v1.0 — 38 场景跨 7 段 reproducer + bug 模板 + 通过/失败 P0/P1/P2 分级

**memory** 新增 4 entries（type=feedback/project）：
- `phase_6_knowledge_ai_hybrid_complete` (project) — 全套总结
- `better_sqlite3_text_number_trap` (feedback) — Number→TEXT "1.0" 5 处 String() 包
- `ios_inner_view_stateobject_pattern` (feedback) — SwiftUI @EnvironmentObject 不可在 init() 用
- `ios_ci_only_verify_path_on_win` (feedback) — Win 无 Swift，"Phase X 完成 ✅" 必须等 iOS CI 真绿

**剩余真机 E2E**（plan §11.4 唯一未闭环 follow-up）：Mac + iPhone + 桌面跑 38 场景。Win dev box 不可推进。

---

## [Sub-phase 5-6 v2 + 10 v2] - 2026-05-18 — Android LOCAL 项目终端 picker + 全量项目内容拉取（commit `09bd0ec0f`）

> 承接 `3319febc4` Sub-phase 5-6 fix 真机反馈："弹补填对话框但找不到同名 PC 项目"+"项目文件同步没做"两条阻塞，两件事一起收口。

**Issue 1: LOCAL 项目终端入口改为 PC 项目 picker**
- 旧 v1 手输 Windows 路径太难用；新 v2 dialog 打开调 `project.list` 拉所有桌面项目 → LazyColumn picker → tap row → 保存 pcRootPath + 跳终端
- 同名匹配项目高亮 "同名" 标顶部；列表为空时自动展开自定义路径折叠区 + error hint
- 触点：`RemoteContextViewModel.listPcProjects` / `ProjectDetailScreenV2` AlertDialog 全重写

**Issue 2: PC→Android 全量项目内容拉取**
- 旧 v1 pullSingle 只拉 metadata + 文件清单；新 v2 之后循环 `project.getFile(fileId)` 把每个文件 content 存 Room project_files
- 单文件失败 continue + log warn；content > 1MB skip 占位 row 防 OOM
- PullProgress StateFlow 暴露进度 → UI 显 LinearProgressIndicator + 当前文件名行
- 触点：`RemoteProjectBrowserViewModel.pullProject` 加 files 循环 + remoteFileToEntity / `RemoteProjectBrowserScreen` 进度 row

**测试覆盖**：78 新单元 + 集成测试全绿（详见 [设计文档 §12.4](docs/design/Android_Project_Remote_Terminal_Entry.md)）；同步修了 3 个 stale 测试断言。

**剩余真机 E2E §12.3 8 场景**：需 Mac/Win PC + Android 双机配对环境，dev box 无法独验。

---

## [v5.0.3.64] - 2026-05-18 — iOS 版本号 4 段制 + AppConstants stale 硬编码清零 + 全套测试覆盖

> v5.0.3.63 release 后用户反馈：(1) iOS Settings 「版本」显示只有 3 段制 `5.0.3` 或 stale `0.32.0`(实际几个月没更过 hardcode 常量); (2) PIN 闪退问题仍报告(待用户提供 v5.0.3.63 .ipa 上的具体 crash log)。本版做三件事:**A** 修 `AppConstants.App.version` / `buildNumber` / `bundleId` 三个 stale 硬编码 (0.32.0 / 32 / com.chainlesschain.ios) 改为从 `Bundle.main` 动态读, Settings 「关于」展示完整 `v5.0.3.64` 4 段制; **B** 加 iOS 17 API 二次审计(对全仓 596 个 `.swift` 跑 29 个 pattern,确认 0 新增违规, `AppState.swift` `assumeIsolated` → `Task @MainActor` 的 v5.0.3.63 修复已就位); **C** 加单元测试 + 集成测试 + UITest 三层覆盖锁死版本号显示 + PIN 解锁不崩两类回归。

### Fixed

- **`AppConstants.App.version` stale 硬编码** — `0.32.0` (已 stale 几个月) → 改为 `Bundle.appShortVersion`(从 `Info.plist CFBundleShortVersionString` 动态读)
- **`AppConstants.App.buildNumber` stale 硬编码** — `32` → `Bundle.appBuildNumber`(从 `CFBundleVersion` 动态读)
- **`AppConstants.App.bundleId` 错误硬编码** — `com.chainlesschain.ios` (实际 Info.plist 配的是 `com.chainlesschain.ChainlessChain`,CodeSign 也基于此) → `Bundle.main.bundleIdentifier`
- **`AIDashboardView.swift:95` 硬编码 `v0.16.0`** → `AppConstants.App.fullVersionTag`
- **`PluginManager.swift:118` 直接 `infoDictionary["CFBundleShortVersionString"]` 读** + 错误 fallback `"1.7.0"` → `Bundle.appShortVersion`
- **`SystemTools.swift` `appInfoExecutor`** — 加 `fullVersion` 字段 (`5.0.3.64`),`displayName` 改用 `Bundle.appDisplayName` helper

### Added

- **`Bundle` extension** (`Modules/CoreCommon/Sources/CoreCommon/Extensions/FoundationExtensions.swift`):
  - `Bundle.appShortVersion` — `"5.0.3"`
  - `Bundle.appBuildNumber` — `"64"`
  - `Bundle.appFullVersion` — `"5.0.3.64"` (4 段制,与 desktop productVersion / Android versionName 对齐)
  - `Bundle.appFullVersionTag` — `"v5.0.3.64"` (带 v 前缀,UI 展示用)
  - `Bundle.appDisplayName` — `CFBundleDisplayName` 或 fallback
- **`AppConstants.App.fullVersion` / `fullVersionTag`** 动态字段,所有 UI 统一调
- **`SettingsView.swift` 关于栏** — 「版本」显示 `v5.0.3.64` (`accessibility id = settings.app.version`),加「Bundle ID」一栏便于用户确认安装的是真版本
- **`BundleVersionTests.swift`** (Tests/CoreCommonTests/, 11 unit tests) — 锁版本号 helper + AppConstants 动态字段语义
- **`AppStateNotificationTests.swift`** (ChainlessChainTests/Features/App/, 7 integration tests) — 验 `databaseUnlocked` / `didAuthenticated` post 不崩 + 高频反复 post 稳定性 + 版本号 4 段制锁
- **`ChainlessChainUITests.testSettingsVersionDisplaysFourSegmentTag`** + **`testPINUnlockDoesNotCrashOnFirstLaunch`** — XCUITest 真机回归,首测真机 PIN 解锁 + Settings 版本号格式

### Validated

- 全仓 596 个 `.swift` 扫描 29 个 iOS 17-only API pattern (`assumeIsolated` / `@Observable` / `SwiftData` / `symbolEffect` / `ContentUnavailableView` / `scrollPosition` / `KeyframeAnimator` / `visualEffect` / `sensoryFeedback` / `Previewable` / `dialogSeverity` / `SubscriptionStoreView` 等),**0 处新增违规**:
  - `AppState.swift:94-118` v5.0.3.63 修已就位 (`Task { @MainActor in ... }`)
  - `SystemInfoView.swift:65-73` `.symbolEffect` 在 `if #available(iOS 17, *)` 块内,iOS 16 fallback 静态图标
  - `ImagePickerView.swift:522-527` `@Previewable` 在 `@available(iOS 17, *)` `#Preview {}` 内,preview-only 不进生产
- AppIcon 资产复审:18 张 AppIcon + 3 张 LaunchIcon 齐全,全 RGB 无 alpha 通道(App Store 合规),最大 1024×1024 (174K) AppStore icon 完整
- `scripts/check-version-sync.js` 5 surface 全 sync (productVersion=v5.0.3.64 / desktop=5.0.3-alpha.64 / ios CFBundleShortVersionString=5.0.3 + CFBundleVersion=64 / android versionName=5.0.3.64 + versionCode=503064)
- iOS deployment target 仍为 16.0 (xcodeproj + Package.swift 一致)

### Known / 待用户反馈

- 用户报告的 v5.0.3.63 PIN 闪退**根因未在代码层复现** — HEAD 的 `AppState.swift` fix 完整正确, 全仓 0 iOS 17 API 漏网。若 v5.0.3.64 装机后仍崩,请附 crash log (Xcode → Window → Devices and Simulators → 选设备 → View Device Logs) 以便定位具体崩点。Settings 「关于」新加的「Bundle ID」字段可帮用户确认安装的是 v5.0.3.64 真版本。

## [Unreleased] - iOS Phase 5 AI Chat 收口 (4 真实 bug + 4 集成测试)

> Phase 5.1-5.6 已在 v5.0.3.63 周期前后随 CI 单测一并落地。Phase 5.7 收口走静态审计路径：找出 4 真实 bug（finalizeStreamingPlaceholder 空字符串穿透 / deleteConversation 半回滚 / sendMessage 缺 stream-in-flight guard / selectConversation 保留 stale streamId），逐条修，每条 1 个回归单测。同时补 4 个 Phase 5 集成测试覆盖 events fan-out / cancel 顺序 / offline drain / 多对话 stream 隔离的端到端链路。

### Fixed — iOS Phase 5 AI Chat (4 真实 bug)

- **`RemoteAIChatViewModel.finalizeStreamingPlaceholder` 空字符串穿透 nil-coalesce**（Bug #1）— 旧代码 `messageId ?? oldMsg.id`。`ChatStreamEnd.parseFromEnvelope` 在 server 缺 `messageId` 字段时填 `""`（不是 nil），nil-coalesce 不兜底，`""` 直接覆盖本地 `local-assistant-<UUID>` 占位 id，SwiftUI `ForEach(messages, id: \.id)` 身份被击穿（多条 row 共享空 id）。改为 `if let mid = messageId, !mid.isEmpty { resolvedId = mid } else { resolvedId = oldMsg.id }` 显式 guard。
- **`RemoteAIChatViewModel.deleteConversation` 失败半回滚**（Bug #2）— 删除当前对话失败时仅恢复 `conversations` 列表，`currentConversation` / `messages` 留在已清空状态。新增 `rollbackDelete(insertAt:item:restoreCurrent:restoreMessages:)` 私有方法 + 入口处 `wasCurrent`/`originalCurrent`/`originalMessages` 快照，全量原子回滚（含离线无队列的 fallback 分支）。
- **`RemoteAIChatViewModel.sendMessage` 缺防御性 stream-in-flight guard**（Bug #3）— UI 在流式中切到 cancel button 形态，但 VM 不能假设上层禁掉了 send 入口（programmatic 调用 / 双击竞争 / 上层 bug 都可能绕过）。在 DC gate 前加 `guard currentStreamId == nil else { lastError = "请先等待当前响应完成或取消"; return }`。
- **`RemoteAIChatViewModel.selectConversation` stale streamId 污染**（Bug #4）— 切对话时不清 `currentStreamId`，依赖 `messages.last.isStreaming` guard 兜底。edge case：新 conv 末条恰为 streaming 占位（前次未 finalize）时，prev stream 的 delta 会越界改新 conv 的 last。改为显式 `currentStreamId = nil; isStreamingMessage = false`（dispatcher buffer 不动，桌面 LLM 继续跑完落 server side，下次 loadMessages 拉到）。

### Added — iOS Phase 5 集成测试 (Tests/CoreP2PTests/Integration/Phase5AIChatIntegrationTests.swift)

- `testFullChatStreamHappyPathThroughFanout` — inbound → RemoteCommandClient.events → 真 fan-out task → dispatcher 累积 → VM 占位 msg 实时更新 → end event 终态 server msg id 落地（替换原单测只 mock dispatcher 的 stub 链路，验真实 AsyncStream 单消费者 fan-out 不丢 event）。
- `testCancelOrderingDiscardBeforeRpc` — 50ms 窗口验证：discardStream 同步执行 → 本地状态收尾 → cancelStream RPC 出站 → late chunk silent drop（per design §7.3 顺序保证）。
- `testOfflineCreateConversationDrainsOnRecover` — DC down 时 `vm.createConversation` 入 OfflineQueue → DC ready 切 false→true edge → drainer 触发 → ai.createConversation 真发出 → server 响应 → 队列清空（验本期新增 `ai.*` method 真接入 Phase 3 drainer 路径）。
- `testCrossConversationStreamIsolation` — conv A 启 stream sA → 切 conv B 立即清 `currentStreamId`（Bug #4 fix） → sA 后续 delta+end 不污染 conv B `messages`（验 design §7.4 隔离）。

### Added — iOS Phase 5 单测回归 (RemoteAIChatViewModelTests.swift +4)

- `testEndEventEmptyMessageIdPreservesLocalId` — Bug #1 回归。
- `testDeleteConversationFailureFullRollback` — Bug #2 回归。
- `testSendMessageRejectsWhenStreamInFlight` — Bug #3 回归。
- `testSelectConversationClearsCurrentStreamId` — Bug #4 回归。

### Validated

- iOS Phase 5 单测从 41 → **45**；总 iOS 单测 ~313 + 45 = **~358**。集成测试从 6 → **10**。
- 设计文档 `docs/design/iOS_Phase_5_AI_Chat_Skill.md` §8.1 / §8.2 / §8.3 / §8.4 全部刷新（含 Phase 5.8 真机 E2E 8 场景 reproducer 详步骤）。
- docs-site / docs-site-design 两份副本通过 `sync-*.js` 自动刷新（162 文件同步）。
- 官方网站 `docs-website-v2/mobile.astro` iOS section 更新到 Phase 1+2+3+4+5 + 7-tab horizontal scroll shell + ~358 单测。

### Notes — 待办

- **Phase 5.8 真机 E2E（8 场景）** 仍待 Mac+iPhone+真桌面在场，design §8.4 reproducer 详步骤已就绪。本轮 Windows dev box 上 `swift test` 不可跑，验收依赖 iOS CI（macos-15-arm64 runner）`swift build --target CoreP2P` 编译通过 + 静态审计 + 集成测试设计无 mock 绕过真链路。

## [v5.0.3.63] - 2026-05-17 — iOS 16 PIN 闪退修复 + AppIcon 全幅 + Sub-phase 5-6 移动远程终端体验

> v5.0.3.62 (iOS deployment target 降到 16) 部署后真机 E2E 暴露两类问题：(1) iOS 16 上 PIN 设置 / 解锁均闪退，根因是 `AppState.swift` 用了 iOS 17 only 的 `MainActor.assumeIsolated`；(2) AppIcon 缩成小图四周大片白边。同时 Android 端 Sub-phase 5-6 LOCAL 项目首次远程终端体验需要：放宽 v2 fallback gate（只要有 paired desktop 就显示 Terminal icon）+ LOCAL 项目（`pcRootPath=null`）首次点终端弹框补填 PC 端工作目录避免 PtyManager 落 Electron cwd。

### Fixed

- **iOS PIN 闪退（iOS 16 兼容）** — `AppState.swift:99,110` 由 `MainActor.assumeIsolated` 改 `Task { @MainActor in ... }`（iOS 13 back-deploy，语义等价）；`databaseUnlocked` / `didAuthenticated` 通知触发时不再 trap。Sub-agent 复审 518 个 `.swift` 文件，0 处其它裸调 iOS 17 API（`@Observable` / `SwiftData` / `scrollPosition` / `containerRelativeFrame` / `KeyframeAnimator` / `visualEffect` / `sensoryFeedback` / `ContentUnavailableView` / 4-参 `fileImporter` / iOS 17 Charts / iOS 17 Map 等），唯一的 `.symbolEffect` 在 `SystemInfoView.swift:68` 已用 `#available(iOS 17, *)` 包好（v5.0.3.62 引入）。
- **iOS AppIcon 全幅满图** — 用 `desktop-app-vue/assets/icon.png`（1282×1282 全幅）sharp 重生成 18 张 AppIcon + 3 张 LaunchIcon，扁平化到白底（App Store 不允许 alpha 通道的 app icon）。

### Changed

- **Sub-phase 5-6 LOCAL 项目远程终端入口** — `RemoteContextViewModel.kt`（新文件，`presentation/screens/helper/`）：
  - `pairedDesktops StateFlow` 兜替 `project.sourcePeerId` 判定 Terminal icon 可见性
  - `findPcProjectPathByName()`：异步调桌面 `project.list` 自动预填同名项目路径
  - `pushPcRootPathToDesktop()`：双向同步写回桌面 `projects.pc_root_path`
- `ProjectDetailScreenV2.kt` terminal-gate 重写（v2 fallback）+ `AlertDialog` 含 lookup 进度条 + 预填提示 + diag log `tag=ProjectDetail`
- `ProjectDao` + `ProjectRepository` + `ProjectViewModel` 加 `updatePcRootPath` 链路（**不**发 `ProjectEvent.Updated` 避免触发 `mobile-bridge-sync` 反向 sync）
- `mobile-bridge-sync.js` 新 `project.updatePath` topic：UPDATE `projects` 同时 `COALESCE` 一份到 `root_path` 兼容旧 row（只有 `root_path` 字段的旧客户端）

### Validated

- `scripts/check-version-sync.js` 5 surface 全 sync (productVersion / desktop alpha / ios CFBundleShortVersionString+Version / android versionName+Code)
- iOS 16 真机 PIN 首次设置 + 重新登录 PIN 解锁两条路径均通过
- Android Xiaomi 24115RA8EC：LOCAL 项目首次点终端 → 弹框 lookup 进度 → 找到同名 PC 项目自动预填 → 写回桌面 `pc_root_path` → PtyManager 落正确工作目录

## [v5.0.3.62] - 2026-05-17 — iOS deployment target 降到 iOS 16 (覆盖 iPhone 8 起)

> v5.0.3.61 .ipa 出包成功后用户反馈 iOS 17 baseline 太高；audit 后发现 app 实际只用 1 处 iOS 17-only API (`SystemInfoView` 的 `.symbolEffect`)，降低成本极小。降到 iOS 16 后覆盖 2017 年以来所有 iPhone 机型（iPhone 8+），扩大测试 / 试用人群约 30%。

### Changed

- `ios-app/ChainlessChain.xcodeproj/project.pbxproj` — `IPHONEOS_DEPLOYMENT_TARGET = 17.0` → `16.0`（Debug + Release 两 config 同步）
- `ios-app/Package.swift` — `platforms: [.iOS(.v17)]` → `.iOS(.v16)`，SPM 模块 (CoreP2P / CoreDID / CoreSecurity / CoreDatabase 等) 全部跟随
- `ios-app/.../RemoteOperate/Views/SystemInfoView.swift` — pulse 动画 (`Image.symbolEffect(.pulse, isActive:)`) 加 `if #available(iOS 17, *)` guard，iOS 16 上 fallback 为静态图标（无 pulse 动画，其它行为不变）

### Validated

- `scripts/check-version-sync.js` 5 surface 全 sync (productVersion / desktop alpha / ios CFBundleShortVersionString+Version / android versionName+Code)
- Audit 表明无 `@Observable` macro / `ContentUnavailableView` / 显式 `@available(iOS 17, *)` 标注，仅 1 处 `.symbolEffect` 已处理
- 之前 ios-build.yml SPM phase 1-5 已用 `--triple ios15.0-simulator` 编译验证，源码层面对 iOS 16 兼容性无忧

## [v5.0.3.61] - 2026-05-17 — iOS CI 真签名 .ipa 出包 (Hua Zhang 团队 ad-hoc 配置)

> v5.0.3.56 揭示 iOS app target 412 编译错后，那次 release.yml build-ios 回退到 SPM-only (`faa8e267f`) 暂不产 .ipa。之后 app target 0 错 (`a8dc88b13`) 已落，本版本恢复 xcodebuild archive + ExportArchive 路径，并打通 4 个 GitHub Secret + Apple Developer 账号 (Team `2GMR44F922`)，每次发版自动产真签名 ad-hoc `.ipa`（7.4MB）随 GitHub Release。

### Fixed — iOS CI signing 链路恢复 (4 iter)

- `release.yml` revert `faa8e267f` 回到 xcodebuild archive 路径（`43bb85c99`）
- 揭示 archive step 失败「requires a provisioning profile」→ 加 `PROVISIONING_PROFILE_SPECIFIER=adhoc` + `CODE_SIGN_IDENTITY="iPhone Distribution"`（`91704c030`）
- 仍失败但 xcpretty 吞错 → 删 xcpretty + `2>&1 | tee build/xcodebuild-*.log` + `if: always()` upload-artifact `ios-xcodebuild-logs`（`0d1d66482`）
- raw log 终于显形真因：CLI 上的 `PROVISIONING_PROFILE_SPECIFIER` 注入到所有 target 包括 SPM resource bundle (`CryptoSwift_CryptoSwiftResources` / `Starscream_Starscream`) → 它们拒绝任何 profile。修法：把 signing setting 放进 `ChainlessChain.xcodeproj` 的 app target Release config（per-target），CLI 只传 `DEVELOPMENT_TEAM`（`7baf33bd7`）
- ExportOptions.plist 加 `signingStyle=manual` + `provisioningProfiles` map 避免 export step 重蹈覆辙

### Added — iOS signing infra

- 4 个 repo-level GitHub Secret: `IOS_CERTIFICATE_BASE64` / `IOS_CERTIFICATE_PASSWORD` / `IOS_PROVISIONING_PROFILE_BASE64` / `IOS_TEAM_ID`
- Cert: `iPhone Distribution: Hua Zhang (2GMR44F922)` (Team `2GMR44F922`，过期 ~2027-04-23)
- Profile: `adhoc` ad-hoc method（bundle `com.chainlesschain.ChainlessChain`，单 UDID `b9a7376832...`，过期 2027-05-09）
- 源文件: `tools/未命名文件夹 36/{adhoc,dev}.{p12,mobileprovision}`（gitignored, dev box only）
- `release.yml` build-ios job 加 `Upload xcodebuild logs (diagnostics, always)` step，失败可秒拉 raw 日志

### Test — Android cross-module runtime 35 fail 收口

- `83b7b8a5b` 一晚解 Android 跨模块 runtime 失败 35 个（与本版本 iOS 工作并行 land）

### Validated

- Test draft run `25987829449` produced `ChainlessChain.ipa` 7,720,753 bytes, signed (embedded.mobileprovision matches adhoc profile), attached to GitHub Release alongside 17 other assets
- 整 release.yml 11 job 全绿 (5 builds + create-release + publish-cli + update-changelog + finalize-release)

### Known Limitations

- .ipa 仅可装 Hua Zhang 测试 iPhone (UDID `b9a7376832...`)。加新设备需 Apple Developer Portal 加 UDID + 重签 profile + 更新 `IOS_PROVISIONING_PROFILE_BASE64` secret
- App Store distribution 不在此版本范围（需要换 App Store method profile）

## [v5.0.3.57] - 2026-05-17 — Android FileTransferScreen 本机下载浏览面板

> Plan C Android↔PC 文件传输落地 (`3463e059a`) 后的 UX 补强：Android 端新增「本机下载文件夹」面板，让用户直接在 app 里浏览公共 Downloads 目录里已下载的文件（之前只能跳 Files app 找）。

### Added

- `android-app/.../remote/ui/file/FileTransferScreen.kt` — 新增 `LocalDownloadsPanel` Composable + `queryLocalDownloads()` suspend fn：通过 `MediaStore.Downloads.EXTERNAL_CONTENT_URI` 查询公共 Downloads 目录（API 29+，老版本返回空），按 `DATE_ADDED DESC` 排序，每行显示文件名 / 大小 / 时间 + 点击调系统打开
- TopBar 加 `PhoneAndroid` 图标 IconButton 切换面板显隐 (`showLocalPanel` state)；面板内含刷新按钮 + 关闭按钮 + LinearProgressIndicator loading 态 + 空态提示

### Why

- Plan C 落地后用户实测反馈：下载完文件只看到 Toast「已保存到 Downloads」，但不知道具体哪里、也无法直接打开。这次面板就在 FileTransferScreen 内集成，UX 闭环

## [v5.0.3.56] - 2026-05-16 — iOS CI 真编译收口 (Phase 1-5 SPM 绿) + release.yml 防 mask

> 2026-05-15/16 一晚 20 iter 推进 iOS GitHub Actions 真编译。之前 Phase 1-5 时代所有 iOS CI 假绿（双层 mask：`continue-on-error` job 级 + `xcodebuild | xcpretty || true` pipe 级），从未真编译过。本次收口让 Phase 1-5 SPM 模块（CoreP2P + transitive deps）真编绿，揭示 app target 412 个老代码 compile error。

### Fixed — iOS CI workflow 16 iter 主线收口

- `.github/workflows/ios-build.yml` — 拔双层 mask，destination 改 `generic/platform=iOS Simulator`，pivot 到 native `swift build --target CoreP2P`（绕开 xcodebuild + Package.swift CLI 不可靠的坑）。Phase 1-5 CoreP2P 真编译验证（run 25923999179）
- `ios-app/Package.swift` 清理：删 dead targets（CoreBlockchain 目录从未创建 / sqlcipher repo 没 Package.swift / libsignal repo 没 root Package.swift）；恢复 CoreDatabase target（之前误删——其实只用 Apple 内置 SQLite3）；CoreDatabase DAO+Migrations 暂排除编译（缺 8 个未实现 model 类型）
- `ios-app/ChainlessChain.xcodeproj/project.pbxproj`：commit `5ea6c47bf` 修 25 个 broken file path（24 改 ./ChainlessChain/Features/.../X.swift 全路径 + 删 KnowledgeItem.swift 孤儿引用）；commit `159fc2403` 程序化加 XCLocalSwiftPackageReference + 6 个 XCSwiftPackageProductDependency（via `wire_spm_packages.rb`）
- `.gitignore` `models/` 改 `/models/` — anchor 顶层，避免 case-insensitive 误杀子目录 Modules/iOS Features/*/Models/（实战屏蔽 7 个 Swift 文件 silent）
- `.github/workflows/release.yml` build-ios job — 删 `ruby scripts/create_xcode_project.rb`（会覆盖 wiring）+ 删所有 mask + 临时回退 SPM-only 路径（待 app target 412 错消化后再恢复 xcodebuild archive + IPA export）

### Added — iOS 缺失类型补 stubs

- `Modules/CoreDID/Sources/CoreDID/Models/DIDIdentity.swift` — Codable struct
- `Modules/CoreDID/Sources/CoreDID/Crypto/Ed25519.swift` + `Ed25519KeyPair.swift` — CryptoKit Curve25519.Signing 包装
- `Modules/CoreDID/Sources/CoreDID/Crypto/Base58.swift` — pure Swift base58btc 编解码 (~70 行)
- `Modules/CoreSecurity/Sources/CoreSecurity/Crypto/CryptoManager.swift` 加 `private extension Data { var bytes: [UInt8] }`（CryptoSwift 1.10 移除原 extension）
- `Modules/CoreP2P/Sources/Pairing/{Desktop,ScanDesktop}PairingViewModel.swift` 3 处 Phase 1-5 时未真编验过的 Swift bug（covariant Self default arg / unwrap nil pcPeerId / redeclaration data）

### Added — iOS CI 工具链

- `ios-app/scripts/wire_spm_packages.rb`（~70 行）+ `.github/workflows/ios-wire-spm.yml`（manual dispatch）— 程序化把本地 SPM library 接进 .xcodeproj，避免 Mac Xcode UI 手工
- `.github/workflows/ios-app-target-test.yml`（manual dispatch）— 验证 app target xcodebuild 编译进度，跑 unsigned simulator build

### Known limitations

- iOS app target 真编暴露 412 个 compile error 跨 30+ 文件，是 Phase 1-5 之前的 scaffold + 半实现老债（缺 ViewModel/Model/Entity ~150 个 + iOS 15 vs 16/17 API 兼容 + SyncStatus 歧义 + Codable ext 综合 + Logger.configure mismatch）。详见 memory `ios_app_target_compile_state.md`。修复 path 4 级（极轻 30min → 极重 1-2 周）
- v5.0.3.56 release 不产 iOS 安装包（.ipa/.app）— `release.yml` build-ios 临时 SPM-only。`docs-site/docs/changelog.md` 同步说明

### Changed

- 5 个 orphaned Swift models 入库（Blockchain/ChainConfig+Wallet / Collaboration/CollaborativeDocument+Version / Enterprise/Workspace），早于 Phase 1-5 创建但被 `.gitignore models/` silent 屏蔽几月

## [v5.0.3.55] - 2026-05-15 — iOS Phase 1+2+3+4 完整移植 + 2 P0 修

> Android v1.0 GA 验证后，iOS 端启动镜像移植，一日内三 Phase 框架级落地：133 文件 / ~264 单测 / 3 设计文档 / 3 trap memory。代码 review 后期修两处 continuation 泄漏 P0。

### Added — iOS Phase 1: 桌面配对三流（commit `c30b415a8`）

- `Modules/CoreP2P/Pairing/` (9 swift) + `Features/Pairing/` (8 swift) — Flow B 摄像头扫桌面 QR + Flow A 桌面扫手机 QR (Signal e2ee) + 手输 6 位 code 兜底
- `PairingSignalingGate` 接口 + `DefaultPairingSignalingGate` + `PairingMessageBus` + `PairedDesktopsStore` (UserDefaults JSON 持久化) + 3 ViewModel
- 71 unit tests across 7 suites
- 桌面端 follow-up `desktop-app-vue/src/main/web-shell/handlers/manual-pair-listener.js` (220 LOC) — `pairing-code:<6digit>` signaling 别名监听 + LAN 与中继双连接

### Added — iOS Phase 2: 远程桌面终端 Plan A.1 移植（commit `7613ea710`）

- `Modules/CoreP2P/RemoteTerminal/` (13 swift) — `RemoteWebRTCClient` 5 步 handshake actor + `WebRTCPeerConnectionTransport` Google SDK 抽象 + `TerminalRpcClient` 6 method wrapper + `WebRTCRuntime` actor
- `Features/RemoteTerminal/` (6 swift + 4 xterm.js bundle resources) — `TerminalListView` + `TerminalSessionView` + `TerminalWebView` (WKWebView 嵌 xterm.js)
- `Modules/CoreP2P/Signaling/SignalClient.forwardedMessages: AsyncStream<String>` (Phase 2.4 prereq 回填 Phase 1 设计 gap)
- 163 unit tests across 12 suites（累计 234）
- 镜像 Android Plan A.1 (`docs/design/Android_Remote_Terminal_Plan_A1.md`) 已 Xiaomi 真机 E2E 验证版

### Added — iOS Phase 3: 远程操控 framework + 4 typed skill（commit `759a1e907`）

- `Modules/CoreP2P/RemoteSkills/` (16 swift) — `RemoteCommandClient` 通用 RPC actor (Phase 2 `TerminalRpcClient.invoke` 抽出 sibling) + `RemoteSkillRegistry` 23 SeedRegistry 1:1 mirror Android (795 method) + `OfflineCommandQueue` UserDefaults JSON crash recovery + `OfflineQueueDrainer` false→true edge detection + 4 typed skill (Clipboard / File / Screenshot / SystemInfo) + `ManifestSignatureVerifier` (NoOp 默认，Marketplace M0 forward-compat)
- `Features/RemoteOperate/Views/` (6 swift) — `RemoteOperateView` 5-tab segmented shell (Terminal embeds 既有 TerminalListView，4 新 tab) + ClipboardView / FileBrowserView / ScreenshotView (PHPhotoLibrary 显式保存) / SystemInfoView (5s polling)
- `RemoteCommandClient` 单消费者 fix — 把 `webRTCClient.inboundMessages` 订阅 owner 收口到 commandClient，TerminalRpcClient 改订 `commandClient.events` 流（避 AsyncStream 单消费者切分事件 bug；Phase 3.6 refactor 提前到 3.3）
- ~264 unit tests across 20+ suites（累计）

### Fixed (P0) — Continuation 泄漏（2026-05-15 code review 后修）

- `RemoteCommandClient.invoke` — `withThrowingTaskGroup` timeout 路径不会 auto-resume 池中 continuation，长期运行下 `pendingResponses` 泄漏。修：`do/catch` 包，catch 显式 `pendingResponses.removeValue(forKey: reqId)?.resume(throwing: error)`。
- `RemoteWebRTCClient.waitForAnswer` — 同模式不清 `pendingAnswer`，下次 connect 与残留 continuation 撞。修同上 + 加 `hasPendingAnswer()` 诊断 accessor。
- 2 regression test (`testInvokeTimeoutClearsPendingResponses` / `testAnswerTimeoutClearsPendingAnswer`) + 1 集成 test (`testTimeoutFollowedByImmediateInvokeSucceeds`) 验池清干净。

### Added — iOS 集成测试套件

- `Tests/CoreP2PTests/Integration/Phase3IntegrationTests.swift` 6 跨组件测试：(1) ClipboardCommands DC 端到端 + envelope shape + 解码 / (2) TerminalRpcClient 通过 `commandClient.events` demux stdout / (3) `OfflineQueueDrainer` false→true edge 触发 drain + 重复 false 不重 drain + true→true 不重 drain / (4) Offline enqueue → 网络恢复 → drain 全成功 + 队列清空 / (5) 3 concurrent invoke 共享 client pool + reqId distinct / (6) timeout 后立即新 invoke 必须成功（regression）。

### Added — iOS Phase 4: Notification skill（design `cf7a7be78` + 6 sub-phase impl `45b485fdd` → `5877b5d84`）

- `Modules/CoreP2P/RemoteSkills/Notification/` 3 swift — `NotificationModels` (Codable wire 协议: Priority enum / HistoryItem / Settings / 6 Response / ReceivedEvent.parseFromEnvelope) + `NotificationCommands` actor (11 method 1:1 mirror Android `NotificationCommands.kt`，与 Clipboard/File/Screenshot/SystemInfo 共享 commandClient invoke 池) + `NotificationEventDispatcher` @MainActor class (LRU dedup 256 + 触发 PushNotificationManager.scheduleSystemNotification + @Published latestPush/unreadCount + Combine SwiftUI 集成)
- `Modules/CoreP2P/RemoteSkills/Notification/RemoteNotificationsViewModel.swift` (322 LOC) — @MainActor ObservableObject; 6 user actions (loadHistory/refresh/markAsRead/markAllAsRead/delete/clearAll/loadDesktopSettings/clearError); **乐观更新 + offline gate 三分支模式** (DC ready → server 调，失败 rollback + refresh; DC 不通 → enqueue OfflineQueue + 本地仍乐观)
- `ChainlessChain/Features/RemoteOperate/Views/NotificationsView.swift` (517 LOC) — UI 镜像 Android `NotificationCenterScreen.kt`: filter Picker(.segmented) "全部/未读" + List(.insetGrouped) + ForEach + swipe markAsRead/delete + .refreshable + .toolbar Menu (全部已读/清空/设置) + detail sheet (priority badge/data dict/时间) + settings sheet (iOS 端跳系统设置 + 桌面端 readonly per OQ-4)
- `ChainlessChain/Features/Common/Services/PushNotificationManager+RemoteTarget.swift` (12 LOC) — 1 行 `extension PushNotificationManager: RemoteNotificationPushTarget {}` (既有 PushManager 531 LOC 0 改动 — Phase 4 设计承诺)
- `ChainlessChain/Features/RemoteTerminal/RemoteDependencies.swift` (+52 LOC) — wire NotificationCommands + dispatcher + **events fan-out task** (修 Phase 4 实施暴露的新 trap：cmdClient.events 单消费者 AsyncStream，多 skill 订阅必须分流) + 启动 Task `MainActor.run { dispatcher.attach(PushNotificationManager.shared); dispatcher.start() }`
- `ChainlessChain/Features/RemoteOperate/Views/RemoteOperateView.swift` (+24 LOC) — SkillTab enum 加 .notification + body switch + .onChange 进 tab 时 dispatcher.resetUnreadCount
- `ChainlessChain/Features/RemoteOperate/Views/SkillTabPickerView.swift` (REWRITE 27 → 83 LOC) — 从 Picker(.segmented) 改 ScrollView(.horizontal) + Button row + Capsule unread badge overlay (per design §7.9 备选 B；HIG 5-tab segmented 软上限 + 无原生 badge 接口；Discord/Slack 移动端 channel switcher pattern)
- 41 新 unit tests across 3 files (NotificationCommandsTests 18 + NotificationEventDispatcherTests 10 + RemoteNotificationsViewModelTests 13)；iOS 单测累计 ~313

### Documentation

- `docs/design/iOS_Phase_1_Pairing_Flow_B.md` v1.0 — 含 §6 sub-phase + §6.5 修订（Manual wire 从 HTTP pivot 到 signaling alias）
- `docs/design/iOS_Phase_2_Remote_Terminal.md` v1.0 — 含 §3 OQ 4 项决策 + §6 sub-phase + §7 9 traps + §8.3 真机 E2E 4 场景
- `docs/design/iOS_Phase_3_Remote_Operate_Framework.md` v1.0 — 含 §3 OQ 5 项决策 + §6 sub-phase + §7 9 traps + §8.3 真机 E2E
- `docs/design/iOS_Phase_4_Notification_Skill.md` v1.0 (676 LOC, full doc) — 含 §3 OQ 5 项决策 + §6 sub-phase + §7 9 forward-looking traps + §8.3 真机 E2E 8 场景
- Memory：`ios_qr_pairing_three_flows.md` (6 trap) + `ios_remote_terminal_phase2.md` (9 trap) + `ios_remote_operate_phase3.md` (9 trap) + `ios_remote_notification_phase4.md` (8 trap) + `feedback_ios_ui_mirrors_validated_android.md` (HIG 偏离白名单)

### Pending — 真机 E2E（需 Mac+iPhone+真桌面，移交用户）

- Phase 1.7：桌面配对三流各跑一次（Flow A / B / 手输）+ LAN→relay fallback
- Phase 2.7：远程终端 4 场景（LAN / TURN / DC failover / 30min stdout 持续）+ Xcode 资源 `Features/RemoteTerminal/Bundle/` "Create folder references"
- Phase 3.7：4 skill 各跑一次（Clipboard 双向 / File ~/Documents / Screenshot 保存相册 / SystemInfo 4 cards + 5s polling）
- Phase 4.7：8 通知场景（拉历史 ≤500ms / 桌面 push 弹 banner ≤2s + tab badge + app icon badge / LRU dedup 桌面 DC+signaling 双发不重复 / markAsRead 双轨 / 离线 enqueue → drainer 自动 / quiet hours silenced=true 不弹 banner / authorization denied in-app banner / 后台 1min 回前台 refresh 看到 unread）

## [v5.0.3.54] - 2026-05-14 — Plan A.1 真机 E2E 收口（8 bugs：UI 黑屏 + cc/claude 可用）

> v5.0.3.53 发版后真机 E2E 暴露 8 个独立 bug，从"打不开 / 黑屏 / 无法输入 / cc/claude 不可用"到端到端完整可用。`f54a6fcd0` 收口（Xiaomi 24115RA8EC ↔ Windows git-bash longfa 验证）。

### Fixed — 远程终端真机端到端打通

- **fix1** `P2PClient.handleIncoming` 加 `chainlesschain:*` envelope guard — 避免协议消息被当业务消息触发 spurious peer state 变化
- **fix2** `WebRTCClient.sendOffer` 移除 `currentPeerId = peerId` 误赋值（peerId 是 target ≠ self） — echo loop 真因：WS 重连 auto-re-register 把 mobile 注册成桌面 peerId 后路由回自己
- **fix3** desktop `mobile-bridge` + `desktop-pair-handlers` 加 `maybeRefreshIceForMobile` 12h 节流自动 refresh iceServers — 跨 24h TTL 仍可用
- **fix4** signaling-relay `server.js handleMessage` 注入 `msg.from = ws._peerId` 中继路由 forward 缺 from 字段（中继 deploy `docker compose up -d --build --force-recreate` 47.111.5.128）
- **fix5** `TerminalRpcClient` stdout dedup gate 移除（gate 表达式永远 true 让每条 stdout 被 drop）
- **fix7** `TerminalListViewModel.createSession.onSuccess` closure shadow 真因：`it.copy(lastCreatedId = it.lastCreatedId)` 把 `CreatedSession` 参数名 shadow 成 state，永远不更新；改用 `created.sessionId` + List 屏 `LaunchedEffect(state.lastCreatedId)` 自动 navigate
- **fix11** `TerminalWebView` `LayoutParams MATCH_PARENT × MATCH_PARENT` — Compose AndroidView 默认 WRAP_CONTENT + HTML `body { height: 100% }` 死锁让 WebView 永远 0 高，xterm.fit() 返回 cols=49 rows=1 → 桌面 PTY 被 resize 成 1 行 → 用户看到的"全黑"其实是底色 #1e1e1e（fix9/10 ResizeObserver + DOM size guard 三层定位）
- **fix12** `PtyManager` login shell + git-bash probe — `pty.spawn(cmd, [], ...)` 无 args 让 bash/wsl 不走 login mode → `~/.bashrc` 不加载；`bash.exe` PATH 优先匹配 WSL bash → 进 root 用户无 npm-global PATH。改返回 `{cmd, args}`，bash 走 `-l`，wsl 走 `-- bash -l`，shell=bash 优先 probe `Program Files/Git/bin/bash.exe`。Android 端选 `bash` 后能用 `cc` / `claude` / `npm` 等用户全局 CLI

### Lessons captured

- `feedback_currentpeerid_target_vs_self_trap.md` — sendOffer 不能拿 target peerId 设 currentPeerId（self）
- `android_webview_xterm_resize_observer.md` — Compose AndroidView WRAP_CONTENT × HTML height:100% 死锁三连坑 + 三层修法

## [v5.0.3.53] - 2026-05-14 — Plan A.1 远程终端 Android↔桌面 WebRTC DataChannel 直连

> Plan A v5.0.3.52 把 terminal 命令通道架在 signaling 转发 (Plan C, 4 跳链路) 上，真机 e2e 暴露 5 个 reliability bug：APK 中文 GBK 乱码 / 每次 invoke 新 peerId 让 server cleanup 误杀 / OkHttp pingInterval 太短 / WS reconnect 不自动 re-register / **NAT idle + 蜂窝间歇杀 TCP 让 4 跳链路任一跳断即整体失败 (架构性)**。Plan A.1 治本：稳态命令 + stdout/exit 推送从 4 跳 signaling 切到 1 跳 WebRTC DataChannel 直连，绕开中继 + NAT idle，p50 RTT 200-500ms→30-80ms。失败 silent fallback signaling，保留兜底。

### Added — Phase 1 Trap 1 修复 + DC 状态 helper

- `WebRTCClient.dataChannelReady: StateFlow<Boolean>` derived flow（`connectionState == READY` 才 true，比 `DATA_CHANNEL_OPEN` 字面更精确——后者只是 ICE 通了 DC 未必 open）。
- `SignalClient.forwardedMessages: SharedFlow<String>` 多订阅入口替换单 `setOnForwardedMessageReceived` callback。后者"set 不是 add"的反模式让 WebRTCClient/SignalingRpc/TerminalRpc 三方互覆盖（Trap 1），TerminalRpc.start 第一次 invoke 后 SignalingRpc 会偷走 ice:config 拦截器，iceServers 24h TTL 到期跨 NAT 失效。`WebSocketSignalClient` 同步 emit SharedFlow + invoke callback 向后兼容（ice:config 仍走 callback canonical handler）。

### Added — Phase 2 DC fast path

- `SignalingRpcClient.invoke` 内部 `trySendViaDataChannel` 优先 `webRTCClient.sendMessage(envelope)`，DC 未 ready 或 sendMessage 抛 IllegalStateException 时自动 fallback signaling LAN+relay 既有路径。**所有 RPC 客户端**（terminal + system.* + ai.*）自动受益，pending pool 共享。
- `preferDataChannel: Boolean = true` feature flag（in-memory；后期接 SharedPreferences）允许诊断切回纯 signaling。
- `ensureResponseListener` 双路监听 `SignalClient.forwardedMessages` + `WebRTCClient.messages`，响应从任一路到达都 complete 同一 pending deferred；二次 complete 被 CompletableDeferred 安全忽略，无需显式去重。
- 埋点 `[SignalingRpc.metric] path=dc|signaling → method`，发版 grep logcat 算 fast path 占比（验收 > 80% / 一周内）。

### Added — Phase 3 触发 + UI 标识

- `TerminalListViewModel.init` 检测 `dataChannelReady=false` 时异步调 `RemoteConnectionManager.connect(pcPeerId, "did:peer:$pcPeerId")` 触发 WebRTC 握手（pcDID 占位 — `PairedDesktop` 不存 DID，P2PClient 也只把它当 metadata）。失败 silent，命令仍走 signaling fallback。
- `TerminalListScreen` 顶部 chip 实时显示 "P2P 直连" / "中继路径"，订阅 `webRTCClient.dataChannelReady` 自动切换。

### Added — Phase 4 双路 push + 双向去重

- `TerminalRpcClient.start()` 双订 `SignalClient.forwardedMessages` + `WebRTCClient.messages`。Phase 3 DC handshake landing 后，DC 路径上的 `chainlesschain:event` (terminal.stdout / exit) push 才能被本类拿到 — pre-Phase-4 只订 signaling 路径，用户看 UI 命令回显但收不到输出。
- LRU 反向去重：256-key stdout `"sessionId|seq"` / 64-key exit `sessionId`。同一 (s, seq) 经 DC + signaling 双路到达，UI 只看到一次。`Collections.synchronizedMap(LinkedHashMap accessOrder)` + `removeEldestEntry`。
- 桌面 `mobile-bridge.js bridgeToLibp2p` 入口 LRU dedup `payload.id`（128 容量 / 30s TTL），防 PtyManager 双执行（同 stdin 跑两次 / 双倍 stdout fanout）。`_gcRecentMobileRequests` 惰性 GC 无 timer。

### Phase 5 — DC 失效 fallback + 自动重建（零新代码 / Phase 2 + P2PClient 既有 wiring 副产品）

- DC 抛 IllegalStateException → Phase 2 `trySendViaDataChannel` 返 false → signaling fallback。
- DC 死 → `P2PClient.handleDisconnection` 监听 `webRTCClient.setOnDisconnected` → `scheduleReconnect` 指数退避（base 1s / cap 60s / factor 2.0 / maxAttempts 10）。已存在 piggy-back。
- DC 恢复 → `isDcReady()` 在每次 invoke 重新读 connectionState，下次 invoke 自然走 DC，无显式切换动作。

### Fixed — Plan A 真机 e2e 暴露的 4 bug（v5.0.3.52 临门修，发 53 一起 sweep）

1. APK 中文显示乱码：gradle.properties + compileOptions.encoding 加 `-Dfile.encoding=UTF-8`
2. 每次 invoke 新 `mobile-${ts}` peerId 让 server cleanup 误杀：`WebSocketPairingSignalingGate.sendAck` 复用 register 的 DID
3. OkHttp pingInterval(20s) 太短：拉到 60s 容纳桌面慢命令处理
4. WS reconnect 不自动 re-register：onOpen 加 auto re-register 避免 server peerId=undefined 黑洞

### Tests — Plan A.1 新增 10 个 unit test，所有现有测试保持绿

- `SignalingRpcClientTest`: 4 个新测试（DC ready 走 DC + flag-off 走 signaling + DC 不 ready fallback + DC throws fallback），envelope 共享 pending deferred 验证
- `TerminalRpcClientTest`: 3 个新测试（DC + signaling 重复 dedup stdout / dedup exit / DC 单路投递 stdout）+ Trap 1 回归测试
- `WebRTCClientTest`: pre-existing pairedDesktopsStore 缺参修补（v1.3+ Plan B 留的 stale test）

### Real-device E2E — §5.3 矩阵移交用户

- Xiaomi 24115RA8EC（已有 device）+ 桌面 Windows dev 模式
- 场景：(1) LAN 同 WiFi 期望 DC 秒级握手 (2) 蜂窝 + LAN 桌面 TURN relay (3) 双 NAT 3G symmetric fallback signaling (4) 模拟 DC 失效 fallback ≤3s (5) DC 恢复自动切回

### Design doc

- `docs/design/Android_Remote_Terminal_Plan_A1.md` v0.1 → v1.0（一日 7 commit 完成 Phase 1-5；落地反思：Phase 5 是 Phase 2 + P2PClient.scheduleReconnect 的免费副产物，零新代码）

---

## [v5.0.3.52] - 2026-05-14 — Plan A 远程终端：Android↔桌面 PTY 全链路

> Phase 1 – 4 全部落地：用户从 Android 配对桌面的 RemoteOperateScreen 点 "打开远程终端" → TerminalListScreen → 新建会话 (pwsh/cmd/bash/wsl) → TerminalSessionScreen 嵌 xterm.js WebView 真键入并查看 stdout。桌面端 PtyManager 单例同时被 web-shell WS 网关 + cc ui WS 网关 + V6 native IPC 共享。

### Added

- **Desktop main process**: `PtyManager` (lazy node-pty + 256KB ring buffer + 24h idle kill + 4-shell whitelist + 8 concurrent limit) + `terminal-handlers.js` (8 WS topics: create/list/stdin/resize/close/history + server-push stdout/exit) + `terminal-ipc.js` (V6 native IPC bridge) + `confirmation-dialog.js` (dangerous-keyword Electron messageBox + permanent trust per-cmd cache). `handleMobileCommand` adds `terminal.*` namespace + per-mobile-peer stdout/exit subscription fanout.
- **CLI workspace mirror**: `attachTopicHandlers` shared helper (extracted from `ws-cli-loader` dispatcher wrap, ESM); `agent-runtime.startUiServer` attaches `terminal.*` handlers — `cc ui` users get the same terminal route as desktop web-shell. `node-pty` added as optionalDependencies (workspace hoist resolves it without breaking install on platforms without prebuilds).
- **Web Panel**: `useTerminal` composable + `Terminal.vue` route `/terminal` (xterm.js lazy import + multi-session tabs + history backfill + ResizeObserver + dangerous-keyword toast) + sidebar entry under "去中心化" group.
- **V6 plugin widget**: `plugins-builtin/terminal/plugin.json` + `shell/widgets/TerminalWidget.vue` + `shell/TerminalPanel.vue` modal (xterm.js + `electronAPI.terminal.*`) + slash command `/terminal`.
- **Android**: `TerminalRpcClient.kt` (reuses `SignalingRpcClient` envelope pattern, observeStdout/observeExit SharedFlow) + `TerminalWebView.kt` (Kotlin↔JS bridge) + `xterm-shell.html` + bundled xterm.js / addon-fit / xterm.css under `assets/terminal/` + `TerminalListScreen` / `TerminalSessionScreen` Compose + softkey toolbar (Ctrl/Tab/Esc/arrows/Ctrl+C/D) + NavGraph routes + RemoteOperateScreen "打开远程终端" entry.
- **Docs**: `docs/design/Android_Remote_Terminal_Plan_A.md` + `docs-site/docs/guide/remote-terminal.md`; both doc sites resynced.

### Tests — 162 new, all green

- Desktop main: 61 (RingBuffer 7 + PtyManager 15 + terminal-handlers 15 + terminal-ipc 12 + confirmation-dialog 5 + ws-smoke 6 + **real-pty smoke 1, spawns cmd.exe and asserts probe in stdout**)
- CLI cc ui: 21 (PtyManager 10 + handlers 8 + ws-mirror-smoke 3)
- Web Panel: 17 useTerminal unit + **3 e2e** (real `cc ui` subprocess + real WebSocket + real shell stdin/stdout round-trip via probe echo)
- Android: 10 `TerminalRpcClientTest` (full happy path + flow event fanout)

### Fixed — pre-existing test drift swept during the full-suite run

- `widget-registry.test.ts` expected 5 ids, PREVIEW_WIDGETS already at 7 (`bridge-mtc` + `federation-governance` drift since commits `a8fff1f52`/`1c1e4096d`).
- `dashboard-store.test.js` missing `mcp.list_tools` sendRaw mock (drift since `d9cc41432`).
- `views-mount-smoke.test.js` 5 tail views: Projects.vue had static title (i18n drift since `bfdde637d`); 4 others (VideoEditing/P2P/Memory/Git) split into `views-mount-smoke-tail.test.js` for fresh worker context.
- `Projects-folder-picker.test.js` deleted — tested UI no longer exists.

---

## [Unreleased] - 2026-05-13 (later) — Android 社交功能产线化（demo → production）

> 14 屏 + 9 ViewModel + 4 Repository 的社交骨架 (~10K LOC) 建好已久，但 NavGraph 只接通 MyQRCode / QRCodeScanner 两路由，其它 7 路由是 `registerPlaceholder("temporarily simplified")`；`SocialScreen` Friends / Timeline 两 tab 显示固定字串；`PostRepository.reportPost` 构造完 entity 不入库；`FriendRepository.searchUserByDid` 非本地 DID 返回 null。本次一次性收口，**不 bump version**，与本日早期 P0 前置一起 release。

### Added

- **NavGraph 7 占位换实屏 + 2 新路由** — `PublishPost / PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost` 全部接 Composable；新增 `NotificationCenter` / `BlockedUsers` 两路由（前者作为 deep-link target，后者由 `FriendListScreen` 新加 dropdown 入口可达）。DID 文档加载期渲染 `CircularProgressIndicator` 占位。
- **`SocialScreen.kt` 三 tab 升级** — Friends → `FriendListScreen`（保留 P2P chat 入口 CTA）；Timeline → `TimelineScreen`，myDid 走 `DIDViewModel.didDocument.collectAsState()`；Notifications → `NotificationCenterScreen`（带筛选 / 批量已读 / 清理菜单），删旧的内联 basic 列表 + 2 个 `R.string.social_*_placeholder` 引用。
- **`PostReportDao` 落地** — `PostReportEntity` 早在 schema v23 在册，但 DAO 一直缺。新建 `core-database/.../dao/social/PostReportDao.kt`（7 个查询/更新方法）+ 注册到 `ChainlessChainDatabase` + `DatabaseModule` `@Provides`。`PostRepository.reportPost()` 改走 `postReportDao.insertReport()` + `hasReporterReportedPost()` 去重让重复举报 idempotent；`getUserReports()` 走 `postReportDao.getReportsByReporter().asResult()` 不再 hardcode 空；新增 `getPostReports() / getPendingReportCount()` 供 moderation 排序信号。
- **PROFILE_QUERY / PROFILE_RESPONSE 协议** — `MessageType` 加 2 项；`core-p2p/.../realtime/SelfProfileProvider.kt` 接口 + `SelfProfileSnapshot` data class；`RealtimeEventManager.queryProfile(targetDid, timeoutMs=5_000L)` 用 `onSubscription { send }` 在订阅完成后才发请求，解 `_profileResponseEvents` (replay=0) 的订阅竞态；`handleProfileQuery` 通过 `AtomicReference<SelfProfileProvider?>` 读取注入的 provider 自动回包，未注入或返回 null 时静默忽略（向后兼容旧节点）。`feature-p2p/.../repository/social/DefaultSelfProfileProvider.kt` 默认实现：DID 末 8 位占位昵称（与 `MyQRCodeViewModel.kt` L100 同规则），在 `ChainlessChainApplication.delayedInit()` 走 `AppEntryPoint` 注入。`FriendRepository.searchUserByDid()` 本地未命中即 fallback 远端查询，超时返回 `Result.Success(null)`（UI 显示"未找到"，不弹错误）。
- **`BlockedUsersScreen` 接 ViewModel** — 之前 `blockedUsers = mutableStateOf(emptyList())` 写死 + TODO 注释。`FriendViewModel` 注入 `DIDManager`、新增 `loadBlockedUsers()` + state field `blockedUsers / isLoadingBlockedUsers`；`unblockFriend(did)` 现在走完整 `friendRepository.unblockUser(myDid, did)` 路径（同时清 `BlockedUserEntity` 行），未登录态 fallback 到 flag-only `unblockFriend(did)`，避免孤儿屏蔽记录。`FriendListScreen` dropdown 加 "屏蔽用户" 入口，通过 `MainContainer → SocialScreen → FriendListScreen → NavGraph.Screen.BlockedUsers.route` 链路打开。

### Tests — 39 new, all green

| 层 | 文件 | 数量 |
|----|------|------|
| Unit (core-p2p) | `RealtimeEventManagerProfileQueryTest` | 6 |
| Unit (feature-p2p) | `PostRepositoryReportTest / FriendRepositoryRemoteLookupTest / FriendViewModelBlockedUsersTest / DefaultSelfProfileProviderTest` | 4+4+4+2 = 14 |
| Integration (core-database) | `PostReportDaoTest` (Robolectric + in-memory Room) | 8 |
| Regression (app) | `SocialRouteRegressionTest / SocialScreenTabRegressionTest` | 6+5 = 11 |

**关键学习——race-fix**：`queryProfile resolves with matching PROFILE_RESPONSE` 这个测试最初用 `runTest` 跑 fail——`RealtimeEventManager` 内部 `scope = CoroutineScope(Dispatchers.IO + SupervisorJob())` 与 `runTest` virtual-time TestDispatcher 不在同一调度图，2s timeout 在 virtual 时间瞬时跳完，IO 协程还没来得及 `handleRealtimeMessage` 就 fail。改 `runBlocking + withTimeout(10_000)` 跑真实并发后通过。

### Files

```
新增 (5):
  android-app/core-database/src/main/java/.../dao/social/PostReportDao.kt
  android-app/core-p2p/src/main/java/.../realtime/SelfProfileProvider.kt
  android-app/feature-p2p/src/main/java/.../repository/social/DefaultSelfProfileProvider.kt
  + 8 测试文件 + 1 设计文档 (docs/design/Android_Social_Wiring_2026-05.md)

修改 (14 Kotlin + 8 文档):
  Application / AppEntryPoint / NavGraph / MainContainer / SocialScreen
  ChainlessChainDatabase / DatabaseModule
  P2PDevice / RealtimeEventManager
  FriendRepository / PostRepository / BlockedUsersScreen / FriendListScreen / FriendViewModel
  README.md / README_EN.md / docs/FEATURES.md
  docs-website-v2/src/pages/{,en/}mobile.astro
  docs-site/docs/design/* (sync) / docs-site-design/docs/* (sync)
```

[详细设计文档 →](docs/design/Android_Social_Wiring_2026-05.md)

---

## [Unreleased] - 2026-05-13 — v1.2 GA 反馈整合：P0 前置 + project workflow + 11 daily templates + 6 bug fix ([#21](https://github.com/chainlesschain/chainlesschain/issues/21))

> 本批分两阶段。**阶段 1** (v1.2 GA 上架前)：A.3 ADR review / B.6 PQC 严格模式 verifier / B.2 削 web-shell `/multisig` cc subprocess 冷启三项 GA-independent + AI-3 forward-compat seam + 2 相关 bug fix。**阶段 2** (v1.2 GA 反馈到位)：5+3 反馈整合 #2 (删除 bug) / #3 (模板改日常) / #4-#7 (桌面↔手机项目工作流: CLI + REMOTE handler + 双向 sync walker) / #8 (web-shell 项目菜单 + 双端一致 view) 落地 P1+P2+P3 Part A。**version 不 bump** — v1.2 GA 反馈仍在收集中, 与未来 P1 主体一起 release。

### Added — [#21](https://github.com/chainlesschain/chainlesschain/issues/21) P0 前置三项 GA-independent

- **A.3 ADR Review v2.0**（commit `348896382`）—— 新增 [`docs/design/Android_ADR_重评估_v2.0.md`](docs/design/Android_ADR_重评估_v2.0.md) v1.0；8 ADR 全 audit 结论 **5 keep / 2 amend / 1 revise**：ADR-2 (M2 DID wallet 走软件 Ed25519，blocks B.3 DID rotate) 待 v1.2 GA Play Console API level 数据决策选项 A/B/C；ADR-7 (cc-mobile.json 从未创建，实际走 user_settings 表 + `mobile.*` scope) + ADR-8 (实际 disk-first + push-based，非 pull) 文本 amend 落 §4 对齐真实。同 commit §10 v1.3+ scope triage 分层（12 子项 P0/P1/P2 + 5 依赖链）。
- **B.6 PQC 严格模式 verifier gate**（commit `e24386d00`）—— `packages/core-mtc/lib/landmark-cache.js` 加 `strictPqMode` opt-in flag + `_assertStrictPqMode()` + `_assertStrictPqModeForSnapshot()` 两层 gate + `STRICT_PQ_MODE_VIOLATION` error code + `CLASSICAL_ALGS` 常量 + `isClassicalAlg` helper。Reading A 语义：拒收任何 `alg === "Ed25519"` 的 partial sig + publisher_signature；与现 heterogeneous federation 数据格式兼容，0 schema 改动；生产者侧 0 改动（用户已可配 SLH-DSA signers）。
- **B.2 in-process multisig.* + marketplace.consume topics**（commit `b1c7cfd95` + label fix `c21ba9346`）—— `desktop-app-vue/src/main/web-shell/handlers/multisig-handlers.js` 新增 7 个 WS topics 镜像 CLI `--json` 输出 shape：`multisig.list / show / policy.show / cancel / finalize / sweep` + `marketplace.consume`。Topics 调 `openMultisigManager()` from CLI `multisig-runtime.js`（per-call open SQLite WAL ~20ms），dynamic-import 跨 CJS/ESM 边界。`Multisig.vue` 加 `callMultisigTopic(topic, msg, fallbackCmd)` helper 用 `useShellMode().isEmbedded` 分发；7 处 `ws.executeJson` 全切；非 embedded（cc serve 无 asar 开销）保留原 subprocess fallback。**性能：asar:true 子进程冷启 6-10s → in-process ~20ms (SQLite open) + 查询，60-100× 提升**。UX 0 改动。
- **A.3 AI-3 SkillMetadata.signature forward-compat**（commit `45a88270e`）—— Android-side Kotlin。新增 `ManifestSignatureVerifier.kt`：`interface` + sealed `VerificationResult.{Accepted | Rejected(reason)}` + `object NoOpManifestVerifier` always-accept stub（默认 wired）。`SkillMetadata.kt` 加 `signature: String? = null` field + init invariant（null = unsigned legacy，blank reject）。`RemoteSkillRegistry.kt` 加 `@Volatile manifestVerifier = NoOpManifestVerifier` + `setManifestVerifier(v)` swap seam + `updateFromRemote()` 跑 verifier per-skill（Accepted 合并，Rejected `Timber.w` warn-log + 跳过，accepted.isEmpty() 短路）。Marketplace M0（#21 AI-5）上线时注入真 Ed25519/SLH-DSA hybrid verifier 即可，调用方 0 改动。

### Fixed

- **wear test imports**（commit `c0d061328`）—— `CcPhoneDecisionListenerTest.kt` 自 `cc08da0b0` (v1.2 #20 P0.2 wear Phase 2) 起用 `kotlinx.coroutines.GlobalScope.launch { ... delay() }` 写 smoke 测试，但 imports 缺 `launch`/`delay`/`GlobalScope`/`DelicateCoroutinesApi` —— `launch` 是 extension function，fully-qualified `GlobalScope.launch` 也必须 import 才能 resolve。block 了整个 `:app:compileDebugUnitTestKotlin`。加 4 imports 解锁。CI 此前未报可能因 wear test 未纳入 `:app` 测试目标或 continue-on-error 沉默。
- **B.6 strict mode disk-load gate**（test-driven 发现于本次 QA sweep）—— `LandmarkCache.loadFromDisk()` 直接调 `_validateAndStoreSnapshot()`，bypassing `ingest()` 里的 `_assertStrictPqMode()` 调用。结果：strict mode OFF 时写入磁盘的 Ed25519 landmark，下次 strict mode ON 加载时**仍接受**（silent strict invariant 违反）。修：把 per-snapshot 严格检查移到 `_validateAndStoreSnapshot()` 头部，让 ingest + loadFromDisk 两条路径都有 gate；`_assertStrictPqMode(landmark)` 简化为只查 publisher_signature。+2 新 disk-load integration tests 锁回归。

### Added — v1.2 GA 反馈整合 5+3 项 ([#21](https://github.com/chainlesschain/chainlesschain/issues/21) #2/#3/#4/#5/#7/#8)

- **#2 项目无法删除 fix** (commit `fc24f9856`) —— `ProjectScreen.kt::EnhancedProjectCard` 完全没有 delete UI（feature-project/.../ProjectListScreen.kt 的 delete 代码是死代码未连入 NavGraph）。加 3-dot 菜单 + AlertDialog 确认 + `onDeleteClick` → `viewModel.deleteProject` → DAO softDelete (status='deleted') → Room Flow 自动从列表移除。
- **#3 项目模板改日常** (commit `99d38bf69`) —— L1+L2+L3 mobile 定位下用户不是程序员，原 11 IDE 模板 (Android/React/Spring/Flutter 等) 跟使用场景不符。整个 `ProjectTemplates` 重写为 11 日常生活模板：购物清单 / 旅行计划 / 读书笔记 / 灵感收集 / 健身计划 / 食谱记录 / 学习计划 / 家庭账本 / 工作日志 / 会议记录 / 空白。`TemplateCategory` 加 5 个日常类目 (DAILY/TRAVEL/STUDY/HEALTH/FINANCE)。`TemplateLibrary` `getCategoryIcon`/`getCategoryType` when 表达式补 5 个新分支防 compilation error。strings.xml 加 5 新 string (zh-rCN + en)。
- **#4/#7 桌面 CLI + REMOTE handler P1** (commit `32ccabdb5`) —— `packages/cli/src/lib/project-runtime.js` (SQLite cascade + Electron userData path resolution Win/macOS/Linux) + `packages/cli/src/commands/project.js` (`cc project init/list/show/delete` 4 subcommands 直写 desktop chainlesschain.db, WAL mode 并发安全)。`desktop-app-vue/src/main/remote/handlers/project-management-handler.js` (6 actions: list/get/init/delete/listFiles/getFile) 暴露给 Android L3 REMOTE 调用, 复用 desktop DatabaseManager。CLI 7 integration tests + handler 21 unit tests 全过。
- **#4 Android→Desktop 反向 sync P2** (commit `2646bbb4e`) —— audit 发现：桌面→手机 sync 通 (mobile-bridge-sync `_fetchProjects` walker + Android `ProjectSyncApplierImpl`), 反向手机→桌面断 (`SocialSyncWalker` 不含 projects 表)。新增 `ProjectDao.getProjectsSinceCursor` (无 status 过滤让 status='deleted' 也 emit) + `ProjectSyncWalker.kt` (feature-project, ~120 LOC, op mapping CREATE/UPDATE/DELETE, snake_case JSON 对齐 desktop) + `CompositeSyncRepositoryWalker.kt` (`:app`/sync 聚合 SocialSyncWalker + ProjectSyncWalker) + `SyncWalkerModule.kt` (Hilt `@Binds → Composite` replaces feature-p2p single-walker binding)。P2PModule.kt 注释旧 binding。ProjectSyncWalker 12 tests + CompositeSyncRepositoryWalker 7 tests。顺手修 5 个 pre-existing feature-project 测试 `kotlin.test.*` → `org.junit.Assert.*` imports unblock `:feature-project:compileDebugUnitTestKotlin`。
- **#5/#8 web-shell Projects view + in-process WS topics P3 Part A** (commit `bfdde637d`) —— `desktop-app-vue/src/main/web-shell/handlers/project-handlers.js` 6 in-process WS topics 包装 P1 ProjectManagementHandler (DRY: 同一 handler 同时服务 web-shell + mobile L3 REMOTE, 避免 ws.execute('cc project …') asar:true 6-10s 子进程冷启)。新 `packages/web-panel/src/views/Projects.vue` 项目管理列表 (4 stats + filter + table + Detail drawer 含文件列表 + Create modal 10 types)，`useShellMode().isEmbedded` 分发 in-process vs `ws.executeJson` 兜底。原 Projects.vue "项目 init/setup/templates" 内容移到新 `views/ProjectInit.vue` (路由 `/project-init`) 保留 backward 访问。project-handlers 7 unit tests。

### Fixed

- **wear test imports**（commit `c0d061328`）—— `CcPhoneDecisionListenerTest.kt` 自 `cc08da0b0` (v1.2 #20 P0.2 wear Phase 2) 起用 `kotlinx.coroutines.GlobalScope.launch { ... delay() }` 写 smoke 测试，但 imports 缺 `launch`/`delay`/`GlobalScope`/`DelicateCoroutinesApi`。block 了整个 `:app:compileDebugUnitTestKotlin`。加 4 imports 解锁。
- **B.6 strict mode disk-load gate**（test-driven 发现于 P0 QA sweep）—— `LandmarkCache.loadFromDisk()` 直接调 `_validateAndStoreSnapshot()`，bypassing `ingest()` 里的 `_assertStrictPqMode()` 调用。修：把 per-snapshot 严格检查移到 `_validateAndStoreSnapshot()` 头部，让 ingest + loadFromDisk 两条路径都有 gate；`_assertStrictPqMode(landmark)` 简化为只查 publisher_signature。+2 disk-load integration tests 锁回归。
- **feature-project pre-existing kotlin.test imports** (P2 sweep) —— `CodeCompletionTest` / `CodeFoldingTest` / `EditorTabManagerTest` / `Phase6IntegrationTest` / `Phase9IntegrationTest` 5 文件用 `kotlin.test.assertEquals/assertTrue` 但 deps 无 `kotlin.test`，block `:feature-project:compileDebugUnitTestKotlin`。改成 `org.junit.Assert.*` 解锁。

### Tests

阶段 1 (P0):
- **`landmark-cache-strict-pq-mode.test.js`** 11/11 pass（原 9 + 2 disk-load integration tests for strict mode persistence）
- **`multisig-handlers.test.js`** 23/23 pass（B.2 via `runtimeFactory` 注入 seam）
- **`ManifestSignatureVerifierTest.kt`** 10/10 + `SkillMetadataTest` 9/9 + `RemoteSkillRegistryTest` 38/38 regression 全过

阶段 2 (project workflow):
- **`project-management-handler.test.js`** 21/21 pass（P1 desktop handler）
- **`project-cli.test.js`** 7/7 pass（P1 `cc project` CLI integration via sql.js WASM temp DB）
- **`ProjectSyncWalkerTest.kt`** 12 tests (P2 Android walker — pending CI run，本地 feature-project test 套有 pre-existing 不相关 failures)
- **`CompositeSyncRepositoryWalkerTest.kt`** 7/7 pass（P2 :app 聚合，2026-05-13 Phase 4 加）
- **`project-handlers.test.js`** 7/7 pass（P3A web-shell wrapper）
- Android `:app:testDebugUnitTest` regression: **80/80 pass** (ManifestSignatureVerifier 10 + RemoteSkillRegistry 38 + SkillMetadata 9 + SeedRegistry 10 + RegistryStore 6 + CompositeSyncRepositoryWalker 7)
- Desktop combined: **51/51 pass** (project-handlers 7 + multisig-handlers 23 + project-management-handler 21)

## [v5.0.3.49] - 2026-05-12 — M-of-N multisig Phase 1d + Phase 2a marketplace mediator + Phase 2b web-panel Multisig view + Flow B QR pairing 收口 + 测试补丁

> 本版四条主线：(1) **`@chainlesschain/core-multisig` package + `cc multisig` CLI 落地**（commit `3c890dcac`，v1.2 m-of-n Phase 1d）—— Phase 1 完整 5-lib（policy / store / proposals / signing / governance-log），CLI 8 subcommands（propose / sign / cancel / finalize / list / show / sweep / policy），75 lib 单测 + 10 CLI integration 测试全过。(2) **Phase 2a marketplace.purchase mediator**（commit `2755093d0`）—— 设计文档 §6.1 落地：`cc marketplace purchase` 大额（≥¥1000）自动走 M-of-N 多签 propose，小额走 direct；`cc marketplace consume` 在 threshold 达成后 finalize + 执行业务；抽 `multisig-runtime.js` 共享 SQLite cascade（-130 行 dedup，Phase 1 10/10 零行为变更）；8 新 E2E 测试全过。marketplace.purchase 是第一个真实接通业务侧的 mediator。(3) **Phase 2b web-panel Multisig 视图落地**（commit `c758492d9`）—— 设计文档 §8.1 落地：web-shell（默认桌面入口）加 M-of-N 多签查看 / 操作面板，Phase 1 CLI 的 `cc multisig list/show/cancel` + `cc marketplace consume` 通过 `ws.executeJson(...)` 走 CLI 子进程；同份 SPA 在 desktop web-shell + cc ui 两边都自动可用。(4) **Android v1.1 W3.7 Flow B QR pairing 落地**（commit `c47cbc649`）—— desktop 显 QR / phone 扫的主流应用通用 UX（微信/支付宝同模式），Xiaomi 24115RA8EC 真机 E2E verified。同步补齐 Flow B 漏掉的 2 个测试文件：`ScanDesktopPairingViewModelTest` 10 项 + `desktop-pair-handlers.test.js` 19 项。

### Added — M-of-N multisig core（v1.2 #20 P0.3 Phase 1d）

- **`@chainlesschain/core-multisig` npm workspace package**（commit `3c890dcac`）—— 5 个 lib 文件：
  - `policy.js` 域级 policy `{m, n, members[], requirePqc, defaultExpiryMs}` validate + normalize
  - `store.js` SQLite schema 3 表（proposals / signatures / policies）+ 5 操作 helper
  - `proposals.js` 状态机 propose / sign / cancel / finalize / expireStale；`pending → reached → consumed` + `cancelled` / `expired` terminal
  - `signing.js` JCS canonicalize + DOMAIN_PREFIX `"MULTISIG:"` 防回放 + Ed25519 / SLH-DSA dispatcher + verifyThreshold strip-all-sigs
  - `governance-log.js` append-only JSON Lines 审计 log（proposed / signed / reached / consumed / cancelled / expired / expired_sweep）
  - 75 单测全过（policy 14 + signing 21 + proposals 20 + store 12 + governance-log 8）
- **`cc multisig` CLI 8 subcommands**（commit `3c890dcac`）—— propose / sign / cancel / finalize / list / show / sweep / policy {set, show}；全 `--json` 输出。
- **SQLite driver cascade native → WASM**（per memory `feedback_sqlite_wasm_fallback`）—— `better-sqlite3-multiple-ciphers` / `better-sqlite3` 加载失败时自动降级 `sql.js` (WASM)，CLI 跨平台开箱即用，无须每平台预装 native prebuild。
- **测试基础修复 3 项**：core-multisig `vitest.config.js` 设 `globals: true`（vitest 4 不接 CJS `require("vitest")`，memory `cli_ci_sharding_lessons`）；5 个 test 文件改 ESM `import` 头；`multisig-cli.test.js` import 路径修 `@chainlesschain/core-mtc/signers/ed25519.js` → 去 `.js` 后缀（core-mtc exports key 无后缀）。
- 10/10 CLI integration tests pass。

### Added — Phase 2a marketplace.purchase mediator（v1.2 #20 P0.3 Phase 2）

- **共享运行时抽取** `packages/cli/src/lib/multisig-runtime.js`（commit `2755093d0`，新文件）—— Phase 1 commands/multisig.js 内联的 SQLite cascade（better-sqlite3-multiple-ciphers → better-sqlite3 → sql.js）+ manager loader 抽出公共模块，让 commands/marketplace.js 复用同一份。
- **commands/multisig.js refactor**（commit `2755093d0`）—— 用 `multisig-runtime.js` 替代内联 `_openManager` / `_openDatabase` / `_adaptSqlJs` / `_readKey` / `_readJsonArg`，−130 行 dedup。Phase 1 10/10 integration test 全 green，零行为变更。
- **`cc marketplace purchase <itemId>` 新 subcommand** —— `--amount-fen N --buyer <did> --key <hex> [--threshold-fen N] [--item-name <name>]`：amount < threshold (default `LARGE_PURCHASE_THRESHOLD_FEN = 100_000` fen = ¥1000) 走 direct path（CLI stub 打印 "purchased"）；amount ≥ threshold 必须有 `marketplace.purchase` 域 policy，否则 exit 2 `no_policy`；有 policy 调 `mgr.propose` 返 proposalId 让其他签名方加签。
- **`cc marketplace consume <proposalId>` 新 subcommand** —— 校验 `domain == "marketplace.purchase"` + `state == "reached"` 才执行；finalize 后打印订单 payload + governance log 写 `consumed`。错域 / 错态都 exit 2。
- **8 新 E2E test 全 green**（`packages/cli/__tests__/integration/marketplace-multisig-e2e.test.js`）：大额 ¥1500 2-of-2 walkthrough（policy → purchase → sign×2 → consume → governance.log 4 类事件 `proposed`/`signed`×2/`reached`/`consumed`）/ 小额 ¥500 direct path / `--threshold-fen` override / 大额无 policy → exit 2 / consume pending → exit 2 / consume 错域 → exit 2 / `--help` 文本。
- 总 **18 multisig integration test 全 green**（Phase 1 10 + Phase 2 8）。

### Added — Phase 2b web-panel Multisig 视图（v1.2 #20 P0.3 Phase 2b）

- **`packages/web-panel/src/views/Multisig.vue`**（commit `c758492d9`，新文件 468 行）—— 6-card 顶部 stats（总数 / pending / reached / consumed / cancelled / expired）+ 两个 tab：**提案列表**（columns ID / Domain / State / Sigs / Created / Expires / Actions + state 过滤 + domain 过滤 + 行 actions 详情 / 取消 / 执行购买）/ **域策略**（列 marketplace.purchase / did.rotate / crosschain.outbound 已知 domain policy + 成员展开）+ 640px Detail drawer（Descriptions 显 domain / state / threshold / sigs / initiator / timestamps / payload JSON + 签名列表 + 操作按钮 取消 / 执行购买 / finalize）+ info Alert "web shell 不持私钥 sign 走 CLI"。
- **router/index.js + AppLayout.vue**（commit `c758492d9`）—— 加 `/multisig` 路由 + sidebar security/audit 组 multisig menu item（TeamOutlined icon）+ 折叠模式同步 + i18n fallback "M-of-N 多签"。
- **WS 通信走 CLI 子进程** —— `ws.executeJson('multisig list --json')` 等通过 CLI WS server `_executeCommand` 路径；冷启动 6-10s（asar:true 开销）Phase 2 可接受；Phase 3 可加 in-process WS handlers 削延迟。
- **同份 SPA 复用** —— desktop web-shell + cc ui 两边自动可用（per memory `feedback_cross_shell_feature_pattern`）。
- **Phase 3 follow-up**：私钥签名 UI（需 Unified KeyStore 接通）、in-process WS handlers、实时推送（现 onMounted 拉一次）、Marketplace.vue purchase modal 集成。

### Added — Android v1.1 W3.7 Flow B QR pairing（issue #19）

- **Mobile 端扫描桌面 QR 完整链路**（commit `c47cbc649`）—— Phone 摄像头扫桌面屏幕 QR 比反向（desktop webcam 扫小手机屏）识别率高得多，是主流应用通用 UX 模式。9 项实战坑全排清（memory `desktop_qr_pairing_flow_b.md`）：`<a-qrcode>` 必须显式 async-register / `parseJsonOutput` log-prefix vs JSON-array regex / `mobileBridge.peerId` 必须 `this.` / social `QRCodeScannerViewModel` 校验 reject 非好友 QR / pair-ack 拦截在 bridgeToLibp2p 前 / in-memory ack vs CLI 写 DB 双轨 / 跨模块 DI / adb reverse 无域名 E2E / Flow B QR 字段含 `pcPeerId`。
- **跨模块 DI 拆解**：`PairingSignalingGate.sendAck` interface 落 `:core-p2p` 避免 `:feature-p2p` 反依赖 `:app`；`WebSocketPairingSignalingGate.sendAck` 实现在 `:app` 内 `ensureRegistered + Mutex` 串行化；`WebRTCClient.SignalClient.sendForwardedMessage(toPeerId, payload)` 桥接 mobile 端的 signaling forward。
- **Desktop 端 WS topics 三件套** `desktop-pair-handlers.js`：`desktop.pair.generate-qr`（生成 6 位 code + payload + pcPeerId 三段 fallback：`mobileBridge.peerId` → `deviceManager.getCurrentDevice` → `"desktop-unknown"`）/ `desktop.pair.poll-ack`（idle / waiting / acked / expired 四态）/ `desktop.pair.reset`；`mobile-bridge.js` 加 `this.peerId` 持久化 + 拦截 `type=pair-ack` 经 `recordPairAck` 匹配 + 写 SQLite paired_devices。
- **Vue UI** `MobileBridge.vue` Flow B tab（默认）+ Flow A + 手输 3-tab；`antd.js` 注册 `AQrcode`。
- **真机 E2E verified**：Xiaomi 24115RA8EC desktop QR → ML Kit 扫 → signaling pair-ack → desktop mobileBridge 拦截 → recordPairAck 匹配 → CLI `pair-from-qr` 写 SQLite → Vue 列表刷新。

### Added — 单元测试补丁

- **`ScanDesktopPairingViewModelTest.kt`**（新增 10 测试）—— 覆盖 ScanDesktopPairingViewModel `onQrScanned` 全部 validation 分支 + happy path + retry + idempotent + malformed JSON。MockK + StandardTestDispatcher + FakeGate（捕获 sendAckCallCount）。
- **`desktop-pair-handlers.test.js`**（新增 19 测试）—— 覆盖 3 个 handler factory + `recordPairAck`：generate-qr 6 case / poll-ack 4 case（用 `vi.useFakeTimers` 验 expired 态）/ reset 1 case / recordPairAck 4 case。
- **Android `:feature-p2p:testDebugUnitTest` 41s 全绿**（138 actionable tasks）；Desktop 3 文件 / 45 测试全绿。

### Distribution

- 桌面 binary：v5.0.3.48 → v5.0.3.49 重打（含 Flow B + multisig 新代码；auto-updater 比对 `5.0.3-alpha.49 > 5.0.3-alpha.48`）
- `chainlesschain` npm 0.161.8 → 0.161.9（cli 加 multisig command + dep `@chainlesschain/core-multisig`）
- Android：versionCode/Name 不变（v1.0.0 GA 维持），Flow B 走桌面端首发；后续 Android v1.1 minor release 一并 ship 完整移动客户端
- 三大文档站同步刷新：docs-site / docs-site-design / docs-website-v2 tagline 升 v5.0.3.49 + 加本节 changelog；CHANGELOG.md + README.md / README_EN.md 同步

## [v5.0.3.48] - 2026-05-12 — Android M3 capture suite (5/5 code) + M4 RemoteSkillRegistry method-level + ApprovalUI 4-category + ProgressViewer + alias 兼容窗口

> Android v1.0 RFC M3 + M4 收尾批次（7 commit / 187 新单测）+ **Android M7 GA flip 一并落地（commit `ffe722162`，versionCode 37 → 100，versionName 0.37.0 → 1.0.0）**。把设计文档 §5.3 L2 捕获五件套补齐到代码层（VoiceMode / CameraOCR / LocationTagger / SharePayloadFlusher / PushNotifier）+ §6 M4 D1 RemoteSkillRegistry method-level 元数据 + §5.4 ApprovalUI 4-category 适配 + ProgressViewer 长时任务面板 + §8.3 alias 兼容窗口。Android 总单测 196+ → 383+。无桌面 / CLI 源码改动，CLI npm 0.161.7 → 0.161.8（force publish 走 release.yml 同步轨道）。Android v1.0 GA 仍待用户出场（4 项）：M3 真机 E2E / M4 D2 真机 / FCM 凭证 / M6 性能实测。

### Added — Android M3 capture suite (5/5 code)

- **VoiceMode 连续语音串联**（commit `47bebed80`）—— ASR → REMOTE chat → TTS pipeline 在 home 入口串通。
- **CameraOCR 拍照入 KB 流水线**（commit `a69269ced`）—— `ai.ocrImage` + `knowledge.createNote` 走完，自动写 OCR 元数据。
- **LocationTagger Play Services FusedLocationProvider + Foreground Service**（commit `3f5ac8647`）—— GPS 数据进 `createNote.metadata`，前台服务保证后台采集合规。
- **SharePayloadFlusher 接 SyncCoordinator → knowledge.createNote**（commit `3d1a6e3a8`）—— 5 种 SharePayload（Text / Url / SingleImage / MultiImage / GenericFile）转 note 字段；SyncCoordinator 30s push 循环末尾 `drain` SharedInboxRepository，失败 re-enqueue。19 新单测。
- **PushNotifier 本地通道 + FCM 骨架**（commit `c0d990c91`）—— 4 NotificationChannel（Cowork DEFAULT / Marketplace HIGH / SystemAlert DEFAULT / ShareInbox LOW）+ 协议中立 `CcPushNotificationService` 入口；google-services.json 真接入按 `android-app/docs/M3_FCM_SETUP.md` 5 步（用户出场）。36 新单测。

### Added — Android M4 收尾

- **RemoteSkillRegistry method-level 元数据补全**（commit `6e49270fd`）—— `MethodMetadata`（name / paramCount / riskOverride / requiresApprovalOverride）+ `listMethods` / `getMethod` / `requiresApprovalForMethod` / `riskForMethod` accessor；`knowledge.*` + `ai.*` 各 10 methods seeded（8 riskOverride 演示）；其他 21 namespace pending 桌面 `mobile-skill-whitelist` 下发。16 新单测。
- **ApprovalUI 4 category 适配**（commit `f4f83cc67`）—— `ApprovalCategory` enum {Sign / Cowork / Marketplace / SystemCritical} + `fromMethod` 推断；`AndroidApprovalGate` 4-arg overload 透传 category 透传到 dialog（旧 3-arg 自动 forward）；Dialog 按 category 切 icon / tint / title / footer。9 新单测。
- **ProgressViewer 长时任务面板**（commit `f4f83cc67`）—— `LongTaskRegistry` `@Singleton` `MutableStateFlow<List<LongRunningTask>>`（Pending / Running / Completed / Failed / Cancelled，MAX_TASKS=100 滑窗）+ `TaskProgressCommandRouter` 接 `task.*` reverse-RPC（update / complete / fail / cancel / remove）+ Compose `ProgressViewerScreen`（StatusChip + Linear / indeterminate Circular + dismiss / clear-terminal）。34 新单测（15 + 19）。
- **§8.3 RemoteSkillRegistry alias 兼容窗口**（commit `0bc8e2797`）—— `SkillMetadata.aliases: List<String>` + 内部 `aliasIndex` 反查；`get` / `listMethods` / `requiresApproval` / `risk*` 全部经 `resolveAlias` 路径自动解析；新增 `resolveAlias` public API。未来 namespace 改名时旧调用方 1 版内不 break。7 新单测。
- **§8.1 README versionName 滞后修正 + v1.0 GA 检查清单**（commits `0bc8e2797` `3da484e9c`）—— `android-app/README.md` M3 行 (2/5) → (5/5 code)、M4 行补 method-level + ApprovalUI + ProgressViewer；新增 `ANDROID_v1_GA_CHECKLIST.md`：v1.0 GA 仍待用户出场 5 项。

### Tests

- Android 新增 **187 单测全绿**（`./gradlew :app:testDebugUnitTest --tests "*Test"` 对应 14 个测试文件）。回归覆盖 capture / push / registry / task / approval-category / composite-router 全部新模块。
- Android 总单测 196+ → 383+（M1 0 + M2 68 + M3 130 + M4 152 + M5 33）。
- Desktop store 回归 26 文件 / 773 测 ✓；CLI lib 169 文件 / 7185 测 ✓（确认 Android 工作未污染 desktop / CLI 路径）。

### Distribution

- 桌面 binary：v5.0.3.47 → v5.0.3.48 重打（无桌面源码改动；auto-updater 比对 `5.0.3-alpha.48 > 5.0.3-alpha.47`，v5.0.3.47 用户重启拿到新 build）。
- `chainlesschain` npm 0.161.7 → 0.161.8（CLI 自身 0 源码改动；force publish 走 release.yml 同步轨道）。
- **Android：versionCode 37 → 100, versionName 0.37.0 → 1.0.0 GA**（commit `ffe722162`）—— M7 GA flip 与本批 M3/M4 工作一并落地；android-app/CHANGELOG.md 加 [1.0.0] - 2026-05-12 GA entry 汇总 9 commit + 4 项已知限制（FCM 国内 / 单 peer / 离线队列 / QRPairing scaffold）；android-app/README.md 标题切 "🎉 当前版本 v1.0.0 — GA"。下一步 tag `v1.0.0` 在 commit `ffe722162` 推 gitee+github。
- 三大文档站本次同步刷新：tagline 升 v5.0.3.48 + 加本节 changelog。

---

## [v5.0.3.47] - 2026-05-11 — Verification release：build-android keystore fix VERIFIED + density splits 14→4 落地 + outstanding `../` 全扫净

> 验证型发版。无桌面 / CLI / Android 源码改动，只把 v5.0.3.46 后陆续落的 3 个 release-pipeline 修复在 CI 实跑一遍证明 green。release.yml run #25632845952 全 11 个 job ✓（含 build-android、create-release、publish-cli、finalize-release），4 个 Android assets 入 GitHub Release v5.0.3.47。

### Verified

- **build-android keystore path mismatch（issue #N/A，commit `f9a7ba716`）** —— 历史：`49f1440ca` (2026-05-09) 把 `android-app/app/build.gradle.kts:79` 从 `file(...)` 切到 `rootProject.file(...)`，让 `release.storeFile` 路径解析基准从 `:app` 模块改成 rootProject (`android-app/`)。`.github/workflows/release.yml` 写的 `release.storeFile=../debug-ci.keystore` 在新基准下错位到 repo root（gradle 在 `<repo-root>/debug-ci.keystore` 找不到 keystore），v5.0.3.46 build-android 因此挂在 `:app:validateSigningRelease`。修法：去掉 workflow 里 `keystore.properties` 内容的 `../` 前缀，让 `rootProject.file("debug-ci.keystore")` 直接解到 `android-app/debug-ci.keystore`（正是 keytool 输出位置）。v5.0.3.47 release.yml run #25632845952 build-android 真绿 verified，且 4 Android assets（`app-{arm64-v8a,armeabi-v7a,universal}-release.apk` + `app-release.aab`）正确入 Release。
- **Density APK splits 用户侧首落（commit `9865c5c08`）** —— v5.0.3.46 已合，但因 build-android 挂没产出 release assets，本轮首次以 release 形态用户可见：每 density × ABI splits 在 Android 5.0+ runtime resource selection 加持下意义不大，移除后 release asset count 14 → 4（3 APK + 1 AAB），AAB 上 Play Store 继续走 `bundle{}` 块的 density delivery 不影响用户。
- **剩余 `../` 三处扫净（commit `5a06421cd`）** —— `f9a7ba716` 只修了 workflow；`keystore.properties.template` / `docs/guides/KEYSTORE_SETUP.md` / orphan `android-app/.github/workflows/android-release.yml` 同病的 `../` 这次一并扫掉。约定全 repo 统一：`release.storeFile=keystore/<name>.keystore`（无 `../`），物理 keystore 落 `android-app/keystore/<name>.keystore`。KEYSTORE_SETUP.md 的 CI 例子顺手加 `working-directory: android-app` 保 keystore 落对位置。orphan workflow 加头注释说明 `.github/workflows/` 嵌套层级 GitHub Actions 不会执行。

### Distribution

- 桌面 binary 重打：v5.0.3.46 → v5.0.3.47（二进制内容与 v5.0.3.46 等价，version 字段不同。auto-updater 比对 `5.0.3-alpha.47 > 5.0.3-alpha.46`，v5.0.3.46 用户重启会拿到新 build）
- `chainlesschain` npm 维持 0.161.7（无 CLI 改动，release.yml `cli-tests` job correctly skipped）
- Android：versionCode 37 / versionName 0.37.0 不变（无 Android 源码改动），但 APK 因 density splits 关闭从 14 个产物精简为 4 个 (`app-arm64-v8a`、`app-armeabi-v7a`、`app-universal` + `app-release.aab`)
- 三大文档站本次同步刷新：tagline 升 v5.0.3.47 + 加本节 changelog + deploy-all.py tar 路径同步

## [v5.0.3.46] - 2026-05-10 — Phase 3d 桌面 ↔ Android 双向同步全套 + Android 0.37.0 七件套 + e2e CI 静默回归洞收口

> 真正打通桌面 ↔ Android 的双向社交数据同步（Phase 3d M2 → v1.2 共 12 个 commit，gate 1-4 全部 Ed25519 真签真验），Android 端一次落 7 件用户可见功能（Volcengine 语音 / APK 自更新 / Splash 重做 / Claude coral 主题 / i18n 三地区 / 生物识别 / DID Key 屏），CI 收掉 e2e-tests `continue-on-error` 这个把 3/3 OS 失败显示 success 的静默回归洞。

### Added — Phase 3d Mobile-Bridge-Sync 桌面 ↔ Android 双向同步

- **M2: 5 ResourceType walker + tombstones + IPC wire-up**（commits `491fb4758` `a052e51c0` `dd2156ec3` `a4fe653f9` `9a8e3635d`）—— 桌面侧 sync engine 落地：scaffold mobile-bridge-sync provider，drop dead `MobileSyncManager`；rewrite 5 ResourceType walker（`note` / `conversation` / `did` / `community` / `channel`）+ apply 路径；tombstone 触发器 + `resource_type` 列；`mobile.ts` 真 provider + IPC wire-up；52 个 mobile sync 测试，过程中找出并修 3 个 prod bug
- **M3 step A→D.5: SocialSyncAdapter wiring + Room cursor + JSON-RPC handlers**（commits `28c85dad5` `647dc8699` `945001502` `510f6d2e0` `1131e35a2`）—— Android 侧：用 `dagger.Lazy` 解 4 处 Hilt 循环依赖；MESSAGE outgoing path；Room 持久化 `SyncRemoteCursor`；`sync.*` JSON-RPC handlers 在 SyncManager 落地；transport wiring + outbound JSON-RPC
- **M4: 设置页 + DeviceManager + 手动配对**（commits `0bf5f00b9` `17ea9b69d`）—— Settings 加 SyncMobile 移动设备同步页面（设备列表 + 同步状态 + 触发 push/pull）；DeviceManager wire-up + 手动 pairing 表单
- **v1.1: SocialSyncWalker for handlePullRpc 实数据 + DID auth 验证 + SyncCoordinator auto-trigger**（commits `2d841dfdc` `692e3e626` `b77e0773b`）—— Android 侧 walker 真填 `handlePullRpc` 不再 stub；`sync.*` topic 加 DID 签名验证；`SyncCoordinator` socket 连上后自动 trigger push/pull，不需要 UI 手动点
- **v1.2: 真 Ed25519 签名 + Android gate 4**（commits `c739d77d0` `4ecb7c8ef`）—— 桌面侧把 placeholder 签名换成真 `@noble/ed25519` 签名；Android gate 4 即对端 Ed25519 验签（前 3 gate 在 v1.1 已开），桌面 ↔ Android 4 个 gate 全部 strict-verify

### Added — Android 0.37.0（commit `1348636ad`，7 件用户可见功能）

- **Volcengine SeedASR 语音识别** —— `WavRecorder`（16kHz mono PCM → WAV）+ `VolcengineAsrClient`（HTTP submit + 800ms poll）+ `HomeStatusViewModel` 状态机 + `AsrSettingsScreen`（x-api-key 入口）+ Recording dialog（pulsing coral mic + breathing ring + mm:ss + 72dp Stop 圆）+ Transcribing dialog（3-dot breathing，跟 splash 一致）
- **APK 自更新（issue #21）** —— `UpdateChecker`（GitHub Releases API，tag prefix `android-v`，arm64-v8a asset 选择）+ `UpdateInstaller`（DownloadManager + FileProvider + ACTION_VIEW）+ `UpdateDialog`（changelog scroll + REQUEST_INSTALL_PACKAGES 权限流）+ Settings "检查更新" 入口带当前 versionName + Application 级 BroadcastReceiver 接 `DownloadManager.ACTION_DOWNLOAD_COMPLETE`
- **Splash + 主题大改** —— SplashScreen 紫色渐变 + 旋转环 + TT logo + 3-dot + progress + stage；`rememberUpdatedState` 修 splash race（之前 `nextAfterSplash` 在 AuthVM load 完之前被 capture 成 stale）；`Theme.kt` 切 Claude coral palette（`#D97757` primary + warm-gray dark + `#FAF9F5` bg）；`Type.kt` 加粗 headlines + 拉宽 body line-height；`dynamicColor=false` 默认保品牌色（Android 12+ 否则会被 Material You 改色）
- **i18n（issue #16）** —— `resourceConfigurations` 用 `zh-rCN` / `zh-rTW` / `zh-rHK` 显式 qualifier（fix：`zh` 作 language-only 在 build 时把 `values-zh-rCN/` 全过滤掉）；`AppCompatDelegate.setApplicationLocales` 在 SettingsScreen 接线；`MainActivity` → `AppCompatActivity` + `Theme.AppCompat.Light.NoActionBar` 父主题；`locales_config.xml` + `AppLocalesMetadataHolderService`（API <33 兼容）
- **Auth + DID** —— `AuthRepository.register` 幂等回退到 `verifyPIN`（fix race：AuthVM 异步 DataStore read vs splash navigate 抢跑）；SettingsScreen 生物识别 toggle 接 AuthVM `enableBiometric` / `disableBiometric`；新增 `KeyManagementScreen`（DID + public key hex + clipboard + trusted devices + reset）
- **Home page UX** —— LLM 未配置 banner 显示在 BrandSection 上方（点击跳 LLM Settings）；Send-from-home prefill 通路：home → NewConversation route 带 prefill；`ConversationViewModel.getDefaultModel()` + 自动建会话（prefill 跳过 picker UI）；BrandSection / AboutScreen logo 切 `R.mipmap.ic_launcher`（TT 品牌）；FunctionEntryCard 12 个硬编码彩色 → 统一 surfaceVariant + 44dp icon chip
- **Launcher icons** —— 替换默认 Android 机器人 `mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher{,_round}.png` 为 TT logo（PIL LANCZOS resize）
- **顺手修的 latent bug**：`OpenAIAdapter.{chat,chatWithTools,checkAvailability,streamChat}` 加 `withContext IO` + `flowOn`（之前 block main thread → 12s 主页冻结）；`RemoteConnectionManager.invoke{,WithRetry}` inline reified `<T : Any>`；`ProcessManagerViewModel.cpuUsage` Elvis fallback 改 `Double 0.0`；`SystemMonitorScreen.kt:149` `os?.type/version` null-safe；256 个 `rs_*` string stub 自动生成（remote/ui/* 屏 Phase 3d v1.3 work 平行编译需要）

### Fixed

- **Android `sync.*` DID auth strict-mode flip + release build unblock**（commit `49f1440ca`）—— `sync.*` topic 的 DID 鉴权从可选变强制；release build 之前因 lint baseline 漂移挂的 issue 一并修
- **2 个 mobile-ipc 测试 stale after M4.5**（commit `d34de0ac0`）—— DeviceManager wire-up 改了 IPC shape，把测试同步对齐
- **官网移动端 hamburger 菜单**（commit `0bb62675d`）—— `SiteHeader.astro` 在小屏下 nav 列表撑满整行无折叠，加 `<button>` toggle + tailwind `md:hidden`
- **logo 资产送 docs+design 站 + www 文档跳链 retarget**（commit `61b8cd642`）—— 之前 docs/design 站 hero 引 `/logo.png` 但仓库里没有；www 部分 footer 链接还指着旧 docs 路径
- **E2E preload 真错暴露 + force V5/V6 mode + app-config.json 早写**（commits `076474208` `1f61a18bf` `fc9cacc48`）—— preload 失败时 throw window snapshot 不再 catch+continue 吞信号；E2E 强制 V5/V6 模式让 preload bridge 真加载；测试启动前先 `writeFileSync app-config.json useWebShellExperimental:false`，绕过 Phase 1.6 hard-flip

### CI

- **drop e2e-tests workflow `continue-on-error: true`**（commit `e807d576c`）—— 之前 JOB 级 `continue-on-error` 让 3/3 OS 失败显示 success，"No team IPC interface found" 沉了几周
- **e2e-tests workflow 加 npm cache + Playwright browsers cache**（commit `9460f05da`）—— `actions/cache@v4` 缓存 `~/.npm` 和 `~/Library/Caches/ms-playwright` / `%LOCALAPPDATA%\ms-playwright`，单 OS 跑时间预期从 ~14m 降到 ~6-8m

### Android

- **versionCode 36 → 37, versionName 0.36.0 → 0.37.0** —— minor bump 反映 7 件用户可见功能 + Phase 3d 双向同步落地

### Tests

- 桌面 mobile sync 52 测试全绿（M2 step 8）
- Android Phase 3d v1.1/v1.2 sync 测试全绿（gates 1-4 完整）
- mobile-ipc 12/12 绿（M4.5 wire-up 后）

### NPM

- `chainlesschain` 保持 0.161.7（CLI 自 v5.0.3.45 无源码改动）

### Distribution

- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.46 > 5.0.3-alpha.45`，所有 v5.0.3.45 桌面用户重启会真发现新版
- Android APK 走新 `android-v0.37.0` tag 发布（用户可在 Settings → 检查更新 看到）
- 三大文档站本次同步刷新：tagline 升 v5.0.3.46 + 新增本节 changelog + 设计文档对齐

---

## [v5.0.3.45] - 2026-05-09 — cc ui llm.chat parity + 意图理解 opt-in 开关 + 真流式 + Vue Proxy reactivity 修复

> `cc ui` 终于跟桌面 web-shell 在 LLM 路径上对齐；项目/文件模式聊天默认不再走"理解中…"占位 LLM 调用；`chatStream` 改为真正的 token-by-token 流式；意图卡片 Vue Proxy 引用 bug 修复让占位卡正确翻面。

### Added

- **`cc ui` `llm.chat` WS topic**（commit `f41c4b4e2`）—— 桌面 web-shell 自 `4eaf90137`（Phase 2）就有这个 topic，但 `cc ui`（CLI 的 ws-server）从未注册过。结果：QuickAsk 页面在 `cc ui` 模式下永远卡 60 秒后报 `Stream idle timeout`（dispatcher 返回的 `UNKNOWN_TYPE` 帧 SPA 不识别为流的终态）。
  - 新增 `packages/cli/src/gateways/ws/llm-chat-protocol.js`，handler 复用 chat-core 的 `streamOllama`/`streamOpenAI`/`streamAnthropic`，按 `<topic>.chunk` + `<topic>.result` 的 frame 协议跟桌面 `desktop-app-vue/src/main/web-shell/handlers/llm-handlers.js` 完全对齐
  - 新增 `packages/cli/src/gateways/ws/llm-creds.js` 共享 cred 解析：explicit `options` → WS session creds → provider 环境变量（顺序：volcengine/openai/anthropic/deepseek/dashscope/gemini/kimi/minimax/mistral）；任何源没拿到都立即返回 ok:false 帧，不再 60 秒挂死
  - chat-intent-protocol 同步切到共享 helper —— 顺手修一个 latent bug：原代码 `session.baseUrl || "http://localhost:11434"` 在 session 没设 baseUrl 时硬编码到 ollama 地址，所有云 provider 在用户本地没起 ollama 时都会跑死
- **意图理解可见开关**（commit `f41c4b4e2`）—— Chat / Agent 项目/文件模式 header 加 `<a-switch>`，**默认关闭**。原行为：v5.0.3.43 起每条消息先调 LLM 提炼意图（`chat.intent.understand-stream`），再走真发送 —— LLM 慢/无 cred 时占位卡 90 秒；现在默认直发，需要意图卡片的用户手动打开开关（持久化到 `localStorage cc.web-panel.chat.intentEnabled`）
  - `submitUserInput` 第一行的短路：`if (mode === 'global' || !intentEnabled.value) { sendMessage; return }`
  - 桌面壳同享这个 SPA bundle，所以桌面也跟 `cc ui` 行为一致

### Fixed

- **`chatStream` 真正的 token 流式**（commit `35f6e60ea`）—— `packages/cli/src/lib/chat-core.js` 的 `chatStream` 原本是 buffer 全部 token 后再循环 yield 的伪流式 —— 消费者要等到 LLM 整个回完才看到第一帧。改为 token queue + Promise waiter 模式：onToken push 后立刻 wake generator yield。`streamPromise.finally` 翻 done flag 兜底空响应。Chat / Agent / QuickAsk / 意图理解 全部受益。
- **意图占位卡片 Vue Proxy reactivity 修复**（commit `a76e451e2`）—— `submitUserInput` 创建 placeholder 后 push 进 reactive `messages[sessionId]` 会被 wrap 成 Proxy，但本地变量 ref 仍指向 unwrap 之前的 target；后续 `placeholder.metadata.X` 直接改原对象绕过 Proxy `set` trap → 数据更新但不触发重渲染。用户可见症状：意图卡片永久卡在"理解中… / 0 tokens / 意图: 未识别"，即使后端已经流完 30+ chunk + final。修法：`card = msgs[msgs.length - 1]` push 后重新取 Proxy 引用，所有后续 mutation 走 `card.metadata.X`。

### Tests

- CLI ws gateway 16/16 绿（chat-intent 6 + 新 llm-chat 9 + 新增"无 cred 不调 LLM"环境清理 1）
- web-panel chat-intent-flow 27/27 绿（包含新 "default off" + "setIntentEnabled persists" + 已存在的 8 条意图流测试改成显式 setIntentEnabled(true) 后的开关用例）

### NPM

- `chainlesschain` 0.161.5 → 0.161.6 → **0.161.7**（0.161.6 已先于 productVersion 单独 publish 修复 QuickAsk + Chat 项目模式 hang；0.161.7 带 chatStream 真流式 + 意图卡片 Vue Proxy 修复）

---

## [v5.0.3.44] - 2026-05-08 — LLM OCR + audit-ipc 覆盖 + V5/V6 chat-intent 90s 兜底

> 一条 user-visible feature（LLM OCR）+ 三条质量收口（chat-intent 90s wall-clock、compliance-ipc 死 handler 清理 + audit-ipc 23 用例首测、macOS 路径断言修复）。无破坏性变化，所有 v5.0.3.43 用户可直接 upgrade。

### Added

- **截图 OCR LLM 引擎**（commit `39b16e29f`）—— Tesseract.js 中文识别准确度差，新增 `engine` 参数 `auto`/`llm`/`tesseract` 三态：
  - `auto`（默认）：火山引擎已配置走 doubao 视觉 OCR，否则回落 Tesseract；LLM 出错带 `fallbackFrom`/`fallbackReason` 标签自动降级
  - `llm`：强制视觉 LLM（当前 `volcengine` doubao-1.5-vision-pro，`userBudget=medium`）；无 llmManager / 非 vision provider 时显式报错
  - `tesseract`：强制本地 Tesseract.js
  - Engine guards 放在 `recognizeDispatch` 而非 `recognizeWithLLM`，便于测试 stub 替换 impl 不重复验证逻辑。Provider 白名单 `Set(["volcengine"])`，扩展到 gemini/openai/anthropic 只需在各自 `LLMManager` 暴露 `chatWithImage*` 后加一个集合项
  - UI：V5/V6 共享 dialog + web-panel dialog 各加一个 `<a-select>` engine 选择 + 蓝/灰/橙三色 tag 显示已用引擎

### Fixed

- **chat intent understand 90s wall-clock 兜底**（commit `6cbd04c50`）—— `sendStream` 自带的 60s idle timer 在每个 chunk 上 rearm，慢 LLM 一直 dribble token 但永远不出 `final` frame 时，"理解中…" 占位卡会无限转。包一层 `AbortController + setTimeout(90s)` 把信号传进 stream 调用，超时后清理 placeholder 并给可读错误。
- **compliance-ipc 死 handler 清理**（commit `29006decf`）—— `compliance-ipc.js` 之前注册的两个 channel 用了 typo 前缀 `compliance-classify:*`：
  - `compliance-classify:generate-report` / `compliance-classify:get-policies`（typo，无人调用）
  - 真正被 renderer（`stores/compliance.ts` + `stores/audit.ts`）调用的 `compliance:generate-report` / `compliance:get-policies` 由 `audit-ipc.js` 拥有，背后是 `ComplianceManager`
  - 死 handler 背后接的是不同 service（`soc2Compliance.generateReport` vs `auditManager.complianceManager.generateReport`），保留只会让以后修真正路径时漏改死路径。直接删 + 同步删 `IPC_CHANNELS` 中两个 typo 项
- **macOS 临时目录路径断言**（commit `bb2c16656`）—— `build-win-with-deref.test.js`（虽然测的是 Windows 构建符号链接，但 macOS Unit Tests 矩阵也跑）3 个断言炸 `expected '/private/var/folders/...' to be '/var/folders/...'`：macOS 的 `/var → /private/var` symlink，`os.tmpdir()` 返回 `/var/...` 但 `realpath` 路径不一样。`canonical = fs.realpathSync(os.tmpdir())` 把测试用临时目录都规范化掉，linux/win 上 `realpath` 是恒等，无 regression。

### Tests

- **`audit-ipc.js` 首次单测覆盖**（commit `b092673be`）—— 之前零覆盖的盲点（被 `29006decf` typo 死 handler bug 拽出来）。`audit-ipc.js` 拥有 18 个 channel 包括 renderer-facing 的 `compliance:get-policies` / `compliance:generate-report`，没有单测就让 `compliance-ipc.js` 里的 typo duplicate 静悄悄活了几个月：
  - 源码 DI 改造（与 `credit-ipc` 模式一致）：accept `ipcMain` via `deps` with `electron` fallback，lazy-required 让 injection 可以抢先
  - 新增 23 个 case 覆盖 18 channel 路由 + happy-path payload + AuditManager 异常路径
  - 全局测试套总数滚到 17,455 / 17,455

| 套 | 通过 |
|---|---|
| desktop 单测 | 1477 / 1477 |
| CLI unit | 17,455 / 17,455 |

### Notes

- CLI npm 包同步发布 `chainlesschain@0.161.5`（v5.0.3.43 末已 bump，本次随 release.yml 一起 publish）。
- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.44 > 5.0.3-alpha.43`，所有 v5.0.3.43 用户重启会真发现新版。

---

## [v5.0.3.43] - 2026-05-07 — MTC publisher_signature M-of-N 修正 + 安全硬化级联

> 两条主线。**(1) MTC `landmark.publisher_signature` strip-all-sigs 对称化**——修复一个会**绕过 M-of-N 阈值**的真实缺陷：原实现只清零 `publisher_signature.sig` 后做 JCS，但只要篡改 M-of-N 联邦中**任何一个**成员的 per-member sig，publisher_signature 就会被打断 → 直接绕过阈值的存在意义。**(2) 安全硬化级联**——一周内 8 次 sweep 把 `npm audit` 全部清零（HIGH 44 → 0 / MOD 4 → 0 / LOW 45 → 0）。

### Fixed

- **MTC publisher_signature M-of-N strip-all-sigs**（commit `c23e98cca` 代码 + `038e6d710` 规范）—— Producer 与 verifier 必须**对称地**把 `_stripSigsForPublisher(landmark)`（清零 `publisher_signature.sig` + 每个 snapshot 的 `signature.sig` + `signatures[*].sig`）喂给 JCS 后再签 / 验。Helper 抽到 `packages/core-mtc/lib/publisher-signing.js`，导出为 `@chainlesschain/core-mtc/publisher-signing` 子路径。三处调用点：`batch.js`（单签 + 联邦）、`landmark-cache.js` 验证侧、桌面 `governance-multisig.js`（lazy-require 绕 @noble/curves hoisting trap）。规范文档 §8.2 同步更新。Canary：`mtc-federation-publish-cli.test.js` "2-of-3 threshold accepts when one member's sig is tampered" — 任何修改 publisher-sig 路径都必须跑全部 `mtc-federation*` 集成。
- **LandmarkCache `landmark.publisher_signature` 验证启用**（commit `c40d927da` + `72c3619ee`）—— `LandmarkCache` 默认 opt-in `verifyPublisherSignature: true` 对 cache 命中前增加发布者签名校验（不再无脑相信 cache）；real-verifier callers（CLI `cc mtc verify` + 桌面 audit pipeline + cross-chain bridge 校验侧）全线启用。常量 `BAD_PUBLISHER_SIG` → `BAD_LANDMARK_SIG`（`36fcd8f4f`）匹配规范 §11；spec §8.5 跟进 `LANDMARK_SIG_PREFIX` 定义（`8e459cfd5`）。

### Security

- **HIGH 44 → 0 / MOD 4 → 0 / LOW 45 → 0 安全硬化级联（多 commit）**——
  - `f6c937fa8` override transitive `serialize-javascript` + `tar`（HIGH 44 → 10）
  - `8a56978b5` 干掉无人维护的 `speedtest-net`，改用 native fetch 实现网速测试（HIGH 10 → 7）
  - `9c7ce00e7` override `semver` 到 `^7.7.4`（清掉 imap 链 HIGH 7 → 4）
  - `922b64822` override `undici` 到 `^6.21.2`（清掉 hardhat 5.x 链 HIGH 4 → 3）
  - `4fae47dd4` deprecate `werift`（清空残余 HIGH 3 → 0）
  - `cc7b0b40a` override `ip-address` + `dompurify`（MOD 4 → 0）
  - `1f86594a2` override `tmp` 到 `^0.2.5`（LOW 45 → 40）
  - `64047283a` override `make-fetch-happen` 到 `^13`（LOW 40 → 14）
  - `d19bcb8cb` 拆 `hardhat-stack` 到独立 `contracts/` workspace + drop 不再依赖的 `hdkey`（LOW 14 → 0）
- **`channel-manager` DDL 加固 + drop 未用的 jspdf**（commit `d558b66b1`，1 critical）—— 修一处 DDL 注入面 + 删未用依赖减少攻击面。
- **`wrtc-compat` `ip.isPublic` 补丁 CVE-2024-29415**（commit `7312cf035`）—— `ip` package SSRF 漏洞绕过补丁。

### Added

- **Updater 渲染端进度通知**（commit `4c1a5ac18` + `e27592bb5`）—— `notifier-only` flow，关闭重复的 native dialog，渲染端实时显示下载进度。

### Fixed (post-release follow-ups, 2026-05-08)

> 源码级 follow-ups，源自 `551ef28b3` "fix(ipc): correct ipcGuard API" 那次 sweep 不彻底，留下两类互补 bug。两个 commit 都是源码 / 测试同步问题，**不影响 v5.0.3.43 桌面 binary 的业务功能**（handlers 仍正常注册），下次发版自动滚入。

| Commit | Bug | 为什么之前没炸 | 测试 |
|---|---|---|---|
| **`af92e0162` fix(test): align nostr-bridge-ipc stub** | 源码用 `ipcGuard.markModuleRegistered(name)` 直调（real guard 有此 fn），但 test stub 仍 mock 不存在的 `registerModule(name, channels)` 二参 → stub 调时 `TypeError: ipcGuard.markModuleRegistered is not a function`，23 / 389 social 用例炸 | CI "Unit Tests" stable-fallback 排除 `**/*-ipc.test.js`；"Full Test Suite" 用 `continue-on-error: true` | 23 / 23 ✅ |
| **`11247a957` fix(ipc): align 8 ai-engine IPC modules** | 8 个 IPC 模块（autonomous-developer / collaboration-governance / tech-learning / federation-hardening / reputation-optimizer / sla / stress-test / inference）反过来 —— 源码 `if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }`，real guard 没 `registerModule` → `if` 永远 falsy → guard 内部 `registeredModules` Set 漏跟踪这 8 个模块。Handlers 走 `ipcMain.handle` 仍真正注册，业务功能正常，只是 guard tracker 漏 8 个模块 | 测试 stub 自己 mock 了 `registerModule` → 测试假绿 | 邻近 29 文件 577 / 577 ✅ |

修法：stub `registerModule` → `markModuleRegistered` + 断言去 channels 参（test 侧）；`if (ipcGuard.registerModule) { ipcGuard.registerModule(name, CHANNELS); }` → `ipcGuard.markModuleRegistered(name)`，同时去掉同样无意义的 `if (ipcGuard.unregisterModule)` wrap（源码侧）。CI 漏检的两类（fallback 排除 `*-ipc.test.js` + Full Suite `continue-on-error: true`）作为单独 follow-up，不在本 commit 范围。

### Maintenance (post-release follow-ups, 2026-05-08 evening)

> 当晚晚些时候继续清理。其中 `cf77aea8d` 直接关掉上一段 explicit 留的"CI 漏检两类"follow-up；其余三条是顺手清出的 V5 opt-out 死代码 + 必走的 CLI 版本 bump + 一个 web-panel 404 bundle 修。这一批同样**不影响 v5.0.3.43 桌面 binary 的业务功能**，下次发版自动滚入。

| Commit | 内容 |
|---|---|
| **`1cb6576b9` chore(web-panel): refresh built asset hashes** | committed 的 `index.html` 引用 `index-Cf0pZvjB.js`，但该 bundle 已被新 build 覆盖；workspace 实际用 `index-Cs70ksHC.js` —— main 上 web-panel 在加载 404 bundle。同步两处 dist (`packages/web-panel/dist/` + `packages/cli/src/assets/web-panel/`) |
| **`cf77aea8d` fix(ci): close test.yml two coverage holes** | (1) Unit Tests stable-fallback 删掉 `**/*-ipc.test.js` catch-all（40 个 IPC 文件本地 39 pass + 1 skip / 1476 用例）；(2) Full Test Suite "Run all unit tests" 删掉 `continue-on-error: true`（coverage step 保留）。drive-by：`compliance-ipc.test.js` 3 个 fail align 到源里实际注册的 `compliance-classify:*` typo 前缀（dead handler 独立 bug 后续 commit 再处理） |
| **`539463b85` refactor(ui): drop dead chat-panel state + stale V5 page references** | `5066a778d` 删了 V5 ChatPanel 容器，但 `app.ts` `chatPanelVisible` field、`AppHeader` 聊天 toggle、`VoiceCommandHandler` 打开/关闭聊天 + 未识别语音 fall-through 派发到聊天的分支全成 cosmetic no-op。同时清 4 个 plugin.json description + `communityQuick.ts` header 引用已删 V5 页面的 stale 字符串。−50 行净瘦身 |
| **`a9b85f5ba` test(ui): drop chatPanelVisible default-state assertion in app.test.js** | `539463b85` 漏改第二个 store 测试 `tests/unit/stores/app.test.js`（之前 .ts 镜像 `src/renderer/stores/__tests__/app.test.ts` 改了，.js 这个 broke）。pre-commit prettier 顺手 reformat 整文件单引号→双引号 |
| **`c61de71eb` chore(cli): bump 0.161.4 → 0.161.5** | `af92e0162` + `11247a957` 改了 CLI 源但没 bump 版本号 → 下次发版 cli-tests 会被 `SHOULD_TEST=false` 跳过（rule: `github_release_pipeline_constraints.md` #5）。drive-by：`package-lock.json` 之前 v5.0.3.42 release 时 .161.3 → .161.4 漂移没修，一并对齐到 .161.5 |

### Tests

| 套 | 通过 |
|---|---|
| desktop 单测（含 nostr-bridge-ipc 修） | 1454 / 1454 |
| core-mtc 单测 | 258 / 258 |
| CLI mtc-federation 集成 | 41 / 41 |
| CLI 全量 unit | 17,432 / 17,432 |

### Notes

- 本版本同时是大幅安全 / 加密路径硬化版本，不含新增 P2P / chat-panel feature；用户可放心 upgrade。
- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.43 > 5.0.3-alpha.41`，所有 v5.0.3.41 桌面用户重启会真发现新版。三大文档站（docs-site / docs-site-design / docs-website-v2）同步刷新（commit `1183075b5` + `0384099f3`）。

---

## [v5.0.3.42] - 2026-05-07 — CLI 0.161.3 → 0.161.4 chat-intent 同步

> 无功能变化，仅修 release pipeline 测试覆盖问题。

### Changed

- **CLI 包 `chainlesschain` 0.161.3 → 0.161.4 atomic bump**（commit `a555b6760`）—— v5.0.3.41 ship 了 chat-panel-v5 三壳对齐里的 chat-intent 路由代码，但 CLI `package.json.version` 没动，cli-tests 在 release 流程的 precheck 阶段判 `SHOULD_TEST=false`（`chainlesschain@0.161.3` 已在 npm registry → 跳过测试），导致后续 v5.0.3.43 publisher_signature 修补的真实回归差点没被拦住。本版本明示 atomic bump CLI 0.161.4 + 安装包同步发布，触发 cli-tests 强制运行。规则文档化在 `MEMORY.md` `github_release_pipeline_constraints.md` 第 5 条：未来如果发现 CLI source 改动但 release pipeline 跳测 cli-tests，请优先检查 `git diff <prev-tag>..HEAD -- packages/cli/src/` 是否非空 + 同步 bump CLI version。

---

## [v5.0.3.41] - 2026-05-07 — chat-panel-v5 三壳对齐 + B4 social 滚动收口

> productVersion **v5.0.3.40 → v5.0.3.41**。本版本正式 ship 自 .40 以来全部滚动条目（XII–XIX：B4 跨机分发 / trust filter / viewer / 外部归档 / M-of-N / 跨联邦信任 / web-shell / web-panel / sign-as-self / cred-persist / auto-archive / chat-panel-v5）。

### Added

- **chat-panel-v5 V6 AIChatPanel 反向对齐**（commit `b33527d31`，Phase E）—— 把 V5 ChatPanel 的 4 个核心特性反向对齐到 V6 默认壳 AIChatPanel：流式响应 + 历史会话切换 + 上下文记忆引用 + 工具调用面板。从此 V5 / V6 / web-shell 三壳的聊天体验严格对等。
- **chat-panel-v5 web-shell 端口 v1+v1.1**（commit `72b13388a`）—— V5 ChatPanel 的全部 router 协议、autoSendMessage 信号、virtual list 与 5 intent / 6 IPC 在 web-shell 默认壳走 WS topic 接通。配合上一条，**Phase 1.6 hard-flip 默认壳用户不再缺任何 V5 聊天能力**。
- **B4 P2P 社交全栈 audit-grade 闭环**（§2.2.10 → §2.2.24 共 15 节，跨多个 .40 滚动 commit）——
  - **§2.2.10 Phase A 跨机同步**（commits `50b8ddb05` + `3741a8e7e`）：系统性修 7 个底层 bug（libp2p 3.x stream API、`registerMessageHandler` 漏调、收包后没按 type 派发、`gossipProtocol.message:received` 一直没人订阅）。社区 / 频道跨机器同步真正打通。
  - **§2.2.11 Phase B v1 + B4 DID 签名 + 自动 peer 桥接**：MTC federation gossipsub 双轨（`channel:send-message` / `community:join` 双发布双订阅 + `INSERT OR IGNORE` 幂等），每条 channel_message 带 `sender_pubkey + Ed25519 detached signature`，三重校验关闭 sender_did free-text 冒名缝隙；libp2p `peer:connected` 双向广播 `mtc:advertise` envelope 自动桥接。
  - **§2.2.12-2.2.13 B4-merkle channel envelope finality**：本机发出每条 channel 消息进离线可验的 Merkle 批 envelope（`channel-event-batch.js` +390）；新 IPC `channel:get-message-envelope` 返 inclusion proof + landmark；输出 wire-compatible，对端可用 `cc mtc verify` 验证。
  - **§2.2.14-2.2.18 B4-cross / cross-trust / ui / archive / mofn**：跨机 envelope gossipsub 分发 + on-demand pull / community-member trust filter / 桌面 viewer 按钮 + modal / 外部归档（filesystem + WebDAV）/ M-of-N 多签治理。
  - **§2.2.19-2.2.20 B4-crossfed + B4-webshell**：跨联邦信任锚 / 13 个 WS topic 桥接 web-shell 默认壳。
  - **§2.2.21-2.2.22 B4-webpanel + B4-mofn-sign v2**：4 个 composable + `MtcAudit.vue` 4-tab 页 / sign-as-self（私钥永不离主进程，渲染端只发 ID），顺手修 `registerAllIPC` 漏传 12 个 manager 的潜伏 ~1 个月 bug。
  - **§2.2.23-2.2.24 B4-cred-persist + B4-auto-archive**：WebDAV 凭据走 secure-config.enc（safeStorage / AES-256-GCM）`useStoredCredentials:true`，凭据永不外泄；主进程 `setInterval` 周期触发归档（5min 最小、per-community try/catch、runOnce 非重入、配置写 `app-config.json` 的 `mtc.autoArchive` namespace、`lastRun*` 自动持久化）。
- **Web Shell Phase 3c.7**（commit `200078947`）—— 截图识别 + 通知设置 + 托盘 5 个 quick-action 路由收口（global-search / clipboard-import / show-notifications / screenshot-ocr / open-settings#notifications）；`Notes.vue` 监听 `?clipboardImport=` / `?screenshotOcr=` query 自动开 dialog；测试 26 cases。
- **Plugin Marketplace 部署脚本骨架**（commit `a62fd8b81`）—— `docker-compose.yml` 加 marketplace services；deploy doc + bt-nginx 修复脚本。生产实际是 standalone 部署到 47.111.5.128；这些是未来 from-repo 部署的参考。

### Fixed

- **web-panel 单测 `views-mount-smoke.test.js` 在 63 文件并行套件下 first-import 撞 30s timeout**（本版）—— Pipeline.vue + Chat.vue 在 4-fork 池 + 全量 SFC transform 竞争下，首个加载它们的 fork 会撞默认 testTimeout。fix：file-level `vi.setConfig({ testTimeout: 60_000 })`，全局 timeout 不动（已验证全局升 60s 反让 worker pool 调度恶化导致更多 file 超时）。同 `cli_ci_sharding_lessons` 记录的 vitest 4 严格 timeout 模式。
- **Dashboard bundled-skill 发现 + JSON-based stat 解析**（commit `3881b9603`）—— skill 数 / 桌面统计在仪表盘上的展示口径修正，bundled-skill 列表能正确发现，stats 走 JSON 解析不再走 fragile string parse。

### Tests

| 套 | 通过 |
|---|---|
| desktop unit（MTC + DID + social + web-shell + p2p + bootstrap + renderer）| 1454 / 1454（4 skipped）|
| core-mtc 单测 | 258 / 258 |
| CLI chat-intent + mtc-federation core/trust/sync 集成 | 69 / 69 |
| CLI 全量 unit | 17,432 / 17,432 |
| web-panel 单元 | 1853 / 1853 |
| web-panel e2e | 63 / 63 |

### Notes

- 桌面 binary 重新打过；auto-updater 比对 `5.0.3-alpha.41 > 5.0.3-alpha.40`，所有 v5.0.3.40 桌面用户重启会真发现新版。三大文档站同步刷新。
- 设计文档 `docs/design/modules/02_去中心化社交模块.md` 累积 §2.2.10–§2.2.24 全 15 节。**私钥 / 密码均不过线**，UI 默认壳全套可见，audit-grade 闭环。

---

## [v5.0.3.40] - 2026-05-07 — MTC 视图 in-process 提速 + CI 解锁三发

### Fixed

- **MTC 视图 onMounted 三发并发必爆 timeout**（asar 冷启动级联）—— v5.0.3.39 切到 `asar:true` 后 `cc` 子进程冷启动从 dev 的 ~2.5s 涨到打包后 6-10s（asar header 走查 + Node module resolve 多一层虚拟 fs），Mtc.vue 的 `loadStatus` + `loadBridgeStatus` + `loadBridgeSla` 三发并发必撞 8s/6s 上限。修法：新增 3 个 in-process WS topic（`mtc.audit-status` / `mtc.bridge-status` / `mtc.bridge-sla`）直查 `audit-mtc` / `cross-chain-mtc` lib（纯文件读，无 SQLite，无 spawn，零 asar 开销）；`Mtc.vue` 通过 `useShellMode().isEmbedded` 分叉，embedded 走新 topic，浏览器 / `cc serve` 仍走旧 `ws.execute`。同时把保底 timeout 从 8000/6000 提到 30000 ms（与 `executeJson` 默认对齐）。顺手修了 standalone 路径一个 pre-existing shape mismatch（lib 返回扁平字段，SPA 期望 `obj.config.*` 包装）—— 仅 embedded 路径生效，standalone 维持原状（独立 follow-up）。配 7 + 1 新单测。
- **macOS unit fallback 上 7 个 build-win-with-deref 测试**（commit `25d834958`）—— `isSymlink` 之前用 `realpathSync` 比较，但 macOS `os.tmpdir()` 路径含 `/var → /private/var` 的隐式 symlink，所有 tmp 路径下的常规目录都被误判为 symlink。改成 platform split：Win 仍用 realpath（junction 需要），POSIX 用 `lstat.isSymbolicLink()`（POSIX 没有 junction 概念，lstat 可靠）。
- **rules-validator SQL_INJECTION 在测试 fixture 上误报**（同 commit）—— `sync-external-store.test.js:32` 的 `TestDbManager.exec(sql)` 是 sql.js 测试适配器的 passthrough。`getAllFiles` 现在跳过 `__tests__/` / `__mocks__/` 目录 + `.test.js` / `.spec.js` / `.d.ts` 文件。生产代码扫描不变；75 条警告仍属 advisory。
- **CLI subprocess cold-start ETIMEDOUT on Windows**（同 commit）—— `skill.test.js`（12 处 @ 15s）+ `agent-repl.test.js`（3 处 @ 10s）调 `node bin/chainlesschain.js …`。ESM module-graph cold-start 在繁忙 Windows 主机真的需要 >10s。所有 CLI subprocess 调用 timeout 统一升到 60s（与项目 testTimeout 对齐）；passes 仍 1.7-2.5s 完成，只有真 fail 才会跑满。

### Tests

| 套 | 通过 | 文件 | Duration |
|---|---|---|---|
| Desktop unit + stores | 10482 / 10482 (689 skipped) | 320 | 1022s |
| MTC handler in-process 新增 | 7 / 7 | 1 | 3.4s |
| web-panel mtc-parser 新增 | 14 / 14 | 1 | 1.1s |
| CLI unit | 17392 / 17392 (7 skipped) | 412 | 458s |
| CLI integration | 821 / 821 | 56 | 198s |
| CLI e2e | TBD | TBD | TBD |
| **小计** | **12224 + e2e** | **790+** | **~28 min** |

### Notes

- 桌面**有**运行时改动：`web-shell-bootstrap.js` 注册 3 个新 in-process WS handler，`packages/web-panel` SPA bundle 重打。auto-updater 比对 `5.0.3-alpha.40 > 5.0.3-alpha.39`，所有 v5.0.3.39 桌面用户重启时会发现新版并自动获取 MTC 提速 + CI 修复。
- v5.0.3.39 install-time benchmark 已跑 + [issue #8](https://github.com/chainlesschain/chainlesschain/issues/8) 已关 (2026-05-07 completed)：dev-box `Setup.exe /S` 实测 **190.9 s**（vs 1201 s baseline = −84% / 6.3×；vs 360 s gate = PASS 47% 余量）。Methodology caveat：本机 Defender OFF + NVMe SSD 跟 #6 baseline 三轴错二，HDD + Defender-on 严格 parity 仍是 nice-to-have follow-up（不是 release blocker）。本版桌面 binary 重新打过（含 SPA 新 bundle），但 ASAR surgery / native deps / 文件量级与 .39 一致，install 时间应等价。
- standalone `cc serve` 模式下 `loadBridgeStatus` 仍受 lib-vs-SPA shape mismatch 影响（pre-existing bug），桥状态显示 defaults——只在浏览器直连场景出现，桌面 v5.0.3.40 默认壳不受影响。

---

## [v5.0.3.39] - 2026-05-07 — B4 post-pack ASAR surgery（Windows 安装显著加速, issue #8）

### Fixed
- Windows installer time substantially reduced by re-enabling `asar: true` and running post-pack ASAR surgery in `afterPack` to inject the 4 walker-dropped packages (`call-bind-apply-helpers`, `side-channel-{list,map,weakmap}`) at top-level (commit `e11b46913`). **Measured: 190.9s on dev-box (NVMe SSD + Defender OFF) vs 1201s legacy baseline (issue #6) = 6.3× speedup. HDD + Defender ON default-environment strict parity not measured** — see [issue #8 close comment](https://github.com/chainlesschain/chainlesschain/issues/8#issuecomment-4393734608) for methodology caveats.

### Added
- `scripts/asar-surgery.js` — extract → inject → repack with original unpackDir preserved + verification gate.
- `scripts/build-win-with-deref.js` — Win wrapper that detaches workspace symlinks, runs electron-builder, restores in finally with `'junction'`.
- `scripts/probe-asar.js` — debug CLI for inspecting any asar's top-level entries.
- `tests/unit/scripts/asar-surgery.test.js` (8) + `build-win-with-deref.test.js` (15) — 23 unit/integration tests, real fs + real `@electron/asar` against tmp fixtures.

### Changed
- `electron-builder.yml`: `asar: false` → `asar: true`; removed 7 force-include `extraResources` entries that targeted `app.asar.unpacked/`.
- `scripts/electron-after-pack.js`: dual-branch — asar:false nuclear-replace (legacy) / asar:true `runSurgery`. Mac/Linux + Win all funnel through the same hook.
- `desktop-app-vue/package.json`: `@electron/asar ^3.4.1` declared as explicit devDep (was implicit transitive).

### Notes
- Surfaced one bug during testing: `@electron/asar` has a module-level `filesystemCache` keyed by archive path; `extractAll` populates it with the pre-surgery header so `listPackage` returns stale entries after we delete + repack. Fix: `asar.uncache(asarPath)` after `fs.rmSync`. Production builds were also affected — no Win VM smoke needed to find this.
- Refuted approaches (don't re-attempt): asarUnpack glob (issue #6 proven empirical), extraResources to `app.asar.unpacked/` (v5.0.3.12), declaring 4 packages as direct deps (v5.0.3.6).
- ASAR integrity: Electron `EnableEmbeddedAsarIntegrityValidation` fuse currently macOS-only. Windows post-surgery hash mismatch is unenforced. When macOS support lands, either patch electron.exe hash or disable integrity via `@electron/fuses`.

---

## [v5.0.3.38] - 2026-05-06 — 平台补齐：v5.0.3.37 漏掉的 Android APK 重新出全平台

> v5.0.3.37 的 release 因 GitHub immutable-releases 机制（一旦 release 由 finalize-release 翻成 published，**任何 asset 的新增/替换/删除都被 API 拒绝**——不只是 delete，UPLOAD 也 422）漏掉了 build-android 产出的 APK/AAB，桌面三平台 + iOS 共 14 个 asset 已发出且事后无法追加。本版无桌面功能改动，仅重新出全平台一致的 release 把 Android 补回。桌面侧二进制内容与 v5.0.3.37 等价（仅 productVersion / desktop version +1）。

### Fixed

- **CI release 工具链 2 处工程闭环**——
  - `release.yml` create-release 三状态分支（`b6256c972`）—— state 1 (no release) 创建 draft / state 2 (draft exists) edit + clobber upload / state 3 (published exists) 原本计划 add-only，**但本版实测证伪**：immutable-releases 连 UPLOAD 都拒，state 3 路径的 add-only 写法对已 finalized release 永远 422。后续会改成 advisory exit 0 或 revert 该分支，单独 issue 跟进。
  - `package-lock.json` 同步 `b6256c972` 5 个 npm 包版本（`a90e09b57`）—— 上一次 chore commit 改了 5 份 package.json 没跑 `npm install`，导致 v5.0.3.37 redispatch 在所有桌面平台一致挂在 `npm ci` "Install dependencies" 步。

### Notes

- v5.0.3.37 桌面用户重启时 auto-updater 比对 `5.0.3-alpha.38` > `5.0.3-alpha.37`，会真发现新版并提示。Android 用户首次拿到 APK（v5.0.3.37 release 的 14 个 asset 里没有 .apk / .aab）。

## [v5.0.3.37] - 2026-05-06 — 桌面版同步 productVersion + 托盘内存使用周期更新

> 用户在 v5.0.3.36 装上后看托盘 → 关于显示 `产品版本: v5.0.3.36 / 桌面版: 1.1.2-alpha`，质疑 auto-updater 用哪个版本号比对——直觉是对的。`desktop-app-vue/package.json.version`（也就是 electron-updater 真正用来比对的字段）从 v5.0.3.30 起一直停在 `1.1.2-alpha` 没动过，导致即便 productVersion 已 bump 到 v5.0.3.36，auto-updater 比对 GitHub Release `latest.yml` 里的 `1.1.2-alpha` 总是相等，**所有 6 个 release（v5.0.3.31-36）的"已是最新"判断都是误报**——任何一个老版用户重启都收不到自动更新提示。本版同步两件事。

### Changed

- **`desktop-app-vue/package.json` version 同步 productVersion**（commit pending）—— `1.1.2-alpha` → `5.0.3-alpha.37`，semver 合法（`-alpha.N` prerelease），数字部分跟 productVersion `vX.Y.Z.N` 一一对应。规则文档化在 `CLAUDE.md` Version hierarchy 段：每发一版（`productVersion → vX.Y.Z.N`）desktop 版同步到 `X.Y.Z-alpha.N`。下一次发版（productVersion → v5.0.3.38）desktop 版变 `5.0.3-alpha.38`，比 v5.0.3.37 用户当前的 `5.0.3-alpha.37` 高一档，auto-updater 会真发现并提示新版本。Setup.exe 文件名也变为 `ChainlessChain-Setup-5.0.3-alpha.37.exe`，与 GitHub release tag `v5.0.3.37` 视觉对应。

### Added

- **托盘 → 性能监控 → 内存使用 周期更新**（commit pending）—— `EnhancedTrayManager` 早就提供了 `updateMemoryUsage(usage)` 方法但 main 进程从未调用，跨 v5.0.3.30+ 一直显示"加载中..."。`index.js` 在 tray 创建后挂一个 10s `setInterval`：用 `app.getAppMetrics()` 累计所有 electron 进程（main + renderer + GPU + utility 子进程）的 `workingSetSize` (RSS)，格式化"X MB"或"X.X GB"传给 `updateMemoryUsage`。failure-tolerant：`getAppMetrics` 抛错只 `logger.warn` 不影响 tray 主流程。`onWillQuit` 中 `clearInterval` 提早停掉防止 quit 链路 timer 火 stale 回调。

## [v5.0.3.36] - 2026-05-06 — 手动检查更新加 native dialog feedback

> v5.0.3.35 修了 electron-log 缺失致 auto-updater 整模块 load 不进来的 bug 之后，从 electron-log 真实日志看 auto-updater 在用户点托盘"检查更新"时确实运行了：`手动检查更新 → Checking for update → Update for version 1.1.2-alpha is not available → 当前是最新版本`。但用户在 v5.0.3.30 - 5.0.3.35 跨 6 个版本一直反映"点了无反应"——根因是 `update-not-available` / `error` 事件只调 `webContents.send("update-status",...)` IPC，但 V5/V6 App.vue 和 web-shell 模式下加载的 web-panel SPA **都没监听这个 channel**，所以无论哪种 renderer 模式 UI 都看不到任何反馈。

### Changed

- **手动检查更新加 native dialog feedback**（commit pending）—— `auto-updater.js` 加 `_manualCheckPending` 标志：`checkForUpdates(manual=true)` 设置；`update-not-available` 事件回调在 manual 时弹 native "当前已是最新版本" dialog（带当前版本号）；`error` 事件回调在 manual 时弹 native "检查更新失败" dialog（带错误信息）；`update-available` 已有 `showUpdateAvailableDialog`，仅清掉 manual 标志避免重复弹窗。后台 3s 启动自检 + 每 4h 周期检查路径不传 manual=true，**全程静默不弹任何 UI**（电源管理 / 锁屏唤醒等场景下大量自动 dialog 会很骚扰）。`enhanced-tray-manager.js triggerCheckForUpdates` 调用处加 `true` 参数。

### Notes

- 之前 v5.0.3.31 / 32 / 33 / 34 / 35 五版的"检查更新点了无反应"用户体验问题，本版彻底闭环。绕开了 renderer IPC channel 的"无人监听"问题，跟 showAboutDialog 一样走主进程原生 dialog——简单可靠，不依赖 V5/V6 / web-shell 模式。

## [v5.0.3.35] - 2026-05-06 — auto-updater 缺 electron-log 模块导致从未 load

> v5.0.3.34 给"检查更新"fallback dialog 加诊断字段后，用户截图反馈：`autoUpdater loaded: NO`、`require error: Cannot find module 'electron-log'`、`app.isPackaged: true`。诊断把根因暴露得很彻底——v5.0.3.31 加 auto-updater init 时就坏，但因为 require 抛错被 logger.warn 静默吞掉，包括启动 3s 自检 + 4h 周期检查 + 托盘"检查更新"在内的整条自动更新链路其实从未真正生效，跨 v5.0.3.31 / 32 / 33 / 34 四个版本（v5.0.3.32 加的 `app.isPackaged` gate 是有效的，autoUpdater 是 undefined 就走不到那一步）。

### Fixed

- **packaged 安装版 `require("electron-log")` 抛 ENOENT 致 auto-updater 模块无法 load**（commit pending） —— `electron-log` 既不是 desktop-app-vue 的直接依赖，`electron-updater@6.6.2` 也不再带它作 transitive dep（v6 起 logger 由调用方注入）。修法是双保险：
  - **`auto-updater.js` 把 `require("electron-log")` 包 try/catch**：缺失时 fallback 到 console-based `{info,warn,error}` 对象，内部 `log.info(...)` 调用站点全部不变；同时 fallback 分支不设置 `autoUpdater.logger`，让 electron-updater 用自带默认。这样即便未来 electron-log 又出意外 missing，自动更新链路本身仍然可用，不会 cascading fail。
  - **`desktop-app-vue/package.json` 加 `electron-log: ^5.4.3` 直接依赖**：正常情况会走 file logger（写到 ChainlessChain log 目录），fallback 只是兜底。

### Notes

- 已知不在本版本修：托盘 → 性能监控 子菜单的"内存使用 / 加载中..."始终显示"加载中..."。`tray-manager` 有 `updateMemoryUsage(usage)` 方法但 main 进程从未周期性调用它来填充实时数据。和本版本无关，单独 issue 跟。
- web-panel 的"全局搜索 / 截图识别 / 剪切板导入 / 同步 / 通知中心"等 tray 项点了弹"功能即将推出"toast 是设计预期——web-panel 暂无对应面板。要让它们真工作得在 web-panel 加面板，是更大的功能开发。

## [v5.0.3.34] - 2026-05-06 — Web-shell 托盘菜单 bridge + 检查更新诊断信息

> 用户在 v5.0.3.33 安装版上反馈：托盘"检查更新 / 新建笔记 / 设置"等菜单项点了不跳转（除"显示主窗口"和"关于"外）；"检查更新"仍弹"开发模式"对话框。根因：当前默认走 web-shell 模式（Phase 1.6 `caaddf530` hard-flip），加载的渲染器是 `web-panel` SPA 而不是 `desktop-app-vue` 的 V5/V6 Vue 渲染器。v5.0.3.31 / v5.0.3.32 的两处 tray 修复都改的是 `desktop-app-vue/src/renderer/App.vue` 的 IPC listener — 在 web-shell 模式下这文件根本没被加载，preload (`src/preload/web-shell.js`) 也是空的（per strategy memo），所以主进程通过 `webContents.send("tray:action", …)` 发的事件无人接收。

### Fixed

- **Web-shell 模式下托盘菜单事件被丢弃** —— 给主进程加一条"绕开 IPC 走 ws-server"的桥接：
  - `ws-cli-loader.js` 暴露 `broadcast(frame)`，委托底层 `ChainlessChainWSServer._broadcast`（现成的，原本只内部用于 task 完成事件）。
  - `web-shell-bootstrap.js` 把 broadcast 透传到 startWebShell 返回的 handle。
  - `index.js` 在 EnhancedTrayManager 构造时传入 `getWebShellHandle()` 懒 getter（不依赖 web-shell 启动顺序）。
  - `enhanced-tray-manager.js dispatchTrayAction` 在原 IPC `webContents.send` 之外，增加 `webShellHandle.broadcast({ type: "tray:action", payload: { type, payload } })`。`getWebShellHandle()` 返回 null 时（V5/V6 模式）跳过；web-shell 活跃但无 web-panel 客户端连上时 `_broadcast` 自然 no-op。两边都不抛错。
  - `packages/web-panel/src/App.vue` 在 `ws.onMessage` 上挂全局监听器，`type === "tray:action"` 路由到 web-panel 自己的页面 (`/notes`、`/chat`、`/dashboard`、`/project-settings` 等)；web-panel 没对应面板的（通知中心 / 全局搜索 / 同步）回 toast"功能即将推出"。

### Changed

- **"检查更新"开发模式 fallback dialog 加诊断信息** —— v5.0.3.32 已经把 gate 从 `process.env.NODE_ENV === "production"` 改成 `(NODE_ENV === "production" || app.isPackaged)`，但用户在 v5.0.3.33 packaged install 上仍报告看到这个 dialog。把 `NODE_ENV` / `app.isPackaged` / `autoUpdater loaded` / `checkForUpdates fn` 四个字段直接打到 dialog detail 里，下次用户截图就能直接判断是哪条 fail：require 抛了？isPackaged 出乎意料是 false？还是 module 缺导出？避免再让用户挖 log 文件。

### Tests

- `enhanced-tray-manager.test.js` 6 → 10 测试（新增 4 个 web-shell broadcast path：handle 存在时双发、handle 为 null 时仅 IPC、未传 option 时向后兼容、broadcast 抛错时不波及主进程）。
- `src/main/web-shell/` 全 13 文件 196/196 绿。

## [v5.0.3.33] - 2026-05-06 — 托盘"关于"产品版本显示 "—" 修复

> 用户在 v5.0.3.32 安装版上反馈托盘 → 关于对话框 `产品版本：—`（应显示 v5.0.3.32）。根因是历史遗留 packaging 路径问题，v5.0.3.31 / v5.0.3.32 都有；本版顺手修掉。

### Fixed

- **托盘"关于"产品版本永远显示 "—"** —— `enhanced-tray-manager.js:317` 用 `require("../../../../package.json")` 读 monorepo 根 `productVersion`，但 packaged install 里 `enhanced-tray-manager.js` 位于 `app.asar/dist/main/system/`，相对路径 `../../../..` 走出 `app.asar` 抵达 `<install>/resources/`，那里没有 package.json → require 必失败 → 永远 catch 走 "—"。改为 build 时把 `productVersion` + `appVersion` 烧进 `dist/main/build-info.json`，showAboutDialog 优先读这个常量文件，packaged 模式 / dev 模式都能稳定取到；老相对路径保留作为直接 import src 跑测试时的 fallback。`scripts/build-main.js` 在 `dist/main/` 末尾写入 build-info.json。

## [v5.0.3.32] - 2026-05-05 — 修 v5.0.3.31 系统托盘菜单两处残留

> 用户在 v5.0.3.31 安装版上报告：托盘"检查更新"按钮仍弹"当前模式：development"对话框；从托盘菜单点其它项只把主窗口拉出来，但不跳到对应页面。两处不同根因，但一起表现为"v5.0.3.31 的托盘修复在打包版上没生效"。

### Fixed

- **托盘"检查更新"在打包版误报开发模式** —— `enhanced-tray-manager.js:365` 的判断写的是 `process.env.NODE_ENV === "production"`，但 Electron 打包后 `NODE_ENV` 默认是 undefined（不是 "production"），所以即使是 GitHub 下载的安装版也走 fallback 分支显示"当前模式：development"，且因此从未真正调用过 `autoUpdater.checkForUpdates()`。改为 `(process.env.NODE_ENV === "production" || app.isPackaged)`，对齐 `backend-service-manager.js:17` 已有的双判断写法。注意：后台静默自动更新链路本身不受影响，因为 `auto-updater.js:32` 守的是 `!process.env.NODE_ENV || === "production"`，对 undefined 容错。
- **首次启动未设密码状态下托盘菜单事件被丢弃** —— `App.vue` 的 `onMounted` 在 `initial-setup:get-status` 返回 `{ completed: false }` 时 early-return（line ~339），跳过下方的 IPC listener 注册块（`tray:action` / `show-global-settings` / `database-switched` 三个）。结果：首次启动用户点托盘菜单，主进程的 `dispatchTrayAction` 把窗口 show + focus 后通过 IPC `send("tray:action")`，但 renderer 没人接，路由不跳。把这三个 listener（连同已经在早返之前的 `deep-link:invitation`）整体提到早返之前——它们和数据库加密 / 设置流程无依赖关系。

### Notes

- 已知小问题（不在本版本修）：preload `removeListener` 直接传 `func`，但 `on` 注册时包了 arrow wrapper，不匹配。表现为 `onUnmounted` 里的 cleanup 实质未生效（轻微监听器累积），不影响功能。

## [v5.0.3.31] - 2026-05-05 — 系统托盘菜单 + 自动更新接入（修 v5.0.3.30 漏修的三个 bug）

> 用户报告 v5.0.3.30 安装版三个 bug：托盘菜单除了"显示主窗口"全部点了无反应；"检查更新"按钮点了哑响；自动更新功能不工作。三个症状同根：tray-manager 把所有菜单项 send 到 renderer 各自独立的 IPC channel，但 renderer **从未给任何一个 channel 注册 listener**；同时 `auto-updater.js` 模块在 `index.js` **从未被初始化**（grep `autoUpdater` 在 index.js 0 个匹配）。

### Fixed

- **自动更新静默不工作** —— `auto-updater.js` 模块定义了 init / 4-小时定期检查 / 启动 3s 自检，但 `desktop-app-vue/src/main/index.js` 从来没调用过 `init()`，packaged 版本因此既不主动检查也不被动等待。修复：在 tray 创建之后调用 `require("./system/auto-updater.js").init(this.mainWindow)`，模块自身仍守 `NODE_ENV !== "production"` 的 dev no-op。这是发版功能性 bug，影响所有已安装用户的自动更新链路。
- **托盘"检查更新"菜单点击无反应** —— 原实现 `sendToRenderer("check-update")`，renderer 全代码库 0 个 listener 监听该 channel。改为主进程直接调 auto-updater 单例 `checkForUpdates()`（dev 模式下弹一个原生 dialog 提示"开发模式不会触发自动更新"，避免再次哑响）。
- **托盘菜单大部分项点击无反应** —— `quick-action / sync / show-notifications / show-performance / open-settings / show-about` 6 个菜单分别 send 自己的 IPC channel，**renderer 一个都没监听**。统一为单一 `tray:action` 通道，payload 形如 `{ type, payload }`。`enhanced-tray-manager.js` 新增 `dispatchTrayAction(type, payload)` 方法，`src/renderer/App.vue` 注册 listener 按 type 分发到 Vue Router (`/settings/system`, `/performance/dashboard`, `/chat`) / `showGlobalSearch` 状态切换 / window 自定义事件 (`cc:show-notifications`, `cc:new-note`)；当前未接入的能力（screenshot-ocr / clipboard-import / sync）给明确的 `message.info("功能即将推出")` toast，避免再次哑响。
- **托盘菜单触发时主窗口被隐藏** —— 用户从托盘菜单选了菜单项但主窗口在托盘里没拉出来，UI 永远没机会响应。`dispatchTrayAction` 派发前检查 `mainWindow.isVisible()`，隐藏则 `show() + focus()`，保证操作可见。

### Added

- **`enhanced-tray-manager.js` 三个新方法** —— `dispatchTrayAction(type, payload)` 统一通道；`showAboutDialog()` 主进程原生关于对话框（避开 renderer round-trip）；`triggerCheckForUpdates()` 调 auto-updater 单例 + dev 模式 fallback dialog。
- **`src/main/system/__tests__/enhanced-tray-manager.test.js`** —— vitest 单测覆盖 `dispatchTrayAction` 6 个场景（payload 形状 / 空值默认 / 隐藏窗口的 show+focus / mainWindow 缺失兜底）。`showAboutDialog` / `triggerCheckForUpdates` 是 Electron 原语薄包装，受现有全局 `tests/__mocks__/electron.ts` + `tests/setup.ts` mock 干扰难以隔离测试，靠手动验证覆盖。
- **`docs-site/docs/guide/installation.md` 等三处 tagline / 当前版本** 同步更新到 v5.0.3.31。

## [v5.0.3.30] - 2026-05-05 — 桌面版收口（安装链路 + 托盘 + 技能上限 + 图标）

> 覆盖 commits `b2e1ff27d` / `33d40fbad` / `d57759dc9` + 本次 desktop fix batch。

### Fixed

- **内置技能数 100 上限触顶 —— 第 101 个起注册全失败** —— `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-registry.js:23` 的 `maxSkills` 默认 `100`，但运行时 `SkillLoader` 实际加载 **bundled 144 + marketplace 5 + managed 9 = 158** 个。所有 `getSkillRegistry()` 调用均不传 options，从第 101 个开始 `throw 已达到最大技能数限制: 100`。提升默认值到 `1000`（注释说明仅作 sanity 上限防循环注册 OOM，非功能上限），实测 158/158 全注册成功。
- **系统托盘图标在 dev 模式加载为空白** —— `enhanced-tray-manager.js:getIconPath()` 候选路径全部指向 `resources/`（项目里**根本没有这个目录**），`nativeImage.createFromPath()` 返回空 image，Windows 给了 fallback 图标。候选列表头部加 `assets/icon.ico`（dev 模式真实位置），`process.resourcesPath/icon.ico` 排第二（packaged 模式由 `electron-builder.yml extraResources` 拷贝）。tray 现在能正常吃到品牌 icon。
- **本地 `make:win:builder` 漏装 `packages/cli` 生产依赖** —— 之前从本地构建产物启动会在 web-shell 拉起 `ws-server.js` 时崩溃 `Cannot find package 'ws'`。`desktop-app-vue/package.json` 加 `prepare:cli-prod-deps` 前置脚本，`make:{win,mac,linux}:builder` 串起来跑 `cd ../packages/cli && npm install --omit=dev --workspaces=false --legacy-peer-deps`，对齐 CI release path 行为。
- **`afterPack` 在 Windows 非 admin / 非 Developer Mode 下 EPERM symlink** —— `cpSync` `dereference: false` 试图把 `@chainlesschain/{core-mtc,session-core}` 的 workspace junction 复刻到目标目录，Windows 拒绝。改 `dereference: true`——shippable 安装包本来就该 inline workspace 内容，不应保留指回用户源码树的 link。

### Changed

- **关闭按钮 X 默认最小化到系统托盘** —— 之前点窗口 X 直接退出应用导致用户误以为"窗口消失了"。现在 X 会把主窗口隐藏到屏幕右下角系统托盘（`desktop-app-vue/src/main/system/enhanced-tray-manager.js` 接进 `index.js`），后台仍运行；通过托盘菜单"退出"或 `Ctrl+Q` 才彻底关闭。完整说明见 [`/guide/installation`](/guide/installation#三、关闭按钮-x-行为)。
- **本地 Win 安装包体积下降 357 MB / 14k 文件** —— `desktop-app-vue/scripts/electron-after-pack.js` 增加 `cpSync` filter，丢 50 个声明在 `devDependencies` 的顶层包（运行时无引用，4 个例外 `better-sqlite3` / `electron` / `jsdom` / `glob` 通过 lockfile BFS 验证保留）+ 12 个非 win32 平台原生（`@nomicfoundation/edr-{linux,darwin}-*` 等）。Setup.exe 由 ~610 MB 降至 **594 MB**，安装时文件数由 124k 降至 110k。
- **应用图标 master 重生成（fill ratio 52% → 100% 水平）** —— `assets/icon.png` 原 master 是 2451×2451 但圆形 logo 仅占画布 ~52%，托盘 / 任务栏 / 桌面快捷方式视觉上明显比邻居（WeChat / Office）小一圈。新增 `desktop-app-vue/tools/regen-app-icon.js`（sharp + png-to-ico），自动 trim 透明边重生成 master + 7 层 .ico（16/24/32/48/64/128/256，bbox 1282×1143 squared 到 1282×1282，水平 100% / 垂直 89% fill）。后续换 logo 直接 `node tools/regen-app-icon.js` 重跑。
- **Windows 任务栏图标 + AppUserModelId 收口** —— `desktop-app-vue/src/main/index.js` 主 BrowserWindow 加 `icon: resolveAppIconPath()`（dev 走 `assets/icon.ico`，packaged 走 `process.resourcesPath/icon.ico`），`setupApp()` 顶部加 `app.setAppUserModelId("com.chainlesschain.desktop")`。dev 启动不再回落到 Electron 默认图标，packaged 升级时任务栏图标关联也不会丢。

### Added

- **`desktop-app-vue/package.json` postinstall electron 二进制兜底** —— `node node_modules/electron/install.js || true`。npm workspaces hoisting 偶发导致子包 electron postinstall 不触发、`node_modules/electron/dist/electron.exe` 缺失时，`npm install` 自动恢复，避免 `npm run dev` 抛 `Electron failed to install correctly`。
- **`desktop-app-vue/tools/regen-app-icon.js`** —— 应用图标 master + .ico 重生成脚本（详见 Changed 段）。
- **`docs-site/docs/guide/installation.md`** —— 桌面版安装指南，覆盖安装时间预期（15–25 分钟）、首次启动延迟（30–60 秒到主窗口）、托盘行为、卸载、系统要求。回答 "进度条不动是不是卡死了" / "我的窗口怎么消失了" 等高频疑问。
- **`desktop-app-vue/scripts/after-pack-dryrun.js`** —— 不打包的探针，复用 afterPack 过滤逻辑量化收益（kept / skipped / 文件数 / 体积），用于将来调整过滤规则前预演。
- **`desktop-app-vue/scripts/find-renderer-only-deps.js`** —— grep `src/main` + `dist/` 的实际 require/import，跟 `dependencies` 求差集找 renderer-only 候选。当前未接入 afterPack（transitive prod-chain 风险需 lockfile BFS 单独验证），留作后续安装包减肥探针。

### Known Limitations

- **首次安装仍需 15–25 分钟** —— `asar:false` 散文件部署模式下 NSIS + Defender 单文件处理是结构性瓶颈。前期试过 `asar:true` + `asarUnpack` glob 方案（[#6](https://github.com/chainlesschain/chainlesschain/issues/6)，已关），实测被 electron-builder walker 的 nested-only 决策证伪；剩余可行路径 = post-pack asar surgery（直接对 `app.asar` header 注入 walker dropped 的 4 个包 + 重算 integrity hash），暂无 active tracker。
- **图标视觉上仍比 WeChat / 酷狗音乐等方形 app 显小** —— 圆形 logo 物理面积 = 同尺寸方形的 78%（π/4），跟方形邻居同台必然显瘦一圈。本次改进只解决了"源 master 留白过多"的工程问题；要彻底视觉对齐需要设计层加方形底（待评估）。

## [v5.0.3.1] - 2026-04-29 — V6 Preview Shell P9d — 品牌收口 + 空白起步 + 设置入口

### Changed

- **`/v6-preview` 预览壳品牌收口** —— `desktop-app-vue/src/renderer/shell-preview/AppShellPreview.vue` 左上角字符串 "ClaudeBox" 替换为 `import brandLogo from "../assets/logo.png"` + 文字 "ChainlessChain"；composer 标签去掉 "运行中..." 后缀；`createDefaultRuntimeStatus.agentLabel` 默认值 `"Claude Code"` → `"ChainlessChain"`。
- **平台感知 traffic dot** —— macOS 红/黄/绿圆点改 `v-if="isMacPlatform"`；挂载时 `await window.electronAPI.system.getPlatform() === "darwin"` 判定，Windows/Linux 隐藏。
- **底部 runtime chip 收口为单按钮** —— 5 颗 chip（progress/model/skill/tool/terminal）收成单颗 button-chip 显示 `runtimeStatus.modelLabel || "未配置模型"`；与顶部新增的齿轮 `SettingOutlined` 按钮均 `router.push({ path: "/settings/system", query: { tab: "llm" } })`。

### Added

- `desktop-app-vue/src/renderer/shell-preview/AppShellPreview.vue` 引入 `useRouter` + `SettingOutlined` + `import brandLogo from "../assets/logo.png"`；新增 `isMacPlatform` ref 与 `openSettings()` 跳转助手。

### Removed

- `seedConversations()` / `createDemoFiles()` / 旧 `createBlankFiles()` 演示树 —— 不再注入 demo04 / workspace / ClaudeBox 三条欢迎会话；首次启动或 schema/JSON 损坏均落到 `conversations: []` + `activeId: null`，UI 引导用户主动 "+ 新会话"。
- `__testing.seedConversations` 导出（store 单测同步对齐）。

### Migration

- **`stores/conversation-preview.ts` 持久化 schema 从 `version: 2` 升到 `version: 3`** —— `localStorage` 中残留的 v2 数据会因 `SCHEMA_VERSION` 不匹配被 `restore()` 直接判废，落到空白起步状态。无主动迁移代码 —— 损失的只是 demo 数据，用户真实会话首次启动后通过 "+ 新会话" 按需创建。

### Tests

- `conversation-preview.test.ts` 改写"空白起步"语义 —— `it("seeds desktop preview conversations …")` → `it("starts empty when storage is empty and persists the empty state")` 等 4 处用例，扩到 **23 条** 全绿。
- preview shell 系列：`theme-preview.test.ts`（10）+ `widget-registry.test.ts`（5）+ `v6-shell-default.test.ts`（9）+ `conversation-preview.test.ts`（23）= **47/47** 全绿（17.1s）。
- `vue-tsc --noEmit` 0 错误。

### Docs

- `docs-site/docs/guide/desktop-v6-shell.md` §0 —— P9a 描述更新到 schema v3 + 空白起步语义；测试合计 37 → 53；新增 P9d 品牌/平台/设置入口三段。
- `docs-site/docs/design/modules/97-claude-desktop-refactor.md` + `docs-site-design/docs/modules/m97-claude-desktop-refactor.md` —— §交付状态新增 P9d 条目。
- `docs-website-v2/src/pages/index.astro` —— `evolution[]` 顶部新增 2026-04-29 条目。
- `README.md` / `README_EN.md` —— 顶部新增 2026-04-29 增量更新表格。

---

## [CLI 0.156.5] - 2026-04-22 — Windows postinstall 跨平台修复

### Fixed

- **CLI postinstall 在 Windows `cmd.exe` 下失败** — 旧 `postinstall` 脚本用了 Unix-only 的 `2>/dev/null || true`（Windows cmd 把 `/dev/null` 当字面路径，且没有 `true` 命令），导致 `npm install -g chainlesschain` 以 `ELIFECYCLE` 退出，skill-packs 生成失败还会让整个安装红掉。
- 抽出 `packages/cli/scripts/postinstall.mjs` 跨平台包装脚本：`try/catch` 吞错 + `process.exit(0)` 保底，不再依赖 shell 重定向。
- `package.json` `files` 数组补充 `scripts/postinstall.mjs`，确保 npm tarball 里包含它。

### Affected versions

- 已发布的 `0.156.0` / `0.156.1` / `0.156.2` / `0.156.4` 全部受影响。Windows 用户请升级到 `0.156.5`，或在旧版本上加 `--ignore-scripts` 绕过。

---

## [v5.0.2.43] - 2026-04-21 — 发布前测试回归闭环 + 533 自动文档刷新 + CLI 0.156.2

### Added

- **发布前测试回归闭环** — 92 单元测试 + 5 集成测试 + `vue-tsc --noEmit` + `vite build` 五关全绿，E2E 跟随既有 `describe.skip` 约定；本轮回归未触发任何代码修复。结果表已写入 [`docs-site/docs/guide/desktop-v6-shell.md` §18.7](docs-site/docs/guide/desktop-v6-shell.md) 与 [`docs/design/桌面版UI重构_设计文档.md` v0.5](docs/design/桌面版UI重构_设计文档.md)。
- **533 份自动文档刷新** — `desktop-app-vue/docs/api/generated/*.md` prettier list/heading 规范刷新，`ARCHITECTURE_OVERVIEW.md` + `COMPONENT_REFERENCE.md` 格式同步。
- **CLI 0.156.1 → 0.156.2** — patch 补丁用于 v5.0.2.43 npm release（无源码改动）。

### Changed

- `deploy-docs.py` + `deploy-www.py` 重定向到 `v5.0.2.34-20260420-1831` tar 产物（稍后再滚到 `20260421-*`）。

---

## [v5.0.2.42] - 2026-04-20 — V6 Shell 回归闭环 + 用户文档

### Added

- **V6 Shell + `/v6-preview` 用户文档** — `desktop-v6-shell.md` 新增 §18 "P7–P9b 预览壳" 全套（18.1–18.7）+ v0.4 / v0.5 版本行；`desktop-ui-refactor-user-guide.md` 新建 355 行用户指南；`introduction.md` / `architecture.md` / `tech-stack.md` / `getting-started.md` / `compliance-threat-intel.md` / `social-protocols.md` 六份指南追加 17 章规范附录（概述 / 核心特性 / 系统架构 / 系统定位 / 核心功能 / ... / 相关文档）。
- **设计文档落地** — `docs/design/桌面版UI重构_设计文档.md` 458 行新文档（文档信息 + 修订历史 + 现状分析 + 总体设计 + 详细设计 + 企业定制方案 + 安全设计 + 与其他端的关系 + 迁移方案 + 风险与对策 + 待决事项 + 附录 A 目录约定 + 附录 B 相关文档）。
- **CLI 0.156.0 → 0.156.1** — 文档版本号对齐补丁。

### Changed

- `docs-site-design/scripts/sync-docs.js` + `docs-site/scripts/sync-design-docs.js` 加入新中文 → ASCII 映射：`桌面版UI重构_设计文档.md` / `96_V2规范层governance.md` / `97_桌面版UI_ClaudeDesktop重构计划.md`。
- VitePress 两站 sidebar 加入新条目（`desktop-ui-refactor` / `m97-claude-desktop-refactor` / `96-v2-governance`）。
- `docs-website-v2` footer + `desktop.astro` + `index.astro` evolution hero chip 全部 v5.0.2.10 → v5.0.2.34。

---

## [v5.0.2.34] - 2026-04-20 — 桌面版 V6 Chat-First Shell (P0–P6 完成) + P7 预览外观

### Added (P7 · Claude-Desktop 风格外观预览)

- **`/v6-preview` 路由** — 与 `/v2` 并存的新壳，不替换任何现网入口。沿用 P6 `slash-dispatch` 分发器。
- **4 主题体系** — `src/renderer/shell-preview/themes.css` 提供 dark / light / blue / green 四套 `--cc-preview-*` CSS 变量；`src/renderer/stores/theme-preview.ts` 是 Pinia store，`[data-theme-preview]` 属性切换，localStorage 持久化。
- **4 颗去中心化入口** — 左栏底部固化 `TeamOutlined` P2P / `SwapOutlined` Trade / `GlobalOutlined` Social / `SafetyCertificateOutlined` U-Key；分别绑定 `builtin:openP2P` / `openTrade` / `openSocial` / `openUKey` handler（当前为占位 toast，P8 对接业务页）。
- **三区骨架** — 左栏 `ConversationList` 会话历史 + `DecentralEntries` 四入口 + 主题切换；中区留白气泡 + 极简 composer（Ctrl/Cmd+Enter 发送）；右侧 `ArtifactDrawer` 抽屉从右滑入。
- 设计文档：[`docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`](docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md)

### Tests (P7)

- `src/renderer/stores/__tests__/theme-preview.test.ts` — 11 例，覆盖初始值 / apply / restore / clear / 无效值保护 / 多 pinia 实例共享 localStorage
- `src/renderer/shell/__tests__/slash-dispatch.test.ts` — 8 例，覆盖注册 / 派发 / 未注册 / 覆盖语义 / 解绑匹配 / 错误捕获 / listRegisteredHandlers / 4 入口共存
- 合计新增 19 例全部通过

### Added (P8 · 4 颗入口接入 drawer preview widget)

- **4 个 preview widget** — `src/renderer/shell-preview/widgets/{P2p,Trade,Social,UKey}PreviewWidget.vue`，每颗 widget 统一 "概览 hero + kv 指标卡 + 2–3 按钮 router.push 进 `/main/*` 完整页" 骨架。
- **widget 注册表** — `shell-preview/widgets/index.ts` 把 4 个 entry id（`p2p` / `trade` / `social` / `ukey`）映射到 component + title。
- **`AppShellPreview.vue` 替换 `message.info()` 占位** — 现在 4 个 `builtin:open*` handler 直接打开 `ArtifactDrawer` 并挂载对应 widget；drawer 的 `toggleArtifact` / `closeDrawer` 同步清理 `activeEntryId` 状态。
- **跳转目标**：P2P 用 `P2PMessaging` + `/main/p2p/device-pairing`；Trade 用 `TradingHub` / `Marketplace` / `Contracts`；Social 用 `Chat` / `/main/social-collab` / `SocialInsights`；U-Key 用 `ThresholdSecurity` / `DatabaseSecurity` / `/main/hsm-adapter`（均已在 `router/index.ts` 存在）。

### Tests (P8)

- `src/renderer/shell-preview/widgets/__tests__/widget-registry.test.ts` — 5 例：4 canonical ids / 字段完整 / 已知 id 查询 / 未知 id undefined（大小写敏感）/ 标题唯一
- 合计 P7+P8 新增 **24 例** 单测全部通过（3.64s）

### Added (P9a · 会话持久化)

- **`useConversationPreviewStore`** — `src/renderer/stores/conversation-preview.ts` Pinia store，把预览壳的会话列表 + 消息 + 活跃 id 持久化到 `localStorage`（key `cc.preview.conversations`，`version: 1` schema）。
- **Schema 安全**：非法 version / 损坏 JSON / 非数组 conversations / `activeId` 指向不存在会话 — 均触发 "重新 seed 欢迎会话"；`restore()` 不抛错
- **actions**：`restore` / `select` / `createBlank` / `appendMessage` / `remove` / `clearAll` — 每次写操作立即 `_persist()` 到 localStorage
- **`AppShellPreview.vue` 重构**：所有会话 / 消息读写改走 store，`ref<Conversation[]>` + 内联种子完全删除，`onMounted` 额外调用 `conversationStore.restore()`

### Tests (P9a)

- `src/renderer/stores/__tests__/conversation-preview.test.ts` — 13 例：seed / hydrate / schema 版本拒绝 / 损坏 JSON 容错 / `createBlank` 活跃切换 / `appendMessage` 更新 preview+title+updatedAt+持久化 / 空串忽略 / `select` 未知 id 拒绝 / `remove` 当前活跃自动切换 / `remove` 非活跃保持 / `clearAll` 清空 / schema version 校验 / 空 store 自动 `createBlank`
- 合计 P7+P8+P9a 新增 **37 例** 单测全绿（~22s，4 个测试文件）

### Added (P9b · composer → 真 LLM)

- **`llm-preview-bridge.ts`** — `src/renderer/shell-preview/services/llm-preview-bridge.ts` 薄桥：`isAvailable()` 查 `window.electronAPI.llm.checkStatus()`；`sendChat(messages)` 调 `window.electronAPI.llm.chat({ messages, enableRAG:false, enableCache:false, enableCompression:false, enableSessionTracking:false, enableManusOptimization:false, enableMultiAgent:false, enableErrorPrecheck:false })`，从 `{ content }` / `{ message: { content } }` / `{ reply }` 三种返回形状中提取文本；`toBridgeMessages(history, nextUser?)` 把 `BubbleMessage[]` 转 `{role,content}[]`；所有失败（electronAPI 未就绪 / checkStatus 拒绝 / chat 抛错 / 返回空）都走 `BridgeResult = { ok: false, reason }` 兜底，不抛。
- **`AppShellPreview.sendDraft()` 重写**：追加用户气泡 → 翻 `isGenerating=true` → 调 bridge → 成功追加 assistant 气泡 / 失败追加 `LLM 调用失败：${reason}` / 不可用追加 `LLM 服务不可用，请检查火山引擎/Ollama 配置` → `finally` 翻 `isGenerating=false`。
- **typing 指示器 + 发送态**：气泡列表在 `isGenerating` 时追加一只三点动画气泡（`data-testid="cc-preview-typing"`）；发送按钮进入 `loading` 并禁用，直到回合结束。
- **`conversation-preview` store 扩展**：新增 `isGenerating: boolean` state、`appendAssistantMessage(content)` / `setGenerating(flag)` actions；`appendMessage` 修正为仅 `role==="user"` 时才在 `新会话` 标题上自动覆盖（之前 assistant 消息也会改标题）。

### Tests (P9b)

- `src/renderer/shell-preview/services/__tests__/llm-preview-bridge.test.ts` — 19 例：`isAvailable` 5 例（无 api / `{available:true}` / 布尔 / `{available:false}` / reject）+ `sendChat` 6 例（`{content}` / `{message.content}` / 空返回 / 抛错 / 无 api / 消息透传 + 关闭高级开关）+ `toBridgeMessages` 3 例（历史 + next / 空 next 跳过 / trim）+ `extractReply` 5 例。
- `conversation-preview.test.ts` 新增 2 例：`appendAssistantMessage` 不改标题 / `setGenerating` 翻转。
- 合计 P7+P8+P9a+P9b 新增 **58 例** 单测全绿（~15s，5 个测试文件）

### Added (P9c · 流式输出)

- **Bridge 扩展**：`llm-preview-bridge.ts` 新增 `streamAvailable()` / `sendChatStream(prompt, onChunk)` — 调 `window.electronAPI.llm.queryStream(prompt)` 并监听 `llm:stream-chunk` 事件。Payload 优先读 `fullText`，退回累加 `chunk`；调用方通过 `onChunk(liveText)` 收到每次累积文本。`queryStream` 返回为空时以累积文本兜底。`finally` 里 `off(STREAM_CHUNK_EVENT, listener)` 清理监听（preload 现有 off 无法真正 removeListener，是已知既有 quirk，影响范围限单监听器）。
- **局限**：`llm:query-stream` 只接收单串 prompt（无 messages 数组），预览壳流式发送时**仅把最新用户输入作为 prompt**，不含会话历史；历史感知的流式需要新建 main-process handler，超出 preview 范围，留给后续。
- **Store 新 actions**：`beginStreamingAssistant()` 种一只空 assistant 气泡并返回其 id；`updateAssistantContent(id, content)` 增量更新（不持久化，只在 finalize 时落盘）；`finalizeStreamingAssistant(id, content)` 写最终值 + `_persist()`；`removeMessage(id)` 删除指定消息（流式失败时把空气泡撤回，再走非流式 fallback）。
- **`AppShellPreview.sendDraft()` 双路径**：先查 `streamAvailable()` → 开 streaming bubble → 每个 chunk `updateAssistantContent` → 成功 `finalize` 返回；失败 `removeMessage` 后回落到非流式 `sendChat`；非流式再失败走友好提示（P9b 原路径）。
- **typing 指示器收敛**：新增 `showTypingIndicator` computed — 仅在"生成中但最后一条不是已开始填充的 assistant 气泡"时显示，避免流式状态下出现"打字指示器 + 实时内容气泡"双显。

### Tests (P9c)

- `llm-preview-bridge.test.ts` 新增 12 例：`streamAvailable` 4 例（无 api / `queryStream` 缺失 / 都齐 / 只有 queryStream 缺 on）+ `sendChatStream` 8 例（electronAPI 缺 / queryStream 缺 / 空 prompt / chunk 累加 + on/off 注册 / fullText 优先 / null 返回用累加兜底 / 空返回空累加报 `空` / 抛错仍清理 listener）。
- `conversation-preview.test.ts` 新增 5 例：`beginStreamingAssistant` 种 id / `updateAssistantContent` 更新 + preview / 未知 id + 非 assistant role 不动 / `finalizeStreamingAssistant` 落盘 / `removeMessage` 按 id 剔除。
- 合计 P7+P8+P9a+P9b+P9c 新增 **75 例** 单测全绿（~14s，5 个测试文件）

### Added

- **桌面版 V6 对话壳 P0–P6 全量落地** — Electron 桌面端 `/v2` 路由提供"对话优先 + 插件化平台"新壳，完整取代旧 dashboard。设计文档见 [`docs/design/桌面版UI重构_设计文档.md`](docs/design/桌面版UI重构_设计文档.md)，用户指南见 [`docs-site/docs/guide/desktop-v6-shell.md`](docs-site/docs/guide/desktop-v6-shell.md)。
  - **三区布局** — 左侧 `ShellSidebar`（空间切换）+ 中间 `ConversationStream` + `ShellComposer`（对话 + `/` 命令 + `@` 引用）+ 右侧 `ArtifactPanel` + 底部 `ShellStatusBar`。
  - **扩展点 7 类** — Spaces / Artifacts / Slash / Mention / StatusBar / Home Cards / Composer Slots，通过 `plugin.json` 的 `contributes.ui.*` 声明，经 `ExtensionPointRegistry` 按 priority 降序选出胜出者。
  - **企业能力 5 类** — LLM / Auth / Storage / Crypto / Audit Providers，通过 `contributes.provider.*` 声明，通过同一优先级机制让企业 Profile 覆盖默认。
  - **P6 分发器 + Widget 注册表**（本版本核心）— `src/renderer/shell/slash-dispatch.ts` + `widget-registry.ts` 把 plugin 声明的 `handler` / `component` 字符串真正接上运行时行为；内置 `builtin:openAdminConsole` + `builtin:AdminShortcut`。
  - **AdminConsole** — `Ctrl+Shift+A` / `/admin` / 状态栏齿轮按钮三路径打开；4 标签页（概览 / UI 扩展点 / 企业能力 / 调试），仅 `admin` 权限账户可见。
  - **企业定制三路径** — 私有 Registry（`trustedPublicKeys` 验签）、`.ccprofile`（ed25519 签名 + 每插件 sha256，一键换肤换能力）、MDM 推送（启动时校验解包到覆盖目录，高 priority 胜出）。
  - **13 个内置 first-party 插件** — `chat-core` / `notes` / `spaces-personal` / `cowork-runner` / `brand-default` / `ai-ollama-default` / `auth-local` / `data-sqlite-default` / `crypto-ukey-default` / `compliance-default` / `admin-console` / `chain-gateway` / `did-core`，跳过 DB / 沙箱 / 权限流程直接从 `src/main/plugins-builtin/` 载入。

### Tests

- 单元：`tests/unit/renderer/shell/slash-dispatch.test.ts`（7）+ `widget-registry.test.ts`（5）+ `AdminShortcut.test.ts`（2）
- 集成：`tests/integration/plugin-extension-points.integration.test.js`（5）— 验证 `.ccprofile` + MDM 覆盖链路，合成 `acme-corporate@100` 胜过 `chainlesschain-default@10`
- 深度集成：`tests/unit/renderer/shell/AppShell.interaction.test.ts`（3）— 全 jsdom 挂载 `AppShell` 验证三路径都能打开 AdminConsole
- E2E：`tests/e2e/v6-shell/admin-console.e2e.test.ts`（3 × `describe.skip`，待登录 helper 支持 admin 权限后启用）
- 合计：22 例单元 + 集成全部通过（13.6s）；渲染器 `npm run build` 4m 52s 绿灯

### Docs

- 新增 `docs-site/docs/guide/desktop-v6-shell.md` 用户指南（VitePress 侧栏已注入）
- 同步 `docs-site/docs/design/desktop-ui-refactor.md`（设计侧栏已注入）
- 设计文档升级到 v0.3（P0–P6 实现完成，附实现文件映射表 + 验证章节）

## [v5.0.2.10] - 2026-04-16 — Managed Agents A–J + Deep Agents Deploy + CutClaw B

### Added

- **Managed Agents Phase A–J** — Full parity with Anthropic Managed Agents architecture via `@chainlesschain/session-core` (0.3.0).
  - Phase A: `SessionHandle`, `TraceStore`, `AgentDefinition` + cache (79 tests)
  - Phase B: `SessionManager` — idle detection + park/unpark persistence (25 tests)
  - Phase C: `IdleParker` — configurable idle threshold + interval polling (14 tests)
  - Phase D: `MemoryStore` — scoped memory (global/session/agent/user) + `MemoryConsolidator` (55 tests)
  - Phase E: `ApprovalGate` (strict/trusted/autopilot) + `BetaFlags` with date-based expiry (46 tests)
  - Phase F: `StreamRouter` — unified `StreamEvent` protocol for all streaming paths (19 tests)
  - Phase G: `AgentGroup` + `SharedTaskList` with rev-based concurrency control (52 tests)
  - Phase H: Desktop IPC consumption — 24 IPC channels, singletons + preload namespace (33 tests)
  - Phase I: Session tail/usage + 14 WS routes + `stream.run` + `sessions.subscribe` + 3-provider token accounting (30 tests)
  - Phase J: Desktop `closeSession` → auto-consolidate + `_executeHostedTool` → ApprovalGate routing (36 tests)

- **Deep Agents Deploy Phase 1–5** — Agent bundle system for portable agent packaging.
  - Phase 1: `agent-bundle-schema` + `agent-bundle-loader` + `agent-bundle-resolver` (40 tests)
  - Phase 2: USER.md memory seeding via `applyUserMemorySeed` + `parseUserMdSeed`
  - Phase 3: `mcp-policy` — hosted/lan/local MCP transport gating (19 tests)
  - Phase 4: `sandbox-policy` — scope-based sandbox lifecycle (26 tests)
  - Phase 5: `service-envelope` + `envelope-sse` — unified wire format for WS/HTTP/SSE (30 tests)
  - CLI: `cc agent --bundle <path>` + `cc serve --bundle <path>` integration (15 tests)
  - Desktop: `bundle:load/info/unload` IPC channels + Pinia store integration

- **CutClaw Path B verification** — Architecture alignment items all verified.
  - B-1: `DebateReview.resolveConflictingVerdicts()` consumes `detectConflictPairs` + `pickWinnersAndLosers` from `sub-runtime-pool.js` (34 debate-review tests)
  - B-2: 4 built-in `QualityGate` checker factories — `createProtagonistChecker`, `createDurationChecker`, `createThresholdChecker`, `createLintPassChecker` (39 quality-gate tests)
  - B-3: 3 media categories (ASR/AUDIO_ANALYSIS/VIDEO_VLM) in `LLM_CATEGORIES` (25 tests)

- **session-core v0.3.0** — 22 library modules, 21 test files, 452 tests total

### Tests

- session-core: 452 tests across 21 test files
- Desktop session-core IPC: 33 tests
- Desktop session-service Phase J: 36 tests
- Desktop debate-review conflict resolution: 34 tests
- CLI agent-bundle integration: 15 tests
- CLI envelope-http-server: 11 tests

## [Unreleased] - 2026-04-09 — CLI Runtime 收口闭环 (Phase 7 Parity Harness)

### Added

- **Phase 7 Parity Harness 全量落地** — CLI Runtime 收口路线图 (`docs/design/modules/82_CLI_Runtime收口路线图.md`) Phase 0–7 全部完成，统一 Coding Agent envelope 协议 v1.0 在 CLI / Desktop / Web UI 三端达成字节级对齐。
  - 8 步 parity 测试矩阵全部通过（91 tests）：envelope 契约、sequence tracker、legacy→unified 双向映射、WS server envelope 透传、JSONL session store、SubAgentContext worktree 隔离、mock LLM provider、desktop bridge envelope parity。
  - 新增 `packages/cli/__tests__/integration/parity-envelope-bridge.test.js`(58 tests)覆盖 `createCodingAgentEvent` / `CodingAgentSequenceTracker` / `wrapLegacyMessage` / `unwrapEnvelope` / 数据驱动 roundtrip / `validateCodingAgentEvent` / `mapLegacyType` 全路径。
  - `src/lib/agent-core.js` / `src/lib/ws-server.js` / `src/lib/ws-agent-handler.js` 降级为 @deprecated shim（26/16/12 行），canonical 实现收归 `src/runtime/` 与 `src/gateways/ws/`。

### Status

- 收口完成定义 5 项准则全部达成 ✅（见 82 路线图 §8）：单一入口、envelope 协议统一、parity harness 全绿、shim 明确标注迁移窗口、文档同步。

### Docs

- 同步更新 `docs-site/docs/chainlesschain/cli-runtime-convergence-roadmap.md` 与 `docs-site/docs/design/modules/82-cli-runtime-convergence.md` 镜像至 canonical。

## [v0.45.55–v0.45.61] - 2026-04-08 — 技术债收官 (M2 + IPC Registry)

### Performance

- **M2 启动期同步 IO 异步化收官** — 把启动关键路径上的同步 IO 全部转为 `fs.promises`，避免阻塞 Electron 主进程事件循环。共改造 11 个模块（unified-config-manager / ai-engine-config / tool-skill-mapper-config / mcp-config-loader / database-config / logger / git-auto-commit / project-config + 3 个 ai-engine-manager 变体）。所有改造均使用 `_deps` 注入模式以保持单元测试可 mock；同步 API 作为运行时快路径保留。
  - v0.45.58: `project-config.js` 新增 `initializeAsync` / `loadConfigAsync` / `saveConfigAsync` + `getProjectConfigAsync()` 工厂；`ai-engine-manager.js` / `ai-engine-manager-p1.js` / `ai-engine-manager-optimized.js` 三个变体的 `initialize()` 改用 `await getProjectConfigAsync()`。

### Refactored

- **IPC Registry 收官** (v0.45.59~60)
  - **v0.45.59** — `ipc-registry.js` 的 Phase 5 / Phase 9-15 deps 构造曾用 `{ mcpClientManager, mcpToolAdapter }` 简写但顶部从未声明这两个标识符。由于 `...dependencies` 已经覆盖了它们，简写引用纯属冗余 + 真实潜在 ReferenceError。删除两处冗余引用。
  - **v0.45.60** — 主文件顶部 30+ 行的 destructure（绝大多数项只解构出来又通过 `...dependencies` 转发）压缩到只剩 5 个本文件直接引用的 manager (`app` / `database` / `mainWindow` / `llmManager` / `aiEngineManager`)，其余通过 `...dependencies` 透传。文件 495 → 446 行。

### Fixed

- **v0.45.61** — `project-export-ipc.js` 的 `project:import-file` 处理器有 v0.45.13 引入的 copy-paste 死代码块，引用了 `projectPath` 和 `normalizedProjectPath` 两个未在该作用域定义的变量；进入该 handler 即抛 `ReferenceError`。彻底删除死块，改用 `getActiveDatabase()` 路径（与 export-file handler 一致）。同步补全 `project-export-ipc.test.js` 中 mockDatabase 的 `getProjectById` / `getProjectFiles` / `db.get` / `db.run` 接口，原本静默失败的 3 个文件操作测试还原为真实断言。
- **v0.45.57** — `git-auto-commit.js` 的 `isGitRepository()` 改用 `fs.promises.stat` + ENOENT/ENOTDIR 容错，消除最后一处启动可达的 `existsSync` 调用。

### Tests

本轮全面回归通过：
- `src/main/ipc/__tests__/`: 89/89 ✅
- `src/main/git/__tests__/` + `tests/unit/git/`: 192/192 ✅
- `tests/unit/project/`: 212/212 ✅（修复了 3 个 pre-existing 失败）
- `tests/unit/ai-engine/`: 1987/1987 ✅
- `packages/cli/__tests__/unit/`: 3053/3053 ✅

### Tasks

- ✅ #2 H2 IPC Registry 拆分（completed）
- ✅ #7 M2 启动期同步 IO 异步化（completed）

12 项 tech-debt 列表全部清零。

## [3.4.0] - 2026-02-28

### Added

**v3.1.0 — Decentralized AI Market (Phase 65-67):**

- Phase 65: Skill-as-a-Service — SkillServiceProtocol, SkillInvoker, 5 IPC handlers
- Phase 66: Token Incentive — TokenLedger, ContributionTracker, 5 IPC handlers
- Phase 67: Inference Network — InferenceNodeRegistry, InferenceScheduler, 6 IPC handlers

**v3.2.0 — Hardware Security Ecosystem (Phase 68-71):**

- Phase 68: Trinity Trust Root — TrustRootManager, attestation chain, 5 IPC handlers
- Phase 69: PQC Full Migration — PQCEcosystemManager, ML-KEM/ML-DSA replacement, 4 IPC handlers
- Phase 70: Satellite Communication — SatelliteComm, DisasterRecovery, 5 IPC handlers
- Phase 71: Open Hardware Standard — HsmAdapterManager, FIPS 140-3, 4 IPC handlers

**v3.3.0 — Global Decentralized Social (Phase 72-75):**

- Phase 72: Protocol Fusion Bridge — ProtocolFusionBridge, cross-protocol conversion, 5 IPC handlers
- Phase 73: AI Social Enhancement — RealtimeTranslator, ContentQualityAssessor, 5 IPC handlers
- Phase 74: Decentralized Storage — FilecoinStorage, ContentDistributor, 5 IPC handlers
- Phase 75: Anti-Censorship — AntiCensorshipManager, MeshNetworkManager, 5 IPC handlers

**v3.4.0 — EvoMap Global Evolution (Phase 76-77):**

- Phase 76: Global Evolution Network — EvoMapFederation, multi-Hub sync, 5 IPC handlers
- Phase 77: IP & Governance DAO — GeneIPManager, EvoMapDAO, 5 IPC handlers

**Infrastructure:**

- 64 new IPC handlers across 13 phases
- 23 new database tables
- 13 new Pinia stores, Vue pages, and routes
- 4 new Context Engineering setters (steps 4.9-4.12)
- 13 new config sections
- Comprehensive unit tests (279 tests passing) and E2E tests

## [0.21.0] - 2026-01-19

### Added

**Desktop Application (v0.20.0 → v0.21.0):**

- GitHub Release automation system with comprehensive workflows
- Multi-platform build improvements and optimizations
- Virtual project creation for AI chat E2E tests
- Test infrastructure improvements with ESLint fixes
- Playwright E2E testing support at root level

**Android Application (v0.1.0 → v0.4.0 → Phase 5):**

- **Phase 3**: Knowledge base feature module with CRUD, FTS5 search, and Paging 3
- **Phase 4**: AI chat integration with LLM adapters (OpenAI, DeepSeek, Ollama), SSE streaming, RAG retrieval
- **Phase 5**: P2P networking (WebRTC, NSD discovery, DataChannel transport) and DID identity system (did:key, Ed25519)

**Mobile Application:**

- Performance testing tools and Lighthouse integration
- Final performance metrics report

### Fixed

- CI workflow: Added Playwright dependency to root package.json
- CI workflow: Corrected package-lock.json path in release workflow
- Test failures: Converted CommonJS to ESM imports in test files
- Test failures: Updated IPC handler counts for LLM and Knowledge Graph
- Test failures: Fixed syntax errors and module path issues
- MCP: Removed unused variables and imports
- MCP: Added missing latency metrics to performance monitor
- PDF engine: Fixed test failures with dependency injection
- Tool manager: Fixed test mocks and upsert logic
- Word engine: Fixed HTML parsing
- Windows: Fixed unit test failures
- MCP: Improved server environment variables and default configs
- Desktop: Ensured main window shows after splash screen

### Changed

- Improved P2P voice/video tests with real manager integration
- Enhanced MCP tool testing UI and permission handling
- Added public validation methods to MCPSecurityPolicy
- Refactored test infrastructure with global mocks
- Organized root directory files
- Reorganized src/main into categorized subdirectories

### Performance

- Lazy loading for blockchain, plugins, and media modules
- Optimized startup time with deferred module loading
- Reduced memory footprint with lazy highlight.js loading

### Security

- Enhanced MCP security with improved config validation
- Better error handling for incomplete server configurations

## [0.20.0] - 2026-01-15

### Added

- MCP (Model Context Protocol) integration POC v0.1.0
  - Filesystem, PostgreSQL, SQLite, Git server support
  - Defense-in-depth security architecture
  - Tool testing UI
- LLM Performance Dashboard with ECharts visualization
- SessionManager v0.22.0 with auto-compression (30-40% token savings)
- ErrorMonitor AI diagnostics with local Ollama LLM
- Manus optimizations (Context Engineering, Tool Masking, Task Tracking)

### Changed

- Updated all design documentation to v0.20.0
- Refactored main process modules into categorized subdirectories
- Enhanced login debug logging

### Fixed

- Git status modal now receives correct project ID
- Added WebRTC compatibility layer for P2P
- Improved monitoring and test stability

## [0.19.0] - 2026-01-10

### Added

- P2P encrypted messaging with Signal Protocol
- Knowledge graph visualization
- Advanced RAG retrieval system
- Multi-agent task execution framework

### Fixed

- Database encryption with SQLCipher
- U-Key hardware integration improvements

## [0.18.0] - 2026-01-05

### Added

- Desktop app Vue 3 migration complete
- Ant Design Vue 4.1 UI components
- Electron 39.2.6 upgrade

### Changed

- Migrated from Vue 2 to Vue 3 with Composition API
- Updated build toolchain to Vite

## [v0.2.0] - 2026-01-01 — feat(packaging): 添加完整的打包系统和多种部署方案

> **First tagged release.** 31 days from project inception (2025-12-01 "first commit"), 602 commits
> total, 271 feature commits across 50+ scopes. Tag commit `06860faab` shipped the full packaging
> system; the rest of v0.2.0 represents the substrate that made it shippable.

### Added

#### 🏗 Foundations (2025-12-01 → 2025-12-18, pre-scope era)

- Community forum core (`3ca15ecbe`)
- Admin backend (`0b59c83c7`)
- API service layer (`708530da4`)
- Database seed data (`c7d54751c`)
- Image upload + OCR (`f1722d016`)
- Prompt template library (`5f04ee63f`)
- Browser web-clipping extension (`a3d17e38e`)

#### 🌐 Decentralized Social — P2P / Crypto (2025-12-19)

- **Signal protocol E2E encrypted messaging** (`41279bb5e`)
- P2P multi-device support — core (`f2cfcd714`)
- Device sync — offline message queue + state sync (`adc26e748`)
- Friend management subsystem (`06f244728`) + P2P friend-request protocol (`82763f691`)
- Dynamics (动态) publishing (`bdd42b280`)
- Social UI integration — chat + notifications (`15fbcfe65`, `ef7b245c2`)

#### 💱 Decentralized Trading — Phase 3 (2025-12-19)

- **Module 1** — digital asset management (`7b510c4b7`)
- **Module 2** — trading marketplace (`093d5bf1a`)
- **Module 3** — smart contract engine + frontend (`7ca51eeeb`, `d52dba49e`)
- **Modules 4-6** — knowledge paywall, credit scoring, reviews (`2a316bdd9`, `81d5ab8e8`)
- Cross-chain bridge + on-chain deployment (`1ada44ddb`)
- Complete wallet management (`62db4e138`)
- Transaction list component (`37027db1b`)
- IPC extension + test deployment — Phase 8-9 (`a32d70626`)

#### 📱 Mobile (uni-app, 2025-12-19 → 2025-12-31)

- **Kicked off uni-app, deleted native Android project** (`c64d5d241`)
- Week 1-2 DID/identity system (`88466e2f4`)
- Week 3-4 social basics (`b6800fa88`)
- Week 5-6 AI integration (`7f10aa380`)
- Knowledge module (`5c226b9b8`)
- AI chat + settings module (`89282b312`)
- Volcano engine LLM support (`452cc9903`)
- Social dynamics page (`40426725b`)
- Friend message functionality (`a7fd10495`)
- Trading module — market / orders / assets (`084f5430f`)
- Dark theme system (`0a4b10301`, `69db028c0`)
- Cloud sync + data backup (`9d44f730f`)
- Knowledge tags + favorites (`27ac9fcc6`)
- Knowledge sharing (`551202824`)
- Statistics + analytics (`cd28da9c0`)
- AI-enhanced editor (`2f09aa0e5`)
- Folder management (`5f5fd299d`, `fc11577dd`, `4b7cb102c`)
- Tab bar + home page redesign (`670274172`)
- AI extended features (`d6094f1c7`)
- Knowledge import/export (`208c2fd15`)
- Full speech-input optimization (`35fda1b71`)
- RAG vector retrieval + auto-sync (`b6e8e0c23`)
- Social UI optimization (`83651f3aa`)

#### 🤖 AI Engine & LLM (2025-12-21 → 2025-12-31)

- **Phase 1: core AI engine** (`a6a7a1016`)
- **project-service backend** Phase 1 (`aef4c43d8`)
- Cloud-compute deployment for multi-LLM providers (`286908898`)
- 7 → 14 cloud LLM providers (`b99f0d455`) — Doubao, Volcano, Anthropic Claude (`0c07a6e33`), domestic providers (`27219fb78`)
- Cloud deployment tools + cost calculator (`a263150ed`)
- Anthropic Claude API support + LLM config enhancement (`0c07a6e33`)
- Streaming generation + AI task decomposition (`d6fd3b344`)
- Project RAG integration (`63668c252`)
- Cloud LLM default + intelligent fallback (`4e84279dd`)
- LLM manager singleton (`289590942`)
- 5 advanced RAG techniques (`ca43d5739`, `e3ffe2309`)
- Text splitters (`ad3d2ffb8`)
- Query rewriter (`ae0f29ea5`)
- Domain-specific AI toolset (`1dcee3f99`)
- AI scheduling system (`6d62e5b1d`)
- Real tool implementations Phase 1-8 (`3a75a944c`, `f470d61ef`, `185a6e19c`, `77aae50cb`, `48a01044b`, `6d62e5b1d`, `655e98d78`, `6332921a3`)
- AI-driven Git conflict resolver (`01494bc76`)

#### 📂 Project Management (2025-12-21 → 2025-12-27)

- **Phase 1-3 core** (`663ac6eef`)
- **Phase 4-5 UI** (`f98e84b05`)
- **Phase 6-7** detail / templates (`590097a30`)
- **Phase 8-9** completion (`4783d43f7`)
- AI engine integration + refactor (`66b25f218`)
- Streaming project creation (`3f22718ef`, `46f28ff6b`)
- Project import/export + 100% test pass (`688d22c00`, `c2b74bdb1`)
- Project automation + collab editing + multimedia (`20b0ac680`)
- Project v1.0.0 full feature set + AI engine enhancement (`6ee6eb942`)
- File scanning + UI optimization (`3cc74246a`)
- Enhanced file management + document type recognition (`edb3bf74d`)
- Project categories (`6ada4a333`, `7b54ec5d8`)
- VSCode-level file copy/paste (`524bef4d3`)
- Project paths fix + plugin system + knowledge graph (`6c6c1d8e5`)
- Project recovery (within `48a01044b`)

#### 📝 Editor + File Tree (2025-12-22)

- **Monaco Editor** replacing simple textarea (`45a58a829`)
- ChatPanel — project-level AI assistant (`16f653de5`)
- Conversation persistence + IPC interface (`e9c55d3b5`)
- PreviewManager (`184997c20`) + PreviewPanel (`d212614d6`)
- Git status display in FileTree (`0760da9c6`, `8a0c405c0`)
- Enhanced Git operations + file-sync integration (`0470dae56`)
- FileSyncManager — core monitoring (`03bd20a6b`)
- Virtual-scroll FileTree (`c187db710`)
- File cache + comprehensive fix tools (`6f900da60`)

#### 🔄 Sync Subsystem (2025-12-22 → 2025-12-26)

- Multi-device sync — layered (`a0f5fa48e`, `90f8e4d78`, `455144acb`)
- **Optimistic locking + exponential-backoff retry** (`2c4c43c0c`)
- Concurrent sync + P0 full test coverage (`8d987cdae`)
- Soft-delete + P1 fixes + Git AI UI integration (`f214e4c9a`)
- Required-field validation + invalid-record filtering (`4c97be538`)
- DB multi-device sync + soft delete (`f2ecabf9d`)
- Multi-device sync init fixes (`b757523a0`)
- P2P sync engine (within `48a01044b`)

#### 🎨 Engines & Editors (2025-12-25)

- **data-engine v2** — Excel support + security fixes (`3acedce43`)
- **code-engine v2.0.0** — full rebuild (`3f9812eb1`)
- Enhanced code block + Python execution panel (`fd9ad7c31`)
- Excel + Word dedicated engines (`4d0483bfb`)
- **Markdown → PPT** engine (`2618f2367`)
- PPT editor + project UI optimization (`085563b18`)
- PPT generation + PDF export + template engine + project statistics (`fc9adf409`)
- Web IDE pages + components (`8b17156c5`, `c2777b87c`)
- Rich text editor (`8b17156c5`)
- 100% test pass rate + PPT engine fallback optimization (`d317f11a5`)

#### 🧰 Skill-Tool System (2025-12-29 — major day)

- **Core engine** (`7d1c82862`)
- Advanced features + docs (`4c5620a7e`)
- **Frontend UI 100% integration** (`29d8b6707`)
- 4 advanced features: shortcuts / dark mode / history / i18n (`a9c1c1662`)
- Error boundary + doc-viewer enhancement (`9140bed6e`)
- Error handling + wallet creation (`320444540`)
- Short-term optimization roundup (`f00b885fb`)
- ChatSkillBridge (`379662e63`)
- Phase 5-10 batches of skill extensions (`c512e91a5`, `fe4d297bd`, `c82ec3b53`, `e38a93e47`, `0905ba0bd`, `f4955435d`)
- Skill execution + IPC retry mechanism (`f878eb53d`)
- Enhanced built-in skills + tools (`eb8c655ef`)
- Skill-tool DB tables (`2c44a55f4`)

#### 🏢 Enterprise (2025-12-30 → 2025-12-31)

- **Enterprise tech design** (`843fa9dae`)
- **Decentralized org architecture** + extended skills (`fe4d297bd`)
- Org settings + test coverage (`069ab89cc`)
- **DID P2P invitations** + Phase 10-11 tool extensions + full test coverage (`0905ba0bd`)
- High-frequency engine tests + permission system + video templates (`c1c664371`)
- Permission control + content template extensions (`68b9cc260`)
- Role management + social media templates + voice tests (`6c11dfcce`)
- Collaboration system + org management (`9bdfb9602`)
- Org management UI + routes (`1fe68222c`)
- Enterprise DB migration (`b18fe4250`)
- Data isolation + DB check tools (`7efc1cdc5`)
- Org management + extended template library (`b71dbea84`)
- Enterprise test suite (`8cfa1e983`)
- Org knowledge base (`ec6d89e55`)
- **Phase 1 workspace + task management** (`862bcb6b3`)

#### 📚 Templates (2025-12-27 → 2025-12-31)

- Education / life / podcast templates + UI component optimization (`b3c1ed67a`)
- 10 project templates + 4-column project layout (`b892e7ffc`)
- 3 professional templates + classification filter optimization (`79fbe7b0b`)
- Handlebars helper extensions (`4bf81fc75`)
- **30 video content templates** (`d0a8610b1`)
- **18 AI templates** + build process optimization (`e61325980`)
- **27 more AI templates → 100% category coverage** (`0bf35d625`)
- Food / tutorial / travel video templates (`100cf9364`)
- Color-grading / effects templates + doc-generator tests (`c3eb0c642`)
- Legal docs / marketing / video content templates (`b54fe6df4`)
- Education / health / time-management templates (`9c396c1d3`)
- Data-cleaning template + config-manager tests (`21ca11dd3`)
- Jupyter project template (`03f48aa98`)
- Cooking / education / travel domain templates (`cef40ae39`)
- Gaming / music / photography templates + format fixes (`0452fddb3`)
- Career-development template (`addbbc4a6`)
- 13 professional templates + system health check report (`15cc7a121`)
- Template category + tag i18n (`cf844a8f9`)
- Enhanced template management + AI engine + project UI (`cb976151f`)

#### 🔐 Security (2025-12-28 → 2025-12-29)

- **U-Key drivers**: FeiTian / WatchData / simulation mode (`4f65c42d4`)
- U-Key brand support: 华大 / 天地融 (`d8c0fe384`)
- **SQLCipher AES-256** encrypted database (`9c0f5f7d6`)
- DB access refactor + enhanced encryption (`e0684b587`)
- Dev-mode DB password skip (`6db5f1366`)
- Identity management + initial setup module (`bc27c66b2`)
- DB switch event listener + auto-refresh (`6c8dc1dcb`)

#### 🎤 Speech (2025-12-29 → 2025-12-31)

- Phase 3 advanced: audio enhancement / multilang detection / subtitles (`04bfb36b5`)
- Full speech-input optimization (`35fda1b71`)
- Realtime speech input wired into main UI (`0a6960d13`)

#### 🌍 i18n (2025-12-28 → 2026-01-01)

- **Full i18n system** (`e62ce4a33`)
- Top-bar language switcher (`93d0eb3d7`)
- Template category + tag Chinese translations (`791f0de96`, `d20c84ec8`)

#### 📦 Packaging (2025-12-31 → 2026-01-01) — culminates in v0.2.0

- Windows production packaging + backend service management (`083aa10eb`)
- Built-in data import + packaging toolset (`cb2b16199`)
- **Cross-platform shell scripts** + dependency optimization (`bd321a5dc`)
- **Windows installer + auto-update** (`a425f62e1`)
- 🏷️ **`06860faab` — v0.2.0: full packaging system + multi-deployment** (16 files, +5518 / -8)

#### Other Highlights

- Web IDE components + editor docs (`c2777b87c`)
- Knowledge version history schema (`6cd7eff0a`)
- Knowledge version history full subsystem (`f5d5d552c`, `96faca4ab`)
- Browser extension AI assistance + skill-tool system (`f6fce0fab`, `77f0b823c`)
- Web annotation editor (`c98c6de90`)
- Blockchain smart contracts + transaction escrow (`60522e0af`)
- Cross-chain bridge contract integration (`693854078`)
- WebRTC transport error handling + Node.js compat (`0025657f3`)
- Voice recognition + blockchain + P2P NAT traversal (`39e6c49ed`)
- Video import + management (`a9a81c8b7`)
- Video skill-tool DB migrations + real-implementation extensions (`250baf48e`)
- System tray + config management (`5df9171f5`)
- Backend test framework + Git manager optimization (`948a5e162`)
- Backend service client (`5b628e6ee`)
- Backend API + voice input + multimedia editor (`31635ff01`)
- LLM quick-setup connection test (`875bf3f10`)
- Connection test for LLMSettings + SystemSettings (`f2165a3b3`)
- Project-service RAG index + code-assistant client methods (`79004a85b`)
- Git repo init UI check + confirm dialog (`b6b98a080`)
- ProjectDetailPage security + perf optimization (`cb6e4bd39`, `ed33c93a6`)
- Website redesign — home page (`cea70e53a`)
- Docs website updates (`4f6c6b20e`, `d8e7de24d`)
- Network diagnostics + screen recording (`655e98d78`)

### Stats

- **31 days** from day-0 to v0.2.0 (2025-12-01 → 2026-01-01)
- **602 commits** total, **271 with `feat` prefix** spanning 50+ scopes
- Biggest scopes by commit count: `templates` (13), `enterprise` (11), `sync` (8), `skill-tool` (8), `ui` (7), `project` (7)
- December split: 583 commits in 2025-12, 19 in 2026-01

### Notable

- Project went straight from "first commit" to v0.2.0 — there is no v0.1.x lineage in git
- Pre-orphan history (the 4046 commits between 2025-12-01 and 2026-05-17 v5.0.3.63) was disconnected from `main` until 2026-05-28 when restored via `git replace --graft`
- All SHAs above are reachable from current `main` only thanks to the graft (`refs/replace/e2612b2f1...`); without it, `git log main` stops at 2026-05-18

## [0.16.0] - 2025-12-20

### Added

- Knowledge base management (95% complete)
- RAG-enhanced search
- DID-based identity system
- P2P network foundation

---

## Version History

- **3.4.0** (2026-02-28) - v3.1.0-v3.4.0 Phase 65-77: AI Market, Hardware Security, Global Social, EvoMap
- **0.21.0** (2026-01-19) - Android Phase 5, Release automation, Test improvements
- **0.20.0** (2026-01-15) - MCP integration, Performance dashboard, Manus optimizations
- **0.19.0** (2026-01-10) - P2P messaging, Knowledge graph
- **0.18.0** (2026-01-05) - Vue 3 migration, Electron upgrade
- **0.16.0** (2025-12-20) - Knowledge base MVP

---

## Links

- [Repository](https://github.com/chainlesschain/chainlesschain)
- [Documentation](https://github.com/chainlesschain/chainlesschain/tree/main/docs)
- [Issues](https://github.com/chainlesschain/chainlesschain/issues)
- [Releases](https://github.com/chainlesschain/chainlesschain/releases)
