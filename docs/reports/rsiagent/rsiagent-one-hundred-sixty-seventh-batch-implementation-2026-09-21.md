# 第一百六十七次工程实施：CLI Volcengine 撤销签发者状态快照

## 本批目标

补齐 leaf certificate 的撤销与新鲜度检查，避免已撤销或状态未知的函数撤销签发者继续产生有效授权。

## 实施结果

- revocation evidence resolver descriptor 升级到 v4，新增 `ed25519-root-signed-revocation-snapshot` 状态模式、状态快照摘要和正整数 revision；descriptor digest 同时固定 certificate 与其状态证据。
- 状态快照使用规范 UTF-8 JSON，精确绑定 trust root、root issuer、tenant、revocation authority、revision、签发时间、下一次更新时间及最多 4096 个严格排序且不重复的 certificate digest，并由同一 pinned Ed25519 root 签名。
- resolver 创建时复算状态快照摘要、验证 root 签名和全部绑定；当前 leaf certificate digest 一旦出现在撤销集合中，resolver 创建立即失败。
- 每次 authorization evidence 的授权时间不得早于状态快照签发时间，grant 到期时间不得晚于状态快照 `nextUpdate`。过期状态不会被当作“未撤销”，而是在撤销落盘前失败关闭。
- foreign root 状态、状态摘要或 revision 替换、未排序/重复集合、非法时间窗和超长集合均不能形成受信 resolver。

## 回归与门禁

- 撤销 authority、replay store、process executor 与签名 deployment loader 定向回归：4 files、116 tests passed。
- 负例覆盖已撤销 certificate、过期状态快照、foreign root 状态签名和状态摘要替换；失败后目标 execution authority 保持活动。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- 状态快照随 resolver/deployment 装配，不是在线 OCSP；生产热更新、revision 防回滚、root/leaf 自动轮换和跨主机一致发布仍需独立控制面。
- 企业 PKI、中间 CA、双人签名、HSM/KMS attestation、生产 operator/RBAC 与真实 Electron/provider E2E 仍待目标环境完成。
