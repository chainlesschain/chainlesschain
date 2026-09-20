# 第一百六十八次工程实施：CLI Volcengine 签发者状态防回滚

## 本批目标

为 root 签名的 signer revocation snapshot 建立耐久高水位，阻止旧 revision 或同 revision 替换快照在重启后重新获得信任。

## 实施结果

- 新增品牌化 `VolcengineFunctionRevocationStatusFloorStore`。descriptor 固定 store、tenant、已验签模块、revocation authority、trust root、状态根摘要与 `cross-process-exclusive-file-fsync` 模式；状态根路径替换会在打开后端前失败。
- store 复用已有严格跨进程文件锁与 manifest-head CAS 后端，以私有目录、原子临时文件替换、文件/目录 fsync 和精确字节回读提交最高 signer status revision。
- 首次 snapshot 建立 floor；同 revision 同摘要幂等，同 revision 不同摘要固定冲突，较低 revision 返回稳定 rollback code。较高 revision 还必须推进 `issuedAt`，避免只抬高数字却回退签发时间。
- floor state 绑定 store descriptor digest、revision、snapshot digest、签发/下次更新时间和可复算 head digest；重开实例会重新校验完整状态，损坏或 descriptor 替换失败关闭。
- revocation evidence resolver descriptor 升级到 v5并绑定 floor store digest。root 状态快照验签后必须先取得耐久、精确回读的 floor ack，resolver 才能创建；floor head digest 进入 evidence readback v2 摘要。
- 签名 deployment loader 已暴露 floor store 工厂，并强制其 handler artifact 等于已认证模块摘要。

## 回归与门禁

- status floor store、撤销 authority、replay store、process executor 与签名 deployment loader 定向回归：5 files、120 tests passed。
- 真实临时目录覆盖首次提交、重开、幂等、更高 revision、较低 revision、同 revision 替换、签发时间不推进、状态损坏和路径替换。
- resolver 组合回归覆盖同一状态根跨实例 rollback、冲突及后续合法 revision。
- 相关 CLI ESLint 与 `git diff --check` 通过。

## 未完成边界

- 生产环境仍需配置稳定、备份且受权限保护的状态根；跨主机/WORM 副本、远端一致存储和本模块专用断电/进程强杀故障注入尚未验收。
- 在线状态分发、root/leaf 自动轮换、企业 PKI/HSM、生产 operator/RBAC 与真实 Electron/provider E2E 仍待完成。
