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

_load_dotenv(Path(__file__).resolve().parent / ".env")

HOST = os.environ.get("DEPLOY_HOST")
USER = os.environ.get("DEPLOY_USER")
PASS = os.environ.get("DEPLOY_PASS")
if not (HOST and USER and PASS):
    sys.exit("ERROR: set DEPLOY_HOST / DEPLOY_USER / DEPLOY_PASS in .env or environment")

DEPLOYS = [
    {
        "name": "docs.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-site\artifacts\chainlesschain-docs-v5.0.3.1-20260427-0021.tar.gz",
        "remote_dir": "/www/wwwroot/docs.chainlesschain.com",
    },
    {
        "name": "design.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-site-design\artifacts\design-docs-v5.0.3.1-20260427-0021.tar.gz",
        "remote_dir": "/www/wwwroot/design.chainlesschain.com",
    },
    {
        "name": "www.chainlesschain.com",
        "local_tar": r"C:\code\chainlesschain\docs-website-v2\artifacts\chainlesschain-website-v2-v5.0.3.1-20260427-0021.tar.gz",
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
