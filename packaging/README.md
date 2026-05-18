# ChainlessChain 桌面端打包指南 - 快速参考

> 适用于 Windows / macOS / Linux 三端。当前桌面 `1.1.0-alpha`（产品线 `v5.0.3.7`，CLI `0.161.2`）。
>
> 本目录下的早期文档（`INDEX.md` / `WINDOWS_PACKAGE_DESIGN.md` / `CURRENT_STATUS.md`，2025-01）描述的是 v0.16.0 时代基于 **Electron Forge + `build-windows-package.bat`** 的方案——脚本已不存在，整套流程已被下面的 **electron-builder + `cc pack`** 取代。下面是现行的口径。

## 🚀 一键构建（现行）

### 桌面 App（electron-builder，CI 同款）

```bash
cd desktop-app-vue
npm install
npm run make:win:builder       # Windows: NSIS 安装包 + Portable .exe
npm run make:mac:builder       # macOS:  DMG (x64 + arm64)
npm run make:linux:builder     # Linux:  AppImage / .deb / .rpm
npm run release:builder        # 走 scripts/release.js（含 docs:generate + 校验）
npm run release:builder:draft  # 同上但 GitHub release 留草稿
npm run release:verify         # 仅运行 verify-release-artifacts.js（产物自检）
```

每条 `make:*:builder` 内部展开为 `electron-builder --<plat> --config electron-builder.yml --publish never`。CI 上 `release.yml` 走 `--publish never` 后由 `gh release upload` 单独上传，保证不依赖 `GH_TOKEN`。

### CLI 项目模式（`cc pack`，多平台 + OTA）

```bash
cc pack --project <dir> --target win|mac|linux|all
cc pack check-update           # OTA 检查
cc pack apply-update --sha256  # SHA-256 校验 + 自替换
```

`cc pack` 是 CLI v0.156→v0.161 落地的多平台打包路径，覆盖 macOS / Windows / Linux + 项目模式 Phase 2a / 2b / 3a / 3b（见仓库根 `CLAUDE.local.md` 的"`cc pack --project` 模式"段）。

输出：
- electron-builder：`desktop-app-vue/out/build/`（如 `ChainlessChain-Setup-1.1.0-alpha.exe` / `ChainlessChain-Portable-1.1.0-alpha.exe` / `ChainlessChain-1.1.0-alpha.dmg` / `ChainlessChain-1.1.0-alpha.AppImage` / `.deb` / `.rpm`），自动产出 `*.blockmap` + `latest*.yml`（差分更新 sidecar）
- `cc pack`：项目模式输出在 `<dir>/dist/`，含 SHA-256 manifest

---

## 📁 文件结构

```
chainlesschain/
├── desktop-app-vue/
│   ├── electron-builder.yml          # 现行打包配置 ✅
│   ├── forge.config.js               # 遗留 Electron Forge 配置（保留）
│   ├── scripts/
│   │   ├── release.js                # release / release:builder 总入口
│   │   ├── verify-release-artifacts.js  # 产物自检（blockmap / latest yml）
│   │   └── ensure-ops-playbook-description.js  # 运维手册描述同步
│   └── src/main/
│       ├── index.js                  # 已合入后端服务管理器集成
│       └── backend-service-manager.js
├── packaging/
│   ├── README.md                     # 本文件
│   ├── docs/                         # 早期 forge 时代文档（v0.16，部分仍可参考）
│   │   ├── INDEX.md                  # 旧版文档索引
│   │   ├── BUILD_INSTRUCTIONS.md     # 详细构建说明
│   │   ├── WINDOWS_PACKAGE_DESIGN.md # 早期设计文档
│   │   ├── CODE_SIGNING_GUIDE.md     # 代码签名指南
│   │   ├── DOCKER_PACKAGING_GUIDE.md # Docker 离线打包
│   │   ├── DOCKER_OFFLINE_PACKAGING.md
│   │   ├── RELEASE_GUIDE.md          # 发布流程
│   │   ├── AUTOMATED_RELEASE_SYSTEM.md
│   │   └── ...                       # 其它历史快照文档
│   ├── docker-compose.production.yml
│   ├── scripts/                      # 服务管理 / 发布脚本（部分仍可用）
│   │   ├── start-backend-services.{bat,sh}
│   │   ├── stop-backend-services.{bat,sh}
│   │   ├── check-services.{bat,sh}
│   │   ├── check-components.{bat,sh}
│   │   ├── release-local.{bat,sh}
│   │   └── bump-version.sh
│   ├── jre-17/  postgres/  redis/  qdrant/   # （需下载，仅完整离线包需要）
│   └── config/                                # 自动生成
└── .github/workflows/release.yml     # CI: build → verify → upload
```

