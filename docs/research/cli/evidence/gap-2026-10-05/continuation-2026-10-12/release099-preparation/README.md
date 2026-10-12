# CLI0.166.99 / 双IDE候选准备与条件发布授权

用户明确授权“测试成功可以发布cli和ide版本”。候选CLI **0.166.99**、VS Code **0.37.143**、JetBrains **0.4.161** 已同步manifest、推荐CLI、lock、Java断言、README与changelog；VS Code显式test:unit清单已纳入6项窗口刷新回归。Windows完整VS Code单元 **266/266**，CLI发布合同相关 **67/67**；Overview/JetBrains metadata/公开capability三项校验通过。候选源 **4c46f3c7dd1fbe2003d89f5bce7ce0f49cf727e1** 的16份Git blob单独绑定，不把本地通过当成Actions完成。

Astra只读审计76项原件逐份再次核验：14份现有npm tarball公开fetch、SHA512 SRI与SHA1通过，13子包完整tree与e0d4一致，直接内部依赖准确版本及历史兼容范围均对齐，故不造新子包版或重复发布。候选CLI/OpenVSX版本及三tag均未出现；JetBrains公开列表无候选版本，不能排除vendor端hidden上传。已有0.166.98公开发行与真实首次旅程失败按原记录保留。原响应、tarball、tree、完整七门与OIDC审计见 [manifest.json](./manifest.json)。

新最终SHA须完整通过CLI CI、CLI Strict Sandbox、IDE Extensions、IDE ARM64、Memory Query Index、Context/Memory Kernel和Background Interaction七门及本轮适用CI/Host检查；macOS2s/100样本门不放宽。完成后才创建immutable npm tag，由Actions OIDC依赖顺序核对/复用子包、registry字节与签名provenance、发布CLI、公开安装回读，然后双IDE tag和公开制品回读。未tag、未发布、未进行新的真实模型调用；形式验收36+9/NOT_RUN/observed=0/$99、原指纹/窗口不变。
