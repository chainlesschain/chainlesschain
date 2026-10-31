# CLI 0.166.136 与 IDE 公开状态

CLI **0.166.136** 从 539e4da6ef89e5142a3f3bb90e2d6123c6afb15e 通过 CLI CI 76 项、Strict Sandbox 6 项、Actions OIDC 发布和独立公共包字节/签名回读。无效/缺失来源签名均为 0。发布 41206368406，独立回读 41241946884；回执见 gates.json、cli.json、provenance.json。

Open VSX **0.37.173** 保持已核验公开。JetBrains **0.4.189** 已批准、已上架且未隐藏，公开 ZIP 中全部两个 JAR 与正式构建逐字节一致，无新增或缺失文件；ZIP 容器自身的哈希不同，未记为整包字节一致。原始 JAR 摘要、公开/正式 ZIP 摘要、原始发布来源 82aa6d703a8695721a7ccf0793a435853bc2bbf2 及商店下载地址见 jetbrains-public.json、jetbrains-container.json。

本轮是 CLI 修复，IDE 沿用既有包；两个插件推荐标记仍为 CLI **0.166.135**，测试实际使用 CLI **0.166.136**。Kernel **0.1.11**；Microsoft Marketplace 与 PC/mobile 不属于此次发布。仅五项失败模型复测另行记录，发行和工程回归不增加其验收成绩。
