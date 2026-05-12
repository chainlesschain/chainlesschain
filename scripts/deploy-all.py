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
    {
        "name": "docs.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-site\artifacts\chainlesschain-docs-v5.0.3.48-20260512-0833.tar.gz",
        "remote_dir": "/www/wwwroot/docs.chainlesschain.com",
    },
    {
        "name": "design.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-site-design\artifacts\design-docs-v5.0.3.48-20260512-0833.tar.gz",
        "remote_dir": "/www/wwwroot/design.chainlesschain.com",
    },
    {
        "name": "www.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-website-v2\artifacts\chainlesschain-website-v2-v5.0.3.48-20260512-0842.tar.gz",
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
