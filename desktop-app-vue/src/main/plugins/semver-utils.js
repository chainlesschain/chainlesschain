/**
 * 轻量级 Semver 版本检查工具
 * 支持基本的语义化版本比较和范围检查
 */

/**
 * 解析版本号字符串
 * @param {string} version - 版本号 (如 "1.2.3", "1.2.3-beta.1")
 * @returns {Object|null} 解析后的版本对象
 */
function parseVersion(version) {
  if (!version || typeof version !== "string") {
    return null;
  }

  // 清理版本号前缀
  const cleaned = version.replace(/^[v=]/, "").trim();

  // 正则匹配: major.minor.patch[-prerelease][+build]
  const match = cleaned.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/,
  );

  if (!match) {
    return null;
  }

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
    build: match[5] || null,
    raw: version,
  };
}

/**
 * 比较两个版本号
 * @param {string} v1 - 版本号 1
 * @param {string} v2 - 版本号 2
 * @returns {number} -1 (v1 < v2), 0 (v1 == v2), 1 (v1 > v2)
 */
function compareVersions(v1, v2) {
  const parsed1 = parseVersion(v1);
  const parsed2 = parseVersion(v2);

  if (!parsed1 || !parsed2) {
    throw new Error(`无法解析版本号: ${!parsed1 ? v1 : v2}`);
  }

  // 比较主版本号
  if (parsed1.major !== parsed2.major) {
    return parsed1.major > parsed2.major ? 1 : -1;
  }

  // 比较次版本号
  if (parsed1.minor !== parsed2.minor) {
    return parsed1.minor > parsed2.minor ? 1 : -1;
  }

  // 比较补丁版本号
  if (parsed1.patch !== parsed2.patch) {
    return parsed1.patch > parsed2.patch ? 1 : -1;
  }

  // 比较预发布版本
  // 没有预发布版本的比有预发布版本的大
  if (parsed1.prerelease && !parsed2.prerelease) {
    return -1;
  }
  if (!parsed1.prerelease && parsed2.prerelease) {
    return 1;
  }
  if (parsed1.prerelease && parsed2.prerelease) {
    return parsed1.prerelease.localeCompare(parsed2.prerelease);
  }

  return 0;
}

/**
 * 解析版本范围
 * 支持: >=1.0.0, >1.0.0, <=1.0.0, <1.0.0, =1.0.0, ^1.0.0, ~1.0.0, 1.0.x, *
 * @param {string} range - 版本范围表达式
 * @returns {Object} 范围对象 { type, version, min, max }
 */
function parseRange(range) {
  if (!range || typeof range !== "string") {
    return { type: "any", valid: true };
  }

  const cleaned = range.trim();

  // 通配符
  if (cleaned === "*" || cleaned === "x" || cleaned === "") {
    return { type: "any", valid: true };
  }

  // 大于等于 >=1.0.0
  if (cleaned.startsWith(">=")) {
    const version = cleaned.substring(2).trim();
    return { type: ">=", version, valid: !!parseVersion(version) };
  }

  // 大于 >1.0.0
  if (cleaned.startsWith(">")) {
    const version = cleaned.substring(1).trim();
    return { type: ">", version, valid: !!parseVersion(version) };
  }

  // 小于等于 <=1.0.0
  if (cleaned.startsWith("<=")) {
    const version = cleaned.substring(2).trim();
    return { type: "<=", version, valid: !!parseVersion(version) };
  }

  // 小于 <1.0.0
  if (cleaned.startsWith("<")) {
    const version = cleaned.substring(1).trim();
    return { type: "<", version, valid: !!parseVersion(version) };
  }

  // 精确匹配 =1.0.0
  if (cleaned.startsWith("=")) {
    const version = cleaned.substring(1).trim();
    return { type: "=", version, valid: !!parseVersion(version) };
  }

  // Caret range ^1.0.0 (兼容更新: 允许不修改最左边非零数字的更新)
  if (cleaned.startsWith("^")) {
    const version = cleaned.substring(1).trim();
    const parsed = parseVersion(version);
    if (!parsed) {
      return { type: "caret", version, valid: false };
    }

    // ^1.2.3 => >=1.2.3 <2.0.0
    // ^0.2.3 => >=0.2.3 <0.3.0
    // ^0.0.3 => >=0.0.3 <0.0.4
    let maxMajor = parsed.major;
    let maxMinor = parsed.minor;
    let maxPatch = parsed.patch;

    if (parsed.major !== 0) {
      maxMajor = parsed.major + 1;
      maxMinor = 0;
      maxPatch = 0;
    } else if (parsed.minor !== 0) {
      maxMinor = parsed.minor + 1;
      maxPatch = 0;
    } else {
      maxPatch = parsed.patch + 1;
    }

    return {
      type: "caret",
      version,
      min: version,
      max: `${maxMajor}.${maxMinor}.${maxPatch}`,
      valid: true,
    };
  }

  // Tilde range ~1.0.0 (补丁级更新: 允许补丁级更新)
  if (cleaned.startsWith("~")) {
    const version = cleaned.substring(1).trim();
    const parsed = parseVersion(version);
    if (!parsed) {
      return { type: "tilde", version, valid: false };
    }

    // ~1.2.3 => >=1.2.3 <1.3.0
    return {
      type: "tilde",
      version,
      min: version,
      max: `${parsed.major}.${parsed.minor + 1}.0`,
      valid: true,
    };
  }

  // X-Range: 1.2.x, 1.x, 1.x.x
  if (cleaned.includes("x") || cleaned.includes("X") || cleaned.includes("*")) {
    const parts = cleaned.split(".");
    const major =
      parts[0] !== "x" && parts[0] !== "X" && parts[0] !== "*"
        ? parseInt(parts[0], 10)
        : null;
    const minor =
      parts[1] !== "x" &&
      parts[1] !== "X" &&
      parts[1] !== "*" &&
      parts[1] !== undefined
        ? parseInt(parts[1], 10)
        : null;

    if (major === null) {
      return { type: "any", valid: true };
    }

    if (minor === null) {
      // 1.x => >=1.0.0 <2.0.0
      return {
        type: "x-range",
        min: `${major}.0.0`,
        max: `${major + 1}.0.0`,
        valid: true,
      };
    }

    // 1.2.x => >=1.2.0 <1.3.0
    return {
      type: "x-range",
      min: `${major}.${minor}.0`,
      max: `${major}.${minor + 1}.0`,
      valid: true,
    };
  }

  // 精确版本（无前缀）
  const parsed = parseVersion(cleaned);
  if (parsed) {
    return { type: "=", version: cleaned, valid: true };
  }

  return { type: "unknown", version: cleaned, valid: false };
}

