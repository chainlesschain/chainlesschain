# CLI0.166.100 与双IDE的条件发行候选

用户再次明确授权“测试成功可以发布cli和ide版本”。候选CLI **0.166.100**、VS Code **0.37.144**、JetBrains **0.4.162** 已同步16份manifest/lock/推荐版本/Java断言/README/changelog，覆盖Retry-After、终态/可见输出重放、正式窗口和文档验收器原回归修复。未改子包版本。

Astra fresh回读14个公开npm tarball的SHA512 SRI/SHA1，与既有.99公开归档逐字节相同；13子包完整Git tree与公开source311e01相同，内部依赖准确版本/范围均对齐。CLI.99历史OIDC/provenance及不可变tarball摘要仅用于旧公开依赖来源核验，不作为.100新门。npm .100、OpenVSX .144及三tag没有公开冲突；JetBrains公开列表无.162，不据此排除vendor隐藏上传。

发布合同 **31/31**、changelog **14/14**，overview/JetBrains metadata/public capability三脚本通过；Prettier和diff通过。最初使用陈旧Vitest路径的准备失败原件保留，成功复跑使用root安装的Vitest。源码工作区16份元数据摘要、原registry/tarball、tree、碰撞回读、脚本及各轮reporter均见[summary.json](./summary.json)和[双摘要归档](./manifest.json)。这属于候选准备，不是发布完成。

最终发行提交须自己的完整CLI CI/Strict三系统门、IDE/ARM64/Memory Query/Kernel/Background Interaction，以及适用CI/Host检查。全部通过后，按既有Actions OIDC子包公开核验→CLI immutable tag发布和公开安装回读→双IDE tag及公开内容回读执行。当前未tag、未发布，旧源成绩不能转移；正式36+9仍单独判定。
