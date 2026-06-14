# Android 本地终端（Phase 2.5 — 内置 cc CLI）

> **版本: v5.0.3.65 (Phase 2.5 完成, 2026-05-19) | 状态: ✅ 真机验证（Xiaomi 24115RA8EC × `cc -v → 0.162.2`）| 47 source files · 5 instrumented + 多组 unit test · arm64-v8a Lite ~50MB**
>
> **重大突破**：APK 内置 Termux Node.js v25 + `chainlesschain` CLI npm pack + mksh + toybox + xterm.js，开 app 进 RemoteOperate "本地" tab 直接敲 `cc -v` 即可。无需配对桌面，无需 root，无需 Termux，离线可用。8 个 Android 平台连锁 trap 全部破解，一晚 14 commits 落地。

## 概述

Android 本地终端是 ChainlessChain Android v1.0+ 的全新功能 —— 在手机自己的应用沙箱内跑完整 Linux shell，**不依赖配对桌面**。与现有的"远程终端"（手机→桌面 pty）是两条独立链路：

- **远程终端**（Plan A/A.1）：手机 → WebRTC DataChannel → 桌面 shell，需要配对，桌面在线，断网失效
- **本地终端**（Phase 2.5）：mksh + toybox ~250 命令 + **chainlesschain CLI（`cc`）** 全套跑在手机本地，离线可用，断网仍可 `cc note add` / `cc search` / `cc memory query`

Phase 2.5 完成里程碑是 **`cc -v` 在手机真机返回 `0.162.2`**（2026-05-19 Xiaomi 24115RA8EC 真机验证）。这把 ChainlessChain 全套 ~155 个 CLI 命令带到了用户口袋里。

iOS 端因沙箱根本不允许 `fork+exec` 任意二进制（含 dynamic linker `dyld` 拒绝 load 非系统库），**本地终端 iOS 不支持**，RemoteOperate 第 6 个 tab 在 iOS 编译期就不存在。

## 核心特性

- 🚀 **APK 内置 `cc` CLI**：开盒即用，无需 `pkg install`，无需手动配置，首次启动解压到 `$PREFIX = /data/data/<pkg>/files/usr`
- 📦 **Termux Node.js v25 LTS**：通过 patchelf 重写 RUNPATH / SONAME / DT_NEEDED，与 NDK libc++ 共存（`libtermux_cxx.so` 重命名方案）
- 🔑 **LLM 密钥自动桥接**：app 的 `llm_config_secure` EncryptedSharedPreferences（AES256_GCM）存的 9 个厂商 API key 自动映射到 cc CLI 环境变量（OpenAI / Anthropic / DeepSeek / 通义 / Gemini / 火山豆包 / Moonshot / 文心 / 智谱 / 讯飞）
- 🌐 **`cc ui` LAN 直连**：终端内敲 `cc ui` 拉起 Web 管理面板，自动绑定 `0.0.0.0` + 自动 token，同 WiFi 电脑浏览器直连 `http://<手机 IP>:5174`
- 🔄 **三层更新机制**：APK bundled snapshot（离线兜底）+ 启动机会性检查（轻量 HEAD）+ WorkManager 24h 周期升级（`npm install -g chainlesschain@latest`）
- 🐚 **mksh 单选**：MirOS BSD（MIT 兼容），500KB，POSIX + ksh88 兼容性覆盖 99% 用户脚本（拒绝 GPLv3 bash 反向感染）
- 🧰 **toybox 工具集**：0BSD，~250 命令（ls/cat/grep/find/sed/awk/tar/...），通过 argv[0] 多用途分派
- ⌨️ **xterm.js WebView 复用**：与远程终端共用同一套终端 UI（xterm.js + addon-fit），p99 latency < 30ms 真机基线
- 🛠️ **额外按键工具栏**：`Ctrl` `Esc` `Tab` `↑↓←→` `:` `/` `|` 等 shell 高频组合键
- 🔐 **沙箱内运行**：默认只 `$HOME` 和 `$PREFIX` 内可读写，`/sdcard` 访问需用户主动 toggle（`MANAGE_EXTERNAL_STORAGE`）
- 🪜 **mksh alias 取代 wrapper script**：绕开 SELinux `untrusted_app` 不能 execve `app_data_file` 的硬约束（Trap 4 终极解）
- 📤 **CI 自动化 bundle 工作流**：`node-runtime-bundle.yml` 周期拉 Termux Node 8 个 .deb + 重打包 → 自动 commit 到 `jniLibs/` 与 `assets/local-terminal/cc-cli.tgz`
- ⚡ **首启 bootstrap ≤ 10s**：cold install 解压 $PREFIX；二次启动 ≤ 500ms（仅 relink lib symlinks）
- 🪶 **APK 体积可控**：arm64-v8a Lite ~50MB（含 Node 25 + cc CLI hydrate 后 ~40MB + mksh + toybox + xterm.js）
- 🧪 **真机验证**：Xiaomi 24115RA8EC × `cc -v → 0.162.2` ✅ 2026-05-19；Phase 2.5 一晚 14 commits 闭环