---

## ✅ 构建前检查清单

### 必需

- [x] Node.js 18+ → `node --version`
- [x] npm 10+ → `npm --version`
- [x] `cd desktop-app-vue && npm install`（root workspaces 也会一起拉）

### 可选（仅完整离线包需要）

- [ ] Java JDK 17 / Maven → 用于构建 `backend/project-service/target/project-service.jar`
- [ ] PostgreSQL 16 / Redis 5 / Qdrant 1.7+ / JRE 17 portable 解压到 `packaging/<svc>/`

> 跑 `npm run make:*:builder` 只打桌面 app；不依赖上述离线组件。要做"自包含安装包（含后端）"时才需要它们，此时参考 `docs/BUILD_INSTRUCTIONS.md` / `docs/DOCKER_OFFLINE_PACKAGING.md`。

### 第三方组件下载（仅完整离线包）

| 组件 | 下载 | 解压到 |
|------|------|--------|
| PostgreSQL 16 | https://get.enterprisedb.com/postgresql/postgresql-16.1-1-windows-x64-binaries.zip | `packaging/postgres/` |
| Redis 5.0.14.1 | https://github.com/tporadowski/redis/releases | `packaging/redis/` |
| Qdrant 1.7.4 | https://github.com/qdrant/qdrant/releases | `packaging/qdrant/` |
| Temurin JRE 17 | https://adoptium.net/temurin/releases/?version=17 | `packaging/jre-17/` |

---

## 🔧 后端服务集成（已就绪）

`desktop-app-vue/src/main/index.js` 已在 [`083aa10eb`](../) 合入下列改动，无需手动 patch：

- `getBackendServiceManager()` 导入
- `app.on('will-quit')` 优雅停止后端服务
- `onReady` 启动后端服务
- 两个 IPC: `backend-service:get-status` / `backend-service:restart`

实现见 `desktop-app-vue/src/main/backend-service-manager.js`，集成说明保留在 `desktop-app-vue/src/main/backend-integration.patch.js`（仅供参考）。

---

## 📦 构建输出

```
desktop-app-vue/out/build/
├── ChainlessChain-Setup-<version>.exe       # Windows NSIS 安装包
├── ChainlessChain-Setup-<version>.exe.blockmap
├── ChainlessChain-Portable-<version>.exe    # Windows 免安装版
├── ChainlessChain-<version>.dmg             # macOS x64
├── ChainlessChain-<version>-arm64.dmg       # macOS arm64
├── ChainlessChain-<version>.AppImage        # Linux AppImage
├── chainlesschain-desktop-vue_<version>_amd64.deb
├── chainlesschain-desktop-vue-<version>.x86_64.rpm
└── latest{,-mac,-linux}.yml                 # electron-updater 元数据
```

`<version>` = `desktop-app-vue/package.json` 的 `version`，当前 `1.1.0-alpha`。`artifactName` 模板见 `electron-builder.yml`。

---

## 🐛 常见问题

### Q: `npm run make:win:builder` 在原生模块（better-sqlite3 等）上 node-gyp 失败？

A: `electron-builder.yml` 已设 `npmRebuild: false`，App 启动设置 `CHAINLESSCHAIN_DISABLE_NATIVE_DB=1` 走纯 JS 路径（sql.js WASM fallback），通常不会触发原生重建。如果 fork 自己改了配置，先排查这两处。

### Q: macOS DMG / Linux .deb 构建在 CI 上提示 ENOENT / 缺图标 / 缺 maintainer？

A: v5.0.3.x 一系列 fix 已收口（commits `8c0dc5e8f` / `cf29f2ef1` / `8d5890bfd` / `b050abafd`）。本地复现先 `git pull`、删 `out/`、`node_modules/` 重装。

### Q: 安装后启动报错"Cannot find module 'call-bind-apply-helpers'"（或类似 Express@5 拆出的细包）？

A: 这是 v5.0.3.6 之前的 npm workspaces hoist 陷阱——`desktop-app-vue/node_modules/` 里没有这些细包，全 hoist 到了根 `node_modules/`，于是 `electron-builder.yml` 的 `files: node_modules/**/*` 漏掉它们，ASAR 缺包。修复在 `496d21708` / `f92505fb4` / `1c8d0994d` / `a84284eb6`：lockfile 同步 + 物理位置校验 + dev 端 prune broken hoisted bin shims。本地构建前先 `npm install` 看 lockfile 不要漂。

### Q: CLI 发布流水线 `vitest` IPC RPC timeout / saturation？

