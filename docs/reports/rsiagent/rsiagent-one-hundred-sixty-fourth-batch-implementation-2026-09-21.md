# 第一百六十四次工程实施：CLI Volcengine 撤销原始证据回读

## 本批目标

收紧 Volcengine 函数撤销链：不再仅信任授权端口返回的摘要与布尔声明，要求撤销写入前从独立端口取得对应原始证据字节并逐项复算摘要。

## 实施结果

- 新增品牌化 `VolcengineFunctionRevocationEvidenceResolver`。resolver descriptor 固定 tenant、已验签模块摘要、resolver policy、单项字节上限与 `digest-bound-exact-bytes` 模式，并以 descriptor digest 绑定到撤销 authority。
- 撤销 authority 升级到 v2，只接受 descriptor 完全匹配的品牌化 resolver。allow 决策通过结构、新鲜度、耐久与回读声明校验后，authority 会提交绑定原授权请求及三项证据摘要的只读 resolution request。
- resolver 必须返回 authorization evidence、audit event 与 durability receipt 的原始 `Buffer`/`Uint8Array`。三份字节分别受签名上限约束并重新计算 SHA-256；任一缺失、额外字段、Accessor/Proxy、空值、超限或摘要替换都会在目标 authority 被撤销前失败关闭。
- 验证后的 resolver descriptor、resolution request 与三项证据摘要形成独立 evidence readback digest。最终撤销结果升级到 v2，耐久撤销记录升级到 v3，并同时绑定 resolver digest 与 readback digest；重启后的执行 authority 只接受新记录结构。
- 签名 deployment loader 已暴露 resolver 工厂，并强制 resolver 的 `handlerArtifactDigest` 等于已认证 deployment 模块摘要，阻止组合阶段替换证据读取实现。

## 回归与门禁

- 撤销 authority、replay store、process executor 与签名 deployment loader 定向回归：4 files、113 tests passed。
- 负例覆盖旧 v1 authority、伪造/替换 resolver、原始字节替换和 resolver digest 替换；验证失败后目标 execution authority 仍可正常执行。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- 本批验证了独立 resolver 返回的原始字节与声明摘要一致，但没有验证这些字节内部的 operator 签名、证书链、HSM/KMS 身份或组织 RBAC；这些语义仍需生产 verifier 与信任根。
- 生产 evidence store、跨主机/WORM 副本、真实 operator deployment、身份切换及 Electron/provider E2E 尚未配置或验收。
