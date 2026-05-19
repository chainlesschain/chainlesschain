"""Official deploy script for chainlesschain web properties.

Deploys all 3 sites (docs / design / www) in one run with:
  - SFTP keepalive (15s) so the remote firewall doesn't RST mid-upload
  - 5x retry with backoff on transient socket drops
  - Atomic swap: stage to `<dir>.new`, move `<dir>` to `<dir>.bak-<ts>`, mv staging into place

Update DEPLOYS[*].local_tar to point at fresh artifacts before running.
Requires DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASS in .env (gitignored).
"""
import paramiko, os, sys, time
from pathlib import Path

def _load_dotenv(path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

_load_dotenv(Path(__file__).resolve().parent.parent / ".env")

HOST = os.environ.get("DEPLOY_HOST")
USER = os.environ.get("DEPLOY_USER")
PASS = os.environ.get("DEPLOY_PASS")
if not (HOST and USER and PASS):
    sys.exit("ERROR: set DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASS in .env or environment")

DEPLOYS = [
    # 2026-05-09 v5.0.3.44 滚动更新 (3 站全刷):
    # (1) Added: 截图 OCR LLM 引擎 (39b16e29f) — engine=auto/llm/tesseract 三态;
    #     auto 默认走火山豆包视觉 (已配置), LLM 出错带 fallbackFrom/fallbackReason
    #     标签自动降级 Tesseract; V5/V6/web-panel 三处 dialog UI 各加 a-select +
    #     蓝/灰/橙三色 tag。
    # (2) Fixed: chat intent understand 90s wall-clock 兜底 (6cbd04c50);
    #     compliance-ipc 死 handler 清理 (29006decf, typo 前缀 compliance-classify:*
    #     无人调用且背后 service 跟真路径不同); macOS 临时目录路径断言修复
    #     (bb2c16656, /var → /private/var symlink, fs.realpathSync 规范化)。
    # (3) Tests: audit-ipc.js 首次单测 (b092673be) — 18 channel + DI 改造 + 23 用例。
    # 顺手 ship: chainlesschain CLI 0.161.4 → 0.161.5 atomic bump (c61de71eb)
    #          为 ipcGuard fixes (af92e0162 + 11247a957) 在 release pipeline
    #          cli-tests 上的测试覆盖。
    #
    # 改动: 根 CHANGELOG.md + docs-site/docs/changelog.md 新增 v5.0.3.44 entry;
    # index.md + chainlesschain/overview.md + docs-site-design/docs/index.md
    # tagline .43 → .44 + 加 LLM OCR / audit-ipc 关键词;
    # docs-website-v2/src/pages/{index,en/index}.astro highlights 顶一张
    # "v5.0.3.44" 卡 (中英对照); README.md / README_EN.md 顶部发布块 +
    # Current Version + Latest Update 块同步。release-sizes.json 自动 refresh
    # 到 v5.0.3.44 (GitHub Release published 2026-05-08T15:43:18Z, 28 assets).
    # 2026-05-09 15:29 全量 3 站刷新:
    # (1) www: 移动端 hamburger 菜单 (15:09 已 deploy 一次) + 文档/footer/header 链接改指
    #     /chainlesschain/overview.html + 4 处 "CLI 文档" CTA 改指 /chainlesschain/cli.html。
    # (2) docs: 头部 logo 与 favicon 之前 404 (config 引用 /logo.png + /favicon.ico
    #     但仓库里从无 public/ 目录) — 新建 docs/public/ 含 5 个 logo 文件 (.png/.webp +
    #     32/64/128) + config head 改用 PNG icon 多档 (匹配 www 模式)。
    # (3) design: 同 docs 的 logo+favicon 404 老 bug, 同步修。
    # 2026-05-12 v5.0.3.48 滚动更新 (3 站全刷):
    # (1) Android v1.0 RFC M3 capture suite 5/5 全部进代码层 — VoiceMode 连续语音 (47bebed80) /
    #     CameraOCR 拍照入 KB (a69269ced) / LocationTagger FusedLocation + Foreground Service
    #     (3f5ac8647) / SharePayloadFlusher 接 SyncCoordinator (3d1a6e3a8) / PushNotifier 4 channel +
    #     FCM 骨架 (c0d990c91)。
    # (2) Android M4 收尾 — RemoteSkillRegistry method-level 元数据 + MethodMetadata accessor 套
    #     (6e49270fd) / ApprovalUI 4-category + ProgressViewer 长时任务面板 (f4f83cc67) / §8.3 alias
    #     兼容窗口 (0bc8e2797) / §8.1 README + v1.0 GA 检查清单 (3da484e9c)。
    # (3) Tests: 187 新单测全绿 / Android 总单测 196+ → 383+。Desktop store 26 文件 / 773 测 ✓；
    #     CLI lib 169 文件 / 7185 测 ✓ (确认 Android 工作未污染 desktop / CLI 路径)。
    # 改动: 根 CHANGELOG.md + docs-site/docs/changelog.md v5.0.3.48 entry 已落 (CLI 修正
    # 0.161.7→0.161.8); docs-site/docs/index.md + docs-site-design/docs/index.md tagline 升 .48;
    # docs-site/docs/chainlesschain/overview.md ⭐ 块升 .48; docs-website-v2/src/pages/{index,
    # en/index}.astro 顶一张 v5.0.3.48 卡 (中英对照); README.md + README_EN.md badge / CLI
    # badge / ⭐ Current Version 块同步 .48 / 0.161.8。CLI npm 0.161.7 → 0.161.8 (CLI 自身 0 源码
    # 改动，force publish 走 release.yml 同步轨道)。Android versionCode 37 / versionName 0.37.0
    # 不变 (仍在 v1.0 RFC 实施轨道，GA flip 待 M7)。
    # 2026-05-14 v5.0.3.50 滚动更新 (3 站全刷):
    # Plan C Android Remote Operate signaling-forward RPC 落地:
    #   - SignalingRpcClient (mobile RPC entry) + 30s withTimeout + LAN→relay 自动 fallback
    #   - RemoteOperateScreen + ViewModel (3 chip buttons + JSON 响应 + NavGraph)
    #   - PairedDesktopsStore SharedPreferences 持久化已配对桌面 idempotent by pcPeerId
    #   - Desktop RelayClient outbound wss://signaling.chainlesschain.com 长连 + 指数退避自重连
    #   - mobile-bridge.handlePairAckFromRelay bug fix (?. 静默吞 relay pair-ack 修复)
    #   - MobileBridgeHeaderStatus.vue header 显示已配对 mobile 数量 5s 轮询
    #   - 11 i18n 字符串 → values/strings.xml + values-zh-rCN/strings.xml
    #   - 3 新单测文件 / 20 测试全绿 (PairedDesktopsStore 7 + SignalingRpc 7 + RemoteOperateVM 6)
    #   - 设计文档 Android_Remote_Operate_Plan_C.md (新增)
    # 改动: README + README_EN 加 2026-05-13 v5.0.3.50 section;
    # docs-site/docs/index.md tagline .49 → .50 + 加 Plan C 摘要;
    # docs-website-v2/src/pages/{index,en/index}.astro 顶一张 v5.0.3.50 卡 (中英对照);
    # 设计文档同步 docs-site/docs/design/ + docs-site-design/docs/ (147 files synced).
    # 2026-05-15 v5.0.3.55 滚动更新 (3 站全刷):
    # (1) iOS Phase 1+2+3+4 完整移植 (commits c30b415a8 → 5877b5d84): 桌面配对三流 +
    #     远程终端 + 远程操控 framework + 4 typed skill + Notification skill。~313 单测
    #     across 26+ suites / 4 设计文档 / 4 trap memory。镜像 Android 已 Xiaomi 真机
    #     E2E 验证版，UI 信息架构 1:1。剩 Phase 1.7 / 2.7 / 3.7 / 4.7 真机 E2E 移交用户。
    # (2) #21 P1 主体 5/5 全闭环: A.1 Linux native 配对 (cc pair preflight + cc pair
    #     token 子命令组 + systemd hardening 模板 + docs/linux/PAIRING.md 9 段指南) +
    #     A.2 三端 UI consistency 设计文档 v0.1 + B.1 web-shell 私钥签字 UI + B.5 跨链桥
    #     m-of-n 多签 Layer 1+2 + C.1 wear→phone voice forward。~270 单测。
    # (3) CLI 0.161.12 → 0.162.0 minor: cc pair preflight + cc pair token 子命令组。
    # (4) Continuation 泄漏 P0 修 — RemoteCommandClient.invoke + waitForAnswer。
    # 改动: 根 CHANGELOG.md + docs-site/docs/changelog.md [Unreleased] → [v5.0.3.55]
    # rename; docs-site/docs/index.md + docs-site-design/docs/index.md tagline v54 → v55
    # + CLI 0.161.12 → 0.162.0 + Android 5.0.3.54 → 5.0.3.55 (versionCode 503054 → 503055);
    # docs-site/docs/chainlesschain/overview.md 当前版本块同步; docs-website-v2/src/pages/
    # {index,en/index}.astro highlights 顶一张 v5.0.3.55 iOS Phase 1-4 + #21 P1 5/5 卡
    # (中英对照, results-only per feedback_official_site_results_only.md); mobile.astro
    # chip "#21 P1 主体 5/5 unreleased" → "v5.0.3.55"; release-sizes.json 自动 refresh
    # 到 v5.0.3.55 (GitHub Release published 2026-05-15T10:44:06Z, 18 assets: 8 desktop +
    # 4 Android + iOS placeholder + 3 latest.yml + 3 blockmap)。fix iOS Phase 2/3/4 设计
    # 文档 prose 中 unescaped <code>/<commit>/<source> 致 VitePress build fail (Vue 把
    # <code> 当 HTML start tag)。
    # 2026-05-17 v5.0.3.57 滚动更新 (3 站全刷):
    # Android 远程文件 skill 接通 (commits 3463e059a + a84b1c075 + dfcaed668):
    #   - Plan C Android↔PC 文件传输 完整 UX: 浏览 PC 任意目录无 sandbox / 上传到 PC
    #     Downloads 防覆盖 (1)/(2) 后缀 / 下载到手机公共 Download 目录走 MediaStore.Downloads
    #     + Intent.ACTION_VIEW app 内打开 / 本机下载文件夹 app 内 LazyColumn 浏览。
    #   - desktop-app-vue/src/main/remote/handlers/android-file-handler.js 460 行新写,
    #     11 个 action 字段对齐 Android FileCommands.kt。
    #   - 一晚扫平 6 互锁雷: P2PClient skip guard 太宽 / Plan C 不调 connect / handleFileCommand
    #     弹 PC 框 + 缺 listDirectory case / FileTransferHandler sandbox 在 userData /
    #     checksum sha256-prefix vs md5 自删 / getExternalFilesDir 用户找不到。
    #   - 34 新单测全绿 (PC vitest 30 + Android RemoteCommandClient 4)。
    #   - Xiaomi 24115RA8EC × Win desktop 真机 E2E 8 场景全跑通。
    # 改动: 根 CHANGELOG.md + docs-site/docs/changelog.md v5.0.3.57 entry 已落;
    # docs-site/docs/index.md + docs-site-design/docs/index.md tagline v55 → v57 +
    # 加远程文件 skill 摘要; docs-site/docs/chainlesschain/overview.md ⭐ 当前版本块同步;
    # docs-website-v2/src/pages/{index,en/index}.astro highlights 顶一张 v5.0.3.57 卡 (中英对照);
    # docs-website-v2/src/pages/mobile.astro 加 🎯 重点功能 远程文件 section;
    # docs-site/docs/.vitepress/config.js sidebar 加 remote-file 链接;
    # docs-site/docs/guide/remote-file.md 新建用户文档; docs/design/Android_Remote_File_Skill.md
    # 新建设计文档 (~240 行); sync-design-docs.js + sync-docs.js 各加 1 entry 让设计文档自动
    # 落到两 doc-site 副本; release-sizes.json 自动 refresh 到 v5.0.3.57 (GitHub Release
    # published 2026-05-16T17:58:49Z, 18 assets: 8 desktop + 4 Android + latest.yml × 3
    # + blockmap × 3)。
    # 2026-05-19 v5.0.3.64 滚动更新 (3 站全刷):
    # 在 v5.0.3.57 之后又跨 7 版 (.58-.64)。本批 tagline + 重点卡片 + 重建 + 部署：
    # (1) iOS Phase 5 AI Chat 收口 — 4 真实 bug 修 (finalizeStreamingPlaceholder
    #     空字符串穿透 / deleteConversation 半回滚 / sendMessage 缺 stream-in-flight guard /
    #     selectConversation stale streamId) + 4 集成测试 (events fan-out / cancel 顺序 /
    #     offline drain / 多对话隔离) + 单测 41→45 iOS 总单测 ~313→~358。
    # (2) iOS Phase 6 sprint — 一晚 19 commits 落 Phase 6.3 Knowledge 30 method +
    #     6.4 AI Extended 25 method 全 hybrid (OQ-3.2/3.3 收口) + 15 main tab UI +
    #     多模态 v0.3 实时录音 AVAudioRecorder + Agent streaming runAgentStream +
    #     iOS poll loop + Agents UI live。绿基线 1fb947b32。
    # (3) v5.0.3.63 — iOS 16 PIN 闪退修 (AppState.swift MainActor.assumeIsolated →
    #     Task @MainActor) + AppIcon 全幅 + Sub-phase 5-6 LOCAL 项目终端体验。
    # (4) v5.0.3.62 — iOS deployment target iOS 17 → iOS 16 (覆盖 iPhone 8+)。
    # (5) v5.0.3.61 — iOS CI 真签名 .ipa 出包 (Hua Zhang 团队 ad-hoc, 7.7MB)。
    # (6) v5.0.3.64 — iOS 版本号 4 段制 + AppConstants stale 硬编码清零
    #     (0.32.0/32/com.chainlesschain.ios → Bundle.main 动态读 + 5 helper) +
    #     596 .swift 跑 29 pattern audit 0 iOS 17 API 违规 + 18 unit + 7 integration +
    #     2 UITest 三层覆盖锁版本号显示 + PIN 解锁不崩两类回归。
    # 改动: docs-site/docs/index.md + docs-site-design/docs/index.md tagline 升 v5.0.3.64 +
    # CLI 0.162.0 → 0.162.1 + Android 5.0.3.57 → 5.0.3.64 (versionCode 503057 → 503064);
    # docs-website-v2/src/pages/{index,en/index}.astro highlights 顶一张 v5.0.3.64 卡 (中英对照);
    # 修 docs-site/docs/changelog.md:58 unescaped <path> Vue parse fail.
    # 2026-05-19 22:36 v5.0.3.67 滚动更新 (3 站全刷):
    # Android Phase 5.6/5.8 cc-exec NL Chat — 用户大白话直接问，AI 自动调本机 cc CLI 跑只读查询:
    #   - Phase 5.6 LLM tool-use 协议接通: OpenAI (tool_calls + type:function 信封) /
    #     Doubao (wire-compat 直 delegate) / Claude (tool_use 内容块 + tool_result 走 role=user)
    #     三家原生 tool-use; 不支持的厂商 (Qwen / Ernie / Spark 等) 自动走"防幻觉 fallback"
    #     明确告知用户切模型而不是编笔记。
    #   - Phase 5.7 cc Chat 屏: 个人中心入口 + 5 状态进度条 (思考 / 准备调用 / 执行 cc /
    #     处理结果 / 整理) + 工具卡片 (命令 + exitCode + 耗时 + stdout 折叠展开 + 取消按钮)。
    #     8 个只读子命令白名单 (note list/show/view / search / memory list/show / skill list /
    #     status / session list / mcp list / did show), 写/删/安装类 LLM 编也被拦 (exitCode=126),
    #     ProcessBuilder 绕过 shell 无注入风险。
    #   - Phase 5.8 真机 E2E SOP: 9 场景 E1-E9 reproducer + preflight 脚本
    #     android-app/scripts/e2e/phase_5_8_preflight.ps1; 待 Xiaomi 24115RA8EC 真机跑通。
    #   - 静态审计 + bug 修复: CcExecService 双 async drain 解 JVM pipe buffer 死锁 /
    #     CcChatOrchestrator.runFallback 不再 silently 丢 StreamChunk.error / CcAllowlist.check
    #     拒 "有 allowedSubcommands 但无子命令"。
    #   - 测试覆盖: 127 新测试全绿 (feature-ai 89 单测 + :app 28 集成测试走真生产图)。
    # 改动: README.md + README_EN.md 顶部新加 2026-05-19 v5.0.3.67 section (中英对照);
    # docs-site/docs/changelog.md v5.0.3.67 entry 已落;
    # docs-site/docs/.vitepress/config.js + docs-site-design/docs/.vitepress/config.js
    # sidebar 各加 2 entry (Phase 5.8 SOP + Checklist) + 老条目去 ⭐NEW;
    # docs-website-v2/src/pages/index.astro highlights 顶一张 v5.0.3.67 cc Chat 卡 (中文,
    # results-only per feedback_official_site_results_only.md);
    # docs-website-v2/src/pages/mobile.astro 新增 "cc Chat 自然语言查询" section
    # (含 "默认安全 / 流式状态可视" 双卡 + 3-grid 支持模型/测试覆盖/底层 + 用户文档/SOP 链接)。
    # 注: release-sizes.json 仍指向 v5.0.3.66 (release v5.0.3.67 仍在 build, 4/5 jobs in_progress);
    # mobile.astro 下载链接仍走 .66 ANDROID_TAG, 待 release publish 后再刷一次 release-sizes
    # 重 build + 重 deploy 即可让下载切到 .67 (Per memory feedback_android_tag_follows_desktop.md)。
    {
        "name": "docs.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-site\artifacts\chainlesschain-docs-v5.0.3.67-20260519-223607.tar.gz",
        "remote_dir": "/www/wwwroot/docs.chainlesschain.com",
    },
    {
        "name": "design.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-site-design\artifacts\design-docs-v5.0.3.67-20260519-223607.tar.gz",
        "remote_dir": "/www/wwwroot/design.chainlesschain.com",
    },
    {
        "name": "www.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-website-v2\artifacts\chainlesschain-website-v2-v5.0.3.67-20260519-223607.tar.gz",
        "remote_dir": "/www/wwwroot/www.chainlesschain.com",
    },
]

stamp = time.strftime("%Y%m%d-%H%M%S")

def new_client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=60, banner_timeout=60, auth_timeout=60)
    t = c.get_transport()
    t.set_keepalive(15)
    t.use_compression(False)
    t.window_size = 2147483647
    t.packetizer.REKEY_BYTES = pow(2, 40)
    t.packetizer.REKEY_PACKETS = pow(2, 40)
    return c