A: `release.yml` / `publish-cli.yml` 走 `--no-file-parallelism` + 静默 vitest + 分批跑集成测试（`5d3a3dc49` / `c2746e41b` / `b68fff118` / `4e50d9691`）。如果手动跑 publish 想跳过测试可用 `feat(ci): skip_tests input`（`24427e4c8` / `8d2defd90`）。

### Q: 如何调试构建问题？

A: 按下面顺序逐步定位：
1. `cd desktop-app-vue && npm run release:verify`（产物自检）
2. 检查 `out/build/` 里 `*.blockmap` + `latest*.yml` 是否齐全
3. 看 `electron-builder` stdout（默认非常详细）
4. 走 `release:builder:draft` 做一次干跑

---

## 📚 文档索引

- **本文件** `README.md` — 现行入口
- **设计 / 旧方案**: `docs/WINDOWS_PACKAGE_DESIGN.md`、`docs/BUILD_INSTRUCTIONS.md`（v0.16 时代 Electron Forge 方案，部分章节仍可参考）
- **代码签名**: `docs/CODE_SIGNING_GUIDE.md`
- **Docker 离线包**: `docs/DOCKER_PACKAGING_GUIDE.md`、`docs/DOCKER_OFFLINE_PACKAGING.md`
- **发布流程**: `docs/RELEASE_GUIDE.md`、`docs/AUTOMATED_RELEASE_SYSTEM.md`
- **CI**: `.github/workflows/release.yml`、`.github/workflows/publish-cli.yml`

---

## 🔄 下一步

### 立即可做

1. ✅ `cd desktop-app-vue && npm install`
2. ✅ `npm run make:<plat>:builder` 试跑一次
3. ✅ `npm run release:verify` 校验产物
4. ✅ 走完 `release:builder:draft` 完整流水

### 进阶优化

- [ ] 配置代码签名（Apple Developer / Windows EV cert / `CODE_SIGNING_GUIDE.md`）
- [ ] 接入 macOS notarization（先实现 `desktop-app-vue/scripts/notarize.js`，再回填 `afterSign`）
- [ ] electron-updater 自动更新接通（差分包已开 `differentialPackage: true`）
- [ ] 优化安装包大小（开 `compression: maximum` + 收紧 `files:` 排除规则）
- [ ] Linux AppImage / .deb / .rpm 的存储库托管（apt/yum repo）

---

## 📞 技术支持

- 问题反馈: https://github.com/chainlesschain/chainlesschain/issues
- 讨论区: https://github.com/chainlesschain/chainlesschain/discussions

---

## ⚠️ 重要提示

### 生产环境部署前

1. **安全审计**: 依赖安全扫描、恶意软件扫描、代码签名验证
2. **性能测试**: 后端启动时间、CPU/内存/磁盘占用、并发用户
3. **兼容性**: Windows 10/11、macOS x64+arm64、主流 Linux 发行版
4. **备份恢复**: SQLCipher 数据库备份/恢复、IPFS Pin 迁移、加密强度

---

## 📝 版本历史

- **v5.0.3.6 / v5.0.3.7**（2026-05）— 修 npm workspaces 把 Express@5 transitive deps（call-bind-apply-helpers 等）hoist 到 root `node_modules` 导致 ASAR 缺包的发布陷阱：lockfile 同步 + nested `node_modules` 物理位置校验 + ci-release 强制失败 + dev 端 prune broken hoisted bin shims。
- **v5.0.3.5**（2026-05）— CLI 0.161.2 + MTC v0.6→v0.11 doc roll-up + 发布到 www / docs / design 三站。
- **v5.0.3.3**（2026-05）— productVersion v5.0.3.1 → v5.0.3.3 + CLI 标签同步；MTC v0.5 + libp2p gossipsub 联邦自发现 + Web Panel i18n 落地。
- **v5.0.3.x release-pipeline 硬化**（2026-04 → 2026-05）— electron-builder.yml 路径 / Linux .deb 元数据 / icon.ico 256x256 / `npmRebuild: false` / `--publish never` + `gh release upload` 拆分 / Linux AppImage blockmap 缺失降级为 warning / publish-cli `--no-file-parallelism` + 静默 vitest + 分批跑集成测试。
- **v5.0.3.4 / CLI 0.160.1**（2026-05）— LanguageSwitcher 进入 V6 AppShell + shell-preview topbar；`--no-web-shell` dev opt-out。
- **v0.16.0**（2025-01）— 初始打包方案：完全本地化部署、仅云 LLM、Electron Forge + `build-windows-package.bat`。该方案已被本文件描述的 electron-builder + `cc pack` 取代，原脚本不再随仓库分发。

---

## 📄 许可证

MIT License

---

**构建愉快！** 🎉
