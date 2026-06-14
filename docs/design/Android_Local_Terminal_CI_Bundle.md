# Android Local Terminal — CI 构建 + Bundle 后续设计

> 状态：📐 设计中（2026-05-18）
> 关联：[`Android_Local_Terminal.md`](Android_Local_Terminal.md) Phase 5 / [`local-terminal-bundle.yml`](../../.github/workflows/local-terminal-bundle.yml)
> 前置：Phase 0-4 已落地，Phase 4 真机 verified（commit `ebf27fc9c`）

## 0. 为什么需要这份 doc

Windows host dev box 无法 cross-compile：
- **toybox** — 需 HOSTCC（kconfig 解析器 + scripts/genconfig 必须以 host gcc 编出 host 可执行）
- **Node.js** — 需完整 GCC 工具链 + Python 3 + ICU data 处理
- **git / python / vim / openssh** —（Phase 5 Full 变体）需各自的 Linux build chain

Linux CI runner（GitHub Actions ubuntu-latest）天然具备这些工具。本 doc 把 Phase 5 的 native bundle 工作落到 CI 工作流上，避免反复折腾 Windows host 工具链。

## 1. 已经做的 — `local-terminal-bundle.yml`

`<repo>/.github/workflows/local-terminal-bundle.yml`：

- **触发**：push to main / PR + paths 命中 `feature-local-terminal/**` 或 `third_party/{mksh,toybox}/**`；manual dispatch
- **runner**：ubuntu-latest
- **步骤**：
  1. setup JDK 17 + Android SDK + NDK 25.2.9519653
  2. `./gradlew :feature-local-terminal:assembleRelease`
  3. 硬 gate 验 9 个 .so 都产出（3 ABI × {mksh, toybox, pty_jni}）
  4. `file` 命令验 ELF 架构（arm64 → ARM aarch64; armv7a → ARM ARM,; x86_64 → x86-64）
  5. upload 完整 native bundle 为 artifact `local-terminal-native-bundle`
  6. GITHUB_STEP_SUMMARY 表格

这一层确认 toybox 在 Linux 真编出来。`:app:assembleDebug` 在 CI 上跑同样的 CMake path（之前的 android-build.yml 也会跑 toybox build），但本 workflow 用 artifact 显式 expose 让运维可下载 inspect。

## 2. 仍欠的 — Node.js + chainlesschain CLI bundle

### 2.1 Phase 2.5 deferred → Phase 5 CI 任务

设计 doc §4 Sub-phase 2.5 描述了：

```
- vendor Node.js LTS（v20.x）Android 交叉编译产物作为 libnode.so + symlink $PREFIX/bin/node
- bundle chainlesschain@<latestAtBuildTime> 的 npm pack tarball 进 assets/cc-cli-snapshot.tar.xz
- Bootstrapper 首启额外步骤：extract Node.js / npm / chainlesschain
- 写 $PREFIX/var/lib/cc/.bundled-version 记录 snapshot 版本
```

到现在仍未实施。CI 优先策略下，这条线变成 3 个 CI 子任务：

### 2.2 子任务 A — Node.js Android 交叉编译

**候选路径**（按从轻到重排序）：

#### A1：直接 vendor Termux 现成 nodejs.deb

- Termux apt 仓发布 https://packages.termux.dev/apt/termux-main/pool/main/n/nodejs/，arm64-v8a Architecture
- `.deb` 解开有 `data/data/com.termux/files/usr/bin/node` ELF + 配套 .so 一堆
- **chokepoint**: ELF 用 DT_RUNPATH 写死 `/data/data/com.termux/files/usr/lib`，跟我们 `$PREFIX = /data/data/com.chainlesschain.android.debug/files/usr` 不匹配
- **修法**：用 `patchelf --set-rpath '$ORIGIN/../lib'` 改成相对路径；ICU data 文件名 `libicudata.so.NN` shipped 在同一目录即可
- 工作量：~半天 CI script
- 风险：Termux build 跟随上游可能有未文档化的 path 假设（NODE_PATH / openssl certs / hsperfdata）

#### A2：vendor `nodejs-mobile` GitHub release

- https://github.com/nodejs-mobile/nodejs-mobile 提供 .so + headers，用于 React Native 嵌入 Node 运行时
- 形态：libnode.so（共享库）不是独立 CLI；需要自己写一个最小 host 程序调 `node::Start()` 入口
- **chokepoint**：要 ~150 行 C++ host + main.cpp 包 argv 转 Node API
- 工作量：~1 天 C++ host + CI 集成
- 风险：API breaks 时需跟版本；不像独立 CLI 那样开箱即用

