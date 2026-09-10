"use strict";

const { runCliResult } = require("./chat/introspect-commands.js");

function parseStatus(text) {
  let value;
  try {
    value = JSON.parse(String(text || ""));
  } catch {
    throw new Error("cc 返回了无法识别的 Skill 自进化配置结果");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("cc 返回了无效的 Skill 自进化配置结果");
  if (value.ok === false) throw new Error(value.error || "配置操作失败");
  return value;
}

async function run(command, args, { cwd, deps } = {}) {
  const result = await runCliResult({
    command,
    args: ["evolution", "deployment", ...args, "--json"],
    cwd,
    timeoutMs: 60_000,
    deps,
  });
  if (!result.ok)
    throw new Error(result.text || result.error || "无法运行 cc 配置命令");
  return parseStatus(result.stdout || result.text);
}

function getEvolutionDeploymentStatus(options = {}) {
  return run(options.command, ["status"], options);
}

function configureEvolutionDeployment(
  { descriptorPath, trustRootPath },
  options = {},
) {
  if (!descriptorPath || !trustRootPath)
    throw new Error("请选择签名描述符和 Ed25519 信任根公钥");
  return run(
    options.command,
    [
      "configure",
      "--descriptor",
      descriptorPath,
      "--trust-root",
      trustRootPath,
    ],
    options,
  );
}

function setEvolutionDeploymentEnabled(enabled, options = {}) {
  return run(options.command, [enabled ? "enable" : "disable"], options);
}

module.exports = {
  parseStatus,
  getEvolutionDeploymentStatus,
  configureEvolutionDeployment,
  setEvolutionDeploymentEnabled,
};
