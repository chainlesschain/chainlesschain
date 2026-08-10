# CLI 原生发行公网回读门禁

本门禁只验证已经公开的 `cli-vX.Y.Z` 原生发行物，不创建 release、不上传或覆盖资产，也不向 Homebrew tap 或 WinGet catalog 提交内容。仓库当前的 `CLI Native Release` 仍保持 `blocked-pending-signing-and-public-distribution-evidence`；在仓库保护、外部凭证、签名后安装矩阵和真实渠道发布完成前，Task 4 继续是 **NO-GO**。

## 调用边界

手动运行 `.github/workflows/cli-native-release-readback.yml` 时必须提供严格 SemVer 的 `tag`（例如 `cli-v0.164.0`）、另行确认的 40 位 `expected_sha`，以及是否要求 `cli-stable` 逐字节一致的 `verify_stable`。手动运行只接受受保护的 `main`，并将 `github.workflow_ref`、`github.workflow_sha`、run ID 和 attempt 写入证据。

发布工作流通过仓库内本地 reusable workflow 调用回读。调用方必须是同一受信仓库的 `.github/workflows/cli-native-release.yml@refs/tags/<tag>`，事件必须继承同一个受保护 tag 的 `push`，调用方 workflow SHA、release SHA 和输入 SHA 必须相同。called job 的 `workflow_repository`、`workflow_file_path`、`workflow_ref` 和 `workflow_sha` 从 GitHub `job` context 读取并逐字段验证；本地 reusable workflow 还必须与调用方处于同一 tag/SHA。公网 verifier、下载器和证据生成器始终 checkout 该受信 called-workflow SHA；目标 release 的 lock/package/installer 内容通过 exact release commit 读取，不执行任意目标分支上的 verifier。

手动 `workflow_dispatch` 使用受保护 `main` 上的当前 verifier/schema 与 `native-production` 当前 signer-policy variables。它适合当前兼容策略下的历史回查，但证书轮换或 generator/schema 演进后，旧 release 的失败可能只是 verifier/policy drift，不能据此直接判定旧公开字节失效；跨策略时代的长期历史验真仍需后续增加按 release 版本路由的归档 verifier 与策略快照。

同仓库 PR 到 `main` 时只运行离线 verifier/契约测试，不访问公网 release，也不读取 `native-production` 环境。fork PR 或任意其他仓库、分支、工作流调用均拒绝。

## 验证范围

1. tag、`packages/cli/package.json` 版本和 `expected_sha` 必须互相反向生成且符合严格 SemVer 2.0.0。GitHub Release metadata 通过无认证公共 API 回读，`target_commitish`、公开状态、URL 和完整资产集合必须一致。
2. 每个下载 URL 从受信仓库、tag 和安全资产名重新推导。初始请求以及每次重定向都只允许 HTTPS、默认端口和 GitHub 固定主机白名单；请求不携带 token/cookie。metadata、普通 sidecar、SBOM 和二进制分别有预下载 `size`/`Content-Length` 与流式硬上限，超限、压缩传输、过多重定向或已有输出均 fail closed。
3. 六个二进制、聚合 manifest、安装脚本、Homebrew/WinGet metadata、公钥、SBOM 和 `SHA256SUMS` 的每个 Sigstore bundle 都必须同时绑定发布 workflow 的 repository、tag ref、exact SHA、`push` trigger、OIDC issuer 和 certificate identity。verifier 只消费本次 workflow 成功执行 `cosign verify-blob` 后生成、且绑定同一 readback run ID/attempt 的本地 evidence。
4. `SHA256SUMS` 必须无重复、无遗漏地覆盖全部 versioned assets；每项重新散列。六目标 pack sidecar 必须与真实 bytes、版本、commit、target 和平台签名类型一致。聚合阶段还会逐项检查平台记录的 `artifact`、SHA-256 和 bytes 与核心记录相同。
5. `chainlesschain-update.json` 必须通过 Ed25519 公钥验签；其六目标 URL、SHA-256、字节数、SBOM、package-manager generator contract 和 release notes 必须绑定同一版本与 exact SHA。
6. Windows x64/ARM64 公网二进制必须同时满足 Authenticode `Valid`、可信时间戳、受保护策略中的证书 SHA-256、完整 Subject、Publisher 与 timestamp Subject。macOS x64/ARM64 必须通过 `codesign --verify`、`spctl`，并精确匹配 TeamIdentifier、首个 Developer ID Authority 和 designated requirement。策略缺失或任一字段不等即失败。
7. CycloneDX 1.6 SBOM 只能从 exact repository `package-lock.json` v3 与 CLI package metadata 生成，不访问 registry。闭包包含 runtime/optional 依赖及必需 peer，排除不可达 dev/test 和 optional peer；lock/package digest、runtime ref 集、依赖图、root、serial 和 source commit 都确定性绑定。发布阶段生成两次并逐字节比较；公网阶段从 release commit 的 lock/package 独立重建并再次逐字节比较。
8. Homebrew formula 与 WinGet version/defaultLocale/installer 三件套必须按签名的 generator/schema contract 确定性重建。固定的 `windows-2025` runner 还对公网三件套执行官方 `winget validate --manifest`，validator 缺失即失败，并把实际 validator version 与结果绑定到核心证据中的同一 SHA-256/bytes；首次可达的 exact-SHA live run 仍须保存该版本证据。这不等同于已经提交或进入公开 WinGet catalog。
9. `install.sh` 和 `install.ps1` 与 exact release commit 中源码逐字节比较。启用 `cli-stable` 时，所有滚动资产及 bundle 与 versioned release 逐字节一致。
10. 聚合 JSON 保留核心 evidence 的 SHA-256、六目标的 artifact/SHA-256/bytes/Sigstore 结论、package-manager 资产摘要和 workflow/run identity，再由 SHA 固定的 GitHub Action 生成 build-provenance attestation；Linux 二进制也因此由最终 attestation 精确指认。最终 artifact 永远写入 `releaseEligible=false`。
11. 发布事务必须先公开不可变 versioned release，并以 `verify_stable=false` 完成匿名公网回读；只有该门通过后才允许修改 `cli-stable`，激活后再以 `verify_stable=true` 回读。已有 `cli-stable` 缺 manifest 或 bundle 时不得当成空 channel 自动初始化，因为那会丢失单调版本锚；必须由操作员恢复完整可信 pair 或显式移除整个 rolling release。旧 pair 的 Cosign 身份从旧 manifest 的稳定版本与 exact commit 推导，并要求远端旧 tag 指向同一 commit。远端 mutation 开始前会持久化 job output；激活 API 出现 outcome-unknown 失败或激活后的 stable 回读失败时，containment job 会撤下任何可能 active 的 manifest 并保持 workflow 失败。两次 reusable readback 的 core、WinGet、平台和 aggregate artifact 名均带 `verify_stable=false/true` 模式，不能在同一 caller run 中冲突或串读。