## 系统架构

### 模块布局

```
android-app/feature-local-terminal/
├── src/main/
│   ├── cpp/
│   │   ├── CMakeLists.txt
│   │   ├── pty_jni.cpp            ← JNI pty 桥（posix_spawn + TIOCSCTTY + setsid）
│   │   └── pty_jni_placeholder.cpp
│   ├── assets/local-terminal/
│   │   ├── xterm.js + xterm.css + addon-fit.js  ← 终端渲染
│   │   ├── xterm-shell.html       ← WebView 容器
│   │   └── cc-cli.tgz             ← chainlesschain CLI snapshot（npm pack + hydrated prod deps，ustar 格式）
│   ├── jniLibs/<abi>/
│   │   ├── libnode.so             ← Termux Node v25（patchelf 重写 RUNPATH → $ORIGIN）
│   │   ├── libcrypto.so / libssl.so / libsqlite3.so
│   │   ├── libicu*.so（icudata/i18n/uc/io/test/tu）
│   │   ├── libcares.so / libz.so / libandroid-support.so
│   │   ├── libtermux_cxx.so       ← Termux libc++_shared.so（重命名避 AGP merge 冲突）
│   │   ├── libtoybox.so           ← multi-call binary
│   │   └── libpty_jni.so          ← 自写 JNI
│   ├── java/com/chainlesschain/android/feature/localterminal/
│   │   ├── LocalFilesystemBootstrapper.kt   ← $PREFIX 首启解压 + cc CLI extract + symlinks
│   │   ├── LocalPtyClient.kt                 ← Kotlin pty 包装（@AssistedInject 多 session）
│   │   ├── LocalPtyNative.kt / PtyNative.kt  ← JNI bindings
│   │   ├── PtyEnvironment.kt                 ← envp 构造 + LLM 密钥桥接 + ccUiToken
│   │   ├── LocalTerminalNative.kt
│   │   └── ui/
│   │       ├── LocalSessionViewModel.kt
│   │       ├── LocalTerminalScreen.kt        ← Compose 壳
│   │       └── LocalTerminalWebView.kt       ← xterm.js WebView 桥
│   └── AndroidManifest.xml
└── build.gradle.kts                          ← externalNativeBuild CMake + ABI splits
```

### 数据流

```
用户输入                                              屏幕显示
   │                                                     ▲
   ▼                                                     │
[xterm.js WebView 输入]                              [xterm.js WebView 渲染]
   │ JS bridge: postMessage("stdin", data)              │ webView.evaluateJavascript("term.write(...)")
   ▼                                                     │
[LocalTerminalScreen JS bridge handler]                  │
   │                                                     │
   ▼                                                     │
[LocalSessionViewModel.writeStdin(bytes)]      [LocalSessionViewModel.onStdout]
   │                                                     ▲
   ▼                                                     │
[LocalPtyClient.write]                          [LocalPtyClient.stdoutFlow (SharedFlow<ByteArray>)]
   │ JNI                                                 │ JNI 监听线程
   ▼                                                     │
[pty_jni.cpp posix_spawn + TIOCSCTTY]            [pty_jni.cpp readPty(fd) → JNI callback]
   │                                                     ▲
   ▼                                                     │
[Linux kernel pty master fd] ↔ [Linux kernel pty slave fd] ↔ [mksh -l 子进程]
                                                                  │
                                                                  ├── alias cc='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
                                                                  ├── alias cc → node → 加载 chainlesschain CLI
                                                                  └── PATH=$PREFIX/bin:/system/bin:/system/xbin
```

### W^X 与 SELinux 双约束

Android 10+ targetSdk ≥ 29 强制 W^X（`untrusted_app` SELinux domain 禁 execve `app_data_file`）：

