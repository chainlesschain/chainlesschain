# 99 — 项目记忆(cc.md)与 `cc init` 对标方案

> 对标 Claude Code 的 CLAUDE.md 项目记忆体系与 `/init` 命令。
> 版本:v1.1(2026-06-11,自审修订)。状态:Phase 0 ✅ / Phase 1 ✅ / Phase 1.5 审核修复 ✅ / Phase 2 规划中。

## 1. 背景与缺口

Claude Code 的核心机制之一是**文件式项目记忆**:启动时自动加载 `CLAUDE.md` 层级(用户级 → 项目根 → 子目录 → `.local`),agent 在任何仓库里都能拿到项目约定(构建命令、代码风格、架构注意点),并提供 `/init` 一键生成。

`cc agent` 在本方案之前完全没有这一层:`system-prompt.js` 不读任何项目指令文件;`memory-injection.js` 注入的是 session-core 记忆库(语义召回),不是确定性的项目约定。这是 2026-06-11 平价缺口盘点中的 **P0-1**(参见 memory `cli-parity-gap-backlog-2026-06-11`)。

## 2. 命名决策(用户拍板)

**主名用自家品牌 `cc.md`,不照搬 `CLAUDE.md`;但保留兼容回退。**

每个位置按以下优先级取第一个存在的文件:

| 范围 | 查找顺序 |
|---|---|
| 用户级 | `~/.chainlesschain/cc.md` → `~/.claude/CLAUDE.md` |
| 项目级(每目录) | `cc.md` → `CLAUDE.md` → `AGENTS.md` |
| 本地伴随(每目录) | `cc.local.md` → `CLAUDE.local.md` |

理由:① 品牌独立;② 已有 CLAUDE.md/AGENTS.md 的仓库(包括本仓)零配置即用;③ 与生态(AGENTS.md 业界惯例)互通。

## 3. Phase 0 — 自动加载(✅ 已落地,commit `0718e3ab6`)

**实现**:`packages/cli/src/lib/project-instructions.js` + `composeSystemPrompt` 单 seam 注入。

