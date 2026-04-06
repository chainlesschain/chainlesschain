export function createRuntimeContext({
  kind,
  policy,
  config = null,
  cwd = process.cwd(),
} = {}) {
  return {
    kind,
    policy,
    config,
    cwd,
    createdAt: Date.now(),
  };
}
