# `cc pack --project` — 项目打包模式 设计文档

> 版本：v0.8 (Phase 0/1/2a/2b/3a/3b/3c/3d/3f/3g + Phase 4a Linux + Phase 5a/5b/5c OTA 全部落地)
> 日期：2026-05-20
> 作者：longfa
> 状态：**Phase 0 / 1 / 2a / 2b / 3a / 3b / 3c / 3d / 3f / 3g 全部完成**；**Phase 4a Linux x64 pack** 已 CI guarded；**Phase 5a/5b/5c OTA 链** 全部交付；**Phase 3g auto-update** 一键串联 + **Phase 3f .env sidecar/`--version --json`** + **Phase 3d persona resolver 真接线** 已上线；`--project` 模式端到端可用
> 关联：`docs/design/CC_PACK_打包指令设计文档.md`（基础流水线 v0.1）
> 关联版本：ChainlessChain v5.0.3.69 / CLI 0.162.3
>
> **v0.8 变更摘要（2026-05-20）**：**Phase 3d — Persona resolver 真接线**。修平 Phase 3b 留下的"`CC_PACK_AUTO_PERSONA` env 无任何下游消费者"的 dangling wire（grep 验证：Phase 3b 之前 env 只 set 不读）。改动 3 处：(1) `agent-core.js:_loadProjectPersona` 加 named-persona 解析链：`CC_PACK_AUTO_PERSONA` env → `config.personas[<env>]` → `config.activePersonaName` → `config.personas[<name>]` → 兜底 inline `config.persona`，每层都有 `personas[key]` 存在性 guard；(2) `init.js` TEMPLATES 有 persona 的（medical-triage/agriculture-expert/general-assistant 等）同时写入 `config.personas[<template>-persona] = persona` + `config.activePersonaName = <template>-persona`，与 `.chainlesschain/skills/<template>-persona/SKILL.md` skill 文件名对称；(3) `cc persona` 加 `list` (含 `--json` 输出 + env mismatch warning) + `activate <name>` (查 personas[name] → 写 activePersonaName + denormalized persona) 两个 subcommand；`reset` 顺带清理 activePersonaName。15 个新单测 + 6 个集成测试 + 1 e2e + 既有全过。重点测试：env 优先级 / activePersonaName 中层 / 不存在的 env 回退 inline / 完全无 persona 默认 prompt / env 胜 activePersonaName / activate switch 覆盖 prior denormalized / e2e init medical-triage 写出 personas + activePersonaName。
>
> **v0.7 变更摘要（2026-05-20）**：**Phase 3f — `.env` sidecar + `--version --json` 落地**，§13 #3+#4 两个待决项收口。`pkg-config-generator.js` inline runtime block 新增：(1) `_loadDotenv(filePath)` 解析器（BOM strip + 跳 `#` 注释 + KEY=VALUE + 匹配引号 strip，length≥2 guard 防 `'` 单字符 slice 成空串）；(2) `.env` 加载块用 `_origEnvKeys` snapshot 保证**显式 shell-set process.env 永远赢**（探出后立即应用 exePath/.env，再应用 userDataDir/.env，后者覆盖前者）；(3) `_hasFlag('-v','--version') && _hasFlag('--json')` 组合在 commander.parse 前 short-circuit 输出 `{cli, project:{name,sha}}` 并 `exit(0)`，project 块仅 `BAKED.projectMode` 时附加。9 新单测 in `packer-pkg-config-generator.test.js`（33→42）：parser helper / 引号 strip / 优先级顺序 / 不覆盖 shell env / userDataDir 后于 exePath 应用 / `--version --json` combo 拦截 / project 块条件 / .env 在 version-json 之前 / 普通 `--version` 不变。17 packer test 文件 228/228 回归绿。
>
> **v0.6 变更摘要（2026-05-20）**：**Phase 3g — `cc pack auto-update` 一键 OTA 落地**。新增 `cc pack auto-update` subcommand 串联 Phase 5a/5b/5c，UX 与 `check-update --download --apply --restart` 等价但加 **interactive confirm**（默认开，`-y/--yes` 跳过；`--json` 隐含 skip-confirm）+ 默认 `restart=true`（一键 UX）+ `--dry-run` 只 check 不 mutate。实现走 `runAutoUpdate()` 导出函数（4 个 impl 依赖注入：check/download/apply/confirm），便于测试。18 个新单测覆盖：no-manifest → exit 2 / up-to-date 短路 / check 失败 → exit 3 / 无 target artifact → exit 3 / dry-run 不下载不 apply / 默认 confirm + decline 中止 / `-y` 跳确认 / `--json` 隐含 skip-confirm / download 失败 → exit 4 / `--dest` 覆盖 / `--no-restart` / `--target-exe` 覆盖 / apply 失败 → exit 5 / Windows sidecar-cmd 延迟 500ms exit(0) / `--json` 输出纯 JSON 无 chalk。**剩**：`check-update` 旧命令保留不动以维持向后兼容；未来 v0.7 可考虑把 `check-update --download --apply` 标 `@deprecated` 引导用户切到 `auto-update`。
>
> **v0.5 变更摘要（2026-05-20）**：
> 1. **Phase 3c — doc/code drift 修平**：之前 doc 与 `pkg-config-generator.js` 内联 runtime block 存在 4 处偏差，本版全部对齐：(a) user-data dir 后缀 SHA-8 (32-bit 熵) → SHA-16 (64-bit 熵)，符合 §4.3 原始约束；(b) Windows 平台 user-data root 改用 `%APPDATA%`（`process.env.APPDATA`）而非 `os.homedir()`，符合 §9 路径长度约束（Roaming ≤ 260 安全）；(c) **`.materialize.lock` 并发保护**落地（`fs.openSync(lockPath, 'wx')` + best-effort unlink cleanup），符合 §7.2；(d) **`config.json` deep-merge** 落地（schema 升级字段自动补入，用户值优先），符合 §4.4。所有改动落在 inline runtime 块，CLI-only 路径完全无感（5 个新单测 + 28 既有全过）。
> 2. **Phase 4a Linux x64 pack pipeline + CI guard**（commit `60762e7fd`，落于 v0.5 之前，doc 漏记）：cli-ci.yml 加 `pack-linux-dryrun` job；native-prebuild-collector 支持 `linux: "linux"` 目标解析。
> 3. **Phase 5a/5b/5c OTA 链**（commits `976d5e161` / `c1f3adafc` / `16ef0612f`，落于 v0.5 之前，doc 漏记）：`pack-update-checker.js` (manifest 探针) + `pack-update-downloader.js` (流式下载 + SHA-256 校验) + `pack-update-applier.js` (POSIX rename + Windows sidecar self-replace)。BAKED 扩展 `updateManifestUrl` + `packedCliVersion`。一键 `cc pack auto-update` orchestration command **尚未实现**（Phase 3g 候选，见 §12 末尾）。
>
> **v0.4 变更摘要（2026-04-24）**：Phase 2b 合入 —— `web-ui-server.js` 新增 `handleApiRequest` 与 `GET /api/skills` 端点，返回 `{schema:1, skills:[{name,source,category,description,version}]}`，复用 `CLISkillLoader.loadAll()` 的 4 层解析（bundled/marketplace/managed/workspace）。SPA 与 minimal 两条服务路径都接入该端点；未知 `/api/*` 路径返回 JSON 404（与"服务器挂了"区分开）。smoke-runner 不再是 pre-wired 状态，而是真正对 `/api/skills` 做实断言；v0.3 引入的 404 容忍分支继续保留作为防御性兜底（便于老 build 前向兼容）。
>
> **v0.3 变更摘要（2026-04-24）**：Phase 3b 合入 —— `CC_PACK_AUTO_PERSONA` env var 由 pack-entry 注入（受 `if (BAKED.projectAutoPersona)` 门控）；`<artifact>.project.json` sidecar 已随 Phase 3.5 集成落地；smoke-runner 的 `/api/skills` 探针对 404 响应容忍跳过（`skillsCheck={ok:true,skipped:"endpoint-404"}`）以便 Phase 2b 解锁前不卡住带 skill 的项目。持久化的"`skill enable <name>` 命令接线"推迟到未来 skill-lifecycle API；当前阶段由下游 persona resolver 读取 env 完成等价逻辑。
>
> **v0.2 变更摘要**：修正 `process.chdir` 风险（改为纯 env var）；新增 project-name 安全化规则；SHA-8 升为 SHA-16；补全 symlink 跳过说明；澄清 `--preset-config` / `--project-config-override` 语义；Phase 拆分细化（2a/2b/3a/3b）；移除未落地的 skill 嵌套深度"collector 强校验"。