- 所有可执行 binary **必须**编为 `lib*.so` 放 `lib/<abi>/`，APK 安装后解到 `/data/app/<pkg>/lib/<abi>/`（W^X 白名单）
- `$PREFIX/bin/<command>` 全是 symlinks 指向 `/data/app/.../lib/<abi>/lib*.so`，**每次启动重 relink**（APK 升级后 nativeLibraryDir 路径变）
- shebang `#!/usr/bin/env node` 因 `app_data_file` exec 拒被无声 fail：**最终解**改用 mksh **alias**，在 mksh 内展开 inline，execve 直接对准 `libnode.so`

### 三层 cc CLI 更新机制

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Bundled snapshot (assets/local-terminal/cc-cli.tgz)
│   • 每次发 APK 都打包当时 latest                          │
│   • 离线首启可用，不依赖网络                              │
│   • Bootstrapper 解压到 $PREFIX/lib/node_modules/chainlesschain/
└─────────────────────────────────────────────────────────┘
           │ 用户启动 app, 联网
           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Startup opportunistic check (lightweight)      │
│   • app onCreate 触发 OneTimeWorkRequest                │
│   • HEAD 请求看 registry.npmjs.org/chainlesschain latest │
│   • 若有新版置 SharedPreferences flag 让 Layer 3 接手    │
└─────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: WorkManager periodic update (24h)              │
│   • 真正执行 `npm install -g chainlesschain@latest`      │
│   • 失败退避 5s/30s/2min 重试 3 次                       │
│   • Settings 透明反馈"上次检查/上次更新结果"              │
└─────────────────────────────────────────────────────────┘
```

## 配置参考

### PtyEnvironment 注入的环境变量

```bash
PATH=$PREFIX/bin:/system/bin:/system/xbin
HOME=/data/data/<pkg>/files/home
TMPDIR=$PREFIX/tmp
SHELL=$PREFIX/bin/mksh
TERM=xterm-256color
LANG=en_US.UTF-8
PREFIX=/data/data/<pkg>/files/usr
ENV=$PREFIX/etc/profile           # mksh -l 自动 source
LD_LIBRARY_PATH=$PREFIX/lib        # 兜底 patchelf RUNPATH=$ORIGIN
NODE_PATH=$PREFIX/lib/node_modules # cc CLI require 解析路径
CC_UI_HOST=0.0.0.0                 # cc ui 默认绑全网卡（LAN 直连）
CC_UI_TOKEN=<32-hex-持久化>        # cc ui 自动生成的 bearer token

# Layer order: defaults < LLM key envs < caller-provided extras
# 以下为 EncryptedSharedPreferences `llm_config_secure` 自动注入
OPENAI_API_KEY=...      # openai.apiKey
ANTHROPIC_API_KEY=...   # anthropic.apiKey
DEEPSEEK_API_KEY=...    # deepseek.apiKey
DASHSCOPE_API_KEY=...   # qwen.apiKey
GEMINI_API_KEY=...      # gemini.apiKey
VOLCENGINE_API_KEY=...  # volcengine.apiKey
MOONSHOT_API_KEY=...    # moonshot.apiKey
ERNIE_API_KEY=...       # ernie.apiKey
ZHIPU_API_KEY=...       # chatglm.apiKey
SPARK_API_KEY=...       # spark.apiKey
```

### mksh 启动配置

```bash
# $PREFIX/etc/profile  — mksh -l 启动时 source（变量 ENV 指向）
export PATH=$PREFIX/bin:/system/bin:/system/xbin
export PS1='\w \$ '
[ -f $PREFIX/etc/mkshrc ] && . $PREFIX/etc/mkshrc   # Phase 2.5 修：profile 必须显式 source mkshrc

