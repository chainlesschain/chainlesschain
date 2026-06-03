"""One-shot www-only redeploy. Reuses scripts/deploy-all.py logic with a single DEPLOYS entry.

Use case: minor content fixes on www.chainlesschain.com that don't justify a full 3-site redeploy
(e.g., stale chip cleanup, typo fix). Run from project root: `python scripts/deploy-www-only.py`.
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

# Edit local_tar before running.
DEPLOY = {
    "name": "www.chainlesschain.com",
    "local_tar": r"C:\code\chainlesschain\docs-website-v2\artifacts\chainlesschain-website-v2-v5.0.3.66-20260519-141017.tar.gz",
    "remote_dir": "/www/wwwroot/www.chainlesschain.com",
}

stamp = time.strftime("%Y%m%d-%H%M%S")

def new_client():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASS, timeout=60, banner_timeout=60, auth_timeout=60)
    t = c.get_transport()
    t.set_keepalive(15)
    t.use_compression(False)
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

name = DEPLOY["name"]
tar_local = DEPLOY["local_tar"]
remote_dir = DEPLOY["remote_dir"]
tar_remote = f"/tmp/{name}.tar.gz"
staging = f"{remote_dir}.new"
backup = f"{remote_dir}.bak-{stamp}"

print(f"\n=== Deploying {name} (www-only) ===")
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

print("\nDone.")