#### A3：upstream nodejs 完整 cross-compile（official path）

- `./configure --dest-cpu=arm64 --dest-os=android --cross-compiling` + GN-based build
- CI runner 跑 ~30-45 分钟（Node.js 大）
- **chokepoint**：upstream Node 对 Android 支持是"unofficial"，每个新 version 都可能 break；need maintained patches
- 工作量：~2 天 first-time setup + CI workflow + 定期 rebase patches
- 风险：高，可能需要长期维护

**推荐：A1 路径**。半天工作量，binary 现成稳定（Termux maintainers 持续 build），patchelf 改 RUNPATH 是已知技术。

### 2.3 子任务 B — chainlesschain npm pack 集成

简单很多：

```bash
cd packages/cli
npm pack --pack-destination ../../android-app/feature-local-terminal/src/main/assets/local-terminal-extras/
# 产 chainlesschain-X.Y.Z.tgz
```

CI workflow 在 publish-cli job 后串一个：
1. Wait for `npm publish chainlesschain@<version>` 完成
2. `curl -fsSL https://registry.npmjs.org/chainlesschain/-/chainlesschain-${VERSION}.tgz -o cc-cli-snapshot.tgz`
3. 写一个 ChainlessChain Android 资产更新 PR / commit

或者更简单：每次 Android 发版前在 release.yml build-android job 加：
1. `npm pack --pack-destination android-app/feature-local-terminal/src/main/assets/local-terminal-extras/ chainlesschain@latest`
2. Gradle assembleRelease 把它打进 APK

工作量：~2-3h CI script。

### 2.4 子任务 C — Bootstrapper 解压 Node + cc CLI

`LocalFilesystemBootstrapper.kt` 加方法：

```kotlin
private suspend fun bootstrapCcCli() {
    val extrasDir = File(prefixDir, "var/lib/cc")
    extrasDir.mkdirs()

    // 1. Extract Node.js binary + libs (from APK lib/<abi>/ symlinks we
    //    already create + extra .so files for ICU etc.)
    // 2. Extract chainlesschain snapshot tarball from assets/local-terminal-extras/
    val snapshotIn = context.assets.open("local-terminal-extras/cc-cli-snapshot.tgz")
    extractTgz(snapshotIn, File(prefixDir, "lib/node_modules/chainlesschain"))

    // 3. Symlink $PREFIX/bin/cc → ../lib/node_modules/chainlesschain/bin/chainlesschain
    val ccLink = File(prefixDir, "bin/cc")
    Files.createSymbolicLink(
        ccLink.toPath(),
        Paths.get("../lib/node_modules/chainlesschain/bin/chainlesschain")
    )

    // 4. Record bundled version
    File(extrasDir, ".bundled-version").writeText(BuildConfig.CC_CLI_VERSION)
}
```

需 `commons-compress` 依赖（tgz 解压；当前我们用 tukaani:xz 但 .tgz 不是 .tar.xz，需 gzip 解压）。或者改用 `org.tukaani:xz` + 手写 gzip （也 OK，Java util 自带 GZIPInputStream）。

PtyEnvironment.envp 加 `NODE_PATH=$PREFIX/lib/node_modules`（让 Node 找到全局包）+ 确保 `PATH=$PREFIX/bin:...` 已有。

工作量：~半天 Kotlin。

### 2.5 子任务 D — Phase 5.7 auto-update WorkManager

设计 doc 已详 §4 Sub-phase 5.7。等 A+B+C 都落地后再做（依赖关系：A → C 才能跑 npm install）。工作量 1-1.5 天（独立 phase）。

## 3. 时间线建议

| 节点 | 工作 | 工作量 |
|---|---|---|
| **Now** | `local-terminal-bundle.yml` workflow + 本 doc | done |
| Week 1 | 子任务 A1：Termux nodejs.deb + patchelf script | ~0.5 天 |
| Week 1 | 子任务 B：chainlesschain npm pack 集成（GHA） | ~0.5 天 |
| Week 1 | 子任务 C：LocalFilesystemBootstrapper.bootstrapCcCli | ~0.5 天 |
| Week 1 | 真机验证 `cc -v` 在终端可调 | ~0.5 天 |
| Week 2 | Phase 5.7 auto-update WorkManager + Settings toggle | ~1.5 天 |
| Week 2 | Phase 5.4 git/python/vim/openssh 大件包（独立 Full 变体） | ~2-3 天（仍 CI 跑） |

## 4. Open questions

