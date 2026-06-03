# Android 本地终端 — Termux 同等设计文档

> 状态：📐 设计完成，impl 未启（2026-05-18）
> 关联：[Android Remote Terminal Plan A.1](Android_Remote_Terminal_Plan_A1.md) / [iOS Phase 2 Remote Terminal](iOS_Phase_2_Remote_Terminal.md) / [Android Remote Operate Plan AB](Android_Remote_Operate_Plan_AB.md)
> 前置：本地终端是**全新功能**，与现有"远程终端"是两条独立链路。Remote Terminal = iPhone/Android 控桌面 shell；Local Terminal = Android 设备上跑自己的 shell，不依赖配对桌面，iOS 沙箱原理上不支持

## 0. TL;DR

把 Termux 的核心栈 — mksh shell + toybox 工具集 + 终端模拟 — 集成进 ChainlessChain Android app，让用户在手机上有完整 Linux shell 体验（git/python/vim 通过下载式包，Phase 5 落），但 UI 层复用现有 Remote Terminal 的 xterm.js WebView + Compose 壳，最低成本接通。

- **工作量**：3.5-5 周（一人全职），6 phase × sub-phase（含 §12 cc CLI 集成）
- **APK 增量**：双变体策略 — Lite ~50MB（mksh+toybox+**Node.js LTS+chainlesschain CLI**，arm64-v8a only）/ Full ~130MB（额外 bundle git/python/vim/openssh/curl）
- **默认 mobile CLI 体验**：`chainlesschain` npm 包预集成 + 启动时自动检查升级到最新（详见 §12）
- **入口**：`RemoteOperateScreen` 现有 5-tab segmented 加第 6 个 tab "本地"（Android only，iOS 隐藏）
- **License 风险**：repo MIT → 不能 bundle GPLv2 busybox / GPLv3 bash，改用 **toybox (0BSD) + mksh (MirOS BSD)**
- **NDK 版本**：锁 `25.2.9519653`（跟 `feature-ai/build.gradle.kts:14` 现有 ndkVersion 对齐，避免单 APK 双 NDK toolchain）
- **⚠️ 已知约束**：targetSdk = 35 排除了"运行时下载二进制到 $PREFIX/bin 后 exec"模型（Android 10+ W^X 拒 data dir exec）。Phase 5 必须 APK bundle，**禁止**运行时下载可执行 ELF

## 1. 背景

### 1.1 起源 — 用户提的"iOS CLI"实际是远程终端

`docs/design/iOS_Phase_2_Remote_Terminal.md` 5/15 落地的"iOS CLI"其实是 iPhone 走 WebRTC DataChannel 控桌面的 shell，**iPhone 上没有 shell**。Android 同款架构早就有（Plan A.1，5/14 真机 E2E 验证 `c47cbc649`）。

用户实际想要的 "Android 直接打开本地终端" 是 **全新的本地 shell** —— 不依赖配对桌面，手机自己能跑命令。这个 iOS 沙箱不允许（App Store 明确禁 fork+exec 任意二进制），Android 反而完全可行，因为 Android 允许 app 在自己 sandbox 内 exec。

### 1.2 为什么 Termux 同等而不是轻量 command runner

Phase-0 决策摘要（用户已拍板）：

| 方案 | 体验 | 工作量 | 选择 |
|---|---|---|---|
| Termux 同等（完整 shell + PTY） | vim/git/python/ssh 都能跑 | 3-6 周 | ✅ **本方案** |
| 轻量 command runner（`/system/bin/sh -c`） | 只能跑 toybox 内置 ~150 命令，无交互式 | 1-2 周 | ❌ |
| 调用外部 Termux app（Intent RUN_COMMAND） | 用户必须先装 Termux，跳出我们 app | 3-5 天 | ❌ |

### 1.3 与 Remote Terminal 共存

Remote Terminal（iOS Phase 2 / Android Plan A.1）在 `RemoteOperateScreen` 已有 5-tab segmented control（终端/文件/剪贴板/截屏/系统）。本方案在 Android 端加第 6 个 tab "本地"，iOS 端因沙箱不支持**隐藏**这个 tab（不是灰显，避免误导）。

```
Android RemoteOperate:
[ 终端 | 文件 | 剪贴板 | 截屏 | 系统 | 本地 ]
   ↑                                    ↑
   远程（控桌面）                          本地（控手机）

iOS RemoteOperate (no change):
[ 终端 | 文件 | 剪贴板 | 截屏 | 系统 ]
```

复用 xterm.js WebView：`Local` tab 内同一套 `TerminalWebView` 组件，**只切 backend** —— REMOTE mode = TerminalRpcClient（DC 发 stdin 到桌面 pty），LOCAL mode = LocalPtyClient（JNI 把 stdin 喂到本地 mksh 的 pty fd）。

## 2. 8 个开放问题决策

| OQ | 选项 | 决策 | 理由 |
|---|---|---|---|
| **OQ-1** 终端渲染层 | A. Compose AnsiTerminalView 原生 / **B. xterm.js WebView 复用** | **B** | 跟 Remote Terminal Plan A.1 同 UI 已验过 Xiaomi 24115RA8EC mid-range；省 4-5 天 Termux terminal-emulator 移植；JSON bridge stdout 序列化 latency 5-15ms 对交互式终端不可感知；Compose 原生方案的 <1ms latency 优势在手机 240Hz refresh 下无意义 |
| **OQ-2** shell 选型 | **A. mksh 单选** / B. bash / C. 都带 | **A** | mksh 500KB MirOS BSD（MIT 兼容），bash 4MB + GPLv3 viral（强反向感染整个 app license）。mksh POSIX + ksh88 兼容性覆盖 99% 用户脚本；用户写 `#!/bin/bash` 强依赖的可在 Phase 5 通过包源下载 bash |
| **OQ-3** 工具集 | A. busybox / **B. toybox** | **B** | repo LICENSE = MIT。busybox GPLv2 viral → 反向强制整 app GPL；toybox 0BSD（公有领域级宽松，无任何附加条件）。功能覆盖差异：toybox ~250 命令 vs busybox ~300 命令，缺的 sed/awk/find 高级特性可在 Phase 5 单独 vendor 全功能版（GNU sed 是 GPLv3 也不能 bundle，用 sbase BSD 替代） |
| **OQ-4** $PREFIX 初始化 | A. assets/usr.tar.xz 解压 / B. lib/<abi>/ 预铺 / **C. Hybrid** | **C** | Android 10+ targetSdk 29+ 强制 W^X：data dir 文件不可执行。binaries 必须放 `lib/<abi>/lib*.so`（必须 `lib` 前缀 `.so` 后缀，APK 安装时不会被剔，运行时 `extractNativeLibs=true` 解到 `/data/app/.../lib/<abi>/`）。**但 lib/ 只能装可执行 `.so`，不能装数据/symlinks/man/profile**，所以数据走 `assets/usr.tar.xz` 首启解压到 `$PREFIX = /data/data/com.chainlesschain.android/files/usr`。这是 Termux 实际的双轨方案 |
| **OQ-5** 大件包策略 | **A. APK Lite/Full 双变体** / B. 下载式自建包源 / C. Termux apt 仓 / D. 全砍 | **A** | **B/C 在 targetSdk 35 不可行**：下载到 `$PREFIX/bin/<binary>` 解压后 W^X 禁 exec（Termux 死守 targetSdk=28 的根因），proot/ptrace 走法被 SELinux untrusted_app 域封死。改双 APK 变体：Lite ~50MB（mksh+toybox+**Node.js LTS+chainlesschain CLI 默认集成**）；Full ~130MB 额外把 git/python/vim/openssh/curl bundle 到 `lib/<abi>/lib*.so`（W^X 白名单内）。**applicationId 分离**（`com.chainlesschain.android` Lite / `com.chainlesschain.android.full` Full，Play 商店不支持单 applicationId 双 listing），用户安装 Full 后 Lite 可保留共存；数据迁移作为 Phase 6+ 单独 ticket（Lite 的 `$HOME` export → Full import）。⚠️ Node.js 在两个变体都 bundle — `chainlesschain` 包是"默认 mobile CLI 体验"，详见 §12 |
| **OQ-6** 危险命令拦截 | **A. 不拦** / B. blacklist | **A** | 用户在自己 sandbox 内 `rm -rf $PREFIX` 是用户的权利；blacklist 永远 incomplete（`rm -r $HOME/../usr` 怎么写规则）。Settings 加 "工厂重置 $PREFIX" 按钮一键 wipe + 重新解压 |
| **OQ-7** /sdcard 访问 | A. 默认开 + MANAGE_EXTERNAL_STORAGE / **B. 分阶段** | **B** | Phase 1-3 默认 sandbox 只 `$HOME` 和 `$PREFIX` 内可读写，最小可用，无外部权限。Phase 4 Settings 加 toggle "允许访问外部存储"，开启时调起系统 `ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`。F-Droid 发版无障碍；Play 商店需准备 justification 说明 "full Linux shell on device"，做好被拒预案 |
| **OQ-8** iOS "本地" tab | **A. 隐藏** / B. 灰显 | **A** | iOS 沙箱根本不允许 `fork+exec` 任意二进制（含 dynamic linker `dyld` 拒绝 load 非系统库），灰显 tab 反而误导用户以为"未来会支持"。ChainlessChain 不是 Compose Multiplatform，iOS 是独立 Swift codebase — 实施时 iOS `RemoteOperateView` 的 `enum Tab` **编译期就不出现 .local case**（不是 runtime gate），Android Compose 端 `Tab.Local` 正常存在 |

