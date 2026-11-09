# CLI / IDE 主线与发行边界设计核对（2026-11-09）

核对基线：`main@c34a664f42`。公开 CLI .145 的不可变源码为 `4e4b421bfb42e524f071c9ad70c2a2a2ce607374`；两种身份分别保留，文档部署另有 `deployment-source.json` 记录。

## 公开组合与源码版本

CLI **0.166.145**、Session Core **0.3.27**、Open VSX **0.37.181** 和 JetBrains **0.4.198** 已公开。两款 IDE 推荐 CLI .145。Open VSX 下载突破 **7 万+**（2026-11-09 项目方确认；公开 API 采样单独保留，不改写原始数值）。产品 **v5.0.3.145** 仍独立发行；源码产品 **v5.0.3.146**、VS Code **0.37.182** 不等于公开安装包。

## 输入、执行与验收的边界

模型输入诊断沿共享 Runtime 记录来源选择、最终发送复核与用量归因。IDE 和 CLI 读取有界、脱敏投影，不把“读过文件”当作“正文已发送”，也不把“候选测试通过”当作独立任务验收。源内容、账号凭据与授权本体不因生成诊断而自动公开。

## 生命周期与 MCP Tasks

运行中追加输入、压缩、重启恢复及副作用账本复用原会话/回合身份。持久 MCP Tasks 沿原会话交付结果，通过 deliveryId、watch lease 和显式可选 REPL auto-wake 防止串线或无授权唤醒。第三方服务、模型续跑、双 IDE/desktop 和多系统完整旅程仍待补齐，不能从合成检查宣称全部接入完成。

## Memory 与宿主诊断

Memory 在实际 provider dispatch 前再次核验授权；查询完成与清理顺序、取消、撤权和预算准入分别有证据。当前 Windows 响应及语义接线检查不代替三平台 cold/hot/mixed SLO 或多语言真实用户任务。

VS Code bridge 不可达时失败闭合；独立 Electron loopback 诊断将主机 TCP 故障与扩展激活分开。JetBrains scripted 检查和可访问性合同不等于真实 IDE 端到端 GUI 验收。

## 持久计费窗口与过期结算恢复

`44f56fe58aee36e6cc097755ce7c4ab3ec94b126` 在可信宿主支持账号证明的 host-dispatch 计价窗口。派发前原子持久化所选时间/窗口见证，结算在时钟变化、重启及合同/汇率过期后仍绑定原见证；新预留和派发继续检查当前有效期。缺失、重复或冲突证据保持拒绝/全额责任。

离线 Windows 合成费用回归 **234/234** 已包含 authority **81/81**；另有 **37/37** 附加检查。静态 egress 分类仍有 78 个调用链未映射候选。真实火山账号的时间计价规则、含手续费汇率上限、发票对账与正式付费准入仍未完成；`paidReady:false`、`accountPriceVerified:false`、`invoiceReconciled:false` 保持显式。

## 目标移交与原生权限

公开 CLI .145 已包含 `goal transfer-to-project` / `goal restore-transfer`。CLI 冻结/原字节备份与原生个人项目导入分离；新目标暂停且不继承监控、动作或 Memory 权限。原生签名作废回执用于恢复，不能用整库快照覆盖其他业务写入。新原生实现需匹配桌面构建和当前预览确认，旧公开桌面 .145 不承诺包含这些入口。

## 准确源码门禁和验证限制

公开 .145 源的 CLI CI **75 成功、1 跳过**，Strict Sandbox **6 成功**；OIDC 发布成功。本次独立核对 npm 下载 SHA-512、来源元数据，以及两款 IDE 公共归档/包内配对。密码学 provenance 验证、IDE 官方制品全量一致性比较未重跑。同 SHA 的其他工作流保留失败或取消，不能替代准确的必需门禁，也不能统称全部通过。

模型任务成绩仍按原来源和轮次记录：Sol 原冻结 **41/45**、跨修订 **45/45**、独立四项 **2/4**；火山累计 **36/45** 和 .140 严格 **24/45** 各自独立。本文未新增模型任务。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

## 代码与证据

- [本轮用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-09-145.html)
- [公开渠道与下载回执](https://github.com/chainlesschain/chainlesschain/blob/feature/site-refresh-20261109/docs/research/cli/evidence/documentation-refresh-20261109/README.md)
- [原生计价原始范围](https://github.com/chainlesschain/chainlesschain/blob/c34a664f426f8ff1c026d21a25bf8d3fd2f6f959/docs/research/cli/evidence/native-price-windows-20261109/README.md)
- [逐项完成审计](https://github.com/chainlesschain/chainlesschain/blob/c34a664f426f8ff1c026d21a25bf8d3fd2f6f959/docs/research/cli-ide/plans/cli-ide-codex-claude-gap-review-2026-11-08.md)
- [移交设计](./cli-goal-transfer-source-2026-11-07) · [历史 .143 设计](./release-runtime-update-2026-11-06-143)