# $PREFIX/etc/mkshrc  — 定义 cc alias（avoid SELinux app_data_file execve 拒）
alias cc='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
alias chainlesschain='$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js'
```

### LocalFilesystemBootstrapper 行为

```kotlin
suspend fun bootstrap(): Result<Unit> = withContext(Dispatchers.IO) {
    // 1. relink libraries from APK lib/<abi>/ (every startup — APK upgrade 后 nativeLibraryDir 变)
    relinkLibrariesFromApk()

    // 2. 始终重写 etc/profile + etc/mkshrc（USR_VERSION 不 bump 也写，<1KB 写无所谓）
    writeStaticFiles()

    // 3. 首次 bootstrap (.bootstrap_version 不匹配) 才解压 usr.tar.xz + cc-cli.tgz
    if (!bootstrapVersionMatches()) {
        extractUsrTarball()      // mksh / toybox / etc/ 结构
        extractCcCliTarball()    // chainlesschain CLI + hydrated node_modules → $PREFIX/lib/node_modules/chainlesschain/
        writeBundledVersion()
    }

    Result.success(Unit)
}
```

### CI workflow 配置

```yaml
# .github/workflows/node-runtime-bundle.yml （aarch64 矩阵）
# 1. 拉 Termux Packages.gz 索引
# 2. 下载 8 .deb: nodejs / libc++ / openssl / libsqlite / libicu / c-ares / zlib / libandroid-support
# 3. ar x → tar 解 data.tar.{xz,gz,zst}
# 4. 收 .so.N → .so 重命名 + patchelf:
#    - --remove-rpath / --set-rpath '$ORIGIN'
#    - --set-soname <basename>
#    - --replace-needed <old.so.N> <new.so>
#    - 重命名 libc++_shared.so → libtermux_cxx.so + 重打 DT_NEEDED
# 5. cd packages/cli && npm pack → 解 → npm install --omit=dev → tar --format=ustar 重打
# 6. 自动 commit 到 jniLibs/arm64-v8a/ + assets/local-terminal/cc-cli.tgz [skip ci]
```

## 性能指标

### 启动与响应

| 指标 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 首启 bootstrap（cold install） | ≤ 10s | ~6s | ✅ |
| 二次启动（已 bootstrap，仅 relink lib） | ≤ 500ms | ~120ms | ✅ |
| `echo hello` 端到端 stdin → stdout | < 50ms | ~25ms | ✅ |
| xterm.js p99 latency（连续 1000 字符回环） | < 30ms | ~18ms（Xiaomi 24115RA8EC） | ✅ |
| Node v25 cold start（`node -v`） | < 800ms | ~400ms | ✅ |
| cc CLI 首次执行（`cc -v`） | < 1.5s | ~1.0s | ✅ |

### 资源占用

| 指标 | 数值 |
| --- | --- |
| APK arm64-v8a Lite 体积 | ~50MB |
| `libnode.so` stripped | ~30MB |
| `cc-cli.tgz` snapshot（hydrated prod deps） | ~40MB |
| `libtoybox.so` | ~600KB |
| mksh binary | ~500KB |
| 1 小时连续使用 APK process RSS | < 80MB（无 leak） |
| idle mksh session RSS | ~3-5MB |
| 多 session 并发上限 | 4（OOM 保护） |

### 真机基线

- **Xiaomi 24115RA8EC**（mid-range, Android 14, ARMv8a）— Phase 2.5 主要验证设备，2026-05-19 `cc -v → 0.162.2` ✅
- Xterm.js 在该机 p99 < 30ms latency gate 通过，无需回退 Compose 原生 AnsiTerminalView
- Bootstrap cold install 实测 6s 解压 + 100ms relink

## 测试覆盖

### 单元测试

```
✅ LocalPtyClientTest.kt              - JNI mock + 多 session 隔离 / shutdown killpg / waitpid 收尸
✅ PhaseMarkerTest.kt                 - Phase 标记常量校验
✅ LocalFilesystemBootstrapperTest.kt - tar 解压 / symlink relink / bootstrap version match
```

### Instrumented 测试（androidTest，跑在真机 / emulator）

```
✅ LocalPtyNativeTest.kt              - 真 JNI openpty / posix_spawn / read/write 回环
✅ LocalPtyClientIntegrationTest.kt   - 真 mksh 起停 + stdin→stdout 端到端
✅ LocalFilesystemBootstrapperTest.kt - 真 bootstrap 首启 + relink 二次启动
✅ LocalTerminalSmokeTest.kt          - E2E：进 RemoteOperate "本地" tab → echo hello
✅ LocalTerminalLatencyBenchmark.kt   - p50/p99 端到端 latency 强制 gate（OQ-1 决策依据）
```

### 真机 E2E 验证场景（Phase 6）

| # | 场景 | 验收 |
| --- | --- | --- |
| 1 | 首启 bootstrap | 解压 $PREFIX ≤ 10s；终端见 motd；`ls /data/data/.../files/usr` 见 `bin/etc/lib` |
| 2 | 基础命令 | `echo hello` 200ms 内 stdout `hello\n` |
| 3 | **`cc -v`** | 返回 `0.162.2`（或 bundled snapshot 版本） |
| 4 | `cc chat` / `cc note add` | LLM 调用成功（密钥已自动桥接）/ 笔记入本地 SQLite |
| 5 | `cc ui` LAN 访问 | 终端起 `cc ui` → 同 WiFi 电脑浏览器开 `http://<手机 IP>:5174` 显示管理面板 |
| 6 | 信号中断 | `sleep 100` → Ctrl+C 200ms 内退出（pty ctty 正确设置） |
| 7 | 多 session | "+ 新建 session" 开第 2 个 → 切来切去 #1 stdout 完整 |
| 8 | 工厂重置 | Settings "工厂重置 $PREFIX" → 重新 bootstrap → cc 仍可用 |