## 3. 整体架构

### 3.1 模块布局

```
android-app/
├── feature-local-terminal/              ← 新 module（同级 feature-ai / feature-p2p）
│   ├── src/main/
│   │   ├── cpp/                         ← NDK 源
│   │   │   ├── CMakeLists.txt
│   │   │   ├── mksh/                    ← upstream mksh source（vendored）
│   │   │   ├── toybox/                  ← upstream toybox source（vendored）
│   │   │   ├── termux-exec/             ← Termux 的 LD_PRELOAD（vendored）
│   │   │   └── pty_jni.cpp              ← 自写 JNI 包装 openpty/fork/exec
│   │   ├── assets/
│   │   │   └── usr.tar.xz               ← $PREFIX 数据/配置/symlinks bundle
│   │   ├── kotlin/com/chainlesschain/android/localterminal/
│   │   │   ├── LocalPtyClient.kt        ← Kotlin 入口（Android only — iOS 独立 Swift codebase 无对应物）
│   │   │   ├── LocalFilesystemBootstrapper.kt
│   │   │   ├── LocalSessionViewModel.kt
│   │   │   ├── LocalTerminalScreen.kt   ← Compose UI（复用 xterm.js WebView）
│   │   │   └── ui/                      ← 输入栏 / 工具栏 / 多 session 切换
│   │   └── AndroidManifest.xml
│   └── build.gradle.kts                 ← externalNativeBuild CMake + ABI splits
│
└── app/
    └── src/main/java/com/chainlesschain/android/remote/RemoteOperateScreen.kt
                                         ← 加第 6 tab "本地"，引 LocalTerminalScreen
```

### 3.2 数据流

```
用户输入                                                   屏幕显示
   │                                                          ▲
   ▼                                                          │
[xterm.js WebView 输入]                                    [xterm.js WebView 渲染]
   │                                                          ▲
   │  JS bridge: postMessage("stdin", data)                   │ JS bridge:
   ▼                                                          │ webView.evaluateJavascript(
[LocalTerminalScreen JS bridge handler]                       │   "term.write(...)"
   │                                                          │ )
   ▼                                                          │
[LocalSessionViewModel.writeStdin(bytes)]              [LocalSessionViewModel.onStdout]
   │                                                          ▲
   ▼                                                          │
[LocalPtyClient.write(bytes)]                          [LocalPtyClient.readStdout (StateFlow<ByteArray>)]
   │                                                          ▲
   ▼  JNI                                                     │ JNI 监听线程
[pty_jni.cpp writePty(fd, bytes)]                      [pty_jni.cpp readPty(fd) → JNI callback]
   │                                                          ▲
   ▼                                                          │
[Linux kernel pty master fd]  ←→  [Linux kernel pty slave fd] ←→ [mksh child process]
                                                                     │
                                                                     ├── exec toybox/git/python via PATH
                                                                     └── $PREFIX/bin, $HOME = /data/data/.../files/home
```

### 3.3 与 Remote Terminal UI 的并存

```kotlin
// Android: RemoteOperateScreen.kt（既有 Compose，加第 6 tab）
@Composable
fun RemoteOperateScreen(viewModel: RemoteOperateViewModel) {
    val tabs = listOf(
        Tab.Terminal,
        Tab.File,
        Tab.Clipboard,
        Tab.Screenshot,
        Tab.SystemInfo,
        Tab.Local,         // Android only：iOS 端 RemoteOperateView 的 Tab enum 没这个 case
    )
    // ... segmented control ...
    when (selectedTab) {
        Tab.Terminal -> RemoteTerminalScreen(...)     // 既有
        Tab.Local    -> LocalTerminalScreen(...)      // 新
    }
}
```

UI 复用：`LocalTerminalScreen` 内复用 `RemoteTerminalScreen` 已有的 `TerminalWebView`（封装 xterm.js），**只是把 `onStdin` lambda 换成调 `LocalPtyClient.write` 而不是 `TerminalRpcClient.invoke("terminal.stdin")`**。

iOS 端 `Features/RemoteOperate/RemoteOperateView.swift` 的 `Tab` enum **编译期**就只有 5 个 case（不含 `.local`），不是 runtime gate — 避免误以为是 feature flag。

## 4. 实施计划 — 6 phase × sub-phase

每个 sub-phase 含：scope / 文件清单 / 单测 / 验收。

### Phase 0 — NDK 工具链 + mksh/toybox 编译（3-5 天）

#### Sub-phase 0.1 — feature-local-terminal module 骨架（0.5 天）

- 新建 `android-app/feature-local-terminal/`，仿 `feature-ai/build.gradle.kts` 结构
- **NDK 版本**：`25.2.9519653`（GitHub Actions ubuntu-latest preinstalled，跟 `feature-ai/build.gradle.kts:14` 对齐，避免单 APK 双 NDK toolchain）
- 配置 `externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt") } }`
- ABI splits：`arm64-v8a` primary + `armeabi-v7a` legacy + `x86_64` emulator（splits.abi.isEnable = true，universalApk = false）
- minSdk 26（继承 :app），compileSdk 35，targetSdk 35
- ⚠️ targetSdk 35 决定 binary 必须放 `lib/<abi>/lib*.so`（W^X 白名单），Trap 1 详述
- 验收：`./gradlew :feature-local-terminal:assembleDebug` 出 3 个 ABI 的 .so 目录（空）

