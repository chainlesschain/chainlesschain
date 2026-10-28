# CLI / IDE 差距优化第九批：外部 Codex 兼容清单

日期：2026-10-28。承接[差距复核第 4.6 节](./cli-ide-codex-claude-gap-review-2026-10-27.md#46-外部-codex区分默认支持协议探针和生产准入)。源码基线为 `b7616df7f423b33a36aa6ca09885efbee43795d7`；工作分支为 `feature/cli-codex-compatibility-manifest-20261028`。

## 问题与本批结果

原先实验适配器维护四个精确允许版本，工作流重复写入这些版本、三个系统及 `.160` 探针版本，探针脚本又单独维护 `.160`。维护其中一处不能保证其余入口同步，也缺少可自动检查的公开支持说明。

现在由[兼容清单](../../packages/cli/src/lib/codex-app-server-support.js)提供实验允许列表、探针配置、默认启用状态及生产准入声明。清单中“已配置探针”不代表探针已经通过，所有版本仍未获生产准入。

| 范围                             | 本批结果                                                              |
| -------------------------------- | --------------------------------------------------------------------- |
| 实验允许版本                     | 保留 `0.149.0`、`0.150.0`、`0.150.1`、`0.154.0`，仍需显式启用实验模块 |
| schema / 握手 / 移除演练         | 从清单生成 4 版本 × 3 系统，共 12 个 CI 单元                          |
| 固定 schema / 真实进程 turn 探针 | 从清单生成 `0.160.0` × 3 系统，共 3 个 CI 单元，不加入实验允许列表    |
| 生产入口                         | 保留 `codex exec --json`；实验适配器仍无生产调用方                    |
| 支持说明                         | 从同一清单生成，工作流检查内容漂移                                    |

[生成及检查脚本](../../packages/cli/scripts/codex-app-server-support.mjs)同时输出 GitHub Actions 矩阵、单版本诊断和[公开支持说明](../cli/CODEX_APP_SERVER_SUPPORT.generated.md)。[兼容工作流](../../.github/workflows/codex-app-server-compatibility.yml)新增读取清单的作业，保留准确提交检出、完整矩阵要求及原有证据上传；清单作业失败也会使最终门禁失败。

[schema 核验](../../packages/cli/scripts/verify-codex-app-server-schema.mjs)和[真实进程探针](../../packages/cli/scripts/codex-app-server-turn-probe.mjs)读取清单中的唯一固定探针版本。schema 仍逐字节比对原始 fixture，不放宽事件字段或版本匹配。[CLI README](../../packages/cli/README.md)增加支持说明入口。

## 执行与回退诊断

[实验适配器](../../packages/cli/src/lib/codex-app-server-adapter.js)保留原有导出及精确允许列表合同，新增以下状态：

- `runtimeClaims().support` 展示清单修订、标准化上游版本、实验允许、探针配置和生产准入；`compatibilitySource` 区分清单与实例覆盖。
- 成功或回退结果的 `protocol` 表示实际使用的协议，`support` 保留清单状态。`.160` 即使经探针实例覆盖获准执行，也不会被描述成清单已支持。
- 提前回退保留 `fallbackReason`。`turn/start` 发出后提交结果未知，或收到接受回执后未能完成，错误附带协议、清单及 `fallbackSuppressed:true`，保留原有禁止 exec 重复提交的行为。

`CC_EXPERIMENTAL_CODEX_APP_SERVER=1` 只控制独立实验适配器；该环境变量不会把生产编排入口切换到 App Server。

## 本地验证

[新增回归](../../packages/cli/__tests__/unit/codex-app-server-support.test.js)覆盖未知 / 预发布 / 非规范版本拒绝、三系统矩阵完整性、`.160` 不提升支持声明、实例覆盖标识、实际回退协议、提交未知及已接受超时不重复执行。还检查工作流依赖、GitHub 输出与 JSON 输出一致、文档漂移、Windows 换行，以及 schema fixture 字节改变后拒绝通过。

| 检查                                                     | 结果                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| 兼容清单、适配器、官方 schema、turn 探针、稳定外部适配器 | 5 个套件，64 项通过，无跳过                                              |
| 工作流                                                   | actionlint 通过；动态矩阵及最终依赖另由单元测试核对                      |
| 静态检查                                                 | 修改的 JS / MJS 语法、Prettier、生成文档一致性及 `git diff --check` 通过 |
| ESLint                                                   | 本地缺少 `@eslint-community/eslint-utils`，无法启动，不计为通过          |

本次结果与源码摘要见[本地验证回执](./cli/evidence/codex-compatibility-manifest-2026-10-28/verification.json)。回执绑定基线提交及修改文件摘要，不将尚未提交的工作区称为通过 CI 的准确发行提交。

复现命令：

```bash
# 仓库根目录
node packages/cli/scripts/codex-app-server-support.mjs --ci
node packages/cli/scripts/codex-app-server-support.mjs --version "codex-cli 0.160.0"
node packages/cli/scripts/codex-app-server-support.mjs --check docs/cli/CODEX_APP_SERVER_SUPPORT.generated.md
actionlint .github/workflows/codex-app-server-compatibility.yml

# packages/cli
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/codex-app-server-support.test.js __tests__/unit/codex-app-server-adapter.test.js __tests__/unit/codex-app-server-official-schema.test.js __tests__/unit/codex-app-server-turn-probe.test.js __tests__/unit/external-agent-adapters.test.js --maxWorkers 1
```

## 尚需完成的验收

本批完成清单与诊断的源码闭环，没有重新安装各版本 Codex、运行真实 Codex 进程或触发 GitHub Actions。Linux / Windows / macOS 的当前修改提交尚未获得矩阵结果，不能据此扩大默认支持或生产准入。

下一步选择目标新版本，生成其原始 schema，验证真实进程的事件交错、取消、断流、恢复及历史分页，再按同一准确提交收集三系统证据。新增探针与扩大实验允许列表分别审查；付费 / native 准入及 36+9 任务结案仍依据各自最新证据，不由本批本地测试代替。

本次通过 OpenAI Docs 技能实际读取[官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)，核对 schema 生成与上游版本绑定的合同。没有重新判断上游“最新版本”，也没有调用模型、使用账户凭据或执行发行。