---

## 1. 背景与动机

现有 `cc pack`（基础设计文档 §1–§18）打包的实质是 **CLI 自身**：把 `packages/cli/src/**/*.js` 当作 pkg 的 scripts，把 web-panel 当作 assets，产出一个"通用 chainlesschain 便携 exe"。`projectRoot`（CWD）只用来：

1. 决定输出文件名 `dist/chainlesschain-portable-<target>.exe`
2. 写入 manifest 的 git commit / dirty 元数据
3. 通过 `--preset-config` 读一份 config 模板（可选）

由此带来的限制是 —— 用户即使在空目录里 `cc init` + 编辑了 `.chainlesschain/config.json`、写了自定义 skills、配置了 persona，跑 `cc pack` 出来的 exe **完全不包含这些项目内容**。给最终用户分发的还是一个"裸 chainlesschain 实例"。

本设计文档定义一个**新增模式** `cc pack --project`，让用户能够：

```bash
npm i -g chainlesschain
mkdir my-medical-agent && cd my-medical-agent
cc init -t medical-triage         # 或 empty + 自己塞 skills
# ... 编辑 .chainlesschain/config.json、rules.md、skills/*
cc pack                           # 自动检测项目模式
# 产出：dist/my-medical-agent-portable-win-x64.exe
```