#### Sub-phase 0.2 — vendor mksh + 交叉编译（1-1.5 天）

- 下载 mksh R59c upstream tarball（https://www.mirbsd.org/mksh.htm 或 Termux patches repo）
- 放 `src/main/cpp/mksh/`，加 Termux 的 Android-specific patches（PATH 默认值、`$PREFIX` 支持、`/system/etc/mkshrc` skip）
- CMakeLists.txt 加 `add_executable(mksh ${MKSH_SRCS})` + `set_target_properties(mksh PROPERTIES OUTPUT_NAME "libmksh.so")`
  - **关键**：output 必须 `lib*.so` 才能进 APK lib/ 目录通过安装时 W^X check
  - Set `LINK_FLAGS "-Wl,-soname,libmksh.so"` 避免 dlopen 二义性
- 验收：`adb push` 出的 libmksh.so 到设备 `chmod +x` 后 `./libmksh.so -c "echo hello"` 输出 `hello`

#### Sub-phase 0.3 — vendor toybox + 交叉编译（1-1.5 天）

- 下载 toybox upstream（https://github.com/landley/toybox）
- 放 `src/main/cpp/toybox/`，启用 Android NDK config（toybox 自带 `make android_defconfig`）
- 同样 output 为 `libtoybox.so`，runtime 通过 argv[0] 多用途分派（toybox 设计，`ln libtoybox.so ls` 调 ls）
- 验收：`adb shell` `./libtoybox.so ls /` 输出系统根目录

#### Sub-phase 0.4 — vendor termux-exec — **DEFERRED to Phase 5.4**（2026-05-18 决策）

**理由**：Phase 0-4 所有 exec 路径都是 LocalPtyClient 直接调 `libmksh.so` / `libtoybox.so`（绝对路径 + W^X 白名单 lib/<abi>/lib*.so），**不走 shebang**。termux-exec 唯一需要场景是 Phase 5 Full 变体 bundle git/python/vim 后，这些工具的 hashbang `#!/usr/bin/env python3` 需要重写到 `$PREFIX/bin/python3` 才能在 Android 上工作。

→ termux-exec vendoring + 编译挪到 **Sub-phase 5.4**（Full 变体打包同 phase），跟 git/python/vim bundle 一并接通。Phase 0 收口仅 mksh + toybox。

Note: termux-exec v2.4.0 上游已 refactor 成深层 package + 12 个 .c 文件 + Termux 专有 runtime conventions（不再是 v1.x 单文件），所以加进来时要预留 1-2h 集成。

#### Sub-phase 0.5 — Phase 0 收口集成测试（0.5 天）

- 写 instrumented test：拷贝 3 个 .so 到 testdata 目录，`Runtime.exec` 调起 mksh，发 `ls /` + `echo \$PATH`
- 验收：测试通过；APK 体积报告（基础 3 .so 约 4-6MB / abi）

### Phase 1 — JNI PTY + LocalPtyClient（5-7 天）

#### Sub-phase 1.1 — pty_jni.cpp 设计与实现（2-3 天）

- 写 `src/main/cpp/pty_jni.cpp`，导出 JNI 方法：
  - `nativeOpenPty(): IntArray`（返回 `[masterFd, slaveFd]`）
  - `nativeSpawn(slaveFd: Int, executable: String, args: Array<String>, env: Array<String>, cwd: String): Int`（用 **posix_spawn**，不用 raw fork+exec，详见 Trap 7。返回 child pid）
  - `nativeWrite(masterFd: Int, bytes: ByteArray)`
  - `nativeRead(masterFd: Int, buf: ByteArray, len: Int): Int`（阻塞读，调用方在 JNI 线程或 IO coroutine）
  - `nativeSetWinsize(masterFd: Int, rows: Int, cols: Int)`（TIOCSWINSZ ioctl）
  - `nativeKillpg(pid: Int, sig: Int)`
  - `nativeWaitpid(pid: Int): Int`（返回 exit status）
- 用 posix_openpt / grantpt / unlockpt / ptsname_r 打开 master/slave fd
- 子进程经 `posix_spawn` + `POSIX_SPAWN_SETSID` flag 创建（API 28+；API 26-27 fallback：spawn 后立即 `ioctl(slaveFd, TIOCSCTTY)`）
- 单测：22 cases（openpty 成功 / fd 唯一 / write 后 read 回环 / setWinsize / killpg 中断 / waitpid 收 exit status）

#### Sub-phase 1.2 — LocalPtyClient.kt Kotlin 包装（1-2 天）

- `class LocalPtyClient(private val coroutineScope: CoroutineScope)`
- API：
  ```kotlin
  suspend fun start(executable: String, args: List<String>, env: Map<String, String>, cwd: String): Result<Unit>
  fun writeStdin(bytes: ByteArray)
  val stdoutFlow: SharedFlow<ByteArray>  // replay = 0, extraBufferCapacity = 256
  val exitFlow: SharedFlow<Int>
  fun resize(rows: Int, cols: Int)
  fun shutdown()  // killpg SIGTERM + waitpid，5s 后 SIGKILL
  ```
- 内部用 `CoroutineDispatcher` 单线程跑 nativeRead 循环，每读到字节 emit 到 stdoutFlow
- **重要**：shutdown() 必须 killpg 整个进程组（killpg(-pid, SIGTERM)），子 mksh fork 出的孙进程才会被收掉
- 单测：18 cases（mock JNI）+ 3 instrumented（真 mksh 起停）

#### Sub-phase 1.3 — Phase 1 集成 smoke（0.5-1 天）

- 一个 instrumented test：从 APK 复制 libmksh.so → LocalPtyClient.start("/path/to/libmksh.so", []) → writeStdin("echo hello\n") → 断言 stdoutFlow 收到 "hello\n" 在 500ms 内
- 验收：smoke 通过

### Phase 2 — $PREFIX 文件系统 + bootstrap（3-5 天）

#### Sub-phase 2.1 — usr.tar.xz 构建脚本（1-1.5 天）

- 写 `feature-local-terminal/scripts/build-usr-tarball.sh`：
  ```bash
  # 输入：编好的 toybox binary
  # 输出：assets/usr.tar.xz，结构：
  usr/
  ├── bin/                # symlinks 指向 ../lib/libtoybox.so（toybox 多用途分派）
  │   ├── ls -> ../lib/libtoybox.so
  │   ├── cat -> ../lib/libtoybox.so
  │   ├── ... (~250 个 toybox 命令)
  │   ├── sh -> ../lib/libmksh.so
  │   └── mksh -> ../lib/libmksh.so
  ├── etc/
  │   ├── profile         # export PATH=$PREFIX/bin, PS1='$PWD $ '
  │   ├── mkshrc          # mksh-specific rc
  │   └── motd            # welcome message
  ├── lib/                # 注意这里不是 binaries，运行时由 LocalFilesystemBootstrapper 改 symlink 指向 APK 的 lib/<abi>/
  ├── share/
  │   └── doc/            # 可选 man pages
  └── tmp/                # 空目录
  ```
- 用 `xz -9e` 压缩，预期 1-2MB（symlinks 几乎不占体积）

