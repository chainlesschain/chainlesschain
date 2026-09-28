/** Linux-only Docker network enclosure. The host policy proxy owns the UDS.
 * This module does not grant domain policy authority or claim Docker attestation.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import broker from "./process-execution-broker/index.js";

const PORT = 3128;
const LABEL = "chainless.egress.owner";
const CLEANUP_TIMEOUT_MS = 5_000;
const RECONCILE_ATTEMPTS = 3;
const RELAY = `const net=require('node:net');
const sockets=new Set();
const server=net.createServer(c=>{
 const u=net.connect('/egress.sock'); sockets.add(c); sockets.add(u);
 const close=()=>{c.destroy();u.destroy();sockets.delete(c);sockets.delete(u)};
 c.on('error',close);u.on('error',close);c.on('close',close);u.on('close',close);
 c.pipe(u);u.pipe(c);
});
server.on('error',()=>process.exit(71));
const preflight=net.connect('/egress.sock');
preflight.on('error',()=>process.exit(72));
preflight.on('connect',()=>{preflight.destroy();server.listen(${PORT},'127.0.0.1',()=>console.log('EGRESS_READY'))});
process.on('SIGTERM',()=>{for(const s of sockets)s.destroy();server.close(()=>process.exit(0))});`;

// Default-deny, deliberately narrower than Docker's general purpose profile.
// No socketpair, io_uring, namespace/mount, ptrace or cross-process FD imports.
const ORDINARY_SYSCALLS =
  `read write readv writev pread64 pwrite64 close close_range
fstat newfstatat stat lstat statx access faccessat faccessat2 open openat getdents getdents64
lseek dup dup2 dup3 fcntl ioctl pipe pipe2 poll ppoll select pselect6 epoll_create
epoll_create1 epoll_ctl epoll_wait epoll_pwait epoll_pwait2 eventfd eventfd2
mmap mprotect munmap mremap madvise brk futex futex_waitv set_robust_list get_robust_list
rt_sigaction rt_sigprocmask rt_sigreturn rt_sigsuspend sigaltstack rt_sigpending
rt_sigtimedwait rt_sigqueueinfo rt_tgsigqueueinfo kill tkill tgkill
clock_gettime clock_getres clock_nanosleep nanosleep gettimeofday time times
getpid getppid gettid getuid geteuid getgid getegid getgroups uname sysinfo
getcwd chdir fchdir readlink readlinkat getrandom arch_prctl set_tid_address rseq
prlimit64 getrlimit getrusage sched_getaffinity sched_yield sched_getparam sched_getscheduler
exit exit_group wait4 waitid execve execveat fork vfork
connect bind listen accept accept4 getsockname getpeername getsockopt setsockopt
sendto recvfrom sendmsg shutdown
mkdir mkdirat rmdir unlink unlinkat rename renameat renameat2 link linkat symlink symlinkat
chmod fchmod fchmodat umask truncate ftruncate fsync fdatasync flock utime utimes utimensat
fadvise64 statfs fstatfs restart_syscall`
    .trim()
    .split(/\s+/);

export function dockerEgressSeccompProfile(arch = process.arch) {
  const architecture = { x64: "SCMP_ARCH_X86_64", arm64: "SCMP_ARCH_AARCH64" }[
    arch
  ];
  if (!architecture) throw new Error("Unsupported Docker egress architecture");
  return {
    defaultAction: "SCMP_ACT_ERRNO",
    defaultErrnoRet: 1,
    architectures: [architecture],
    syscalls: [
      { names: ORDINARY_SYSCALLS, action: "SCMP_ACT_ALLOW" },
      // clone3 returns ENOSYS so libc can use the inspectable clone syscall.
      { names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: 38 },
      {
        names: ["clone"],
        action: "SCMP_ACT_ALLOW",
        args: [
          {
            index: 0,
            value: 0x7e020080,
            valueTwo: 0,
            op: "SCMP_CMP_MASKED_EQ",
          },
        ],
      },
      ...[2, 10].map((family) => ({
        names: ["socket"],
        action: "SCMP_ACT_ALLOW",
        args: [
          { index: 0, value: family, op: "SCMP_CMP_EQ" },
          { index: 1, value: 0xf, valueTwo: 1, op: "SCMP_CMP_MASKED_EQ" },
        ],
      })),
    ],
  };
}

function docker(args, timeout = 30_000, capture = false) {
  return new Promise((resolve, reject) =>
    broker.execFile(
      "docker",
      args,
      {
        origin: "sandbox:docker-egress",
        policy: "allow",
        shell: false,
        encoding: "utf8",
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        requirePersistentAudit: true,
        auditRedactArgIndexes:
          args.includes("create") && args.includes("/bin/sh")
            ? [args.length - 1]
            : [],
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stdout = stdout;
          error.stderr = stderr;
          reject(error);
        } else
          resolve(
            capture
              ? { stdout: String(stdout), stderr: String(stderr) }
              : String(stdout).trim(),
          );
      },
    ),
  );
}

function checkedImage(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(value)
  ) {
    throw new Error("Docker egress requires a pinned image digest");
  }
  return value;
}

/** Internal dependency seam permits lifecycle tests without claiming Docker runs. */
export async function startDockerEgressSession(options, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== "linux")
    throw new Error("Docker egress requires a Linux host");
  const runDocker = deps.docker || docker;
  const io = deps.fs || fs;
  const relayImage = checkedImage(options.relayImage);
  const targetImage = checkedImage(options.targetImage || options.relayImage);
  const endpoint = await runDocker([
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]);
  // Explicit -H also prevents DOCKER_HOST/DOCKER_CONTEXT from changing authority.
  if (!/^unix:\/\/\//.test(endpoint))
    throw new Error("Docker egress requires a local Unix Docker daemon");
  const command = (args, timeout, capture) =>
    runDocker(["--host", endpoint, ...args], timeout, capture);
  const info = JSON.parse(await command(["info", "--format", "{{json .}}"]));
  if (info.OSType !== "linux")
    throw new Error("Docker egress requires a Linux daemon");
  const workspace = io.realpathSync(options.workspaceRoot);
  const socket = io.realpathSync(options.brokerSocketPath);
  const socketStat = io.statSync(socket);
  const ownerUid = deps.uid ?? process.getuid?.() ?? 1000;
  const socketParent = io.statSync(path.dirname(socket));
  if (
    socketStat.uid !== ownerUid ||
    socketParent.uid !== ownerUid ||
    (socketParent.mode & 0o077) !== 0 ||
    !socketParent.isDirectory()
  ) {
    throw new Error(
      "Docker egress broker socket requires a private owned parent directory",
    );
  }
  if (!io.statSync(workspace).isDirectory() || !socketStat.isSocket()) {
    throw new Error(
      "Docker egress requires a workspace and a listening Unix socket",
    );
  }
  if ([workspace, socket].some((p) => p.includes(",") || p.includes("\n"))) {
    throw new Error("Docker mount paths contain unsupported characters");
  }
  const token = crypto.randomBytes(16).toString("hex");
  const relayName = `cc-egress-${token}`;
  const targetName = `cc-target-${token}`;
  const stateDir = io.mkdtempSync(
    path.join(options.tempRoot || os.tmpdir(), "cc-egress-"),
  );
  const profilePath = path.join(stateDir, "target-seccomp.json");
  io.writeFileSync(
    profilePath,
    JSON.stringify(dockerEgressSeccompProfile(deps.arch)),
    { mode: 0o600 },
  );
  let closed = false;
  let closing;
  let active = false;
  let relayId;
  const containers = new Set([relayName, targetName]);
  const uncertainCreations = new Set();
  const pendingCreations = new Set();
  const recoveryPath = path.join(stateDir, "cleanup-state.json");
  const pause =
    deps.pause || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  function persistRecoveryState() {
    io.writeFileSync(
      recoveryPath,
      JSON.stringify({
        ownerLabel: `${LABEL}=${token}`,
        containers: [...containers],
        uncertainCreations: [...uncertainCreations],
        cleanupRequired: true,
      }),
      { mode: 0o600 },
    );
  }
  persistRecoveryState();
  async function createOwned(name, args) {
    if (closed) throw new Error("Docker egress session closed during launch");
    // A lost CLI response does not cancel the daemon's create operation.
    uncertainCreations.add(name);
    persistRecoveryState();
    const creation = Promise.resolve().then(() => command(args));
    pendingCreations.add(creation);
    try {
      const id = await creation;
      if (!/^[a-f0-9]{64}$/.test(id))
        throw new Error("Invalid Docker container identity");
      uncertainCreations.delete(name);
      persistRecoveryState();
      return id;
    } finally {
      pendingCreations.delete(creation);
    }
  }
  const user = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
  const common = [
    "--label",
    `${LABEL}=${token}`,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    user,
    "--read-only",
    "--pids-limit",
    "128",
    "--memory",
    "512m",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
  ];
  async function removeOwned(name) {
    let identity;
    for (let attempt = 0; attempt < RECONCILE_ATTEMPTS; attempt += 1) {
      try {
        identity = JSON.parse(
          await command(["inspect", name], CLEANUP_TIMEOUT_MS),
        );
        break;
      } catch (error) {
        if (!/No such (object|container)/i.test(error.stderr || error.message))
          throw error;
        if (!uncertainCreations.has(name)) return;
        if (attempt + 1 < RECONCILE_ATTEMPTS) await pause(100);
      }
    }
    if (!identity) {
      const error = new Error(
        "Docker container creation outcome remains unknown",
      );
      error.code = "ERR_DOCKER_EGRESS_CREATE_UNRESOLVED";
      error.containerName = name;
      throw error;
    }
    if (identity[0]?.Config?.Labels?.[LABEL] !== token)
      throw new Error("Docker egress cleanup ownership mismatch");
    // The creation has now been observed even if the subsequent rm loses its
    // reply. A later absent result can therefore establish successful cleanup.
    uncertainCreations.delete(name);
    await command(["rm", "-f", identity[0].Id], CLEANUP_TIMEOUT_MS);
  }
  function close() {
    if (!closing) {
      closed = true;
      closing = (async () => {
        // Join admitted creates before inspecting their names. No new create
        // may be admitted once closed is set.
        await Promise.allSettled([...pendingCreations]);
        const results = await Promise.allSettled(
          [...containers].reverse().map(removeOwned),
        );
        const failures = results.filter(
          (result) => result.status === "rejected",
        );
        if (failures.length) {
          persistRecoveryState();
          const error = new AggregateError(
            failures.map((result) => result.reason),
            "Docker egress cleanup is incomplete",
          );
          error.code = "ERR_DOCKER_EGRESS_CLEANUP_INCOMPLETE";
          error.cleanupStatePath = recoveryPath;
          throw error;
        }
        io.rmSync(stateDir, { recursive: true, force: true });
      })();
      const attempt = closing;
      void attempt.catch(() => {
        if (closing === attempt) closing = null;
      });
    }
    return closing;
  }
  try {
    relayId = await createOwned(relayName, [
      "create",
      "--name",
      relayName,
      ...common,
      "--network",
      "none",
      "--mount",
      `type=bind,source=${socket},target=/egress.sock,readonly`,
      "--entrypoint",
      "node",
      relayImage,
      "-e",
      RELAY,
    ]);
    await command(["start", relayId]);
    // Probe the full relay -> UDS -> policy proxy protocol path. This reserved
    // name cannot designate a public origin; status depends on the policy.
    await command([
      "exec",
      relayId,
      "node",
      "-e",
      `const net=require('node:net');let tries=0;const deadline=setTimeout(()=>process.exit(1),10000);function check(){const s=net.connect(${PORT},'127.0.0.1');let bytes='';s.on('connect',()=>s.write('GET http://blocked.invalid/ HTTP/1.1\\r\\nHost: blocked.invalid\\r\\nConnection: close\\r\\n\\r\\n'));s.on('data',c=>{bytes+=c;if(/^HTTP\\/1\\.[01] [1-5][0-9]{2} [^\\r\\n]*\\r\\n/.test(bytes)){clearTimeout(deadline);s.destroy();process.exit(0)}});s.on('error',()=>{if(++tries>50)process.exit(1);setTimeout(check,100)})}check()`,
    ]);
    return {
      relayId,
      close,
      async run(shellCommand, runOptions = {}) {
        if (closed || active)
          throw new Error("Docker egress session is closed or already running");
        if (typeof shellCommand !== "string")
          throw new TypeError("A shell command is required");
        active = true;
        let executionError;
        let result;
        try {
          const relay = JSON.parse(await command(["inspect", relayId]))[0];
          if (closed)
            throw new Error("Docker egress session closed during launch");
          if (
            !relay?.State?.Running ||
            relay.HostConfig?.NetworkMode !== "none"
          )
            throw new Error("Docker egress relay is unavailable");
          const targetId = await createOwned(targetName, [
            "create",
            "--name",
            targetName,
            ...common,
            "--network",
            `container:${relayId}`,
            "--security-opt",
            `seccomp=${profilePath}`,
            "--mount",
            `type=bind,source=${workspace},target=/workspace`,
            "--workdir",
            "/workspace",
            ...[
              "HTTP_PROXY",
              "HTTPS_PROXY",
              "ALL_PROXY",
              "http_proxy",
              "https_proxy",
              "all_proxy",
            ].flatMap((key) => ["--env", `${key}=http://127.0.0.1:${PORT}`]),
            "--env",
            "NO_PROXY=",
            "--env",
            "no_proxy=",
            "--entrypoint",
            "/bin/sh",
            targetImage,
            "-lc",
            shellCommand,
          ]);
          if (closed) {
            throw new Error("Docker egress session closed during launch");
          }
          let output;
          let attachError;
          try {
            output = await command(
              ["start", "--attach", targetId],
              runOptions.timeoutMs || 120_000,
              true,
            );
          } catch (error) {
            attachError = error;
          }
          const target = JSON.parse(await command(["inspect", targetId]))[0];
          if (
            attachError &&
            (attachError.killed ||
              !Number.isInteger(attachError.code) ||
              target?.State?.Running !== false ||
              !Number.isInteger(target?.State?.ExitCode))
          )
            throw attachError;
          if (
            target?.State?.Running !== false ||
            !Number.isInteger(target?.State?.ExitCode)
          )
            throw new Error("Docker target has no observed terminal state");
          result = {
            stdout:
              typeof output === "string"
                ? output
                : (output?.stdout ?? String(attachError?.stdout || "")),
            stderr: output?.stderr ?? String(attachError?.stderr || ""),
            exitCode: target.State.ExitCode,
          };
        } catch (error) {
          executionError = error;
        }
        try {
          await close();
        } catch (cleanupError) {
          if (executionError) executionError.cleanupError = cleanupError;
          else executionError = cleanupError;
        }
        if (executionError) throw executionError;
        return result;
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  }
}