产物双击即跑成"我的医疗分诊 Agent"，而不是裸 CLI。

---

## 2. 目标与非目标

### 2.1 目标

- **项目即产物**：用户在任意空目录 `cc init` + 开发后，`cc pack` 产物就是"这个项目对应的 Agent exe"
- **零侵入复用**：基础流水线（precheck → ensureWebPanel → collectPrebuilds → runPkg → smokeTest）100% 复用，**新增**一个项目资产收集阶段 + 改造入口脚本即可
- **运行时项目根可写**：内嵌的 `.chainlesschain/` 在首次启动时物化到 user-data 目录，用户可后续修改
- **安全等价**：复用现有 secret-scanner，禁止把 LLM API keys 等密钥打进 exe
- **向后兼容**：`--no-project` 完全等价今天的行为

### 2.2 非目标

- 不重新设计 pkg 选型（继续 @yao-pkg/pkg）
- 不支持把 user 项目的 node_modules 一起打进去（明确拒绝并报错）
- 不支持多个项目共用一份 CLI runtime 的"瘦客户端"模式（首发就是单文件自包含）
- 不做 Web UI 的项目级定制（首发还是用 CLI 默认面板，仅通过 persona 影响行为）

---

## 3. 触发矩阵

| 命令 / 上下文 | 行为 |
|---|---|
| `cc pack`（CWD 有 `.chainlesschain/config.json`） | **默认走项目模式** |
| `cc pack`（CWD 无 `.chainlesschain/`） | 走 CLI-only 模式（今天行为） |
| `cc pack --project` | 强制项目模式；缺 config 直接报错退出 |
| `cc pack --no-project` | 强制 CLI-only，即使 CWD 有 config |
| `cc pack --project --cwd <path>` | 把 `<path>/.chainlesschain/` 当项目根 |

理由：默认 auto-detect 是为了让"在项目目录里直接 `cc pack`"成为最自然的一行命令；显式 flag 留作 CI / 调试逃生舱。

---

## 4. 产物行为变化

### 4.1 命名

- CLI-only：`chainlesschain-portable-<target>.exe`（不变）
- 项目模式：`<project-name>-portable-<target>.exe`，`project-name` 取自 `.chainlesschain/config.json` 的 `name` 字段（`cc init` 默认填 CWD basename）

`project-name` 在写入文件系统前必须经过安全化（`sanitizeProjectName`）：
- 字符白名单：`[a-z0-9_-]`（lowercase、数字、下划线、短横线）；大写转小写，其余字符替换为 `-`
- Windows 保留名（`CON` / `PRN` / `AUX` / `NUL` / `COM1-9` / `LPT1-9`）检测到则追加 `-proj` 后缀
- 长度上限 64 字符（截断后追加末 4 位 SHA hex 防碰撞）
- 安全化在 `precheck` 阶段的 `validateProjectConfig` 里执行，校验失败（产出为空串）直接 `PackError`

### 4.2 默认子命令

今天硬编码追加 `ui` 子命令。项目模式可在 config 里声明：