def run(client, cmd):
    print(f"[remote] $ {cmd}")
    _, o, e = client.exec_command(cmd, timeout=120)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    rc = o.channel.recv_exit_status()
    if out: print(out.rstrip())
    if err: print("STDERR:", err.rstrip())
    if rc != 0:
        raise RuntimeError(f"cmd failed rc={rc}: {cmd}")

def upload_with_retry(local, remote, max_attempts=5):
    last_err = None
    for attempt in range(1, max_attempts + 1):
        try:
            client = new_client()
            sftp = client.open_sftp()
            # Tune sftp for large files: bigger window, max_packet_size
            ch = sftp.get_channel()
            ch.in_window_size = 2097152
            ch.out_window_size = 2097152
            ch.in_max_packet_size = 32768
            ch.out_max_packet_size = 32768
            print(f"[local ] upload attempt {attempt}: {os.path.basename(local)} -> {remote}")
            sftp.put(local, remote)
            sftp.close()
            client.close()
            return
        except (paramiko.ssh_exception.SSHException, EOFError, OSError) as ex:
            last_err = ex
            print(f"[local ] attempt {attempt} failed: {ex.__class__.__name__}: {ex}")
            try:
                client.close()
            except Exception:
                pass
            if attempt < max_attempts:
                wait = 5 * attempt
                print(f"[local ] retrying in {wait}s...")
                time.sleep(wait)
    raise last_err

