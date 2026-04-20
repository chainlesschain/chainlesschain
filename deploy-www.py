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

name = "www.chainlesschain.com"
tar_local = r"C:\code\chainlesschain\docs-website-v2\artifacts\chainlesschain-website-v2-v5.0.2.34-20260420-1807.tar.gz"
remote_dir = "/www/wwwroot/www.chainlesschain.com"
tar_remote = f"/tmp/{name}.tar.gz"
staging = f"{remote_dir}.new"
stamp = time.strftime("%Y%m%d-%H%M%S")
backup = f"{remote_dir}.bak-{stamp}"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)
sftp = client.open_sftp()

def run(cmd):
    print(f"[remote] $ {cmd}")
    _, o, e = client.exec_command(cmd)
    out = o.read().decode("utf-8", "replace")
    err = e.read().decode("utf-8", "replace")
    rc = o.channel.recv_exit_status()
    if out: print(out.rstrip())
    if err: print("STDERR:", err.rstrip())
    if rc != 0:
        raise RuntimeError(f"cmd failed rc={rc}: {cmd}")

print(f"[local ] upload {os.path.basename(tar_local)} -> {tar_remote}")
sftp.put(tar_local, tar_remote)

run(f"rm -rf {staging}")
run(f"mkdir -p {staging}")
run(f"tar -xzf {tar_remote} -C {staging}")
# flatten if tar wrapped contents in a single dist/ dir
run(f"if [ -d {staging}/dist ] && [ $(ls {staging} | wc -l) -eq 1 ]; then shopt -s dotglob; mv {staging}/dist/* {staging}/ && rmdir {staging}/dist; fi")
run(f"if [ -d {remote_dir} ]; then mv {remote_dir} {backup}; fi")
run(f"mv {staging} {remote_dir}")
run(f"chown -R www:www {remote_dir} 2>/dev/null || chown -R nginx:nginx {remote_dir} 2>/dev/null || true")
run(f"rm -f {tar_remote}")
run(f"ls {remote_dir}")
print(f"\n[ok] {name} deployed. rollback -> mv {backup} {remote_dir}")

sftp.close()
client.close()