## 安全考虑

### 沙箱与权限

1. **应用沙箱**：本地终端运行在 Android `untrusted_app` SELinux domain 内，与其他 app 数据互相隔离（kernel-level）
2. **默认 sandbox 范围**：仅 `$HOME` 和 `$PREFIX` 内可读写，与其他 app 完全隔离
3. **/sdcard 访问**：Phase 4 Settings 提供 toggle "允许访问外部存储"，开启时调起系统 `MANAGE_EXTERNAL_STORAGE` 授权；默认关
4. **危险命令不拦截**（OQ-6 决策）：用户在自己 sandbox 内 `rm -rf $PREFIX` 是用户权利；提供"工厂重置 $PREFIX"按钮一键 wipe + 重新解压

### LLM 密钥安全

1. **加密存储**：密钥经 `EncryptedSharedPreferences` (AES256_GCM) 落盘，与 app 数据库同等保护级别
2. **环境变量传递**：仅在 pty fork 时一次性注入子进程 envp，**不写文件**、**不留磁盘痕迹**
3. **空值过滤**：`loadLlmKeyEnvs()` 跳过空白 key，cc 直接报"API key not set"而不是误用空字符串
4. **读取失败容错**：EncryptedSharedPreferences 损坏时返回空 map，终端仍可启动（用户可手动设 env）

### cc ui LAN 访问安全

1. **Bearer token 强制**：首次启动 `SecureRandom.nextBytes(16)` 生成 32 hex chars，持久化到 SharedPreferences（与 EncryptedSharedPreferences 同 SELinux UID 隔离）
2. **`0.0.0.0` 绑定 + token gate**：避免开放 WiFi 网络下 LAN 上其他设备直接访问
3. **Token 持久化**：跨 app 升级保留（SharedPreferences 在 `/data/data/<pkg>/shared_prefs/`），用户可在 Settings 重置

### 进程与资源安全

1. **进程组管理**：`LocalPtyClient.shutdown()` 显式 `killpg(-pid, SIGTERM)` → 5s → `SIGKILL`，确保孙进程不泄漏
2. **POSIX_SPAWN 而非 fork**：避免 Android 14+ ART 主动检测 fork-without-immediate-exec 触发 SIGABRT（Trap 7）
3. **TIOCSCTTY 设置控制 tty**：确保 Ctrl+C 能正常发 SIGINT 给前台进程组（Phase 2.5 修一例：`fix(local-terminal): child pty needs ctty for SIGINT delivery`）
4. **多 session OOM 保护**：上限 4 个并发 session，每个 @AssistedInject 独立实例

### 网络与更新安全

1. **HTTPS-only**：cc CLI 升级走 `registry.npmjs.org` HTTPS + npm 内建 integrity check（package.json shasum）
2. **自定义 registry**：用户可改 `$PREFIX/.npmrc` 切镜像（如 `https://registry.npmmirror.com/`），信任责任由用户承担
3. **不允许提权**：cc CLI 自我升级不触发 root / 系统级写入，全部限于 `$PREFIX` 内

## 故障排除

### 常见问题

**Q: 进入"本地" tab 后终端空白，看不到 motd？**

可能原因：
1. Bootstrap 仍在进行中（首启 ~6-10s）— 等 10s 后下拉刷新
2. APK 升级后 lib symlinks 仍指向旧路径 — 重启 app 触发 `relinkLibrariesFromApk()`
3. xterm.js WebView 加载失败 — Settings → 本地终端 → "工厂重置 $PREFIX" → 重启 app

**Q: 敲 `cc -v` 报 `command not found`？**

1. 检查 mksh 是否 source 了 mkshrc：`echo $ENV` 应返回 `$PREFIX/etc/profile`
2. 手动 source 试试：`. $PREFIX/etc/mkshrc` 后再 `cc -v`
3. 如果 mkshrc 找不到 alias，bootstrap 失败：Settings 工厂重置 → 重启
4. 直接走绝对路径试：`$PREFIX/bin/node $PREFIX/lib/node_modules/chainlesschain/bin/chainlesschain.js -v`

