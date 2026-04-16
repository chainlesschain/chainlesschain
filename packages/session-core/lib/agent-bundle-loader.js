/**
 * Agent Bundle Loader — Phase 1
 *
 * 从目录约定读取 bundle,返回 canonical 对象.
 * 不做运行时注入,只做纯解析 + 结构校验.
 * 运行时消费交给 agent-bundle-resolver.
 */

const fs = require("fs");
const path = require("path");

const {
  BUNDLE_FILES,
  DEFAULT_MANIFEST,
  validateBundle,
  parseMinimalToml,
} = require("./agent-bundle-schema.js");

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function safeReadJson(filePath, warnings) {
  const text = safeReadText(filePath);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    warnings.push(`failed to parse JSON ${path.basename(filePath)}: ${err.message}`);
    return null;
  }
}

function safeStatDir(dirPath) {
  try {
    const st = fs.statSync(dirPath);
    return st.isDirectory() ? dirPath : null;
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

function loadManifest(bundleDir, warnings) {
  const tomlPath = path.join(bundleDir, BUNDLE_FILES.MANIFEST_TOML);
  const jsonPath = path.join(bundleDir, BUNDLE_FILES.MANIFEST_JSON);

  const tomlText = safeReadText(tomlPath);
  if (tomlText !== null) {
    try {
      const parsed = parseMinimalToml(tomlText);
      return { ...DEFAULT_MANIFEST, ...parsed };
    } catch (err) {
      warnings.push(`failed to parse TOML manifest: ${err.message}`);
    }
  }

  const jsonParsed = safeReadJson(jsonPath, warnings);
  if (jsonParsed) {
    return { ...DEFAULT_MANIFEST, ...jsonParsed };
  }

  return null;
}

/**
 * loadBundle(bundleDir)
 *
 * @param {string} bundleDir - 绝对或相对路径
 * @returns {object} canonical bundle
 * @throws {Error} 校验失败
 */
function loadBundle(bundleDir) {
  if (!bundleDir || typeof bundleDir !== "string") {
    throw new Error("loadBundle: bundleDir must be a string");
  }
  const resolved = path.resolve(bundleDir);

  const stat = (() => {
    try {
      return fs.statSync(resolved);
    } catch {
      return null;
    }
  })();
  if (!stat || !stat.isDirectory()) {
    throw new Error(`loadBundle: "${resolved}" is not a directory`);
  }

  const warnings = [];

  const manifest = loadManifest(resolved, warnings);
  if (!manifest) {
    throw new Error(
      `loadBundle: missing ${BUNDLE_FILES.MANIFEST_TOML} or ${BUNDLE_FILES.MANIFEST_JSON} in ${resolved}`
    );
  }

  const agentsMd = safeReadText(path.join(resolved, BUNDLE_FILES.AGENTS_MD));
  const userMd = safeReadText(path.join(resolved, BUNDLE_FILES.USER_MD));
  const skillsDir = safeStatDir(path.join(resolved, BUNDLE_FILES.SKILLS_DIR));
  const mcpConfig = safeReadJson(
    path.join(resolved, BUNDLE_FILES.MCP_JSON),
    warnings
  );
  const approvalPolicy = safeReadJson(
    path.join(resolved, BUNDLE_FILES.APPROVAL_POLICY),
    warnings
  );
  const sandboxPolicy = safeReadJson(
    path.join(resolved, BUNDLE_FILES.SANDBOX_POLICY),
    warnings
  );
  const capabilities = safeReadJson(
    path.join(resolved, BUNDLE_FILES.CAPABILITIES),
    warnings
  );

  const bundle = {
    path: resolved,
    manifest,
    agentsMd,
    userMd,
    skillsDir,
    mcpConfig,
    approvalPolicy,
    sandboxPolicy,
    capabilities,
    warnings,
  };

  const errors = validateBundle(bundle);
  if (errors.length > 0) {
    const err = new Error(
      `loadBundle: validation failed for ${resolved}\n  - ${errors.join("\n  - ")}`
    );
    err.validationErrors = errors;
    throw err;
  }

  return bundle;
}

module.exports = {
  loadBundle,
};