## 仓库保护与最小凭证

截至 2026-08-10，仓库侧查询结果是：没有生效的 ruleset，environment 只有未配置保护规则的 `pypi`，尚无 `native-production`。因此即使代码和离线测试通过，也不能把实现状态改成 ready。

发布前至少完成以下仓库配置：

- 创建覆盖 `cli-v*` 的 tag ruleset，限制 tag 创建、更新和删除，不配置任何包括管理员在内的 bypass；同时按仓库/组织可用规则把 `CLI CI` 与 `CLI Strict Sandbox` 配置为 required workflow/status，workflow 内的 exact-SHA gate 仍会再次核验完整矩阵。
- 创建 `native-production` environment，配置独立 required reviewers、禁止发起者自批、禁止管理员绕过，并只允许受保护的 `cli-v*` tag 部署。签名 secrets 只放在该 environment，不放到普通 repository/PR 上下文。
- environment secrets 最少包含：`CLI_UPDATE_ED25519_PRIVATE_KEY_B64`、`CLI_WINDOWS_SIGNING_CERT_PFX_B64`、`CLI_WINDOWS_SIGNING_CERT_PASSWORD`、`CLI_MACOS_SIGNING_CERT_P12_B64`、`CLI_MACOS_SIGNING_CERT_PASSWORD`、`CLI_MACOS_SIGNING_IDENTITY`、`CLI_MACOS_NOTARY_APPLE_ID`、`CLI_MACOS_NOTARY_TEAM_ID`、`CLI_MACOS_NOTARY_APP_PASSWORD`。
- environment variables 最少包含：`CLI_UPDATE_ED25519_PUBLIC_KEY_B64`、`CLI_WINDOWS_SIGNING_CERT_SHA256`（小写 64 位）、`CLI_WINDOWS_SIGNING_CERT_SUBJECT`、`CLI_WINDOWS_SIGNING_PUBLISHER`、`CLI_WINDOWS_TIMESTAMP_SUBJECT`、`CLI_MACOS_TEAM_IDENTIFIER`、`CLI_MACOS_DEVELOPER_ID_AUTHORITY`、`CLI_MACOS_DESIGNATED_REQUIREMENT`。
- 所有外部 actions 必须继续使用 40 位 commit SHA；升级 action 版本时单独评审 SHA 与权限。自动 `github.token` 只在具体发布步骤授予 `contents: write`，回读下载保持匿名。

## 仍需外部完成的退出条件

- 在同一最终 exact SHA 的六个真实目标上完成签名后的 fresh install、upgrade、rollback、失败恢复和长期 soak；
- 将 `chainlesschain.rb` 实际提交到受控 Homebrew tap，完成 `brew audit`、安装测试与公网 tap 回读；
- 将 WinGet 三件套实际提交到 `microsoft/winget-pkgs`，完成官方审核，并从公开 catalog 安装与回读；
- 保存 tag ruleset、environment reviewers/no-bypass、最小 secrets/variables、完整 `CLI CI`/`CLI Strict Sandbox` 矩阵和本 post-publish readback run 的可审计证据。

只有以上全部完成并经单独评审后，才能把 `CLI_NATIVE_RELEASE_IMPLEMENTATION_STATUS` 从 blocked 改为 ready。仓库侧 metadata/SBOM/WinGet validation 成功不能冒充真实渠道发布完成。