| # | 问题 | 推荐 |
|---|---|---|
| OQ-1 | Node.js 选哪条路 | **A1 Termux nodejs.deb + patchelf**（最省工作量） |
| OQ-2 | cc-cli-snapshot 是 tgz 还是先解开放 assets | 解开放 + 写 manifest 索引文件——避免运行时 IO + 容易 incremental check |
| OQ-3 | NODE_PATH 设全局 vs per-VM | 全局（让所有 mksh session 共用） |
| OQ-4 | ICU data 升级 vs Node 升级 | 同步——Termux 的 Node + ICU 通常匹配，分开升级会 break |

## 5. 风险

| 风险 | 概率 | 影响 | mitigation |
|---|---|---|---|
| Termux nodejs binary RUNPATH patch 后 ICU data lookup 失败 | 中 | Node 起不来 | 用 `ldd` + `strace` debug；fallback 是 LD_LIBRARY_PATH env 而非 patchelf |
| `chainlesschain@latest` 引入新 native dep (better-sqlite3 等) | 低 | cc CLI 部分子命令 fail | 测试 `cc -v` + 关键 subcommand 在真机 |
| Termux upstream rebrand Node 路径 | 低 | A1 路径失效 | fallback 切 A2 (nodejs-mobile) |
| Node 启动慢（>500ms 首启） | 高（已知 problem） | UX 慢 | 用 V8 snapshot；Phase 5.7 工程做 |

## 6. 实施次序总结

```
graph TD
  W[local-terminal-bundle.yml ✅] --> A1[A1: Termux Node patchelf script]
  A1 --> B1[B: chainlesschain npm pack 集成]
  B1 --> C1[C: Bootstrapper.bootstrapCcCli]
  C1 --> D1[真机 cc -v 验证]
  D1 --> E1[Phase 5.7 auto-update]
  D1 --> F1[Phase 5.4 大件包]
```

`local-terminal-bundle.yml` 提供 toybox 这一脚（已 done）。下一步 A1 是工作的关键节点。

## 附录：规范章节补全（v5.0.3.108）

> 本文为设计文档。为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述

见正文「0. 为什么需要这份 doc」。本文规划 Android Local Terminal 的 CI 构建 + Bundle 后续：把 Node.js + chainlesschain CLI 交叉编译并随 APK 打包，由 Bootstrapper 解压运行。

### 2. 核心特性

`local-terminal-bundle.yml`（toybox 已 done）；Node.js Android 交叉编译（A1/A2/A3 三方案）；cc npm pack 集成；Bootstrapper 解压。

### 3. 系统架构

见正文流程图（CI build → bundle → Bootstrapper.bootstrapCcCli → 真机 cc -v 验证）；关联 `Android_Local_Terminal.md` Phase 5。

### 4. 系统定位

Android 本地终端的**CI 构建与运行时 bundle 设计**（Phase 5 CI 任务）。

### 5. 核心功能

见正文：子任务 A（Node.js 交叉编译）/ B（cc npm pack 集成）/ C（Bootstrapper 解压）。

### 6. 技术架构

GitHub Actions `local-terminal-bundle.yml`；toybox + Node.js（vendor Termux / nodejs-mobile / official cross-compile）；cc CLI tarball。

### 7. 系统特点

Phase 0–4 已落地（Phase 4 真机 verified `ebf27fc9c`）；A1（vendor Termux nodejs.deb）是关键节点。

### 8. 应用场景

Android 端内置本地终端 + cc CLI 运行环境。

### 9. 竞品对比

见正文 A1/A2/A3 三方案权衡（vendor 现成 vs 官方 cross-compile）。

### 10. 配置参考

见 `.github/workflows/local-terminal-bundle.yml`；bundle 解压路径见 Bootstrapper。

### 11. 性能指标

bundle 体积 / 解压时长为关键约束（见正文子任务 C / 大件包 Phase 5.4）。

### 12. 测试覆盖

真机 `cc -v` 验证（见正文流程图）；Phase 4 真机 verified。

### 13. 安全考虑

随 APK 打包二进制，需 W^X / extractNativeLibs 适配（见 `Android_Local_Terminal.md`）。

### 14. 故障排除

Node 交叉编译 / W^X execve 失败 → 见 `Android_Local_Terminal.md` 8 traps。

### 15. 关键文件

`.github/workflows/local-terminal-bundle.yml`；Bootstrapper.bootstrapCcCli。

### 16. 使用示例

见正文 CI 任务与 Bootstrapper 解压步骤。

### 17. 相关文档

见正文头部关联：`Android_Local_Terminal.md`（Phase 5）、`local-terminal-bundle.yml`。
