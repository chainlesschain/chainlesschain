# CLI 0.166.98 首次旅程复测准备

这份独立诊断从准确发行候选 `a21913df8be0f7f4d06f9dd95d1a63f7bd978312` 派生，只把公开 CLI 版本与发行源码固定到 `0.166.98` / 该提交，并同步 workflow 步骤名称。保持原冻结项目 `b2aa3aba082873570e85dce39b00754e5504ff37`、verify-04 原 prompt、20 轮、工具费用估算停止线 $0.25 和独立 Docker 验收，不增加题目提示、不改变失败标准、不回填旧候选。

用户已授权火山实际测试及成功后的 CLI/IDE 发布。必须先完成该发行提交的完整 Actions 门禁、既有 OIDC 子包→CLI 发行及公开字节/来源/安装回读，再显式启动复测；普通 push 不调用模型。当前仅准备，未付费调用。

2026-10-11 默认 `main` 的 workflow contents API 返回 404；独立分支入口因此改为仅匹配 `feature/cli-first-run-retest-016698`。付费 push 还必须在最新提交消息包含 `[volcengine-first-run-diagnostic]`，并触及该 workflow 或 first-run 脚本。发行前的普通准备提交不带 marker，diagnostic job 条件跳过。CLI 公开回读成功后才使用显式 marker；保留 dispatch `confirm_live=true` 作为默认分支存在该入口时的选项。不修改发行候选或任何题目/验收参数。

验证目标为实际写入候选、独立冻结/费用语义检查、预算终止分类、拒绝/暂停调用关联及认证/工具/旅程费用；invoice 仍需真实账单。不会把 baseline 通过或离线夹具回归算成模型交付成功。

诊断源码与发行源码分开记录；正式 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99**、冻结计划及窗口保持，独立人工/外部锁、目标GUI/辅助技术、长时/SLO、Windows/macOS durable/native review继续开放。

Windows owner Node22.22.2 的五套离线合同 **39/39**、零 skip；keyless prepare 使用实际冻结 Git 对象，完整原始输出在[双摘要原件](./preparation.json)。没有实际公开安装或 provider 调用。
