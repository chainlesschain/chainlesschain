# OpenAI 原生 36+9 实测结果

结果：**39/45** 通过独立验收；已收集生成 45/45，独立验收 45/45。本轮已完整收齐：普通任务 **31/36**，独立首次运行 **8/9**。

运行：[41117741513](https://github.com/chainlesschain/chainlesschain/actions/runs/41117741513)。执行源码：`0d063552701fc1609aaf5674dfacf42efb1e2154`。固定项目：`b2aa3aba082873570e85dce39b00754e5504ff37`。

公开版本：CLI **0.166.133**、Open VSX **0.37.171**、JetBrains **0.4.188**；VS Code 宿主 1.132.0，JetBrains 宿主 2025.2。公开包清单摘要：`sha256:2ec5541398b4149d092b9ae31199174be8adeca5d59937a767a917ef3d2f4317`。

这是独立 OpenAI / gpt-6.1-sol / Responses 诊断队列。36 个普通任务与九个独立首次运行来自同一冻结任务计划；历史火山结果不并入。公开 CLI 和插件安装文件没有修改。生成作业成功只表示完成交付；最终通过还要求来源、终态和独立 Linux Docker 行为检查全部通过。这不是正式付费或原生生产准入。

| 宿主入口         | 生成通过 | 独立验收通过 | 请求数 | token 费用估算 USD |
| ---------------- | -------: | -----------: | -----: | -----------------: |
| win32-cli        |      5/5 |          4/5 |     69 |           2.945931 |
| win32-vscode     |      5/5 |          5/5 |     68 |           3.490618 |
| win32-jetbrains  |      5/5 |          5/5 |     68 |           3.395956 |
| linux-cli        |      5/5 |          4/5 |     50 |           2.361684 |
| linux-vscode     |      5/5 |          5/5 |     74 |           4.093713 |
| linux-jetbrains  |      5/5 |          5/5 |     72 |           4.339223 |
| darwin-cli       |      5/5 |          5/5 |     56 |           2.554400 |
| darwin-vscode    |      4/5 |          2/5 |     71 |           3.695582 |
| darwin-jetbrains |      5/5 |          4/5 |     70 |           3.783366 |

本轮已记录 **598** 个上游请求，**598** 个有完整用量；未知用量请求 **0**。已知 token 费用估算 **$30.660472**，实际账单未知；未报告的缓存写入及其他费用不包含在估算中。早期本地探针不计入本表。

原错误回归的实际请求证据（本轮 Linux CLI 子集）：50 个请求中，45 个含工具结果、30 个回放 reasoning；出现 91 次空 summary，缺失 summary 0 次。这些是本轮请求的子集，不是额外任务。

## 逐项结果

| 样本                       | 类型     | 宿主入口         | 任务                               | 生成 | 候选行为检查 | 最终验收 |
| -------------------------- | -------- | ---------------- | ---------------------------------- | ---- | ------------ | -------- |
| verify-01                  | 普通     | win32-cli        | 官方 endpoint 与同名自定义网关隔离 | 通过 | 通过         | 通过     |
| verify-02                  | 普通     | win32-vscode     | 精确模型能力查找                   | 通过 | 通过         | 通过     |
| verify-03                  | 普通     | win32-jetbrains  | 新家族未知计价                     | 通过 | 通过         | 通过     |
| verify-04                  | 普通     | linux-cli        | 请求级缓存与阶梯费用               | 通过 | 通过         | 通过     |
| verify-05                  | 普通     | linux-vscode     | 安装与准入分离                     | 通过 | 通过         | 通过     |
| verify-06                  | 普通     | linux-jetbrains  | 付费分解前预检                     | 通过 | 通过         | 通过     |
| verify-07                  | 普通     | darwin-cli       | 持久正文分页边界                   | 通过 | 通过         | 通过     |
| verify-08                  | 普通     | darwin-vscode    | fork 历史归属                      | 通过 | 失败         | 失败     |
| verify-09                  | 普通     | darwin-jetbrains | 历史来源篡改拒绝                   | 通过 | 通过         | 通过     |
| verify-10                  | 普通     | win32-cli        | 分页索引失效回归                   | 通过 | 通过         | 通过     |
| verify-11                  | 普通     | win32-vscode     | 问题持久记录归属                   | 通过 | 通过         | 通过     |
| verify-12                  | 普通     | win32-jetbrains  | 含空格参数完整性                   | 通过 | 通过         | 通过     |
| verify-13                  | 普通     | linux-cli        | 附件同句柄读取边界                 | 通过 | 失败         | 失败     |
| verify-14                  | 普通     | linux-vscode     | 图片逐项错误                       | 通过 | 通过         | 通过     |
| verify-15                  | 普通     | linux-jetbrains  | 权限修订溢出拒绝                   | 通过 | 通过         | 通过     |
| verify-16                  | 普通     | darwin-cli       | 无效设置来源保守失败               | 通过 | 通过         | 通过     |
| verify-17                  | 普通     | darwin-vscode    | 持久进程所有权记录                 | 通过 | 通过         | 通过     |
| verify-18                  | 普通     | darwin-jetbrains | 所有权未知保持阻断                 | 通过 | 通过         | 通过     |
| verify-19                  | 普通     | win32-cli        | 取消审批迟到回调                   | 通过 | 失败         | 失败     |
| verify-20                  | 普通     | win32-vscode     | deny 决策不降级                    | 通过 | 通过         | 通过     |
| verify-21                  | 普通     | win32-jetbrains  | Memory 影子读取无写入              | 通过 | 通过         | 通过     |
| verify-22                  | 普通     | linux-cli        | Memory 发布后故障语义              | 通过 | 通过         | 通过     |
| verify-23                  | 普通     | linux-vscode     | 缺失样本固定分母                   | 通过 | 通过         | 通过     |
| verify-24                  | 普通     | linux-jetbrains  | 比较身份严格隔离                   | 通过 | 通过         | 通过     |
| verify-25                  | 普通     | darwin-cli       | 草稿写失败保留旧记录               | 通过 | 通过         | 通过     |
| verify-26                  | 普通     | darwin-vscode    | 敏感问题字段排除                   | 失败 | 通过         | 失败     |
| verify-27                  | 普通     | darwin-jetbrains | 重载问题精确绑定                   | 通过 | 通过         | 通过     |
| verify-28                  | 普通     | win32-cli        | 迟到加载不覆盖编辑                 | 通过 | 通过         | 通过     |
| verify-29                  | 普通     | win32-vscode     | 模式 ACK 关联                      | 通过 | 通过         | 通过     |
| verify-30                  | 普通     | win32-jetbrains  | 累计动画帧预算                     | 通过 | 通过         | 通过     |
| verify-31                  | 普通     | linux-cli        | 快照失败资源清理                   | 通过 | 通过         | 通过     |
| verify-32                  | 普通     | linux-vscode     | 预览取消失效                       | 通过 | 通过         | 通过     |
| verify-33                  | 普通     | linux-jetbrains  | 快速多图添加预算                   | 通过 | 通过         | 通过     |
| verify-34                  | 普通     | darwin-cli       | 冻结计划操作说明                   | 通过 | 通过         | 通过     |
| verify-35                  | 普通     | darwin-vscode    | 模型失败分类回归                   | 通过 | 通过         | 通过     |
| verify-36                  | 普通     | darwin-jetbrains | 启动配置身份保真                   | 通过 | 失败         | 失败     |
| first-run-win32-cli        | 首次运行 | win32-cli        | 官方 endpoint 与同名自定义网关隔离 | 通过 | 通过         | 通过     |
| first-run-win32-vscode     | 首次运行 | win32-vscode     | 精确模型能力查找                   | 通过 | 通过         | 通过     |
| first-run-win32-jetbrains  | 首次运行 | win32-jetbrains  | 新家族未知计价                     | 通过 | 通过         | 通过     |
| first-run-linux-cli        | 首次运行 | linux-cli        | 请求级缓存与阶梯费用               | 通过 | 通过         | 通过     |
| first-run-linux-vscode     | 首次运行 | linux-vscode     | 安装与准入分离                     | 通过 | 通过         | 通过     |
| first-run-linux-jetbrains  | 首次运行 | linux-jetbrains  | 付费分解前预检                     | 通过 | 通过         | 通过     |
| first-run-darwin-cli       | 首次运行 | darwin-cli       | 持久正文分页边界                   | 通过 | 通过         | 通过     |
| first-run-darwin-vscode    | 首次运行 | darwin-vscode    | fork 历史归属                      | 通过 | 失败         | 失败     |
| first-run-darwin-jetbrains | 首次运行 | darwin-jetbrains | 历史来源篡改拒绝                   | 通过 | 通过         | 通过     |

## 可复核证据

[JSON 完整结果](results.json) 保留逐项 checker 检查、变异控制、生成终态、候选摘要、Docker 镜像及来源绑定；[CSV](results.csv) 用于筛选统计。每个接受摘要必须与生成摘要的 SHA-256 一致。原始交付和无模型凭据的独立验收附件链接、摘要及到期时间列于 JSON。范围下载只提取原始 summary.json，并检查 ZIP 条目 CRC32 与字节数；没有声称重新计算整个 ZIP 的哈希。完整原件保留在 Actions；本机另留已下载附件、逐项原始摘要与校验记录。

## 未通过样本

- **verify-08 / darwin-vscode**：冻结基线 58/58 通过，候选 2/3 通过；测试期望拒绝跨父会话身份后仍存在记录，实际为 null。
- **verify-13 / linux-cli**：基线和候选测试均通过，但未拒绝检查器注入的错误行为，覆盖不足。
- **verify-19 / win32-cli**：基线和候选测试均通过，但未拒绝检查器注入的错误行为，覆盖不足。
- **verify-26 / darwin-vscode**：候选 5/5 及两项行为变异检查通过，但原生宿主未在任务期限前正常退出，缺少有效终态，因此最终仍失败。
- **verify-36 / darwin-jetbrains**：冻结基线 7/7 通过，候选 2/6 通过；空 allowlist 的实际值为 null，另外三个被篡改配置夹具未按测试预期抛错。
- **first-run-darwin-vscode / darwin-vscode**：冻结基线 58/58 通过，候选 2/3 通过；复制分叉历史的实际消息列表与期望不同。

未对候选文件进行人工修补，也未重复运行已完成的付费样本。

GitHub 工作流结论为 `failure`：38 个作业成功，5 个作业失败。作业与步骤状态见 [workflow.json](workflow.json)，未将失败工作流改记为成功。

## 失败断言原件

- [verify-08 原始检查回执](receipts/verify-08-check.json)：候选 2/3 通过，文件 SHA-256 与独立验收摘要绑定一致。
- [verify-36 原始检查回执](receipts/verify-36-check.json)：候选 2/6 通过，文件 SHA-256 与独立验收摘要绑定一致。
- [first-run-darwin-vscode 原始检查回执](receipts/first-run-darwin-vscode-check.json)：候选 2/3 通过，文件 SHA-256 与独立验收摘要绑定一致。

[源码审计](source-audit.json)、[本地验证原件](local-validation.tap) 和[临时密钥清理回执](secret-cleanup.json) 随报告保留。源码审计的正式付费准入状态仍为 false。
