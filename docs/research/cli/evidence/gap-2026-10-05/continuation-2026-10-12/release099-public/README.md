# .99 CLI 与双 IDE 公开发行回读

源码：`311e01a5ec34a8e433c7abde0e4b6b05bce4513b`。14份公开npm制品、CLI准确OIDC来源与不可变Actions tarball、13子包可信复用来源及registry-only安装回读通过；双IDE公开包与本次tag制品核对通过。原API、Actions archive摘要、实际公开下载、provenance与安装合同见[summary.json](./summary.json)和[manifest.json](./manifest.json)。

| 发布端                | 版本     | Actions run                                                                              | 公开状态                                                     |
| --------------------- | -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| CLI / npm             | 0.166.99 | [38231920482](https://github.com/chainlesschain/chainlesschain/actions/runs/38231920482) | 公开下载与来源回读通过                                       |
| VS Code / Open VSX    | 0.37.143 | [38234861662](https://github.com/chainlesschain/chainlesschain/actions/runs/38234861662) | 公开VSIX及canonical制品核对通过                              |
| JetBrains Marketplace | 0.4.161  | [38234862629](https://github.com/chainlesschain/chainlesschain/actions/runs/38234862629) | 已approved/listed且hidden=false，公开下载逐entry字节核对通过 |

正式36+9仍NOT_RUN/observed=0/$99；发布不代替真人/账单/合规宿主/native/durable/8h/24h/SLO验收。npm安装回读禁用lifecycle scripts，仅核对公开来源和依赖身份。VS Code此处为既定Open VSX渠道，官方Visual Studio Marketplace没有被此tag流程发布。旧fdead macOS失败保留，未增加真实付费provider调用。
