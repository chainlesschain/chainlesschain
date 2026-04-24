# `cc pack --project` — 项目打包模式 设计文档

> 版本：v0.1 (Draft)
> 日期：2026-04-24
> 作者：longfa
> 状态：草案，待评审
> 关联：`docs/design/CC_PACK_打包指令设计文档.md`（基础流水线 v0.1）
> 关联版本：ChainlessChain v5.0.2.49 / CLI 0.156.6

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

- 首次启动：把内嵌的 `.chainlesschain/` 物化到 `%APPDATA%/.chainlesschain-projects/<project-name>-<configSha8>/`
- 设置 `process.env.CC_PROJECT_ROOT = <userDataDir>`
- `process.chdir(userDataDir)` —— CLI 现有的 `findProjectRoot` 链路无须改动即可拾起
- 用户修改 user-data 目录里的 config / skills 立即生效，重启 exe 也保留（write-through）

### 4.4 漂移检测

bundle 时计算 `.chainlesschain/` 全量 SHA-256 写入 `BAKED.projectConfigSha`。运行时若 user-data 里的 marker 不匹配：

- 默认：**追加新文件 + 警告**，不覆盖用户改动
- `--force-refresh-on-launch`（打包时设置）：每次启动都强制重置

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
| 5. generatePkgConfig | scripts=cliRoot/src | **assets 追加** `tempDir/project/**/*`；**entry 模板改写** 见 §7 |
| 6. runPkg | 不变 | 不变 |
| 7. writeManifests | sidecar SHA-256 | **追加** `<artifact>.project.json`（projectName / configSha / fileCount / bundledSkills 列表） |
| 8. smokeTest | UI 探针 | **新断言**：`/api/skills` 返回的列表必须包含内嵌 skill 名 |

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
2. **强制 skip**：`.git/`、`node_modules/`、`.cache/`、`dist/`、`*.log`、任何 dotfile 除 `.chainlesschain` 本身
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
  projectName: 'my-medical-agent',
  projectEntry: 'ui',                   // 默认 subcommand
  projectConfigSha: 'abc12345...',      // 完整 sha256
  projectAutoPersona: 'medical-triage-persona',
  projectAllowedSubcommands: ['ui','chat','agent','skill'],
  forceRefreshOnLaunch: false,
});
```

### 7.2 入口脚本新增段

在现有 `pack-entry.js` 模板的 `ensureUtf8()` 之后、commander 解析之前插入：

```js
// ── 项目模式：物化 + chdir ──
if (BAKED.projectMode) {
  const userDataDir = path.join(
    os.homedir(),
    '.chainlesschain-projects',
    `${BAKED.projectName}-${BAKED.projectConfigSha.slice(0, 8)}`,
  );
  const markerFile = path.join(userDataDir, '.chainlesschain', '.pack-version');
  const needsMaterialize =
    BAKED.forceRefreshOnLaunch ||
    !fs.existsSync(markerFile) ||
    fs.readFileSync(markerFile, 'utf8').trim() !== BAKED.projectConfigSha;

  if (needsMaterialize) {
    // pkg snapshot FS：__dirname/../project/ 下是打包时收集的全量
    const bundledRoot = path.join(__dirname, '..', 'project', '.chainlesschain');
    copyRecursiveMerge(bundledRoot, path.join(userDataDir, '.chainlesschain'));
    fs.mkdirSync(path.dirname(markerFile), { recursive: true });
    fs.writeFileSync(markerFile, BAKED.projectConfigSha);
  }

  process.env.CC_PROJECT_ROOT = userDataDir;
  process.chdir(userDataDir);

  // 默认 subcommand 从 BAKED 读，覆盖原本硬编码的 'ui'
  if (!_hasSub) {
    const entryParts = BAKED.projectEntry.split(/\s+/);
    process.argv.push(...entryParts);
    // ... (UI flags 注入逻辑保留)
  }
}
```

`copyRecursiveMerge` 行为：目标已存在则**不覆盖**（用户可能改过），只补齐缺失文件并打印一行 warning。

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
| **LLM API keys** | 明确不允许打进 exe。约定 key 由旁边的 `.env` 提供，`pack-entry.js` 启动时尝试读 `<exePath>/.env` 和 `%APPDATA%/.chainlesschain-projects/<id>/.env` |
| **第三方 skill** | bundledSkills 列表写入 manifest，便于审计；首发不做签名校验 |
| **物化路径冲突** | `<projectName>-<configSha8>` 后缀避免不同版本 / 不同项目同名碰撞 |
| **Windows 路径长度** | user-data 路径走 `%APPDATA%` 而非 `LocalAppData`；skill 嵌套层级不能超过 5 级（collector 强校验） |

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

未列出的 flags（如 `--dry-run` / `--allow-dirty` / `--smoke-test`）行为完全等价。

---

## 12. 实施拆分

| Phase | 范围 | 单测 / 回归 |
|---|---|---|
| **0** | `precheck` 项目检测 + 新 flags 骨架 + 行为矩阵单测 | 新增 `precheck-project-mode.test.js`（4 case：auto-detect on/off × `--project`/`--no-project`） |
| **1** | `project-assets-collector.js` + secret-scan 复用 + 50MB cap + node_modules 拒绝 | 新增 `project-assets-collector.test.js`（≥10 case） |
| **2** | `pkg-config-generator` BAKED 扩展 + 入口模板 + `CC_PROJECT_ROOT` 兼容 + smoke-test 新断言 | 改造 `pkg-config-generator.test.js`；E2E：在 `tmp-pack/` 跑一遍真实打包 |
| **3** | manifest sidecar + 命名规则 + commander 白名单 + persona 自动激活 | 集成测试：模拟 `cc init` → `cc pack` → 启动 exe → 检查 `/api/skills` 列表 |

每个 Phase 独立可上线，建议拆 4 个 commit / PR。

---

## 13. 待决问题

| # | 问题 | 倾向 |
|---|---|---|
| 1 | `.chainlesschain/skills/` 第三方 pack 是否打进去？ | **是**，但写入 manifest 的 `bundledSkills.source` 字段 |
| 2 | 多项目共用 user-data 目录命名碰撞？ | `<name>-<sha8>` 后缀解决 |
| 3 | exe `--version` 是否暴露 bundled project 信息？ | **是**，新增 `--version --json` 输出 `{cli:"0.156.6", project:{name,sha}}` |
| 4 | LLM API keys 怎么解？ | `.env` sidecar 优先级最高，覆盖 bundled config 中的同名字段 |
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

下一步：评审通过后按 §12 Phase 0 起手。