**Q: `cc chat` 报 API key 缺失？**

1. 检查 app 主界面 → AI 设置 → 是否已配置某厂商 API key
2. 在终端内 `env | grep API_KEY` 看是否注入成功（密钥经 EncryptedSharedPreferences 桥接到 envp）
3. 若 PtyEnvironment 读取失败，logcat 会输出 `PtyEnv: Failed reading llm_config_secure`；通常 EncryptedSharedPreferences 首次创建竞态导致，重启 app 即恢复
4. 临时绕过：在终端 `export OPENAI_API_KEY=sk-...` 后立刻试 `cc chat`

**Q: `cc ui` 起来后电脑浏览器开 `http://<手机 IP>:5174` 转圈？**

1. 确认手机和电脑在同 WiFi（蜂窝网下手机 IP 是 RFC1918 私网，电脑访问不到）
2. 路由器是否启用 AP isolation（部分公共 WiFi 默认隔离客户端）—— 关闭或换网络
3. cc ui 启动慢（Node 冷启）：等 5-10s 再刷新
4. 端口冲突：终端内 `cc ui --port 5184` 换端口

**Q: APK 升级后终端报 `libnode.so: not found` 或 mksh 启动崩溃？**

1. APK 升级后 `nativeLibraryDir` 路径变（如 `lib-1` → `lib-2`），旧 `$PREFIX/bin/*` symlinks 全失效
2. **每次启动**`LocalFilesystemBootstrapper.bootstrap()` 应自动 relink，若失败 → Settings 工厂重置
3. 检查 logcat `LocalFilesystemBootstrapper` tag 确认 relink 步骤是否抛错

**Q: 多 session 切换后 #1 session 假死？**

1. 这是 Trap 11 — 单测有覆盖，理论不发生；若复现请抓 logcat tag `LocalPtyClient`
2. 临时方案：关闭 #1 session 重开（"+ 新建 session"）
3. 多 session 上限 4 个，达到上限新建按钮灰显

**Q: `sleep 100` + Ctrl+C 后不退出？**

1. Phase 2.5 已修：`fix(local-terminal): child pty needs ctty for SIGINT delivery`（commit `74a6d71d6`）
2. 若仍现：检查 logcat 是否 ART abort（API 34+ fork 检测），需走 posix_spawn 路径

**Q: 安卓某些低端机型解压 $PREFIX 极慢（>30s）？**

1. tar 解析手写 Kotlin 实现，I/O 受限于 eMMC 速度；老机型可能 15-30s
2. Phase 2.5 后续优化方向：并行写 + 跳过已存在文件
3. 若首启卡死：Settings 工厂重置（强制重新 bootstrap，部分场景比 corrupt state 更快）

**Q: 离线场景下 cc 子命令是否都可用？**

可用：`cc note add` / `cc search` / `cc memory query` / `cc skill list` / `cc workflow run`（纯本地）

不可用：`cc chat` / `cc ask`（需 LLM 端点）/ `cc mcp <remote>` / `cc agent`（依赖网络）/ `cc ui`（仅 web 服务起本地 OK，但需 LAN 才有意义）

### 调试模式

```bash
# 终端内打开 mksh xtrace（看每条命令）
set -x

# 查看 cc CLI 详细 trace
DEBUG=* cc chat "..."

# Node.js 详细输出
NODE_OPTIONS='--trace-warnings' cc -v

# 看 LLM 密钥是否注入（不打印值，只看 key 名）
env | grep -i API_KEY | sed 's/=.*/=<redacted>/'

# 查看 $PREFIX 结构
ls -la $PREFIX/bin/ | head
ls -la $PREFIX/lib/node_modules/

# 验证 mksh alias
alias | grep cc
```

## 关键文件

