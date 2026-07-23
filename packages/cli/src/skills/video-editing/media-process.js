import executionBroker from "../../lib/process-execution-broker/index.js";

export const _deps = {
  spawn: (...args) => executionBroker.spawn(...args),
};

export function spawnMediaProcess(
  file,
  args,
  options = {},
  origin = "video-editing:process",
) {
  return _deps.spawn(file, args, {
    ...options,
    origin,
    policy: "allow",
    scope: "video-editing",
    shell: false,
  });
}
