# CLI 0.166.97 配对发行准备

候选：CLI 0.166.97 / VS Code 0.37.141 / JetBrains 0.4.159，Agent SDK 保持 0.2.14。以下首轮记录保留准备时点，当前发行状态见末节。用户授权最终必需测试门通过后发行。候选标签 `v-npm-0-166-97`、`ide-vscode-v0.37.141`、`ide-jetbrains-v0.4.159` 在准备时均未存在，不移动旧标签。

全部 13 子包完整源码树与 `da91e730d802b7c9dcdc075b222ecc257021e552` 一致，本地 npm pack 与实际公开 tarball 原字节一致，可沿用已发布版本；[原始摘要](./children-summary.json.gz)及[清单](./preparation.json)保留字节绑定。本地结果不是 OIDC provenance 或最终 SHA CI 的替代。SDK vendor 实际重建无 tracked 差异。局部 CLI 35、VS Code 22、JetBrains 14 版本相关测试通过；JetBrains 指定既有 Java 21 后成功。

最终准确 SHA 须 CLI CI、CLI Strict Sandbox 三平台完整门，IDE Extensions 主宿主/浏览器/构建门与独立 ARM64 完整 aggregate。通过后推 immutable CLI tag，由 GitHub Actions OIDC 校验/复用子包、公开来源和 registry-only 安装后发布 CLI；公开 CLI 可取且配对正确后才推 IDE 标签。Open VSX 回读真实 VSIX；JetBrains 绿色上传但 pending 时仍未公开。默认渠道沿用 Open VSX/JetBrains，不新增 Microsoft Marketplace 发布。

本轮 native 根坐标诊断与[正式未完成边界](../root-coordinates-2026-10-10/README.md)分开，36+9/NOT_RUN、$99、observations、旧矩阵及 durable/账号/人工/长时状态不因发行改变。

首轮候选 `17e1e05420c5dc5c1afbc1ec25d47b3d836d83a8` 的常规 CI Windows 原生授权用例和 Windows loopback 失败，见[原件和修复清单](./prepublish-attempt1/manifest.json)。Strict 5/5、ARM64 10/10 只对应这个 SHA；后续提交必须重跑。桌面测试仅单例 30 秒功能预算/阶段诊断，loopback 仅持久保留固定错误类，局部 20/20、23/23；未复现原 SQLite 慢阶段，未确认 loopback 底层原因，不能写成两个生产问题已修复。

## 2026-10-11 发行状态

发行源码 `22ef588c1bb8f71c45feaa115df1d75d5ca505c5` 的CLI CI 71/71、Strict5/5、IDE18必需项、独立ARM64 10/10全部通过。OIDC发布run `38094605922` 成功，CLI `0.166.97` 公开可取并独立回读验证；13子包公共字节与registry安装来源绑定，SDK `0.2.14`沿用同源码tree旧签名来源。CLI 公开回读后才推送两端 IDE 的不可变标签；Open VSX `0.37.141`（run `38095423362`）与 JetBrains `0.4.159`（run `38095423253`）发布矩阵正在运行，尚未确认市场上传或公开安装。

见[总索引](./final-release/manifest.json)、[59份CI原件索引](./final-release/ci/manifest.json)及[公开CLI来源回读](./final-release/public/npm/readback.json)。公开安装回读使用ignore-scripts；所有大二进制保留在.work，提交原件清单与SHA256绑定，不声称本机再次验签或native功能。正式 36 tasks + 9 firstRuns、$99 和 observations 保持 NOT_RUN/INSUFFICIENT_EVIDENCE；旧 Windows 211=194/16/1、mutants 6/4/4 以及新 fixture 211=208/2/1 均未改写，完整 native review 继续 NOT_ADMITTED。Windows/macOS durable、受保护 journal、服务自身恢复/WFP、正式目标宿主、官方 usage/账单、独立人工/辅助技术与 8h/24h/SLO 仍开放。本轮无付费 provider 调用，草稿 PR #428 未合并。