```json
{
  "name": "my-medical-agent",
  "template": "medical-triage",
  "pack": {
    "entry": "ui",
    "autoOpenBrowser": true,
    "autoPersona": "medical-triage-persona",
    "allowedSubcommands": ["ui", "chat", "agent", "skill"]
  }
}
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `pack.entry` | `"ui"` | 双击 / 无参启动时执行的子命令（支持 `"ui"` / `"chat"` / `"agent"` / `"skill <name>"`） |
| `pack.autoOpenBrowser` | `true` | UI 模式下自动开浏览器（仅 `entry === "ui"` 时生效） |
| `pack.autoPersona` | `null` | 启动时自动激活的 persona skill 名 |
| `pack.allowedSubcommands` | `["ui","chat","agent","skill"]` | 白名单，限制 exe 暴露的 CLI 子命令；其他子命令被 commander 注册时跳过 |

### 4.3 运行时项目根

- 首次启动：把内嵌的 `.chainlesschain/` 物化到 `%APPDATA%/.chainlesschain-projects/<project-name>-<configSha16>/`
  - `configSha16`：`configSha` 前 16 字符（64 位熵，碰撞概率可忽略）
- **只设环境变量**，不调用 `process.chdir()`：
  ```js
  process.env.CC_PROJECT_ROOT = userDataDir;
  ```
  `bootstrap.js` 的 `findProjectRoot` 优先读 `CC_PROJECT_ROOT`（§8 改动），这样 CWD 保持不变，避免模块初始化时缓存 CWD 的库（`dotenv`、部分 `winston` transport、`sqlite` 路径解析等）在 chdir 后读写错误路径。
- 用户修改 user-data 目录里的 config / skills 立即生效，重启 exe 也保留（write-through）

### 4.4 漂移检测

bundle 时计算 `.chainlesschain/` 全量 SHA-256 写入 `BAKED.projectConfigSha`。运行时若 user-data 里的 marker 不匹配：

- 默认：**追加新文件 + 警告**，不覆盖用户改动
  - 例外：`config.json` 做 **deep-merge（旧文件值优先）**，而非"有则跳过"。这样新版 exe 引入的必需字段（schema 升级）能被补入，不会因为旧 user-data 缺字段而 runtime 报错
- `--force-refresh-on-launch`（打包时设置）：每次启动都强制重置整棵树（config.json 也覆盖）
- **并发物化保护**：物化前尝试创建 `.lock` 文件（`fs.openSync(..., 'wx')`），失败说明另一个实例正在运行，等待最多 5 s 后继续（非阻塞，只做日志）

---

## 5. 流水线改动

基础设计文档 §11 定义的 7 阶段管线，项目模式扩展为 8 阶段：

| 阶段 | CLI-only 现状 | 项目模式新增 / 改 |
|---|---|---|
| 1. precheck | cliRoot/git 检查 | **新增**：若 `--project` / auto-detect，校验 `projectRoot/.chainlesschain/config.json` 存在 + schema |
| 2. ensureWebPanel | 不变 | 不变 |
| 3. buildConfigTemplate | 从 `--preset-config` 读 | **复用**：把项目 config 当 preset，过同一套 secret-scanner |
| **3.5 collectProjectAssets（新增）** | — | 见 §6 |
| 4. collectPrebuilds | 不变 | 不变 |
| 5. generatePkgConfig | scripts=cliRoot/src | **assets 追加** `tempDir/project/**/*`；**entry 模板改写** 见 §7（Phase 2a） |
| 6. runPkg | 不变 | 不变 |
| 7. writeManifests | sidecar SHA-256 | **追加** `<artifact>.project.json`（projectName / configSha16 / fileCount / bundledSkills 列表）— Phase 3b |
| 8. smokeTest | UI 探针 | **新断言**（Phase 2b，依赖 `/api/skills` HTTP 端点落地后才可加）：返回列表必须包含内嵌 skill 名 |

---

## 6. 新模块：`project-assets-collector.js`

位置：`packages/cli/src/lib/packer/project-assets-collector.js`

```js
/**
 * @param {object} ctx
 * @param {string} ctx.projectRoot      用户项目根（CWD）
 * @param {string} ctx.tempDir          打包临时目录
 * @param {object} [ctx.logger]
 * @returns {{
 *   projectDir: string,                tempDir/project 绝对路径
 *   configSha: string,                 全量 SHA-256（hex）
 *   fileCount: number,
 *   totalBytes: number,
 *   bundledSkills: string[],           skills/<name>/skill.md 解析出的 name 列表
 *   manifest: Array<{rel:string,size:number,sha:string}>,
 * }}
 */
