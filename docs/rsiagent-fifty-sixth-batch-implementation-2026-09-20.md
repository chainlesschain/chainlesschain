# 第五十六次工程实施：签名隔离处置组合工厂

日期：2026-09-20

## 本批结论

本批新增 `createBrowserFilesystemQuarantineDisposalAuthority`，把文件系统隔离 custody 与下载工件 disposal authority 在仓库内直接组合。签名 deployment 模块只需提供经 operator 配置的交互审批策略；真实 `disposeArtifact` 端口由工厂从品牌化 custody 内部取得，部署调用方不能再注入一个伪造 `bytesUnavailable` 回执的替代函数。

该工厂进入 desktop deployment 的内建 factory 集合，并受统一 module-digest guard 约束。disposal descriptor、custody descriptor 与已认证 deployment 模块必须使用同一 handler artifact digest，tenant 也必须一致，否则在授权或文件删除之前失败关闭。

## 主要实现

### 1. 封闭组合边界

- 组合输入严格限定为 `descriptor`、`custody`、`authorize` 和 `now` 四个普通数据属性；
- custody 必须通过品牌化 capture，普通对象或代理不能替代；
- disposal descriptor 由 custody 的 `bindDisposalAuthority` 再次校验 tenant、handler digest 和处置模式；
- 底层删除端口只在组合闭包中产生，不暴露给 deployment 模块替换；
- authority 继续负责一次性交互授权、精确请求绑定与脱敏结果，custody 继续负责 intent、删除回读和 tombstone。

### 2. 签名 Deployment 接线

desktop deployment loader 会装载该组合工厂，并像其他 Browser authority 一样检查 `descriptor.handlerArtifactDigest` 是否等于已认证模块摘要。测试覆盖替换摘要在接触 custody 前被拒绝，以及正确摘要可组合并由标准 disposal authority capture。

### 3. 真实删除验证

真实临时目录测试从隔离流写入工件，经组合 authority 的策略审批签发一次性处置授权，最终验证：

- authority 返回脱敏 deletion receipt；
- 文件系统 custody 中的 artifact 已不可读取；
- 未品牌化 custody、tenant 替换和额外 `disposeArtifact` 字段均失败关闭。

## 验证结果

```text
Filesystem disposal composition / signed deployment loader / custody / authority:
  Test Files  4 passed (4)
  Tests      84 passed (84)

ESLint:
  0 errors
```

## 仍未完成

- operator 尚未签发并部署实际包含该组合的生产 desktop deployment，也尚未接入真实用户、任务、tenant、DID/RBAC 与隐私审批策略；
- 生产 policy egress 与独立恶意文件 scanner 仍需和该 custody 一同装配、验收；
- 自动过期清理和专用 operator revoke 调度/入口尚未实现；
- 跨进程全生命周期锁、目录 fsync、断电/进程崩溃演练与真实 Electron/preload/download provider/custody E2E 仍待完成。
