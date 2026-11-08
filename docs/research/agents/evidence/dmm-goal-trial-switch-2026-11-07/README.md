# 桌面持续目标默认关闭与显式启用证据

候选源码：`aa6211369ac9c808d90c968bd3d9bd42cab4a216`。草稿 [#546](https://github.com/chainlesschain/chainlesschain/pull/546) 依赖 #545。开关语义见[试点说明](../../dmm-desktop-goal-trial-switch-2026-11-07.md)。这批推进 DMM-10 的默认关闭工程验收，完整计划没有完成。

## 实际 Windows 产品

两份报告均由准确提交、干净工作区启动实际 Electron 39.8.10 / 生产 Vue renderer，使用隔离的合成项目和真实登录/原生任务对话框。没有替换审批或 IPC 实现。runner 摘要与 `git show` 候选字节一致，构建产物回读一致；应用日志、登录材料、密钥和加密 profile 不进入归档。

| 场景           | 报告                                            | 结果                                                                                                                                  |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 不提供启用变量 | [default-off](./local/default-off/journey.json) | 原生取消不创建、原生确认只创建一条；目标控件隐藏，四个公开目标 IPC 拒绝；真实 70.06 秒前后任务不变，没有目标表、个人/组织目标调度目录 |
| 显式启用       | [opt-in](./local/opt-in/journey.json)           | 风险创建取消、实际暂停/恢复、旧预览拒绝、新确认单次创建、四类血缘及同 run 重放；完整记忆/通知、独立拒绝完成、结束及真实 70 秒停止观察 |

旧预览与重放是实际授权 IPC 探针。确认框已打开期间并发禁用的新增回归使用真实 SQLite 与明确的对话框替身，不冒充实际 GUI 并发撤权验收。默认关闭旅程没有预先存在的目标；历史保留/重新读取由宿主回归覆盖，不冒充已安装客户端升级场景。

## 本地回归与保留的失败

| 原始报告                               | 通过/总数 | 说明                                                             |
| -------------------------------------- | --------- | ---------------------------------------------------------------- |
| `business-actions.json`                | 422/423   | 新断言误以为关闭会删除已有连接文件；原行为保留失效凭据文件       |
| `bridge-and-policy-final.json`         | 50/50     | 对应修正与默认关闭回归；后续完整连接退出场景见下一行             |
| `bridge-drain-final.json`              | 35/35     | 实际 loopback 关闭等待、在途原生连接授权不能导出；不与上一行相加 |
| `organization-workflow-final.json`     | 19/21     | 新测试误取提交结果的提议字段                                     |
| `organization-workflow-corrected.json` | 20/21     | 新测试用异步断言检查同步拒绝                                     |
| `organization-workflow-passed.json`    | 21/21     | 两条禁用路径均通过；不累计重跑                                   |
| `business-actions-renderer.json`       | 295/295   | 完整个人 renderer 配置                                           |
| `organization-authority.json`          | 338/338   | 完整组织宿主；增加两条场景后的专项结果见上方                     |
| `organization-renderer.json`           | 213/213   | 完整组织 renderer 配置                                           |
| `cli-legacy-off.json`                  | 23/23     | 关闭桌面开关时既有 CLI 文件目标兼容；与桌面统计分列              |

前提交本地测试与准确候选 GUI/CI 分列，不把本地补测包装为完整准确候选 Actions 结果。一次早期 policy 专项的同步/异步断言错误保留在会话输出，未生成 JSON；上表只说明实际归档的原始报告。没有用跳过、放宽超时或删除旧用例解决失败。

## 准确候选 Actions

准确候选 `aa6211369a` 的五组工作流全部终态 success：三平台宿主矩阵 [42308963733](https://github.com/chainlesschain/chainlesschain/actions/runs/42308963733)、基础原生目标 [42308963499](https://github.com/chainlesschain/chainlesschain/actions/runs/42308963499)、原生移交 [42308963545](https://github.com/chainlesschain/chainlesschain/actions/runs/42308963545)、风险创建/默认关闭 [42308963511](https://github.com/chainlesschain/chainlesschain/actions/runs/42308963511) 和记忆/通知 [42308963596](https://github.com/chainlesschain/chainlesschain/actions/runs/42308963596)。五份 GUI 报告源码干净；四份加密原生 Graph preflight 通过。原始制品及运行/任务/制品身份元数据已逐项归档，没有为轮询等待重新触发运行。

三平台各自的完整报告如下。配置之间有重叠，每平台去重后为 **61 文件/1,140 项通过，0 失败、0 跳过**；不与本地补测、历史批次或不同平台相加。新增组织 renderer 配置带入既有覆盖范围，不能把 1,140 与前批 958 的差值全部当作新写用例。

| 配置                  | 文件 | 通过项 |
| --------------------- | ---: | -----: |
| Desktop host          |   22 |    424 |
| Personal renderer     |   19 |    295 |
| Organization host     |   17 |    340 |
| Organization renderer |   11 |    213 |

这不是新源码 CLI CI / Strict Sandbox 或完整发行门结果。

## 复核与边界

`manifest.json` 固定 65 份原始文件和 48 项候选源码摘要；`verify-evidence.mjs` 从 Git 快照核对源码、报告与生命周期断言，不要求后续文档提交仍等于产品候选 HEAD。JSON/YAML 原始字节受 `.gitattributes` 和 `.prettierignore` 保护。

```powershell
node docs/research/agents/evidence/dmm-goal-trial-switch-2026-11-07/verify-evidence.mjs
```

未发布、未合并、未修改公开版本。完整安装迁移/数据库降级回退、真实生产灰度与业务样本、其他平台/IDE/扩展组合 GUI、真实模态框并发撤权及新源码发行门仍待完成。关闭保留目标、任务、证据和记忆；重新启用可能恢复既有有效巡检，不能当作撤销全部授权。
