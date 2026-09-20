# RSIAgent 第二十九次工程实施：交互审批绑定的视觉点击双能力门

> 日期：2026-09-19（Asia/Shanghai）<br>
> 前置实施：[第二十八次工程实施：视觉协议适配与签名截图读取授权](./rsiagent-twenty-eighth-batch-implementation-2026-09-19.md)<br>
> 状态：Browser IPC 的语义视觉点击现要求同一次请求同时取得截图定位 observation grant 和交互审批 action grant。两者缺一时在浏览器引擎与截图前失败关闭；action grant 只有在关联截图已消费后，才会紧邻鼠标事件被一次性消费。输入、导航和多步页面任务仍保持关闭。

## 1. 与签名部署绑定的 action authority

CLI deployment loader 新增 `createBrowserVisionActionAuthority` 内建工厂，并要求 descriptor 的 handler artifact digest 等于已经验签的 deployment 模块摘要。descriptor 还固定 authority、tenant、policy revision、最长 30 秒有效期，并强制 `approvalMode: interactive`；自动批准模式不能创建该 authority。

action request 绑定：

- renderer sender ID 与 frame URL digest；
- 目标 tab 和唯一开放操作 `visual-click`；
- 元素语义描述、鼠标按钮、点击次数、延迟和点击后等待组成的输入 digest；
- 与本次定位截图对应的 observation receipt digest；
- 私有审批材料的摘要和审批 evidence reference。

原始审批材料仅交给签名部署内的私有策略端，不进入 action receipt。Desktop loader 只向主进程返回 opaque action host，不能从中取得 authorize port、descriptor 或原始 authority。

## 2. 截图读取与页面变更不能相互替代

视觉点击按以下固定顺序执行：

1. Browser IPC 为 `locate` 请求短期、一次性的 observation grant；
2. action authority 以该 observation receipt digest 为前提请求交互审批；
3. 在取得浏览器引擎前预检两个 opaque grant 的 target、operation 与输入绑定；
4. `VisionAction` 消费 observation grant，获取新鲜截图并定位语义目标；
5. 紧邻 `page.mouse.click()` 前，再验证 observation 已消费且未被替换，并一次性消费 action grant；
6. 成功结果只返回 action receipt digest，不返回审批材料。

重放任一 grant、替换 tab、描述、点击参数或 observation receipt、使用非品牌 host、让授权过期，都会返回 `CC_AGENT_EVOLUTION_INGRESS_FAILED`。定位失败后 observation 已被消费，旧 action grant 不能配合另一张截图重试；点击抛错后 action grant 也不会恢复为可重放状态。

## 3. 接线范围

双能力门已接入：

- `browser:visualClick`；
- `browser:action:vision` 的 `task: "click"`。

普通坐标点击、键盘输入、导航、滚动、Desktop 操作和 `executeVisualTask` 没有因此获得新权限。直接构造 `VisionAction` 的 `ComputerUseToolExecutor`/`ComputerUseAgent` 也拿不到这两个签名 grant，相关视觉读取或变更继续失败关闭。当前不是通用自主 Computer Use 放行。

## 4. 尚未关闭的边界

仓库内交付的是签名 action authority 合同和失败关闭接线，尚不能代替生产审批与审计。G03 仍需：

- operator 签发的生产 deployment 实际装配 observation/action authority，并连接真实用户、任务、tenant、DID/RBAC、页面敏感级别和交互审批 UI；
- 对输入、导航和多步任务分别定义最小权限 action、逐步审批、停止条件与恢复策略；
- 将授权、执行结果和失败事件写入可认证、耐久且可回读的审计介质；
- 对不可逆页面副作用定义补偿或人工恢复流程，而不是把点击回执误称为回滚；
- 完成真实 Electron/browser/provider 正向 E2E，以及拒绝、取消、过期、重放、参数替换、页面漂移和敏感页面负例；
- 完成日志脱敏、密钥/凭据轮换、生产观察窗口和隐私审查。

因此 G03 仍为“部分完成”。本批只开放经过双能力门的单次语义视觉点击，不授权自主多步页面变更。

## 5. 验证口径

扩展后的视觉相关回归为 17 files、241 tests passed、15 skipped。新增覆盖包括 action authority 的签名模块摘要替换、交互模式、审批材料脱敏、有效期、品牌校验、observation receipt 绑定、消费顺序、一次性点击、参数替换、无 action host 时浏览器引擎零访问，以及真实 `VisionAction` 鼠标调用前的授权消费。

本批未启动 Electron、未访问真实网页、未执行真实账号操作、未调用付费视觉模型，也未创建或发布生产签名 deployment。测试绿灯只证明仓库内能力边界与失败关闭顺序。
