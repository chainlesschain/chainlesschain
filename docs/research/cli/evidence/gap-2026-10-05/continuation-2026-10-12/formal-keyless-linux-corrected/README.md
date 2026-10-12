# 修后实际 Linux 预检与新审阅包

准确 **07f050be901dd806f68ccb3ddb8eee12ad7a5254** 的 [run38272128731](https://github.com/chainlesschain/chainlesschain/actions/runs/38272128731) 已 completed/success：真实 Ubuntu24.04.5 x64 / Node22.12.0、固定项目 b2aa3aba082873570e85dce39b00754e5504ff37、正常公开CLI0.166.99安装、原始 lock/10个直接子包身份与版本、实际 Docker node image启动，以及完整72脚本生成均通过。

修补第34题check的候选baseline遗漏后，新reviewDigest为 `sha256:d333e5826d9ca77b3e635fdf686716519ae2431528b625ac92389667ae10c22f`，runtimeDigest为 `sha256:dc34539305ce48372d9848c5fcc61f1336d116623e5a4b997f9cd13069baf267`；实际image ID仍为 `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da`。新runtime与准确Git blob及72脚本均核验一致。用户授权Astra替代人工后，[新包36项审阅](../astra-authorized-review/README.md)已通过；旧70bf包CHANGES_REQUIRED保留，旧批准不能移用于新包。

[linux-review-pack.tgz](./linux-review-pack.tgz)保留全部75原文件，逐文件hash、真实readiness/API/ZIP/日志/安装及镜像回执见[summary.json](./summary.json)与[32份双摘要原件](./manifest.json)。原run生成时 `authorizedAiReviewAccepted:false`，后续Astra外部签核单独绑定新pin，不改写原回执。

机械collection以原process Buffer归档，exit2、reviewValidated=true、observed=0；预检没有模型认证或任务/first-run。正常安装/版本回执不代表native SQL功能，72脚本未在本run作为实际task checker运行；Windows/macOS和GUI另验。全CI/发行门仍须最终候选自己的准确矩阵；公开CLI.99不因此被改造成新源码。