#### Sub-phase 2.2 — LocalFilesystemBootstrapper.kt（1-1.5 天）

- 首启逻辑：
  ```kotlin
  suspend fun bootstrap(context: Context): Result<Unit> = withContext(Dispatchers.IO) {
      val prefix = File(context.filesDir, "usr")
      val versionFile = File(prefix, ".bootstrap_version")
      val targetVersion = BuildConfig.USR_TARBALL_VERSION  // 跟 build.gradle 同步

      if (versionFile.exists() && versionFile.readText() == targetVersion) {
          // 已 bootstrap，但每次启动重写 lib/ 的 symlinks（APK lib 路径每次 install 后变）
          relinkLibrariesFromApk(prefix, context)
          return@withContext Result.success(Unit)
      }

      // 1. 清理旧 $PREFIX（不动 $HOME = filesDir/home）
      prefix.deleteRecursively()

      // 2. 从 assets 流式解压 usr.tar.xz
      context.assets.open("usr.tar.xz").use { input ->
          XZCompressorInputStream(input).use { xz ->
              TarArchiveInputStream(xz).use { tar ->
                  // 逐 entry 写 + 处理 symlinks
              }
          }
      }

      // 3. 把 $PREFIX/lib 内的 libmksh.so / libtoybox.so / libtermux-exec.so symlink
      //    指向 APK 解出的 /data/app/.../lib/<abi>/lib*.so
      relinkLibrariesFromApk(prefix, context)

      // 4. 写 .bootstrap_version
      versionFile.writeText(targetVersion)

      Result.success(Unit)
  }
  ```
- xz 解压用 `org.tukaani:xz:1.9`（~100KB），tar 解析手写（~200 行，避免引 commons-compress ~600KB 大 dep）。理由：feature-local-terminal 是新 module，dep 自给自足比反向依赖 :app 干净
- **lib symlink 必须每次启动 relink**：APK 升级后 `nativeLibraryDir` 路径变了，老 symlink 指空
- 单测：12 cases（mock context + assets + 各种 bootstrap 状态）+ 1 instrumented（真 bootstrap，断言 $PREFIX/bin/ls 是 symlink 且 readlink 指向有效 .so）

#### Sub-phase 2.3 — $HOME + $TMPDIR + env 准备（0.5 天）

- `$HOME = context.filesDir + "/home"`（独立于 $PREFIX，不会被 bootstrap 重置）
- `$TMPDIR = $PREFIX/tmp`（每次启动清空，避免占用）
- 默认 env：
  ```
  PATH = $PREFIX/bin
  HOME = ...
  TMPDIR = $PREFIX/tmp
  SHELL = $PREFIX/bin/mksh
  TERM = xterm-256color
  LANG = en_US.UTF-8
  LD_PRELOAD = $PREFIX/lib/libtermux-exec.so
  ```

#### Sub-phase 2.4 — 自检命令验收（0.5 天）

- 跑 20 个 toybox 内置命令验对：`ls /`、`cat /proc/cpuinfo`、`echo $PATH`、`pwd`、`whoami`、`uname -a`、`ps`、`df -h`、`mount | grep /data`、`env`、`true`、`false`、`test -d $HOME`、`grep root /etc/passwd`（passwd 没有 → 期望 fail）、`find $HOME -type d`、`mkdir tmp && rmdir tmp`、`echo hi > x && cat x && rm x`、`date`、`ln -s ./x y && readlink y`、`stat /proc/self`
- 验收：20/20 通过

#### Sub-phase 2.5 — Node.js + chainlesschain CLI bootstrap（1-1.5 天）

- vendor Node.js LTS（v20.x）Android 交叉编译产物作为 `libnode.so` + symlink `$PREFIX/bin/node`（同 W^X lib/ 路径，详见 §12.2 vendor 来源）
- bundle 一份 `chainlesschain@<latestAtBuildTime>` 的 npm pack tarball 进 `assets/cc-cli-snapshot.tar.xz`
- Bootstrapper 首启额外步骤：
  1. extract Node.js binary 到 `$PREFIX/bin/node`
  2. extract npm CLI tarball 到 `$PREFIX/lib/node_modules/npm/`，symlink `$PREFIX/bin/npm`
  3. extract chainlesschain snapshot 到 `$PREFIX/lib/node_modules/chainlesschain/`，symlink `$PREFIX/bin/cc` 和 `$PREFIX/bin/chainlesschain`
  4. 写 `$PREFIX/var/lib/cc/.bundled-version` 记录 snapshot 版本（启动后由 auto-update 检查器对比 npm registry 上的 latest）
- 单测：8 cases（mock snapshot + 解压 + symlink 完整性）
- 验收：`cc --version` 在 shell 内返回 bundled 版本（如 `0.162.1`）；`node --version` 返回 v20.x
- ⚠️ Node.js 体积 stripped ~30MB（arm64-v8a），Lite 变体从 ~18MB 涨到 ~50MB

### Phase 3 — UI 接通（xterm.js WebView 复用）（2-3 天）

#### Sub-phase 3.1 — TerminalWebView 抽离成共享组件（0.5-1 天）

- 现 `feature-p2p` 的 RemoteTerminal 内部封装了 xterm.js WebView。把它抽到新 `feature-terminal-ui/` module，导出：
  ```kotlin
  @Composable
  fun TerminalWebView(
      onStdin: (ByteArray) -> Unit,
      onResize: (rows: Int, cols: Int) -> Unit,
      stdoutFlow: SharedFlow<ByteArray>,
      modifier: Modifier = Modifier,
  )
  ```
- Remote 和 Local 都通过这个组件接 WebView，**协议完全一致**，区别只在 `onStdin` 实现
- 单测：组件渲染 + JS bridge 双向（已在 Plan A.1 测过，迁出测试用例）

#### Sub-phase 3.2 — LocalTerminalScreen.kt + LocalSessionViewModel.kt（1-1.5 天）

- ViewModel 持有 `LocalPtyClient`，订阅 `stdoutFlow`，转发到 `TerminalWebView`
- 多 session：`Map<SessionId, LocalPtyClient>`，UI 顶部 chip 切换 + "+" 新建（上限 4，OOM 保护）
- 生命周期：ViewModel.onCleared → 遍历 shutdown()
- 单测：14 cases

#### Sub-phase 3.3 — 输入栏增强（0.5 天）

- 复用 Remote 那套额外按键行：`Ctrl` `Esc` `Tab` `↑↓←→` `:` `/` `|`
- 长按粘贴弹剪贴板内容；选中文本长按弹复制
- 单测：6 cases

#### Sub-phase 3.4 — Latency micro-benchmark（0.5 天，强制 gate）

- WebView 在远程模式下 latency 被网络主导，本地模式无网络故 JS bridge 串行化暴露完整。**必须**实测才能确认 OQ-1 决策正确
- 写 `LocalTerminalLatencyBenchmark.kt`（androidTest），跑：
  - 连续 1000 字符 stdin → stdout 回环
  - 测 p50 / p99 端到端 latency（stdin 写出 → xterm.js DOM 更新完）
- **Gate**：p99 < 30ms → 通过；p99 ≥ 30ms → 必须回退到 Compose AnsiTerminalView（追加 4-5 天 Phase 3.5 移植 Termux terminal-emulator），Phase 4 顺延
- 真机基线：Xiaomi 24115RA8EC（mid-range，跟 Plan A.1 同设备）

