const os = require("node:os");
const path = require("node:path");
function isFormalQualityHermeticRuntime(environment = process.env) {
  if (environment?.["CC_FORMAL_QUALITY_EVAL_HERMETIC"] !== "1") return false;
  const configuredHome = String(environment?.CHAINLESSCHAIN_HOME || "").trim();
  if (!configuredHome) return false;
  const temporaryRoot = path.resolve(os.tmpdir());
  const resolvedHome = path.resolve(configuredHome);
  const relation = path.relative(temporaryRoot, resolvedHome);
  return Boolean(
    relation &&
    relation !== ".." &&
    !relation.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relation),
  );
}
module.exports = { isFormalQualityHermeticRuntime };
