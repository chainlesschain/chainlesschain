# 第一百六十六次工程实施：CLI Volcengine 撤销签发者证书链

## 本批目标

避免 pinned root key 直接签署每次撤销授权，在信任根与业务签发者之间加入用途受限、可审计的一跳 Ed25519 leaf certificate。

## 实施结果

- revocation evidence resolver descriptor 升级到 v3，签名模式改为 `ed25519-certified-signer`，新增 root key ID、`ed25519-root-signed-leaf` certificate mode、leaf certificate digest 和 revocation authority ID。descriptor digest 因而固定完整证书配置。
- resolver 创建时要求规范 UTF-8 JSON leaf certificate。证书必须精确绑定 trust root、issuer/subject key、leaf SPKI、tenant、revocation authority、撤销用途和不超过 366 天的有效期，并由 pinned Ed25519 root key 以 domain-separated payload 签发。
- trust root 只接受 public-only Ed25519 key；私钥材料、非 Ed25519 key、证书摘要替换、foreign root 签名、字段替换、非规范 base64/JSON 和非法有效期均失败关闭。
- authorization evidence 改由证书中的 leaf public key验签。授权时间不得早于证书生效时间，grant 到期时间不得晚于证书到期时间；证书过期时，摘要与业务签名均正确的授权仍不能触发撤销。
- revocation authority 创建阶段还会核对 resolver certificate 的 revocation authority ID，避免同 tenant、同模块下的证书跨撤销 authority 复用。

## 回归与门禁

- 撤销 authority、replay store、process executor 与签名 deployment loader 定向回归：4 files、115 tests passed。
- 负例覆盖 foreign root、foreign leaf signature、certificate digest 替换、过期 certificate、私钥 trust root、伪造 resolver 及原始字节替换；失败后目标 execution authority 保持活动。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- 当前是项目内一跳 Ed25519 certificate，不是 X.509/企业 PKI；尚无中间 CA、证书状态查询、序列号撤销列表、在线轮换、双人签名或 HSM/KMS attestation。
- 生产 root/leaf 发布与撤销、operator/RBAC 服务、evidence store、身份切换及真实 Electron/provider E2E 仍待目标环境配置和验收。
