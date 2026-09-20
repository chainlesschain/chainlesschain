# 第一百六十次工程实施：CLI Volcengine 撤销签发者链绑定

## 本批目标

继续优先完成 CLI 函数执行缺口：让执行 authority 在签名合同中声明唯一撤销 authority，并把实际签发者和授权请求摘要写入耐久撤销记录，使重启后的撤销状态能够归属到确定的授权决策链。

## 实施结果

- Volcengine function authority、request、audit evidence 与 receipt 合同升级到 v6，replay store descriptor 升级到 v3，耐久撤销记录升级到 v2；v1–v5 execution descriptor 和 v1–v2 store descriptor 均失败关闭。
- execution authority descriptor 新增必填 `revocationAuthorityId`。Desktop host 会验证该标识、把它签入每次 function request，并要求最终 receipt 精确回绑；CLI 再独立校验 request、replay store descriptor 和 receipt 使用同一标识，替换签发者会在业务调用前失败。
- 品牌化撤销 authority 除绑定目标 execution authority、replay store 和 policy 外，还必须等于目标 descriptor 声明的 `revocationAuthorityId`。即使其他目标字段相同，foreign revocation authority 也不能调用授权端口或提交撤销。
- 耐久撤销记录新增 `revocationAuthorityId` 与 `authorizationRequestDigest`，并将二者纳入 v2 domain-separated revocation digest。store 在写入、精确回读、重开读取和幂等重试时验证签发者、授权 request digest、tenant、handler artifact、execution policy 与目标 authority/store 的完整绑定。
- 执行进程每次读取撤销状态时再次要求记录签发者等于签名 descriptor，并验证授权 request digest 的格式；旧记录、字段替换、额外字段、签发者替换或 digest 篡改都会使撤销状态不可验证并失败关闭。

## 回归与门禁

- CLI function authority、replay store 与签名 deployment loader 定向回归：3 test files、105 tests passed。
- Desktop capability 与 deployment loader 定向回归：2 test files、64 tests passed。
- 完整 LLM 主进程回归：39 test files、569 tests passed、15 tests skipped；仅出现既有 Node `punycode` 弃用提示。
- 覆盖 v1–v5 execution descriptor 降级拒绝、v1–v2 store descriptor 降级拒绝、Desktop request/receipt 签发者绑定、target descriptor 签发者错配、耐久记录签发者替换、授权 request digest 回读，以及重启和独立子进程传播。
- 相关 JavaScript 语法、Prettier、`git diff --check`、CLI/Desktop ESLint 与 Desktop `build:main` 通过；Desktop ESLint 仅保留目标文件既有的 curly warnings，无新增 error。

## 未完成边界

- 当前记录能够确定撤销由哪个 authority、针对哪个 authorization request 签发，但函数模块仍不解析外部 authorization evidence、audit event 或 durability receipt 的原始字节、签名证书链和撤销列表；这些验证仍属于 production 授权端口。
- production operator/RBAC 服务、身份切换和 profile 热重载仍需负责更新或替换整套签名 descriptor；本批没有增加 renderer 可调用的撤销入口。
- 传播仍受单机文件系统和 50 ms 协作轮询限制；忽略 `AbortSignal` 代码的硬终止、跨主机共识、轮询窗口内外部副作用补偿和不可逆操作恢复仍待完成。
- 真实断电与目标文件系统矩阵，以及 Electron/preload/renderer/Volcengine 工具循环 E2E 仍待目标环境完成。
