# 第六十一次工程实施：Operator 撤销管理入口与 DID/RBAC 签名

日期：2026-09-20

## 本批结论

本批把上一批只存在于签名 deployment 内部的隔离工件撤销 authority 接入 Desktop 生产运行链。新增的 `browser:operator:revoke-quarantine-artifact` 与普通用户的交互式 discard 通道完全分离；renderer 只能提交工件三元组、工单号和撤销理由，不能提交或覆盖 operator DID、角色、签名与 tenant。

主进程从当前已解锁的 DID identity 取得签名密钥，以签名 deployment 固定的 `tenantId` 查询组织 owner/admin 角色，并对 request ID、renderer/frame 摘要、工件摘要、源下载回执、角色、权限、工单号、理由摘要和时间戳生成 Ed25519 签名。签名会立即按 DID/公钥绑定关系自验，随后作为策略可验证的授权证据进入专用 revoke authority；策略仍看不到原始 `quarantine:` 引用和理由正文。

## 主要实现

### 1. 独立管理 IPC

- 固定 preload capability 新增 `browser:operator:revoke-quarantine-artifact`，并通过 `browser.operator.revokeQuarantineArtifact(request)` 暴露窄接口。
- 输入只允许 `artifactRef`、`artifactDigest`、`sourceActionReceiptDigest`、`caseId` 与 `justification` 五个字段；附加 `operatorDid`、`role` 或 `signature` 会在 authority 调用前拒绝。
- 全局 sender-frame guard 继续约束调用来源；签名 payload 另外绑定 sender ID 与 frame URL digest，不能跨窗口转移。
- 未配置签名 operator authority 时通道失败关闭，不会退回普通 disposal 或 renderer 自报权限。

### 2. 主进程 DID 与 RBAC

- operator 身份只来自 `didManager.getCurrentIdentity()`；没有已解锁身份时返回专用认证错误。
- RBAC 只查询 deployment `tenantId` 对应的 `organizations.owner_did` 或 active `organization_members` owner/admin；数据库不可用、查询异常、普通成员和跨 tenant 身份均失败关闭。
- 撤销权限固定为 `browser.quarantine.revoke`，renderer 不能选择更宽权限。

### 3. Ed25519 授权证据

- 使用既有 DID signer 对有限、扁平、可规范化 payload 签名，并在调用 authority 前校验 DID、公钥和签名三者绑定。
- operator DID、原始理由、frame URL 与隔离引用不进入返回结果；策略取得签名 payload、公钥和签名以便复验，底层 request/audit 继续以摘要绑定。
- authority 返回值再次按工件、源回执、operator 摘要及所有耐久回执校验；不一致结果标记为不确定，不能报告撤销成功。

### 4. 签名 Desktop deployment 装载

- Desktop loader 识别 `browserQuarantineOperatorRevocationAuthority`，从固定 CLI 模块路径取得品牌 capture，并仅向 IPC 层暴露 opaque host。
- phase-1 Browser IPC 显式注入 host、DID manager 和数据库；普通 Computer Use handler 不取得 operator 签名能力。

## 验证结果

```text
Operator Desktop host / real custody / authority / deployment / Browser IPC:
  Test Files  6 passed (6)
  Tests      188 passed (188)

Preload fixed capability policy:
  Test Files  1 passed (1)
  Tests      5 passed (5)

ESLint:
  0 errors
```

真实跨层回归已从 owner/admin RBAC 与当前 DID 出发生成、自验签名，由真实 policy 复验后调用真实文件系统 custody，最后确认 artifact metadata/blob 已不可回读。身份、角色或签名注入，未登录、普通成员以及 DID/公钥不一致均在删除前失败关闭。

## 仍未完成

- 当前机器仍没有 operator 实际签发并配置的生产 Desktop deployment、撤销 policy 与 audit writer，也没有真实管理员 UI；本批交付的是可由管理 UI 调用的生产 IPC/API 边界。
- 目前使用软件 Ed25519 identity；双人审批、U-Key/硬件签名、break-glass 与批量撤销仍未接入。
- 文件 custody 的跨进程全生命周期锁、崩溃遗留 part/temp 恢复、目录 fsync 与断电验收仍待完成。
- 真实 Electron、管理员身份切换、下载 provider、恶意扫描和生产 custody 的端到端验收仍待目标环境完成。
