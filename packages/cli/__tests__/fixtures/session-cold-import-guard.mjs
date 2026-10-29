// A real Node loader, rather than a Vitest mock: fail if the executable's
// read-only session graph reaches deployment configuration or process execution.
const forbidden = [
  "/lib/evolution/evolution-enabled.js",
  "/lib/config-manager.js",
  "/lib/secret-store.js",
  "/lib/process-execution-broker/index.js",
];

export async function load(url, context, nextLoad) {
  if (forbidden.some((suffix) => url.endsWith(suffix))) {
    throw Object.assign(new Error(`Session cold import guard: ${url}`), {
      code: "CC_SESSION_COLD_IMPORT_GUARD",
    });
  }
  return nextLoad(url, context);
}