### Phase 2.5 核心文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `android-app/feature-local-terminal/src/main/java/.../LocalFilesystemBootstrapper.kt` | $PREFIX 首启 + tar 解压 + cc CLI extract + symlinks relink | ~600 |
| `android-app/feature-local-terminal/src/main/java/.../LocalPtyClient.kt` | Kotlin pty 包装（@AssistedInject 多 session）+ shutdown killpg | ~400 |
| `android-app/feature-local-terminal/src/main/java/.../PtyEnvironment.kt` | envp 构造 + LLM 密钥桥接 + ccUiToken 持久化 | ~190 |
| `android-app/feature-local-terminal/src/main/java/.../LocalPtyNative.kt` | JNI bindings（nativeOpenPty / nativeSpawn / nativeWrite / nativeRead / nativeSetWinsize / nativeKillpg / nativeWaitpid） | ~120 |
| `android-app/feature-local-terminal/src/main/java/.../LocalTerminalNative.kt` | Native lib 加载入口（`System.loadLibrary("pty_jni")`） | ~30 |
| `android-app/feature-local-terminal/src/main/cpp/pty_jni.cpp` | JNI 实现（posix_spawn + POSIX_SPAWN_SETSID + TIOCSCTTY） | ~300 |
| `android-app/feature-local-terminal/src/main/cpp/CMakeLists.txt` | mksh / toybox / pty_jni CMake 三 ABI 构建 | ~80 |
| `android-app/feature-local-terminal/src/main/java/.../ui/LocalSessionViewModel.kt` | Multi-session ViewModel + 生命周期管理 | ~200 |
| `android-app/feature-local-terminal/src/main/java/.../ui/LocalTerminalScreen.kt` | Compose 壳 + 工具栏（额外按键） | ~250 |
| `android-app/feature-local-terminal/src/main/java/.../ui/LocalTerminalWebView.kt` | xterm.js WebView 桥（JS bridge stdin/onResize） | ~180 |

### Assets 与 jniLibs

| 路径 | 内容 |
| --- | --- |
| `android-app/feature-local-terminal/src/main/assets/local-terminal/cc-cli.tgz` | chainlesschain CLI snapshot（npm pack + `npm install --omit=dev` hydrated + `tar --format=ustar` 重打） |
| `android-app/feature-local-terminal/src/main/assets/local-terminal/xterm.{js,css}` + `addon-fit.js` | xterm.js 终端渲染 |
| `android-app/feature-local-terminal/src/main/assets/local-terminal/xterm-shell.html` | WebView HTML 容器 |
| `android-app/feature-local-terminal/src/main/jniLibs/arm64-v8a/libnode.so` | Termux Node v25 patchelf 重打（RUNPATH=$ORIGIN） |
| `android-app/feature-local-terminal/src/main/jniLibs/arm64-v8a/libtermux_cxx.so` | Termux libc++_shared.so 重命名（避 AGP merge 冲突） |
| `android-app/feature-local-terminal/src/main/jniLibs/arm64-v8a/lib{crypto,ssl,sqlite3,icu*,cares,z,android-support}.so` | Node 8 个直接 DT_NEEDED 依赖 |
| `android-app/feature-local-terminal/src/main/jniLibs/<abi>/libtoybox.so` | toybox 多用途 multi-call binary |

### CI 工作流

| 文件 | 用途 |
| --- | --- |
| `.github/workflows/node-runtime-bundle.yml` | 拉 Termux 8 .deb → patchelf 重打 → npm pack hydrate → 自动 commit 到 jniLibs/ + assets/ |
| `.github/workflows/local-terminal-bundle.yml` | 验 mksh / toybox / pty_jni 三 ABI 编译产出（gate 9 个 .so 都在） |

### 关键 commits（Phase 2.5 一晚串联）

| Commit | 说明 |
| --- | --- |
| `da7457306` | wireCcCliSymlinks 第一版（wrapper script，后被 trap 4 推翻） |
| `baf645b23` | open() probe + wrapper（trap 1+2 修） |
| `839ef3af3` | CI workflow npm install --omit=dev 后再 tar（trap 6 修） |
| `f17b1402b` | CI `tar --format=ustar`（trap 7 修） |
| `9f20c9fb7` | rename Termux libc++_shared.so → libtermux_cxx.so（trap 5 修） |
| `910a3ba6e` | mksh alias 取代 wrapper（trap 4 终极解） |
| `02d1a9342` | 每次 bootstrap 写 etc/（USR_VERSION 不 bump 也写） |
| `209b6c7f1` | profile sources mkshrc（trap 8 修） |
| `a9ef596ab` | bridge app LLM keys to cc CLI via PtyEnvironment |
| `e7419ec95` | key toolbar with Ctrl/Esc/Tab/arrows |
| `74a6d71d6` | child pty needs ctty for SIGINT delivery |
| `cedf0745b` | cc ui binds 0.0.0.0 + auto-token (LAN access) |
| `f3e8d55d0` | refresh Phase 2.5 Node + cc CLI bundle |

## 使用示例

### 首次使用

