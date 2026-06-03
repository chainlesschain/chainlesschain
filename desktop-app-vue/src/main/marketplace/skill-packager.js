/**
 * Skill Packager - 技能打包器
 *
 * 将用户技能打包为市场发布格式
 * 包含验证、元数据提取、校验和计算
 *
 * @module marketplace/skill-packager
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs").promises;

const REQUIRED_FIELDS = ["name", "version", "description"];

const SECURITY_PATTERNS = [
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /eval\s*\(/,
  /Function\s*\(/,
  /process\.exit/,
  /fs\.rmSync|fs\.rmdirSync/,
  /rimraf/,
];

class SkillPackager {
  async packageSkill(skillPath) {
    logger.info(`[SkillPackager] 打包技能: ${skillPath}`);

    const skillMdPath = path.join(skillPath, "SKILL.md");
    const handlerPath = path.join(skillPath, "handler.js");

    let skillMd;
    try {
      skillMd = await fs.readFile(skillMdPath, "utf8");
    } catch (error) {
      throw new Error(`SKILL.md not found at ${skillMdPath}`);
    }

    const metadata = this.extractMetadata(skillMd);

    let handler = null;
    try {
      handler = await fs.readFile(handlerPath, "utf8");
    } catch {
      // handler is optional
    }

    if (!metadata) {
      throw new Error("SKILL.md has no valid frontmatter");
    }

    const pkg = {
      name: metadata.name,
      version: metadata.version,
      description: metadata.description,
      category: metadata.category || "other",
      author: metadata.author || "unknown",
      tags: metadata.tags || [],
      skillMd,
      handlerJs: handler,
      checksum: this.calculateChecksum(skillMd + (handler || "")),
      packagedAt: new Date().toISOString(),
    };

    const validation = await this.validatePackage(pkg);
    if (!validation.valid) {
      throw new Error(
        `Package validation failed: ${validation.errors.join(", ")}`,
      );
    }

    return pkg;
  }

  async validatePackage(pkg) {
    const errors = [];

    for (const field of REQUIRED_FIELDS) {
      if (!pkg[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    if (pkg.version && !/^\d+\.\d+\.\d+/.test(pkg.version)) {
      errors.push("Invalid version format (expected semver)");
    }

    if (pkg.name && !/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)) {
      errors.push("Invalid name format (lowercase alphanumeric with hyphens)");
    }

    const handlerContent = pkg.handlerJs || pkg.handler;
    if (handlerContent) {
      for (const pattern of SECURITY_PATTERNS) {
        if (pattern.test(handlerContent)) {
          errors.push(`Security violation: ${pattern.toString()}`);
        }
      }
    }

    const totalSize = (pkg.skillMd || "").length + (pkg.handler || "").length;
    if (totalSize > 1024 * 1024) {
      errors.push("Package too large (max 1MB)");
    }

    return { valid: errors.length === 0, errors, warnings: [] };
  }

  extractMetadata(skillMd) {
    if (!skillMd) {
      return null;
    }

    const frontmatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const metadata = {};
    const yamlContent = frontmatterMatch[1];
    const lines = yamlContent.split("\n");
    let currentListKey = null;

    for (const line of lines) {
      // Handle YAML list items: "  - value"
      const listMatch = line.match(/^\s+- (.+)$/);
      if (listMatch && currentListKey) {
        const item = listMatch[1].trim().replace(/['"]/g, "");
        if (!Array.isArray(metadata[currentListKey])) {
          metadata[currentListKey] = [];
        }
        metadata[currentListKey].push(item);
        continue;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        let value = line.substring(colonIdx + 1).trim();

        if (value === "") {
          // Potential multi-line list key
          currentListKey = key;
          metadata[key] = [];
          continue;
        }

        currentListKey = null;

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        if (value.startsWith("[") && value.endsWith("]")) {
          value = value
            .slice(1, -1)
            .split(",")
            .map((v) => v.trim().replace(/['"]/g, ""));
        }

        metadata[key] = value;
      }
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  }

  calculateChecksum(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
  }
}

module.exports = { SkillPackager };