### Phase 4 — RemoteOperate "本地" tab 接通（2-3 天）

#### Sub-phase 4.1 — RemoteOperateScreen 加第 6 tab（0.5 天）

- Android 端：`tabs` 末尾加 `Tab.Local`
- iOS 端：iOS SwiftUI 端 `RemoteOperateView` 不加（已隐藏）
- 单测：UI snapshot，6 tabs 显示对

#### Sub-phase 4.2 — DI wiring（0.5 天）

- `LocalPtyClient` 注入：**`@AssistedInject`**，sessionId 作为 assisted parameter，每 session 独立实例。`@AssistedFactory interface LocalPtyClientFactory { fun create(sessionId: String): LocalPtyClient }`
  - ⚠️ **不能用 @Singleton**：多 session 设计要求每实例独立 pty fd + coroutine scope + child pid
- `LocalFilesystemBootstrapper` 是 `@Singleton`（无状态，只读 assets），启动时 `Application.onCreate` 异步触发 bootstrap（不阻 UI）
- `LocalSessionViewModel` 持有 `LocalPtyClientFactory`，按需 create + 维护 `Map<SessionId, LocalPtyClient>`
- 单测：Hilt graph 测试 + AssistedInject factory 多实例隔离测试

#### Sub-phase 4.3 — Settings "工厂重置 $PREFIX" 按钮（0.5 天）

- Settings 加入口，点击 → 确认对话框 → `prefix.deleteRecursively() + bootstrap()` → toast "重置完成"
- 单测：4 cases

#### Sub-phase 4.4 — Phase 4 集成 smoke（0.5-1 天）

- E2E（emulator）：启动 app → 进 RemoteOperate → 切 "本地" tab → 终端起来 → `echo hello` → 见 `hello\n`
- 验收：smoke 通过

### Phase 5 — 抛光 + Full 变体打包（3-5 天）

#### Sub-phase 5.1 — History 持久化（0.5 天）

- `$HOME/.mksh_history`，mksh 自带 HISTFILE 机制，default on
- Settings toggle "保留历史"，关 → 删文件 + `unset HISTFILE`

#### Sub-phase 5.2 — 主题 + 字号（0.5 天）

- xterm.js 已支持 theme JSON，曝 Settings UI（深色/浅色/Solarized + 字号 10-20pt）

#### Sub-phase 5.3 — Foreground service 保活（1-1.5 天）

- 可选 toggle "保持后台运行"：开启时启 `LocalTerminalForegroundService`（dataSync 类型）
- 通知栏显示 "终端运行中 - N 个 session"
- 注意：Android 14 ForegroundService 类型必须申明，dataSync 是合法理由（"用户长任务"）
- Play 商店审批需 justification，F-Droid 无障碍

#### Sub-phase 5.4 — Full 变体 productFlavor + 大件包 NDK 编译（2-3 天）

- `build.gradle.kts` 加 `productFlavors { create("lite") { applicationIdSuffix = "" }; create("full") { applicationIdSuffix = ".full" } }`，**两个 applicationId 不同**（Play 商店硬约束），用户可在同设备共存两个 app
- 大件包编 lib 命名（强制 `lib*.so` 前缀，W^X 必需）：
  - git → `libgit.so` + 一组 git core helpers (`libgit-receive-pack.so` 等若干)
  - python3 → `libpython3.so` + `libpython3.11.so` 等
  - vim → `libvim.so`
  - openssh client → `libssh.so` / `libssh-keygen.so` / `libscp.so`
  - curl → `libcurl-bin.so`（区别于现有 libcurl.so 库依赖）
- `usr.tar.xz` 在 Full 变体含额外 symlinks：`$PREFIX/bin/git -> /data/app/.../lib/<abi>/libgit.so` 等
- Lite 变体首启没这些 symlinks（用户运行 `git` 报 `command not found`，UI 引导升级 Full）
- 单测：12 cases（变体配置 + symlink 完整性）
- **大件包从哪 vendor**：Termux 维护的 patch set（`termux/termux-packages/packages/<name>/`）已含 Android 交叉编译脚本，直接复用，每个包工作量 2-4h 集成
- **license 强制**：每个 bundled 大件包在 APK assets 内含 LICENSE 文件，Settings 内 "关于本机器代码许可" 展示全列表（git GPLv2 + python PSF-2.0 + vim Vim-License + openssh BSD + curl MIT，**注意 git 是 GPLv2** — Full 变体整体须以 GPLv2 兼容方式发布，repo MIT 允许集成 GPLv2 binaries 但 Full APK 的总组合产物视作 GPLv2 工作）

#### Sub-phase 5.5 — MANAGE_EXTERNAL_STORAGE toggle（0.5-1 天）

- Settings toggle "允许访问外部存储（如 /sdcard）"
- 开启时调起系统设置：`Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION).setData(Uri.parse("package:$packageName"))`
- 单测：4 cases

#### Sub-phase 5.6 — Phase 5 收口（0.5 天）

- 跑全单测套 + 验收：Full 变体 `git --version` 返回 2.43.0；后台 1min 不杀（前台服务开启）；Lite 变体 `git` 报 `command not found` 同时 UI banner 引导升级

#### Sub-phase 5.7 — chainlesschain CLI auto-update（1-1.5 天）

- `CcCliUpdater.kt`（Hilt @Singleton），WorkManager 周期任务（默认每 24h）：
  1. 命中条件：网络可用 + 用户未在 Settings 关闭 "自动更新 cc CLI"
  2. 查询 npm registry：`GET https://registry.npmjs.org/chainlesschain/latest`
  3. 对比 `$PREFIX/var/lib/cc/.bundled-version` 当前版本，新 patch/minor 自动升级，**major bump 弹用户确认**（重大变更）
  4. 升级方式：在 pty 内执行 `npm install -g chainlesschain@latest`（依赖 §12.2 bundled npm），完成后更新 `.bundled-version`
  5. 失败重试 3 次（退避 5s/30s/2min），仍失败则下次周期再试，不打扰用户
- Settings UI：
  - toggle "自动更新 cc CLI"（默认 ON）
  - 按钮 "立即检查更新"（手动触发）
  - 显示当前版本 + 上次检查时间 + 上次更新结果
- npm registry 镜像配置：尊重用户 `$PREFIX/.npmrc` 的 `registry=` 设置（中国用户可自行切淘宝镜像 `https://registry.npmmirror.com/`）
- 单测：14 cases（mock HTTP + WorkManager + 各种失败路径）
- 验收：装老 snapshot（如 0.162.0），手动按"立即检查"，更新到当前 latest；UI 显示成功

### Phase 6 — 真机 E2E（1-2 天）

详见 §6。

## 5. 12 个 Forward-Looking Traps

每个 trap 含：现象 / 根因 / 修复 / 验证方式。

### Trap 1 — W^X enforcement (Android 10+ targetSdk 29+)

