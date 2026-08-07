/**
 * Environment policy shared by MCP stdio materialization and runtime launch.
 * These variables can cause a language runtime or native loader to execute
 * bytes that are outside the approved executable/package identity.
 */

const CODE_INJECTION_ENV_KEYS = new Set([
  "CLASSPATH",
  "DOTNET_ADDITIONAL_DEPS",
  "DOTNET_ROOT",
  "JAVA_TOOL_OPTIONS",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NPM_CONFIG_NODE_OPTIONS",
  "PERL5LIB",
  "PERL5OPT",
  "PYTHONHOME",
  "PYTHONPATH",
  "RUBYLIB",
  "RUBYOPT",
  "_JAVA_OPTIONS",
]);

export function isMcpStdioCodeInjectionEnvironmentKey(key) {
  const normalized = String(key || "").toUpperCase();
  return (
    CODE_INJECTION_ENV_KEYS.has(normalized) ||
    normalized.startsWith("DYLD_") ||
    normalized.startsWith("COMPLUS_") ||
    normalized.startsWith("CORECLR_")
  );
}

export function sanitizeMcpStdioHostEnvironment(env) {
  const safe = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (
      !isMcpStdioCodeInjectionEnvironmentKey(key) &&
      typeof value === "string"
    ) {
      safe[key] = value;
    }
  }
  return safe;
}
