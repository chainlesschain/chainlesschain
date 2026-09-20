# 第一百六十五次工程实施：CLI Volcengine 撤销证据信任根验签

## 本批目标

在第 164 批原始字节回读之上验证撤销授权证据的签发者，使摘要一致但由未授权私钥生成的证据不能撤销函数执行 authority。

## 实施结果

- revocation evidence resolver descriptor 升级到 v2，新增 `ed25519-pinned-trust-root` 模式、trust root 原始字节摘要和 signer key ID。resolver 创建时复制 trust root 字节、复算摘要，并只接受可解析的 Ed25519 公钥。
- authorization evidence 必须是规范 UTF-8 JSON，字段精确绑定 evidence schema、trust root、signer key、tenant、revocation authority、原授权请求摘要、`allow` 决策及授权时间窗。非规范编码、字段增删或绑定替换均失败关闭。
- authorization evidence 的 Ed25519 签名覆盖 domain-separated 规范 core；完整含签名字节仍需等于授权决策声明的 evidence digest。由外部私钥签发的摘要一致证据会在撤销写入前被拒绝，目标 execution authority 保持活动。
- resolver descriptor digest 已包含 trust root、signer key 和签名模式，因此第 164 批的撤销 authority v2、结果 v2 与耐久记录 v3 会继续间接绑定本次签名验证配置，无需放宽原协议字段。

## 回归与门禁

- 撤销 authority、replay store、process executor 与签名 deployment loader 定向回归：4 files、114 tests passed。
- 负例覆盖 foreign signing key、替换 trust root、旧 authority、伪造 resolver、resolver digest 替换和原始字节替换；失败路径不会持久化撤销。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- 当前使用 descriptor 固定的单一 Ed25519 公钥，不等同于 X.509/组织证书链、证书状态查询、密钥轮换、双人签名或 HSM/KMS 证明。
- 生产 operator/RBAC 服务、trust root 发布与撤销、生产 evidence store、身份切换及真实 Electron/provider E2E 仍待目标环境配置和验收。