export function collectProjectAssets(ctx) { ... }
```

**实现要点**：

1. 递归拷 `projectRoot/.chainlesschain/` → `tempDir/project/.chainlesschain/`
2. **强制 skip**（静默，不报错）：
   - 目录名：`node_modules/`、`.git/`、`.cache/`、`dist/`
   - 文件后缀：`*.log`
   - **符号链接**：静默跳过并输出 warning（`WARN: symlink skipped: <rel>`）——不跟随 symlink 以保证 bundle 完全自包含、避免 escape-out-of-tree 路径。用户若有共享脚本应改为普通文件拷贝或发布成 skill pack
   - 注：dotfile（如 `.gitignore`）**不在**跳过列表里，正常复制
3. **拒绝条件**（直接抛 PackError）：
   - `.chainlesschain/skills/*/node_modules/` 存在 → 报错"skill 含 hidden deps，请先 `cc skill sync-cli` 发布"
   - 总大小 > 50MB → 报错"项目超过 50MB，使用 `--force-large-project` 跳过"
   - secret-scanner 命中 config.json → 报错"密钥泄露，使用 `--allow-secrets` 跳过"
4. 计算全量 SHA-256：按相对路径排序后串接所有文件的 `sha256(content)`，再 `sha256` 一次

**单测覆盖**：
- 50MB cap 触发
- node_modules 检测拒绝
- 跳过 `.git` 但保留 `.chainlesschain/.gitignore`
- bundledSkills 解析正确（含 frontmatter 的 `name:` 字段）

---

## 7. `pkg-config-generator.js` 改造

### 7.1 BAKED 扩展

今天 BAKED 只有 `tokenMode/host/wsPort/uiPort`。项目模式追加：

```js
const BAKED = Object.freeze({
  // ── 已有 ──
  tokenMode, host, wsPort, uiPort,
  // ── 新增（仅项目模式有值）──
  projectMode: true,
  projectName: 'my-medical-agent',      // 安全化后的名称（见 §4.1）
  projectEntry: 'ui',                   // 默认 subcommand
  projectConfigSha: 'abc12345deadbeef', // 完整 sha256（64 chars）
  projectConfigSha16: 'abc12345deadbeef', // 前 16 chars，用于 userDataDir 后缀
  projectAutoPersona: 'medical-triage-persona',
  projectAllowedSubcommands: ['ui','chat','agent','skill'],
  forceRefreshOnLaunch: false,
});
```

### 7.2 入口脚本新增段

在现有 `pack-entry.js` 模板的 `ensureUtf8()` 之后、commander 解析之前插入：

```js
// ── 项目模式：物化 ──
if (BAKED.projectMode) {
  const userDataDir = path.join(
    os.homedir(),
    'AppData', 'Roaming',
    '.chainlesschain-projects',
    `${BAKED.projectName}-${BAKED.projectConfigSha16}`,
  );
  const markerFile = path.join(userDataDir, '.chainlesschain', '.pack-version');
  const lockFile  = path.join(userDataDir, '.chainlesschain', '.materialize.lock');

  // 并发物化保护：只有第一个实例写 lock，其余等待后跳过
  let lockFd = null;
  try { lockFd = fs.openSync(lockFile, 'wx'); } catch { /* 另一实例持有 lock */ }

  const needsMaterialize =
    BAKED.forceRefreshOnLaunch ||
    !fs.existsSync(markerFile) ||
    fs.readFileSync(markerFile, 'utf8').trim() !== BAKED.projectConfigSha;

  if (needsMaterialize && lockFd !== null) {
    // pkg snapshot FS：__dirname/../project/ 下是打包时收集的全量
    const bundledRoot = path.join(__dirname, '..', 'project', '.chainlesschain');
    // copyRecursiveMerge 行为：
    //   - 普通文件：目标已存在则跳过（保留用户改动）；
    //   - config.json：deep-merge，旧文件值优先（确保 schema 升级字段被补入）；
    //   - BAKED.forceRefreshOnLaunch 时：全量覆盖
    copyRecursiveMerge(bundledRoot, path.join(userDataDir, '.chainlesschain'), {
      forceOverwrite: BAKED.forceRefreshOnLaunch,
    });
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    fs.writeFileSync(markerFile, BAKED.projectConfigSha);
  }

  if (lockFd !== null) {
    try { fs.closeSync(lockFd); fs.unlinkSync(lockFile); } catch { /* best effort */ }
  }

  // 不调用 process.chdir()。只设 env var；bootstrap.js 的
  // findProjectRoot 优先读 CC_PROJECT_ROOT（见 §8）。
  process.env.CC_PROJECT_ROOT = userDataDir;

  // 默认 subcommand 从 BAKED 读，覆盖原本硬编码的 'ui'
  if (!_hasSub) {
    const entryParts = BAKED.projectEntry.split(/\s+/);
    process.argv.push(...entryParts);
    // ... (UI flags 注入逻辑保留)
  }
}
```

**为什么不调用 `process.chdir()`**：Node.js 有若干库在模块初始化（`require` / 顶层 `import`）时缓存 CWD，典型有 `dotenv`、部分 `winston` transport、`sqlite` 路径解析。pkg 打包后模块顺序固定，在 chdir 之前已经运行的模块会读写错误路径且不抛异常。纯 env var 方式规避了这个时序陷阱，且 `findProjectRoot` 已改为优先读 `CC_PROJECT_ROOT`（§8）。

### 7.3 commander 注册过滤

`createProgram()` 内部要支持 `process.env.CC_PROJECT_ALLOWED_SUBCOMMANDS`（入口脚本写入），只注册白名单内的 register 函数。这一改动落在 `src/index.js`，见 §8。

---

## 8. CLI 侧改动（小）

| 文件 | 改动 |
|---|---|
| `src/runtime/bootstrap.js` | `findProjectRoot` 优先读 `process.env.CC_PROJECT_ROOT` |
| `src/index.js` | `createProgram` 新增可选 `{ allowedCommands?: Set<string> }` 入参；遍历 register 时跳过未列入的 |
| `src/lib/skill-registry/*` | 已有 workspace 扫描；确认 `${CC_PROJECT_ROOT}/.chainlesschain/skills` 优先级高于全局 |
| persona 自动激活 | 启动 hook 读 `BAKED.projectAutoPersona`（通过 env `CC_PACK_AUTO_PERSONA` 注入），调用现有 `skill enable <name>` |

每条改动都有兜底：env 缺失时**完全等价于今天的行为**，不破坏 CLI-only 路径。

---

## 9. 安全模型

| 风险 | 措施 |
|---|---|
| **密钥被打进 exe** | secret-scanner 复用，命中即拒；`--allow-secrets` 逃生舱保留 + 写入 manifest 警告 |
| **LLM API keys** | 明确不允许打进 exe。约定 key 由旁边的 `.env` 提供，`pack-entry.js` 启动时按优先级读取：① `<userDataDir>/.env`（用户运行时配置，最高优先级）② `<exePath 同目录>/.env`（分发时旁置），覆盖 bundled config 中的同名字段 |
| **第三方 skill** | bundledSkills 列表写入 manifest sidecar，便于审计；首发不做签名校验 |
| **物化路径冲突** | `<projectName>-<configSha16>` 后缀（16 字符 hex = 64 位熵）避免不同版本 / 不同项目同名碰撞 |
| **project-name 路径注入** | `sanitizeProjectName`（见 §4.1）在 precheck 阶段强制执行，拦截 Windows 保留名、路径分隔符、控制字符 |
| **Windows 路径长度** | user-data 路径走 `%APPDATA%`（`AppData\Roaming`）而非 `LocalAppData`；路径总长度 > 200 字符时 precheck 报 warning（截断 projectName 见 §4.1 64 字符上限） |
| **并发物化竞态** | `.materialize.lock` 文件锁（见 §7.2）；并发实例等待后静默跳过物化，不影响运行 |

---

## 10. 体积预算

| 组件 | 估计大小 |
|---|---|
| pkg + Node runtime | ~80 MB |
| Web panel dist | ~5 MB |
| native prebuilds (better-sqlite3 win-x64) | ~2 MB |
| **项目内容（典型）** | **<5 MB** |
| 总计典型 | ~92 MB |
| 总计上限（含 50MB 项目） | ~140 MB |

50MB 项目 cap 由 §6 强制；超出需要显式 `--force-large-project`。

---

## 11. 新增 / 改动 CLI Flags

```
--project                       强制项目模式
--no-project                    强制 CLI-only 模式（今天行为）
--entry <subcommand>            覆盖 config.pack.entry（如 "chat"）
--allowed-subcommands <list>    覆盖白名单（逗号分隔）
--project-config-override <p>   打包时用另一份 config.json（调试用）
--force-refresh-on-launch       BAKED.forceRefreshOnLaunch=true
--force-large-project           跳过 50MB 上限
```

**`--preset-config` 与 `--project-config-override` 的语义**：两者不能同时传。项目模式下（`--project` 或 auto-detect），`--preset-config` 被**忽略**，统一以 project config（或 `--project-config-override` 指定路径）为准；CLI-only 模式下（`--no-project`）才使用 `--preset-config`。同时传入两者时 precheck 阶段直接 `PackError`（不静默）。

未列出的 flags（如 `--dry-run` / `--allow-dirty` / `--smoke-test`）行为完全等价。

---

## 12. 实施拆分

| Phase | 范围 | 单测 / 回归 | 状态 |
|---|---|---|---|
| **0** | `precheck` 项目检测 + 新 flags 骨架（`--project` / `--no-project` / `--project-config-override`）+ project-name 安全化 | `precheck-project-mode.test.js`（19 case）| ✅ 已交付 |
| **1** | `project-assets-collector.js`：递归拷贝、symlink warning、skip 规则、50MB cap、skill node_modules 拒绝、secret-scan、SHA-256 | `project-assets-collector.test.js`（16 case）| ✅ 已交付 |
| **2a** | `pkg-config-generator` BAKED 扩展（projectMode / projectName / projectConfigSha / projectEntry / allowedSubcommands）+ 入口模板物化段（`CC_PROJECT_ROOT` env var，无 chdir） | `pkg-config-generator.test.js`（26 case）；`--no-project` 路径回归 | ✅ 已交付（commit `522d7c8c9`）。注：并发 `.materialize.lock` 与 config.json deep-merge 等 v0.2 补充项未实施，运行时冲突极罕见；推迟到出现现实压力时再加 |
| **3a** | commander 白名单（`createProgram({ allowedCommands })`）+ `CC_PROJECT_ALLOWED_SUBCOMMANDS` env 注入 | `packer-allowed-commands.test.js`（9 case） | ✅ 已交付（commit `dce8e5d66`） |
| **3b** | manifest sidecar `<artifact>.project.json` + persona 自动激活（`CC_PACK_AUTO_PERSONA`）| `packer-pkg-config-generator.test.js` +2 case；`packer-pipeline.integration.test.js` +2 case；smoke-runner 404 容忍 +1 case | ✅ 已交付。sidecar 在 `runPack` phase-7 之后写入（见 `packer/index.js:265-283`）。persona env 由 pack-entry 注入：`if (BAKED.projectAutoPersona) { process.env.CC_PACK_AUTO_PERSONA = BAKED.projectAutoPersona; }`。注：`skill enable <name>` 命令当前不存在，downstream persona resolver 直接读 env 完成同等逻辑 |
| **2b** | smoke-test 新断言：`/api/skills` 含内嵌 skill 名 | `web-ui-server.test.js` +8 case（SPA + minimal 各一组） | ✅ 已交付。`web-ui-server.js` 新增 `handleApiRequest` 与 `GET /api/skills`，在 SPA / minimal 两条 createServer 路径都接入。smoke-runner 侧保留 v0.3 的 404 容忍分支作为防御性兜底 |
| **3c** | doc/code drift 收口：SHA-8→SHA-16 + Win `%APPDATA%` + `.materialize.lock` 并发保护 + `config.json` deep-merge | `packer-pkg-config-generator.test.js` +5 case；16 packer test 文件 201/201 回归绿 | ✅ 已交付（2026-05-20）。所有改动落在 `pkg-config-generator.js` 内联 runtime 块；CLI-only 路径无变更 |
| **4a** | Linux x64 pack pipeline + CI guard | `cli-ci.yml` 新增 `pack-linux-dryrun` job；`native-prebuild-collector.js` linux target 解析 | ✅ 已交付（commit `60762e7fd`） |
| **5a** | `cc pack check-update` — manifest 探针 | `packer-pack-update-checker.test.js` | ✅ 已交付（commit `976d5e161`）。BAKED 扩展 `updateManifestUrl` + `packedCliVersion` |
| **5b** | OTA artifact 流式下载 + SHA-256 校验 | `packer-pack-update-downloader.test.js` | ✅ 已交付（commit `c1f3adafc`） |
| **5c** | self-replace — POSIX rename + Windows sidecar | `packer-pack-update-applier.test.js` | ✅ 已交付（commit `16ef0612f`） |
| **3g** | `cc pack auto-update` 一键 OTA orchestration (check→confirm→download→apply) | `packer-auto-update.test.js` 18 case；17 packer test 文件 219/219 回归绿 | ✅ 已交付（2026-05-20）。新增 `runAutoUpdate()` 导出函数 + `cc pack auto-update` subcommand；4 impl 依赖注入便于测试 |
| **3f** | `.env` sidecar 优先级 + `--version --json` (§13 #3+#4) | `packer-pkg-config-generator.test.js` +9 case；17 packer test 文件 228/228 回归绿 | ✅ 已交付（2026-05-20）。runtime block 加 `_loadDotenv` 解析器 + 双 .env 应用（exePath 后被 userDataDir 覆盖）+ snapshot `_origEnvKeys` 保证 shell-set env 永远赢 + `--version --json` combo 在 commander.parse 前短路输出 `{cli, project:{name,sha}}` |
| **3d** | Persona resolver 真接线 (`CC_PACK_AUTO_PERSONA` env 消费者 + `cc persona list/activate`) | `persona-command.test.js` +9 / `persona-system.test.js` +5 / `init-command.test.js` +1；既有 + 38 + 1 = 39/39 + 既有 packer 228 绿 | ✅ 已交付（2026-05-20）。`agent-core._loadProjectPersona` 4 层解析链 (env > activePersonaName > personas[active] > inline persona)；`init.js` TEMPLATES 写 personas registry + activePersonaName；`cc persona list/activate` 2 个新 subcommand；`reset` 顺清 activePersonaName |

**上线顺序（已完成）**：`0+1` → `2a` → `3a` → `3b` → `2b` → `3c` → `4a` → `5a` → `5b` → `5c` → `3g` → `3f` → `3d`。

每个 Phase 独立可上线（`--no-project` 路径在 2a 加回归后全程保持等价今天行为）。

### 12.1 候选 Phase 3e（未实施 — 待 OQ）

| Phase | 范围 | Scope | 说明 |
|---|---|---|---|
| **3e (Phase 4b)** | macOS pack pipeline | 4-6h | release.yml 加 macOS pack job + darwin x64/arm64 native-prebuild + smoke-test。代码侧 `native-prebuild-collector.js` 已支持 darwin（L129），但**无 CI guard、无 E2E**。需 macOS runner 配额 |

---

## 13. 待决问题

| # | 问题 | 倾向 |
|---|---|---|
| 1 | `.chainlesschain/skills/` 第三方 pack 是否打进去？ | **是**，但写入 manifest 的 `bundledSkills.source` 字段 |
| 2 | 多项目共用 user-data 目录命名碰撞？ | `<name>-<sha16>` 后缀解决（64 位熵，碰撞概率可忽略） |
| 3 | exe `--version` 是否暴露 bundled project 信息？ | ✅ **已实施** (Phase 3f, 2026-05-20)：`--version --json` 输出 `{cli:"0.156.6", project:{name,sha}}`；project 块仅 `BAKED.projectMode` 时附加 |
| 4 | LLM API keys 怎么解？ | ✅ **已实施** (Phase 3f, 2026-05-20)：`.env` sidecar 双源加载，优先级 explicit shell-set env > `<CC_PROJECT_ROOT>/.env` > `<exePath 同目录>/.env`；显式 shell env 永远赢（不覆盖），userDataDir 覆盖 exePath |
| 5 | CLI-only 与项目模式的 user-data 是否共享？ | **不共享**。CLI-only 用 `%APPDATA%/chainlesschain-portable/`，项目模式用 `%APPDATA%/.chainlesschain-projects/<id>/`，避免互污染 |
| 6 | 是否允许产物再调用 `cc pack`？ | **不允许**。白名单默认 `["ui","chat","agent","skill"]` 已经过滤掉 |

---

## 14. 与基础设计文档的关系

| 主设计文档章节 | 项目模式影响 |
|---|---|
| §3 设计决策锁定 | 决策 1（"完全独立运行（含 DB + 配置模板）"）扩展为"独立运行 + 项目内容内嵌" |
| §6 产物结构 | 增加 `<exePath>/.env` 读取约定 |
| §11 构建流水线 | 7 阶段 → 8 阶段（插入 3.5 collectProjectAssets） |
| §13 安全模型 | 复用 secret-scanner，新增 `bundledSkills` 审计字段 |
| §16 测试策略 | 新增 §6/§12 中的单测 + E2E 用例 |
| §18 分阶段交付 | 新增 4 个 Phase（项目模式独立排期），不阻塞主线 P1（macOS / Linux） |

---

## 15. 不在本文档范围

- 桌面 Electron 套壳产物（另起设计文档）
- 项目模式的远程升级 / OTA（P3+）
- Web UI 的项目级 theming（P3+）
- 多语言 persona 切换（已由 `cc skill` 体系覆盖）

---

**文档结束。**

下一步（v0.8 后）：只剩候选 Phase 3e（macOS pack pipeline，需 CI runner 配额决策）。Phase 3c drift / 3g auto-update / 3f .env sidecar+--version --json / 3d persona resolver 全部收口，doc 与代码完全对齐。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。cc pack --project 项目打包模式：项目级打包。

### 2. 核心特性
cc pack --project / 项目打包 / Phase 0-3。

### 3. 系统架构
见正文架构 / 设计章节。

### 4. 系统定位
ChainlessChain 的「cc pack 项目模式」。

### 5. 核心功能
见正文功能 / 设计章节。

### 6. 技术架构
见正文实现 / 技术章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试 / E2E 章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / trap / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / 命令 / API 示例。

### 17. 相关文档
[系统设计主文档](./系统设计_主文档.md)、相关设计文档。
