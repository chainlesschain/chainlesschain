# 第五十九次工程实施：Desktop 到期清理生命周期接线

日期：2026-09-20

## 本批结论

本批把签名 retention scheduler 接入真实 Desktop 主进程生命周期。deployment 返回的 scheduler 必须通过品牌化 capture；只有其余 deployment 依赖全部验证成功后，Desktop 才调用 `start`。应用退出时，`onWillQuit` 调用 `stop`，从而取消后续 interval 并等待活动 expiry sweep 排空。

到期清理由此形成仓库内完整链路：Desktop 启动 → 签名 scheduler → 脱敏 retention policy → metadata/blob 到期计划 → intent/tombstone 删除 → 耐久 outcome audit → Desktop 关机排空。

## 主要实现

- 新增开发与 packaged scheduler 模块路径解析；packaged 模式必须提供 `resourcesPath`；
- scheduler 必须作为 deployment 的可枚举普通数据属性返回；
- capture 模块必须提供直接、非代理的 `captureBrowserQuarantineRetentionScheduler`；
- Desktop 只保留 `stop` 和 `inspect` 生命周期端口，不暴露 `start` 或 `runNow` 给 renderer/普通业务调用方；
- `start` 必须返回明确的 `status:started`；异常或不确定确认会立即调用 `stop` 回滚并使 deployment 加载失败；
- scheduler 在所有其他 deployment 校验完成前不会启动，避免后续配置失败遗留 timer；
- `onWillQuit` 在其他耗时清理前停止并排空 scheduler，失败只记录主进程错误，不阻塞剩余退出清理。

## 验证结果

```text
Desktop deployment / retention scheduler / authority / signed loader:
  Test Files  4 passed (4)
  Tests      113 passed (113)

ESLint:
  0 errors
  8 pre-existing warnings in desktop main/index.js
```

覆盖签名 scheduler 的 Desktop 自动启动、最小生命周期端口、正常停止、异常启动回滚，以及底层周期、重叠跳过、关机排空、策略授权、耐久审计和 module-digest guard 回归。

## 仍未完成

- 当前机器没有 operator 签发的生产 Desktop deployment，因此真实长期运行 timer 尚未在目标环境启动；
- 仍缺生产 retention policy、真实耐久 audit writer 与多次周期运行的目标环境验收；
- 专用 operator revoke、跨进程全生命周期锁、批次恢复/对账、目录 fsync 与断电验收仍待完成；
- 真实 Electron/preload/download provider/custody E2E 尚未完成。
