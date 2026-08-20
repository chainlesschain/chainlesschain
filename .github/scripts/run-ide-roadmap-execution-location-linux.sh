#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <container|ssh> <release-commit> <artifact-dir> <artifact-name>" >&2
  exit 64
fi

transport="$1"
release_commit="$2"
artifact_dir="$3"
artifact_name="$4"
if [[ "$transport" != "container" && "$transport" != "ssh" ]]; then
  echo "unsupported transport" >&2
  exit 64
fi

run_root="$RUNNER_TEMP/cc-execution-location-$transport-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
state_root="$run_root/state"
source_home="$run_root/source-home"
source_security_home="$run_root/source-security"
node_archive="$run_root/node-v22.12.0-linux-x64.tar.gz"
target_repo="$run_root/target-repo"
target_node="/opt/node-22.12.0/bin/node"
node_url="https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.gz"
node_sha256="e05a4d65232ae2b27b3d77da2e368522fb46b923335b8e0d5f77624c32484044"
container_name="cc-location-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
sshd_pid_file="$run_root/sshd.pid"

mkdir -p "$artifact_dir" "$state_root" "$source_home" "$source_security_home" "$target_repo"

matrix_args=(
  --transport "$transport"
  --release-commit "$release_commit"
  --artifact-dir "$artifact_dir"
  --artifact-name "$artifact_name"
  --state-dir "$state_root"
  --source-home "$source_home"
  --source-security-home "$source_security_home"
)

run_matrix() {
  local mode="$1"
  shift
  node packages/cli/scripts/ide-roadmap-execution-location-matrix.mjs \
    --mode "$mode" "${matrix_args[@]}" "${target_args[@]}" "$@"
}

write_bootstrap_failure() {
  local status="$1"
  node -e 'const fs=require("fs"),c=require("crypto");const [p,t,s,h]=process.argv.slice(1);const d="sha256:"+c.createHash("sha256").update(s).digest("hex");fs.writeFileSync(p,JSON.stringify({schema:"chainlesschain.execution-location-bootstrap-failure.v1",transport:t,releaseCommit:h,diagnosticDigest:d,contentEmitted:false})+"\n")' "$artifact_dir/bootstrap-failure.json" "$transport" "$status" "$release_commit"
}

cleanup() {
  if [[ "$transport" == "container" ]]; then
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  elif [[ -f "$sshd_pid_file" ]]; then
    sudo kill "$(cat "$sshd_pid_file")" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'status=$?; if [[ $status -ne 0 ]]; then write_bootstrap_failure "exit-$status"; fi' ERR

target_args=(--target-cwd /unconfigured --target-cli /unconfigured)
run_matrix initialize

curl --fail --location --silent --show-error "$node_url" --output "$node_archive"
echo "$node_sha256  $node_archive" | sha256sum --check --strict

tar --exclude=node_modules --exclude=build -cf "$run_root/repository.tar" .

if [[ "$transport" == "container" ]]; then
  docker run --detach --name "$container_name" ubuntu:24.04 tail -f /dev/null >/dev/null
  docker cp "$run_root/repository.tar" "$container_name:/tmp/repository.tar"
  docker cp "$node_archive" "$container_name:/tmp/node.tar.gz"
  docker exec "$container_name" bash -lc "set -euo pipefail; mkdir -p /opt/cc-target-repo /opt/node-22.12.0 /var/lib/cc-location/target-home /var/lib/cc-location/target-security; tar -xf /tmp/repository.tar -C /opt/cc-target-repo; tar -xzf /tmp/node.tar.gz --strip-components=1 -C /opt/node-22.12.0; cd /opt/cc-target-repo/packages/cli; /opt/node-22.12.0/bin/npm install --omit=optional --ignore-scripts --no-package-lock; printf '%s\n' 'CC_IDE_TARGET_NODE=/opt/node-22.12.0/bin/node' 'CC_IDE_TARGET_ENTRY=/opt/cc-target-repo/packages/cli/src/index.js' 'CC_IDE_TARGET_HOME=/var/lib/cc-location/target-home' 'CC_IDE_TARGET_SECURITY_HOME=/var/lib/cc-location/target-security' > /tmp/cc-ide-roadmap-target.env; chmod 600 /tmp/cc-ide-roadmap-target.env; chmod +x /opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh"
  target_args=(
    --target-cwd /opt/cc-target-repo
    --target-cli /opt/cc-target-repo/.github/scripts/ide-roadmap-execution-location-target.sh
    --container "$container_name"
  )
else
  tar -xf "$run_root/repository.tar" -C "$target_repo"
  mkdir -p "$run_root/target-node" "$run_root/target-home" "$run_root/target-security" "$run_root/sshd"
  tar -xzf "$node_archive" --strip-components=1 -C "$run_root/target-node"
  (cd "$target_repo/packages/cli" && "$run_root/target-node/bin/npm" install --omit=optional --ignore-scripts --no-package-lock)
  cat > /tmp/cc-ide-roadmap-target.env <<EOF
CC_IDE_TARGET_NODE=$run_root/target-node/bin/node
CC_IDE_TARGET_ENTRY=$target_repo/packages/cli/src/index.js
CC_IDE_TARGET_HOME=$run_root/target-home
CC_IDE_TARGET_SECURITY_HOME=$run_root/target-security
EOF
  chmod 600 /tmp/cc-ide-roadmap-target.env
  chmod +x "$target_repo/.github/scripts/ide-roadmap-execution-location-target.sh"
  ssh-keygen -q -t ed25519 -N '' -f "$run_root/client-key"
  install -d -m 700 "$run_root/sshd/user-ssh"
  install -m 600 "$run_root/client-key.pub" "$run_root/sshd/user-ssh/authorized_keys"
  sudo install -d -m 755 /run/sshd
  cat > "$run_root/sshd_config" <<EOF
Port 2222
ListenAddress 127.0.0.1
PidFile $sshd_pid_file
AuthorizedKeysFile $run_root/sshd/user-ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
UsePAM no
StrictModes no
Subsystem sftp internal-sftp
EOF
  start_sshd() {
    sudo /usr/sbin/sshd -f "$run_root/sshd_config" -E "$run_root/sshd.log"
    for _ in {1..100}; do
      [[ -s "$sshd_pid_file" ]] && return 0
      sleep 0.05
    done
    return 1
  }
  start_sshd
  ssh-keyscan -p 2222 127.0.0.1 > "$run_root/known-hosts" 2>/dev/null
  chmod 600 "$run_root/known-hosts" "$run_root/client-key"
  target_args=(
    --target-cwd "$target_repo"
    --target-cli "$target_repo/.github/scripts/ide-roadmap-execution-location-target.sh"
    --ssh-host 127.0.0.1
    --ssh-port 2222
    --ssh-user "$(whoami)"
    --known-hosts "$run_root/known-hosts"
    --identity-file "$run_root/client-key"
  )
fi

run_matrix prepare-reconnect
if [[ "$transport" == "container" ]]; then
  docker stop "$container_name" >/dev/null
else
  sudo kill "$(cat "$sshd_pid_file")"
  for _ in {1..100}; do
    [[ ! -e "$sshd_pid_file" ]] && break
    sleep 0.05
  done
fi
run_matrix probe-unavailable
if [[ "$transport" == "container" ]]; then
  docker start "$container_name" >/dev/null
else
  start_sshd
fi
run_matrix complete-reconnect
run_matrix campaign --iterations 99
run_matrix finalize
trap - ERR
