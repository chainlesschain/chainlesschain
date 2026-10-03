// In-process identity, not a JSON profile name, admits the packer's larger
// finite CPU budget. This grants no process permission: the broker's ordinary
// deny/prompt checks and strict-mode override still apply.
const policies = new WeakMap();
const origins = new Set(["packer:pkg", "packer:web-panel-build"]);

export const PACKER_BUILD_TIMEOUT_MS = 900_000;

export function createPackerBuildPolicy(origin) {
  if (!origins.has(origin)) throw new Error("Unknown packer build origin");
  const policy = Object.freeze({ profile: "build" });
  policies.set(policy, origin);
  return policy;
}

export function isPackerBuildPolicy(policy, options, launch = {}) {
  const { origin, scope, shell, detached, timeout, killSignal } = options;
  return (
    scope === "pack" &&
    origins.has(origin) &&
    policies.get(policy) === origin &&
    launch.sync === true &&
    launch.pty !== true &&
    shell === false &&
    (detached === undefined || detached === false) &&
    Number.isSafeInteger(timeout) &&
    timeout > 0 &&
    timeout <= PACKER_BUILD_TIMEOUT_MS &&
    killSignal === "SIGKILL"
  );
}