1. **安装 APK**：从 [GitHub Releases](https://github.com/chainlesschain/chainlesschain/releases) 下载 arm64-v8a Lite 包安装（v5.0.3.65+）
2. **打开 app**：登录任意 DID（无需配对桌面）
3. **进 RemoteOperate**：底部 Tab 切到"远程操控"
4. **切"本地" tab**：在 5-tab segmented control 右侧的第 6 个 tab
5. **等 motd**：首次约 6-10s 解压 $PREFIX，终端显示欢迎信息
6. **敲第一条命令**：

```bash
cc -v
# → 0.162.2

cc --help
# → 列出全部 ~109 个子命令

ls $PREFIX/bin/ | wc -l
# → 250+ toybox 命令 + cc / node / npm 等

env | grep PATH
# → PATH=/data/data/com.chainlesschain.android.debug/files/usr/bin:/system/bin:/system/xbin
```

### 本地知识库管理

```bash
# 添加笔记到本地 SQLite（数据库落在 $HOME/.chainlesschain/）
cc note add "今天学到的：mksh alias 可以绕开 SELinux app_data_file 执行限制"

# 搜索笔记
cc search "SELinux"
cc search "mksh" --limit 5

# 列出最近笔记
cc note list --recent 10

# 查看永久记忆
cc memory list
cc memory query "Android W^X"
```

### LLM 对话（已自动桥接密钥）

```bash
# 用默认 provider（在 app AI 设置里配过的）
cc ask "怎么用 patchelf 改 SONAME？"

# 指定 provider
cc chat --provider deepseek "解释 mksh -l 启动流程"

# 多轮对话（session 持久化）
cc chat --session new-session "你好"
cc chat --session new-session "刚才你说的方案有什么风险？"
```

### cc ui — 手机起 Web 面板，电脑浏览器直连

```bash
# 终端内启动 cc ui（默认 0.0.0.0:5174 + 自动 token）
cc ui

# 输出类似：
# Server listening on http://0.0.0.0:5174
# Bearer token: a1b2c3d4...

# 看手机当前 IP
ifconfig | grep inet

# 电脑浏览器（同 WiFi）开：
# http://<手机 IP>:5174
# 提示输入 token，粘贴上面那串 hex 字符串
```

### Skill 执行

```bash
# 列出全部内置 skill
cc skill list

# 跑 skill
cc skill run web-fetch --url https://example.com
cc skill run codegen --lang python --task "写一个 fibonacci 函数"

# 看 skill 详情
cc skill show codegen
```

### 远程 MCP 服务器（需联网）

```bash
# 列出已配置 MCP
cc mcp list

# 添加 HTTP MCP
cc mcp add my-server -u https://mcp.example.com/sse -t sse

# 用 MCP 工具
cc mcp call my-server tool-name '{"arg":"value"}'
```

### 多 session 并发

```bash
# 在终端 #1 跑长任务
sleep 60 && echo "done"

# 点"+ 新建 session" 开 #2，平行跑别的
cc chat "讲个笑话"

# 切回 #1 看 stdout 完整
# 上限 4 个并发 session
```

### 升级 cc CLI

```bash
# 手动检查更新
npm install -g chainlesschain@latest

# 或在 Settings → 本地终端 → "立即检查更新"

# 切镜像（中国大陆推荐）
npm config set registry https://registry.npmmirror.com/

# 再升级
npm install -g chainlesschain@latest
```

### 工厂重置

终端打不开 / `cc` 找不到 / 怀疑 $PREFIX 损坏时：

1. app 主界面 → Settings → "本地终端"
2. 点"工厂重置 $PREFIX"
3. 确认对话框 → toast "重置完成"
4. 重启 app（首启会重新 bootstrap，约 10s）

## 相关文档

- [Android 用户操作手册 →](/guide/mobile-android-usage)
- [Android v1.0 GA 用户文档 →](/guide/mobile-android)
- [远程终端（手机↔桌面 PTY，对比本地终端）→](/guide/remote-terminal)
- [Android 本地终端设计文档（6 phase + 12 trap）→](/design/Android_Local_Terminal)
- [Android 本地终端 CI Bundle 设计 →](/design/Android_Local_Terminal_CI_Bundle)
- [CLI 命令参考 →](/chainlesschain/cli)
- [多智能体协作 Cowork（cc CLI 入口）→](/chainlesschain/cowork)

---

> 本文档对应 Phase 2.5 真机闭环（2026-05-19）。后续 Phase 5 Full 变体（含 git/python/vim/openssh/curl 大件包）+ Phase 5.7 WorkManager auto-update 设计见 [Android Local Terminal 设计文档](/design/Android_Local_Terminal) §4 §5。
