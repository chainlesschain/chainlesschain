# 第一百五十四次工程实施：CLI Volcengine 逐函数字段与字节策略

## 本批目标

继续优先收敛 CLI 签名函数 authority：把单一函数白名单细化为逐函数可验证策略，使不同内置函数不能共享全局 64 KiB 参数和 256 KiB 结果上限，也不能向业务端口夹带该函数未声明的参数字段。

## 实施结果

- Volcengine function authority、request、audit evidence 与 receipt 合同升级到 v2；旧 v1 descriptor 不能被新 Desktop host 或 CLI authority 当成 v2 使用。
- 每个 `allowedFunctions` 项必须按相同顺序提供唯一策略，且不得缺项或添加额外函数。策略固定包含 `functionName`、排序去重的 `allowedArgumentKeys`、`maxArgumentBytes` 和 `maxResultBytes`。
- Desktop capability 在进入签名 authority 前按目标函数策略重新投影 plain JSON，拒绝未知参数键和超出函数预算的参数，并把规范策略摘要签入 request digest。
- CLI authority 不信任 Desktop 的预检，会再次解析 descriptor、查找目标策略、投影参数、限制字段与字节并独立复算策略/request digest；不合规请求不会进入业务执行 port。
- 业务结果同样受逐函数结果字节预算约束。认证耐久 audit evidence 和最终 receipt 必须精确绑定 `functionPolicyDigest`，替换策略摘要不能生成 Desktop 可消费结果。
- 参数键拒绝控制字符、原型相关键、重复项、乱序数组、Proxy 与 accessor；策略数值只能在既有全局硬上限内继续收窄。

## 回归与门禁

- CLI authority 与签名 deployment loader 定向回归：2 test files、78 tests passed。
- Desktop capability 与 deployment loader 定向回归：2 test files、57 tests passed。
- 完整 LLM 主进程回归：39 test files、562 tests passed、15 tests skipped；仅出现既有 Node `punycode` 弃用提示。
- 覆盖策略缺项、未知参数键、参数/结果超限、策略摘要替换及 v2 端到端成功请求。
- CLI 相关 ESLint：0 errors、0 warnings；Desktop 相关 ESLint：0 errors、27 个既有 `curly` warnings。Prettier、JavaScript 语法检查、`git diff --check` 与 Desktop `build:main` 通过。

## 未完成边界

- 当前策略治理 JSON 边界，不替代真实笔记、文件、P2P 或系统信息 adapter 对资源 ID、路径、接收方、字段语义和必填项的最小权限校验。
- 交互审批、deadline、协作取消、撤销、管理员 policy、不可逆操作恢复及跨进程耐久幂等仍未完成。
- 仓库仍未内置访问真实业务数据的签名 production authority；真实 Volcengine 网络、Electron renderer/preload、企业 tenant/RBAC、身份切换与撤销 E2E 尚未完成。