for d in DEPLOYS:
    name = d["name"]
    tar_local = d["local_tar"]
    remote_dir = d["remote_dir"]
    tar_remote = f"/tmp/{name}.tar.gz"
    staging = f"{remote_dir}.new"
    backup = f"{remote_dir}.bak-{stamp}"

    print(f"\n=== Deploying {name} ===")
    upload_with_retry(tar_local, tar_remote)

    client = new_client()
    try:
        run(client, f"rm -rf {staging}")
        run(client, f"mkdir -p {staging}")
        run(client, f"tar -xzf {tar_remote} -C {staging}")
        run(client, f"if [ -d {staging}/dist ] && [ $(ls {staging} | wc -l) -eq 1 ]; then shopt -s dotglob; mv {staging}/dist/* {staging}/ && rmdir {staging}/dist; fi")
        run(client, f"if [ -d {remote_dir} ]; then mv {remote_dir} {backup}; fi")
        run(client, f"mv {staging} {remote_dir}")
        run(client, f"chown -R www:www {remote_dir} 2>/dev/null || chown -R nginx:nginx {remote_dir} 2>/dev/null || true")
        run(client, f"rm -f {tar_remote}")
        run(client, f"ls {remote_dir} | head -5")
        print(f"[ok    ] {name} deployed. rollback -> mv {backup} {remote_dir}")
    finally:
        client.close()

print("\nAll done.")