- **现象**：`Runtime.exec` 调 `/data/data/<pkg>/files/usr/bin/mksh` 抛 `Permission denied`，哪怕文件有 +x 权限
- **根因**：targetSdk ≥ 29 + Android 10+ kernel SELinux 强制 W^X — data dir 内非 lib/<abi>/ 的文件不可执行（防 RCE 提权）
- **修复**：mksh / toybox / termux-exec **必须**编为 `lib*.so` 放 `lib/<abi>/`，APK 安装时通过 `extractNativeLibs=true` 解到 `/data/app/<pkg>/lib/<abi>/`（这条路径白名单内可执行）。`$PREFIX/bin/mksh` 是 symlink 指过去
- **验证**：用 `adb shell stat /data/app/<pkg>/lib/arm64-v8a/libmksh.so` 看 SELinux context 应该是 `u:object_r:app_data_file:s0` 但 `unconfined_app` domain 可 exec；用 `readlink $PREFIX/bin/mksh` 看 symlink 指向正确

### Trap 2 — PIE binaries 必需 (Android 5+)

- **现象**：旧 toybox/busybox build 调起来抛 `error: only position independent executables (PIE) are supported`
- **根因**：Android 5.0+ kernel 拒绝 non-PIE binaries
- **修复**：CMakeLists.txt 加 `target_compile_options(mksh PRIVATE -fPIE) target_link_options(mksh PRIVATE -pie)`；NDK 默认开 PIE，但手 vendor precompiled 一定要验
- **验证**：`readelf -h libmksh.so | grep Type` 输出 `DYN (Shared object file)`（PIE 等价于 ET_DYN + DT_FLAGS_1 PIE bit）

### Trap 3 — SELinux untrusted_app 限制

- **现象**：用户 `mount /sdcard /mnt` 报 `Operation not permitted`；strace 不工作 `ptrace: Operation not permitted`
- **根因**：app domain 是 `untrusted_app`，SELinux policy 禁 mount/ptrace/setuid 等危险 syscall
- **修复**：**不修**。文档明确告诉用户 "本地终端运行在 sandbox 内，部分系统级命令不可用"；常规 shell 99% 用法不受影响
- **验证**：`getenforce` 在普通设备恒返回 `Enforcing`；写一份 `LIMITATIONS.md` 列已知禁用 syscall

### Trap 4 — scoped storage (Android 11+) 路径访问

- **现象**：`ls /sdcard/AnotherApp/` 报 `Permission denied`
- **根因**：Android 11+ scoped storage，app 默认只能访问自己的 `Android/data/<pkg>/` + MediaStore（媒体文件）
- **修复**：默认 sandbox 内最小可用（OQ-7 决策）。用户主动 toggle 后通过 `MANAGE_EXTERNAL_STORAGE` 拿全盘访问（仍读不到 /data/data/<其他 app>，那是 kernel-level 隔离）
- **验证**：toggle 关时 `ls /storage/emulated/0/Download` EACCES；toggle 开后能列出

### Trap 5 — Doze mode 杀进程

- **现象**：用户切后台，1 分钟后回前台，shell session 全没了
- **根因**：Doze mode + 后台 app process death，app 进程一被杀整个 pty + 子 mksh 都没了
- **修复**：Phase 5 加 ForegroundService toggle（dataSync 类型）。默认关，用户主动开。开启时显式通知栏，进程不会被 doze 杀
- **验证**：`adb shell dumpsys activity processes | grep chainless` 查 oom_adj，foregroundService 状态下应该是 200 以下；后台 5min 后 process 仍 alive

### Trap 6 — 进程泄漏 (Kotlin coroutine cancel ≠ OS process kill)

- **现象**：用户切 tab，CPU 还是高，因为 mksh 还在跑 `while true; do :; done`
- **根因**：`coroutineScope.cancel()` 只取消 Kotlin coroutine 协程，**不杀** native pty 子进程；kotlin Process API 也不行（pty 子进程 detach 了）
- **修复**：`LocalPtyClient.shutdown()` 必须显式：
  1. `nativeKillpg(-pid, SIGTERM)`（负 pid = 进程组，收孙进程）
  2. coroutine.delay(5_000)
  3. `nativeKillpg(-pid, SIGKILL)` 兜底
  4. `nativeWaitpid(pid)` 收尸
- **验证**：单测 `LocalPtyClientTest.shutdownKillsChildren`：start mksh → mksh fork sleep 100 → shutdown → 100ms 后 `ps -ef | grep mksh` 无残留

### Trap 7 — fork() on zygote app + Java VM（必须用 posix_spawn）

- **现象 A**：fork() 后子进程 `dlopen` Android runtime libs 抛 `Failed to find binder symbol`
- **现象 B (API 34+ 新增)**：直接 fork() 时 ART runtime 注入 abort hook，进程直接 SIGABRT — "Forking from app process is unsafe"
- **根因**：Android app 进程从 zygote fork，VM 状态特殊；API 34 起 ART 主动检测 fork-without-immediate-exec 并 abort
- **修复**：pty_jni.cpp **不用 raw fork+exec**，改用 `posix_spawn()` + `posix_spawn_file_actions_*`：
  ```cpp
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0);
  posix_spawn_file_actions_adddup2(&actions, slaveFd, 0);   // stdin
  posix_spawn_file_actions_adddup2(&actions, slaveFd, 1);   // stdout
  posix_spawn_file_actions_adddup2(&actions, slaveFd, 2);   // stderr
  posix_spawn_file_actions_addclose(&actions, masterFd);    // child 不需要 master
  posix_spawnattr_t attrs;
  posix_spawnattr_init(&attrs);
  posix_spawnattr_setflags(&attrs, POSIX_SPAWN_SETSID);     // 新 session，pty 作控制 tty
  pid_t pid;
  posix_spawn(&pid, mksh_path, &actions, &attrs, argv, envp);
  ```
  - posix_spawn 在 Android 实现走 vfork+exec 内部路径，**不触发 ART fork abort hook**
  - 缺点：POSIX_SPAWN_SETSID 是 POSIX.1-2008，Android NDK 仅 API 28+ 支持 — 我们 minSdk 26 需 fallback 到手写 setsid（spawn 后立即调 ioctl，有竞态但实测可控）
- **验证**：strace 调试看 syscall trace，应看到 `clone` 或 `vfork` 紧接 `execve`，中间无任何 mmap 加载 Java 库；API 34/35 真机不 abort

### Trap 8 — PATH / $TMPDIR / shebang

- **现象**：`#!/usr/bin/env python` 脚本报 `python: not found`，哪怕装了 python
- **根因**：Android default $PATH = `/system/bin:/system/xbin`，没我们的 $PREFIX/bin；shebang `#!/usr/bin/env` 在 Android 没 `/usr/bin/env` 文件
- **修复**：
  - env 注入 `PATH=$PREFIX/bin:/system/bin`（不带 /usr/bin）
  - `LD_PRELOAD=$PREFIX/lib/libtermux-exec.so`（重写 execve 的 shebang 解析，把 `/usr/bin/env` 翻译为 `$PREFIX/bin/env`）
  - $TMPDIR=$PREFIX/tmp（很多脚本依赖；Android 没 /tmp）
- **验证**：`env python3 -c 'print(1)'` 在装完 python 包后输出 `1`；`echo $TMPDIR` 显示 $PREFIX/tmp

### Trap 9 — license 雷（已 OQ-3 解）

- **现象**：开源律师函质问 "你 app license MIT 但 bundle 了 GPLv2 busybox，全 app 必须开源 GPL"
- **根因**：GPL viral，静态/动态链接都触发
- **修复**：toybox (0BSD) + mksh (MirOS BSD) + termux-exec (Apache 2.0)。**禁止** Phase 5 包源里挂 GNU coreutils（GPLv3）、bash（GPLv3）；要全功能可挂用户**自己**下载的包，repo 内 client 只写"用户 acknowledge GPL"提示
- **验证**：`apt-get` style metadata 加 `license` 字段，UI 在 install 前显示 license 警告