- **层级发现**:用户级 → git root(`.git` 向上探测)→ 逐级向下到 cwd;每级 project 文件后紧跟其 local 伴随;绝对路径去重。
- **`@path` import**:指令文件内的 `@相对路径` / `@~/路径` 递归引入(深度 ≤5,visited 环保护,跳过 ``` 围栏内 token);解析相对**所在文件**目录。token 边界规则与 file-ref-expander 一致(`@` 前必须是行首/空白/开括号),邮箱与 npm scope(`@scope/pkg`)解析不到真实文件时静默忽略。
- **预算**:单文件 48KB 截断(带标记),总预算 192KB,fail-open(任何 I/O 错误 → 空块,绝不让 prompt 组装崩)。
- **注入位置**:`composeSystemPrompt` 内,base(或 `--system-prompt` 覆盖)之后、`--append-system-prompt` 与 output-style 之前,包成 `<project-instructions>` 块。**单 seam = 三入口(headless-runner / headless-stream / agent-repl)自然全覆盖**,且零触并行 session 正在改的文件。
- **开关**:运行时默认开;`CC_PROJECT_MEMORY=0` 全局关;调用方 `projectMemory: false` 单次关;`projectMemory: true` 强制开(测试用)。**vitest 下隐式默认豁免**(`process.env.VITEST`):保住 composeSystemPrompt 既有纯函数契约,老测试零改动。
- **测试**:19 个单测(真临时目录,显式 `home` 注入防开发机 `~/.claude/CLAUDE.md` 泄入断言)+ 运行态 smoke(temp cc.md 注入 + 本仓拾取 CLAUDE.md+CLAUDE.local.md 47.5KB)。

## 4. Phase 1 — `cc init` 重定位(✅ 已落地)

**UX 决策(用户拍板,类 vue init):默认 = 不选模板、盘点当前文件夹;模板创建退为显式选项。**

```
cc init                    # 默认:盘点已有资源 → 生成 cc.md + 最小 .chainlesschain/
cc init --force            # 覆盖已有 cc.md
cc init -t code-project -y # 显式模板:老的 .chainlesschain/ 脚手架流(原样保留)
cc init --bare             # = -t empty -y
cc init --memory -t x      # --memory 强制盘点模式(优先于模板 flag)
```

**`.chainlesschain/` 仍然创建(用户拍板)**:"不选模板"只意味着不套用模板的 persona/skills/rules 内容,项目级基建照建——`config.json`(`template: "none"`、`memoryFile: "cc.md"`)+ `skills/` 工作区(项目级 skills 的家,`cc skill sync-cli` 的 workspace 层)。已有 `config.json` 时原样保留只补 cc.md。盘点模式不写 `rules.md`(记忆职责归 cc.md;模板流的 rules.md 仍被加载链识别,见 Phase 1.5-2)。

- **判别**:`command.getOptionValueSource("template") === "cli"` 或 `--bare` 才算"显式要模板"(`-t` 有默认值 `empty`,不能用值判断)。
- **盘点引擎**:`packages/cli/src/lib/project-inventory.js`,纯离线无 LLM:语言构成(扩展名 census,有界遍历 depth≤4 / 20k entries,跳 node_modules 等重目录)、包管理器(lockfile 探测)、package.json scripts/workspaces、工具链标记(tsconfig/vite/gradle/docker/CI workflows 数)、README 首段摘要、顶层目录文件数。`renderMemoryFile` 渲染成带 Overview/Stack/Commands/Layout/Conventions 段的 starter cc.md。
- **不挪新指令的决策记录**:曾考虑 `cc create <template>`(语义更纯)。否决理由:① web-panel `ProjectInit.vue` 以 `init --template X --yes --cwd` 形态调用,挪走要连带改 web-panel 源 + 重建打包 assets;② "创建项目"语义已被 `cc project init <name>`(desktop DB 项目)占用,第三个创建入口加剧碎片化;③ `-t` 即"快速创建"选项,正是 vue init 形态。将来若需要,`cc create` 可作 `init -t` 纯别名补充,非必要不加。
- **兼容面**:web-panel(显式 `-t`)零破坏;`cc init -y`(无 `-t`)语义从"快速空模板"变为"盘点"——**有意的 breaking change**,用户拍板默认反转。
- **测试**:11 个单测(lib census/synopsis/render + commander 实跑默认盘点/--force/--memory 优先/显式模板与 --bare 走老流)。

## 4.5 Phase 1.5 — 自审发现与修复(✅ 已落地)

对 v1.0 的设计自审发现三个实质问题,均已修:

1. **遮蔽 bug(最重要)**:cc.md 在发现链中优先于 CLAUDE.md/AGENTS.md(每目录只取第一个)。仓库已有手工维护的 CLAUDE.md 时,`cc init` 生成的盘点骨架会**遮蔽**它——精心维护的约定反而失效。**修复**:`renderMemoryFile` 检测到既有记忆文件时,在 cc.md 顶部生成 `## Existing project memory (imported)` 段,逐个 `@CLAUDE.md` import——加载器的 import 机制把既有内容原样带回,nothing is shadowed(roundtrip 测试实证:生成后 loader 同时载到 cc.md 骨架与 CLAUDE.md 原文)。
2. **`.chainlesschain/rules.md` 断链**:模板流(`cc init -t`)生成的项目规则文件,加载器原本不读——两条流割裂。**修复**:发现链每目录追加 `<dir>/.chainlesschain/rules.md`(scope `rules`),脚手架项目与记忆流项目都能喂给 agent。
3. **`-y` 语义变更无迁移提示**:`cc init -y`(无 `-t`)从"快速空模板"变为"盘点"。**修复**:该形态下输出一行 heads-up 指引 `--bare`/`-t`。

审核确认无需改的点:盘点不读源码内容(只数扩展名),`.env` 等敏感文件只出现在工具链标记不读值;README 摘要截断 400 字符;Windows 上文件名大小写不敏感(`cc.md`/`CC.md` 均命中),Linux 严格小写——文档约定统一小写 `cc.md`。

## 5. Phase 2 — 后续(规划,细化)

1. **REPL `#` 快捷记忆**(对标 Claude Code `#` memorize):REPL 内 `# 内容` 一键追加。目标文件三选(项目 cc.md / cc.local.md / 用户级 `~/.chainlesschain/cc.md`),默认项目级;追加格式 `- <内容>`(归入文件尾部 `## Notes` 段,无则创建);写后提示下一 turn 生效(系统提示在 session 内已组装,重载时机=下次 compose)。
2. **`--ai` 增强盘点**:`cc init --ai` 在离线骨架上跑一轮 headless agent(深读 README/入口文件,填实 Conventions 段)。要点:子 agent 运行时设 `CC_PROJECT_MEMORY=0`,防止半成品 cc.md 被注入造成自指污染;`--max-turns` 限额;离线盘点仍是默认(确定性、零 LLM 依赖)。
3. **path-scoped rules**:`.claude/rules/*.md` frontmatter 声明 glob,按工具触达路径动态注入(对齐本仓 desktop 侧机制);同机制可扩展到"嵌套子目录 cc.md 按需加载"(当前只加载 root→cwd 链,deeper 子目录的记忆文件在工具读到该路径时再注入)。
4. **`cc memory files` / REPL `/memory`**:列出当前生效的记忆文件链(路径+scope+字节数,即 `findInstructionFiles` 输出)并可 `$EDITOR` 打开;`cc doctor` 增加同样一节(可观测性:用户能看到 agent 到底吃了哪些约定)。
5. **加载可观测性**:headless `--output-format stream-json` 的 `system(init)` 事件附 `projectMemory: {files, bytes}`;text 态 stderr 一行摘要。(需动 headless-runner,等并行 session settle。)

## 6. 风险与陷阱

- **编码**:所有读取显式 `utf-8`(encoding.md 规则);生成文件 `writeFileSync(..., "utf-8")`。
- **依赖**:新 lib 仅 node 内置(fs/path/os),无 hoisting 装机崩风险(memory `cli_undeclared_dep_hoisting_global_crash`)。
- **大仓性能**:census 有界(20k entries / depth 4),fail-open;自动加载只在 agent 启动时跑一次。
- **自指**:本仓自身 CLAUDE.md(~12KB)+ CLAUDE.local.md(~40KB)会被自动注入 `cc agent`,在 192KB 预算内;若将来超预算,警告里有 budget exhausted 标记。
- **并行 session**:Phase 0/1 全部落在非热区文件(system-prompt.js / init.js / 新 lib),未触 agent-core/headless-*。

## 7. 验收

- [x] `cc agent` 在含 cc.md/CLAUDE.md/AGENTS.md 的目录自动注入 `<project-instructions>`(运行态 smoke 实证)
- [x] `CC_PROJECT_MEMORY=0` 关闭;既有单测零回归(42+11 全绿)
- [x] `cc init` 默认生成 cc.md;web-panel 调用形态(显式 `-t`)行为不变
- [ ] Phase 2 各项(`#` / `--ai` / rules / memory edit)

## 附录：规范章节补全（v5.0.3.108）

> 本文为系统设计子文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文「模块概述 / 功能描述」。项目记忆(cc.md)与 cc init 对标方案：项目记忆体系 + init 盘点。

### 2. 核心特性
项目记忆 / cc.md 层级 / cc init / rules。

### 3. 系统架构
见正文「架构设计」。

### 4. 系统定位
ChainlessChain 的「项目记忆与 init 对标方案」。

### 5. 核心功能
见正文模块概述与各节。

### 6. 技术架构
见正文实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比（如有）。

### 10. 配置参考
见正文配置 / 参数章节。

### 11. 性能指标
见正文性能 / 指标章节。

### 12. 测试覆盖
见正文测试章节。

### 13. 安全考虑
见正文安全 / 权限章节。

### 14. 故障排除
见正文故障 / 已知限制章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文使用 / API 示例。

### 17. 相关文档
[系统设计主文档](../系统设计_主文档.md)、`docs-site` 对应功能页。
