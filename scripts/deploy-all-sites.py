#!/usr/bin/env python3
"""Deploy 3 chainlesschain sites to 47.111.5.128 via paramiko.
One password prompt; uploads www-v2, docs, design sequentially.
"""
import os
import sys
import stat
import getpass
import posixpath
from pathlib import Path

import paramiko

# Windows default stdout codec is GBK, which can't encode ✅/✗ in our prints.
# Force UTF-8 so the same script runs cleanly on POSIX and on cmd.exe / PowerShell.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

HOST = "47.111.5.128"
USER = "root"
ROOT = Path(__file__).resolve().parent.parent

SITES = [
    ("官网 v2",     ROOT / "docs-website-v2" / "dist",
                    "/www/wwwroot/www.chainlesschain.com"),
    ("用户文档",    ROOT / "docs-site" / "docs" / ".vitepress" / "dist",
                    "/www/wwwroot/docs.chainlesschain.com"),
    ("设计文档",    ROOT / "docs-site-design" / "docs" / ".vitepress" / "dist",
                    "/www/wwwroot/design.chainlesschain.com"),
]


def sftp_mkdirs(sftp, remote_dir):
    """Recursively create remote directory (like mkdir -p)."""
    parts = remote_dir.strip("/").split("/")
    cur = ""
    for p in parts:
        cur = cur + "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def sftp_upload_tree(sftp, local_dir: Path, remote_dir: str):
    """Recursively upload a local dir to remote_dir."""
    count = 0
    for root, dirs, files in os.walk(local_dir):
        rel = os.path.relpath(root, local_dir).replace("\\", "/")
        rdir = remote_dir if rel == "." else posixpath.join(remote_dir, rel)
        sftp_mkdirs(sftp, rdir)
        for name in files:
            lpath = os.path.join(root, name)
            rpath = posixpath.join(rdir, name)
            sftp.put(lpath, rpath)
            count += 1
            if count % 50 == 0:
                print(f"    ... {count} files uploaded")
    return count


def exec_cmd(ssh, cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd)
    rc = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return rc, out, err


def main():
    # sanity
    for label, local, _ in SITES:
        if not local.is_dir():
            print(f"✗ missing local build: {local}")
            sys.exit(1)

    print(f"==> connecting to {USER}@{HOST} ...")
    password = os.environ.get("CC_DEPLOY_PASSWORD") or getpass.getpass(
        f"{USER}@{HOST} password: "
    )

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=password, timeout=30,
                allow_agent=False, look_for_keys=False)

    sftp = ssh.open_sftp()

    for i, (label, local, remote) in enumerate(SITES, 1):
        print(f"\n==> {i}/3  {label}  → {remote}")
        # ensure remote exists & clear
        sftp_mkdirs(sftp, remote)
        rc, out, err = exec_cmd(ssh, f"rm -rf {remote}/*  {remote}/.[!.]*  2>/dev/null; echo cleared")
        print(f"   cleared remote dir")
        n = sftp_upload_tree(sftp, local, remote)
        print(f"   uploaded {n} files from {local}")

    sftp.close()
    ssh.close()
    print("\n✅ All 3 sites deployed.")
    print("Verify:")
    print("  https://www.chainlesschain.com/")
    print("  https://docs.chainlesschain.com/")
    print("  https://design.chainlesschain.com/")


if __name__ == "__main__":
    try:
        main()
    except paramiko.AuthenticationException:
        print("\n✗ AUTH FAILED — wrong password.")
        sys.exit(2)
    except Exception as e:
        print(f"\n✗ {type(e).__name__}: {e}")
        sys.exit(1)