/**
 * 检查版本是否满足范围要求
 * @param {string} version - 要检查的版本
 * @param {string} range - 版本范围
 * @returns {boolean} 是否满足
 */
function satisfies(version, range) {
  const rangeObj = parseRange(range);

  if (!rangeObj.valid) {
    console.warn(`[SemverUtils] 无效的版本范围: ${range}`);
    return false;
  }

  if (rangeObj.type === "any") {
    return true;
  }

  const cmp = (v1, v2) => compareVersions(v1, v2);

  switch (rangeObj.type) {
    case ">=":
      return cmp(version, rangeObj.version) >= 0;

    case ">":
      return cmp(version, rangeObj.version) > 0;

    case "<=":
      return cmp(version, rangeObj.version) <= 0;

    case "<":
      return cmp(version, rangeObj.version) < 0;

    case "=":
      return cmp(version, rangeObj.version) === 0;

    case "caret":
    case "tilde":
    case "x-range":
      return cmp(version, rangeObj.min) >= 0 && cmp(version, rangeObj.max) < 0;

    default:
      return false;
  }
}

/**
 * 检查版本 v1 是否大于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}
 */
function gt(v1, v2) {
  return compareVersions(v1, v2) > 0;
}

/**
 * 检查版本 v1 是否大于等于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}
 */
function gte(v1, v2) {
  return compareVersions(v1, v2) >= 0;
}

/**
 * 检查版本 v1 是否小于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}
 */
function lt(v1, v2) {
  return compareVersions(v1, v2) < 0;
}

/**
 * 检查版本 v1 是否小于等于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}
 */
function lte(v1, v2) {
  return compareVersions(v1, v2) <= 0;
}

/**
 * 检查版本 v1 是否等于 v2
 * @param {string} v1
 * @param {string} v2
 * @returns {boolean}
 */
function eq(v1, v2) {
  return compareVersions(v1, v2) === 0;
}

/**
 * 检查版本号是否有效
 * @param {string} version
 * @returns {boolean}
 */
function valid(version) {
  return parseVersion(version) !== null;
}

/**
 * 清理版本号（移除前缀等）
 * @param {string} version
 * @returns {string|null}
 */
function clean(version) {
  const parsed = parseVersion(version);
  if (!parsed) {
    return null;
  }

  let result = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  if (parsed.prerelease) {
    result += `-${parsed.prerelease}`;
  }
  if (parsed.build) {
    result += `+${parsed.build}`;
  }

  return result;
}

module.exports = {
  parseVersion,
  parseRange,
  compareVersions,
  satisfies,
  gt,
  gte,
  lt,
  lte,
  eq,
  valid,
  clean,
};
