import paramiko, os, time

HOST = "47.111.5.128"
USER = "root"
PASS = "WWW@chain"

name = "www.chainlesschain.com"
tar_local = r"C:\code\chainlesschain\docs-website-v2\artifacts\chainlesschain-website-v2-v5.0.2.10-20260418.tar.gz"
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
run(f"if [ -d {remote_dir} ]; then mv {remote_dir} {backup}; fi")
run(f"mv {staging} {remote_dir}")
run(f"chown -R www:www {remote_dir} 2>/dev/null || chown -R nginx:nginx {remote_dir} 2>/dev/null || true")
run(f"rm -f {tar_remote}")
run(f"ls {remote_dir}")
print(f"\n[ok] {name} deployed. rollback -> mv {backup} {remote_dir}")

sftp.close()
client.close()