### Trap 10 — APK 体积爆炸 / ABI splits

- **现象**：universal APK 加 4 个 ABI = 16-24MB 起步，加大件包到 80MB+
- **根因**：每个 ABI 都要打一份 native lib
- **修复**：`splits { abi { isEnable = true; reset(); include("arm64-v8a", "armeabi-v7a", "x86_64"); isUniversalApk = false } }`，每个 ABI 独立 APK，arm64-v8a only ~4-6MB（lib）+ ~1-2MB（usr.tar.xz）。
- **验证**：`./gradlew :app:assembleRelease` 出 3 个 APK，每个 < 20MB

### Trap 11 — 多 session 生命周期

- **现象**：用户开 2 session 切来切去，关 1 个 tab 后另一个也死了
- **根因**：ViewModel scope 共享 → cancel 时遍历杀全部
- **修复**：`Map<SessionId, LocalPtyClient>`，每 session 独立 PtyClient + Job，关闭 session 单独 shutdown。**ViewModel cleared 时遍历杀全部**（避免 leak），但 session 切 tab 不 cleared
- **验证**：单测 `MultiSessionTest`：开 2 session → 关 #1 → #2 仍 alive 能收 stdout；ViewModel onCleared → 2 都被杀

### Trap 12 — 本地 vs 远程视觉混淆

- **现象**：用户在"本地" tab 输入 `rm /sdcard/重要文件.txt`，以为在控桌面，结果删了手机上的
- **根因**：UI 完全一致（同 xterm.js WebView）
- **修复**：
  - tab 头加图标：远程 🌐 / 本地 📱
  - 终端顶部 sticky chip 显示 "📱 本地 [arm64-v8a] $HOME=...."（不同色：远程蓝 / 本地绿）
  - 首次进入本地 tab 弹一次性引导 "命令在你手机本地运行，不影响桌面"
- **验证**：UX review；引导只弹一次（SharedPreferences flag）

## 6. Phase 6 真机 E2E

### 6.1 测试设备矩阵

| 设备 | 角色 | 必要性 |
|---|---|---|
| Xiaomi 24115RA8EC（Android 14, ARMv8a） | Primary — 跟 Plan A.1 同设备复用 | 必须 |
| Android 11 设备（任何） | scoped storage 验证 | 推荐 |
| x86_64 emulator (API 35) | ABI splits 验证 + 多次干净 install | 推荐 |

### 6.2 验收场景（8 个）

| # | 场景 | 步骤 | 验收 |
|---|---|---|---|
| 1 | 首启 bootstrap | 装 APK，首启 → 进 RemoteOperate → "本地" tab | 解压 $PREFIX ≤ 10s；`ls /data/data/.../files/usr` 见 bin/etc/lib；终端见 motd |
| 2 | 基础命令 | 输入 `echo hello` | 200ms 内 stdout `hello\n` |
| 3 | 文件系统 sandbox | `ls $HOME`、`pwd`、`ls /sdcard/Download`（Settings toggle 关时） | 前两个有输出；第三个 EACCES |
| 4 | 外部存储 toggle | Settings 开 "允许访问外部存储" → 系统设置授权 → 回来 `ls /sdcard/Download` | 真实 listing |
| 5 | 信号中断 | `sleep 100` → Ctrl+C | ≤ 200ms 退出，prompt 回来 |
| 6 | 交互式 vim | 装 `pkg install vim` → `vim test.txt` → `i` → 输入 → `Esc` → `:wq` → `cat test.txt` | 内容对；vim 屏幕完整渲染 |
| 7 | 多 session | "+ 新建 session" 开第 2 个 → 跑 `sleep 60` 在 #1 → 切 #2 跑 `echo`  | #2 不阻塞；切回 #1 stdout 完整 |
| 8 | 后台保活（toggle 开） | Settings 开 "保持后台运行" → 切到桌面 → 等 5min → 回 app | session 仍 alive；可继续输入 |

### 6.3 性能基线

- 首启 bootstrap：≤ 10s（cold install）/ ≤ 500ms（已 bootstrap，仅 relink lib）
- 单命令 echo 延迟：stdin → stdout 端到端 < 50ms（不含 WebView 渲染）
- 1 小时连续使用：APK process RSS 不超过 80MB（无 leak）
- 多 session：4 个并发，每个 idle mksh ~3-5MB RSS

### 6.4 回归矩阵

- 远程终端不受影响：Plan A.1 4 个真机场景全跑一遍
- 其它 4 个 Remote Operate tab（文件/剪贴板/截屏/系统）行为不变
- iOS 端 RemoteOperate UI snapshot：仍 5 tab 不变

## 7. 测试策略汇总

| Phase | 单元测试 | 集成测试 | 真机 E2E |
|---|---|---|---|
| 0 | 0 | 1（编出 .so 能 exec） | 0 |
| 1 | 22 + 18 = 40 | 3（真 mksh） | 0 |
| 2 | 12 | 1（真 bootstrap） | 0 |
| 3 | 14 + 6 = 20 | 2 + 1 latency benchmark | 0 |
| 4 | 4 | 1 smoke | 1 |
| 5 | 12 + 4 = 16 | 2（Lite vs Full 变体） | 0 |
| 6 | 0 | 0 | 8 |
| **合计** | **112** | **11** | **9** |

Coverage 目标：核心 LocalPtyClient + LocalFilesystemBootstrapper > 85% line coverage（CI gate）。

## 8. 收口标准（每 phase）

- 所有单测绿
- 所有集成测试在 emulator 绿
- Phase 6 8 场景在 Xiaomi 24115RA8EC 全部通过
- APK universal-debug < 25MB / arm64-v8a release < 20MB
- 无 Play 商店发版 blocking 违规（License 扫描通过 / MANAGE_EXTERNAL_STORAGE 仅在用户主动开启时申请）
- memory 文件 `android_local_terminal_traps.md` 收口实施中暴露的新 trap

## 9. 时间线

| Phase | 估时 | 累计 |
|---|---|---|
| 0 NDK 编译 | 3-5 天 | 3-5 天 |
| 1 PTY + posix_spawn JNI | 5-7 天 | 8-12 天 |
| 2 $PREFIX | 3-5 天 | 11-17 天 |
| 3 UI + latency gate | 2.5-3.5 天 | 13.5-20.5 天 |
| 4 接通 | 2-3 天 | 15.5-23.5 天 |
| 5 抛光 + Full 变体 | 3-5 天 | 18.5-28.5 天 |
| 6 真机 E2E | 1-2 天 | 19.5-30.5 天 |

**全程 3-4 周（一人全职）**。比初版估算（4-6 周）少 1-2 周：
- OQ-1 选 WebView 复用省 4-5 天 Compose AnsiTerminal 移植
- OQ-5 改 Lite/Full 变体省 2-5 天（vs 下载式包源 + 服务端 + manifest 设计）
- ⚠️ Phase 3.4 latency gate 不过则追加 4-5 天 Compose 回退，时间线右移到 4-5 周

## 10. 与现有 Memory 联动

实施中**必读**：

