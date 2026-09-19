# 第三十七次工程实施：脱敏文本绑定的单次视觉输入动作

日期：2026-09-19

## 本批结论

本批继续收敛 G03，在既有视觉定位与点击双能力门上增加独立的 `visual-type` 合同。单次文本输入现可由 Browser IPC 取得与新鲜定位截图关联的一次性 action grant，并在紧邻页面副作用前消费；成功和失败结果都必须经原 action authority 完成认证、耐久、精确回读的审计确认。

这完成的是单目标、单文本值的受治理视觉输入，不是通用键盘注入、页面导航或多步 GUI Agent。`executeVisualTask()` 仍失败关闭，普通导航也没有借用本批输入授权。

## 主要实现

### 1. 独立视觉输入授权

- action authority 只新增显式操作 `visual-type`，没有把泛化 `type` 或 navigation 纳入许可；
- Desktop 输入核心绑定 target、操作、控件描述、文本摘要、Unicode 字符数、输入延迟和是否清空原值；
- 原始文本不进入 authority request、receipt、outcome request 或 `VisionAction` 返回结果；审计侧只取得输入摘要、字符数和最终结果摘要；
- 文本限制为非空且 UTF-8 编码不超过 64 KiB，延迟限制为 0–1000 ms。

### 2. 双 grant 消费顺序

`VisionAction.visualType()` 按以下顺序执行：

1. 在截图和浏览器引擎访问前预检 observation/action grant；
2. 用 observation grant 获取新鲜截图并定位目标输入框；
3. 将图片坐标转换为 viewport 坐标；
4. 在 focus click、可选全选和键盘输入前消费一次性 action grant；
5. 对成功或失败结果取得耐久审计确认后返回。

grant 重放、target/文本/参数替换、未消费关联 observation、过期授权或缺失 action host 均失败关闭。输入动作已发生但审计状态不明时沿用 `CC_AGENT_ACTION_AUDIT_UNCERTAIN`，不会自动重放。

### 3. 产品入口

- `browser:action:vision` 的 `task: "type"` 使用该双能力门；
- 新增直接入口 `browser:visualType`，并同步加入 preload 与 renderer IPC 能力清单；
- 两个入口都在取得授权后才访问浏览器引擎，并从传给动作实现的选项中移除原始授权材料；
- Browser IPC handler 计数由 22 更新为 23。

## 负例覆盖

本批新增或扩展以下验证：

1. `visual-type` 与关联 observation receipt、target、文本和参数精确绑定；
2. 文本替换、grant 重放和超过 UTF-8 字节预算的输入被拒绝；
3. authority 和耐久审计调用中不出现原始文本；
4. 成功输入只返回字符数及授权/审计摘要，不回显文本；
5. 页面输入失败先记录耐久失败结果，再返回脱敏失败响应；
6. 缺少 action host 时，IPC 在浏览器引擎访问前拒绝；
7. 原视觉点击、只读观察、模型 ingress 和 deployment 装配回归继续通过。

## 验证结果

视觉 authority、Desktop adapter、deployment、模型入口、动作与 IPC 相关回归：

```text
Test Files  10 passed (10)
Tests       176 passed (176)
```

其中本批直接聚焦回归为 4 files、31 tests passed。相关 JavaScript 文件通过 ESLint（0 errors，保留 10 个既有 unused-variable warnings），全部本批文件通过 Prettier。

## 仍未完成

- 页面导航、通用键盘动作和多步视觉任务仍无各自的 action 合同，继续失败关闭或不属于本治理入口；
- operator 尚未签发生产 observation/action authority，也未提供真实耐久 audit writer；
- 用户、任务、tenant、DID/RBAC、页面敏感级别、隐私分类与交互审批材料仍需生产策略接入；
- 页面不可逆副作用的补偿/人工恢复、日志脱敏、断电与进程崩溃审计演练仍未完成；
- 尚未运行真实 Electron、浏览器页面和付费视觉 provider 的端到端输入测试。