- `android_native_vendor_strategy.md` — NDK vendoring + Windows schannel submodule 雷
- `android_remote_terminal_plan_a_diagnosis.md` — Plan A.1 4 + 1 bug 教训（kotlin daemon UTF-8 / OkHttp pingInterval / WS reconnect register）
- `feedback_android_kotlin_incremental_cache_encoding.md` — Kotlin daemon 改 UTF-8 后必 `./gradlew --stop && clean`
- `feedback_commit_msg_hook_scope_regex.md` — commit scope 不能含数字，用 `feat(local-terminal)` 不用 `feat(localterminal1)`

实施中**会新增**的 memory：

- `android_local_terminal_traps.md` — 实施中暴露的真坑（W^X / SELinux / fork-after-zygote 等等的实际错误信息）
- `android_local_terminal_pkg_source.md` — Phase 5 包源运维（如果做了的话）

## 11. 待用户决定的开放项（OQ 之外）

- **Lite / Full 变体的 Play 商店发版策略** — applicationId 已决定分离（`com.chainlesschain.android` / `.full`），Play 商店各自独立 listing。Play 是否两个都上？建议 Lite 先上 Play，Full 先 F-Droid + GitHub Release sideload，等 Lite Play 审批稳定后再尝试 Full 上 Play
- **Full 变体的 license 标识** — Full 含 git GPLv2，整 APK 视作 GPLv2 工作；Lite 仅 MIT/0BSD/BSD-like 干净。是否需要在 Play 商店描述明确标 "本产品 Full 变体含 GPLv2 组件"？影响开源律师 review
- **bash 是否在 Full 变体含** — bash GPLv3 比 git GPLv2 更严格（含 Tivoization clause），含进 Full 后用户硬件锁定（如系统签名 enforcement）需放开。建议**不含 bash**，只含 mksh，避免 GPLv3 触发
- **Lite ↔ Full 数据迁移** — 两个 applicationId 是独立 app，`$HOME` / `.mksh_history` 不互通；Phase 6+ 加 `export-home` / `import-home` 命令（mksh 内置 tar）+ Settings UI 一键 share Intent

## 12. 默认集成 chainlesschain npm CLI

### 12.1 设计意图

mobile 端本地终端的**默认 CLI 体验**是项目自己的 `chainlesschain` 包（即 `cc` 命令）— 用户进终端就可直接 `cc chat / cc skill list / cc ask` 用到 ChainlessChain 全部能力，不需要任何手动 `pkg install`。包源版本对齐 `packages/cli/package.json` 的 latest（v0.162.1 at 2026-05-18，每周一到两次发版）。

**铁律**：用户启动 app 时只要联网就**总是**拿到 npm registry 上的 `chainlesschain@latest`（24h 周期自动 + 启动时机会性检查 + Settings 手动触发三层兜底）。

### 12.2 三方 binary vendor 来源 + license

| Binary | 用途 | License | Vendor 路径 |
|---|---|---|---|
| Node.js v20 LTS | JavaScript runtime | MIT + BSD（V8/libuv 子许可，整体 permissive） | `nodejs/node` upstream + Termux patches （`termux/termux-packages/packages/nodejs/`）交叉编译，arm64-v8a stripped binary ~30MB |
| npm | npm package manager | Artistic-2.0（permissive，MIT 兼容） | Node.js 官方 release 自带，不单独 vendor |
| chainlesschain | 本项目 CLI | （repo MIT） | `packages/cli` 工作区直接 `npm pack` 出 `chainlesschain-<version>.tgz` 放 assets/ |

Node.js 进 `lib/<abi>/libnode.so`（W^X 必需，命名 hack 同 mksh），$PREFIX/bin/node symlink 过去；npm 和 chainlesschain 是纯 JS（无 native 模块），可直接放 $PREFIX/lib/node_modules/ 没有 W^X 限制（`node` interpret 是 binary 走 lib/<abi>/，被它 require 的 .js 文件不需要 exec 权限）。

### 12.3 三层更新机制

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Bundled snapshot (assets/cc-cli-snapshot.tar.xz)│
│   • 每次发 APK 都打包当时 latest                          │
│   • 离线首启可用，不依赖网络                              │
│   • Sub-phase 2.5 解压                                  │
└─────────────────────────────────────────────────────────┘
           │ user starts app, online
           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Startup opportunistic check (lightweight)      │
│   • app onCreate 触发 OneTimeWorkRequest                │
│   • 只做 HEAD request 看 latest version，不真升级        │
│   • 若有新版，置 SharedPreferences flag 让 Layer 3 接手   │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: WorkManager periodic update (24h)              │
│   • Sub-phase 5.7 实现                                  │
│   • 真正执行 `npm install -g chainlesschain@latest`      │
│   • 失败退避 + Settings 透明反馈                          │
└─────────────────────────────────────────────────────────┘
```

### 12.4 与 desktop `cc` CLI 的功能差异

mobile 端 cc CLI 跑在 Android 沙箱内，部分子命令受限：

| cc 子命令 | mobile 可用性 | 说明 |
|---|---|---|
| `cc chat` / `cc ask` | ✅ 可用 | 调 LLM 端点（Ollama / 云 LLM），网络 OK 即可 |
| `cc skill list` / `cc skill run` | ✅ 可用 | 本地 skill，纯 JS |
| `cc note` / `cc search` | ✅ 可用 | SQLite 本地数据库，$HOME 内 |
| `cc memory` | ✅ 可用 | 本地文件 |
| `cc mcp <server>` | ⚠️ 部分 | MCP server 若是纯 JS 可起；需 native binary 的 server 失败 |
| `cc ui` | ❌ 不可用 | 需 Electron web server；Android 端建议直接用 app 内 UI 而非 cc ui |
| `cc agent` / `cc serve` | ⚠️ 部分 | 长任务在 doze 模式被杀（与 §5 Trap 5 同），需开 Foreground service |
| `cc setup/start/stop/status/doctor` | ⚠️ 部分 | doctor 大部分检查可跑；setup/start/stop 假设 desktop 环境，mobile 上多数 step 跳过 |
| `cc pack / cc orchestrate / cc workflow` | ✅ 可用 | 纯 JS |

mobile 端默认开机展示一段 motd 说明这些差异（避免用户跑 `cc ui` 困惑）。

### 12.5 离线场景

无网时启动：
- Layer 1 bundled snapshot 立刻可用，所有不需要网络的子命令照跑（`cc note add` / `cc skill list` / `cc memory query` 等）
- Layer 2/3 静默 skip（WorkManager constraints `NetworkType.CONNECTED`）
- UI 不弹错误，Settings 显示 "上次检查：离线"

### 12.6 安全

- 升级走 npm registry HTTPS + npm 自带 integrity check（`package.json` shasum）
- 用户自定义 registry（如 npmmirror）由用户负责信任
- 不允许 cc CLI 自我升级触发 root 权限 / 系统级写入（全在 $PREFIX 内，沙箱受限）

---

**Status**: 📐 设计完成，**Phase 0.1 已落地** (2026-05-18) — `feature-local-terminal` module skeleton + Gradle externalNativeBuild + 3 ABI × `libpty_jni.so` placeholder + Kotlin LocalTerminalNative JNI 桥 + Hilt 接入 + unit tests 全过。建议在 [iOS Phase 1.7 / 2.7 / 3.7 真机 E2E 完成后启 Phase 0.2](../../C--code-chainlesschain/memory/MEMORY.md)，避免框架级 bug 回锅。
