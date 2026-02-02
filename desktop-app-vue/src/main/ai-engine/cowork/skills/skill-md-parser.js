/**
 * SkillMdParser - SKILL.md 解析器
 *
 * 解析 Clawdbot 风格的 SKILL.md 文件，支持 YAML frontmatter 和 Markdown 正文。
 *
 * @module ai-engine/cowork/skills/skill-md-parser
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../utils/logger.js");

// 尝试加载 gray-matter，如果不存在则使用简易解析
let matter;
try {
  matter = require("gray-matter");
} catch {
  matter = null;
}

/**
 * 简易 YAML frontmatter 解析器（作为 gray-matter 的后备）
 * @param {string} content - 文件内容
 * @returns {{data: object, content: string}}
 */
function simpleFrontmatterParser(content) {
  const lines = content.split("\n");

  if (lines[0].trim() !== "---") {
    return { data: {}, content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { data: {}, content };
  }

  const yamlLines = lines.slice(1, endIndex);
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .trim();

  // 简易 YAML 解析（支持嵌套对象）
  const data = {};
  const stack = [{ obj: data, indent: -1 }];
  let currentKey = null;
  let currentArray = null;

  for (const line of yamlLines) {
    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith("#")) {
      continue;
    }

    // 计算缩进
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // 数组项（以 - 开头）
    if (trimmed.startsWith("- ")) {
      const value = trimmed
        .slice(2)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      if (currentArray) {
        currentArray.push(value);
      }
      continue;
    }

    // 键值对
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // 调整栈，找到正确的父对象
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const parent = stack[stack.length - 1].obj;

      // 嵌套对象开始（value 为空）
      if (value === "") {
        const newObj = {};
        parent[key] = newObj;
        stack.push({ obj: newObj, indent });
        currentKey = null;
        currentArray = null;
        continue;
      }

      // 数组开始（空数组标记）
      if (value === "[]") {
        currentKey = key;
        currentArray = [];
        parent[key] = currentArray;
        continue;
      }

      // 内联数组 [a, b, c]
      if (value.startsWith("[") && value.endsWith("]")) {
        const items = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter((s) => s);
        parent[key] = items;
        currentKey = null;
        currentArray = null;
        continue;
      }

      // 布尔值
      if (value === "true") {
        value = true;
      } else if (value === "false") {
        value = false;
      }
      // 数字
      else if (/^-?\d+(\.\d+)?$/.test(value)) {
        value = parseFloat(value);
      }
      // 字符串（移除引号）
      else {
        value = value.replace(/^['"]|['"]$/g, "");
      }

      parent[key] = value;
      currentKey = key;
      currentArray = null;
    }
  }

  return { data, content: body };
}

/**
 * SkillMdParser 类
 */
class SkillMdParser {
  constructor(options = {}) {
    this.options = {
      // 最大描述长度
      maxDescriptionLength: options.maxDescriptionLength || 200,
      // 是否严格验证
      strictValidation: options.strictValidation !== false,
      ...options,
    };
  }

  /**
   * 解析 SKILL.md 文件
   * @param {string} filePath - 文件路径
   * @returns {Promise<object>} SkillDefinition
   */
  async parseFile(filePath) {
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      return this.parseContent(content, filePath);
    } catch (error) {
      throw new Error(
        `Failed to parse SKILL.md at ${filePath}: ${error.message}`,
      );
    }
  }

  /**
   * 解析 SKILL.md 内容
   * @param {string} content - 文件内容
   * @param {string} sourcePath - 源文件路径
   * @returns {object} SkillDefinition
   */
  parseContent(content, sourcePath = "unknown") {
    // 使用 gray-matter 或简易解析器
    const parsed = matter ? matter(content) : simpleFrontmatterParser(content);

    const frontmatter = parsed.data || {};
    const body = parsed.content || "";

    // 规范化字段名（支持 kebab-case 和 camelCase）
    const normalized = this._normalizeFields(frontmatter);

    // 构建 SkillDefinition
    const definition = {
      // 必填字段
      name: normalized.name || path.basename(path.dirname(sourcePath)),
      description: normalized.description || "",

      // 来源信息
      source: normalized.source || "unknown",
      sourcePath,

      // 显示信息
      displayName: normalized.displayName || normalized.name || "",
      version: normalized.version || "1.0.0",
      category: normalized.category || "custom",
      tags: normalized.tags || [],

      // 调用控制
      userInvocable: normalized.userInvocable !== false,
      hidden: normalized.hidden === true,

      // 门控条件
      requires: {
        bins: normalized.requires?.bins || [],
        env: normalized.requires?.env || [],
      },
      os: normalized.os || ["win32", "darwin", "linux"],
      enabled: normalized.enabled !== false,

      // 执行配置
      handler: normalized.handler || null,
      capabilities: normalized.capabilities || [],
      supportedFileTypes: normalized.supportedFileTypes || [],

      // Markdown 正文
      body: body.trim(),

      // 原始 frontmatter
      _raw: frontmatter,
    };

    // 验证
    const validation = this.validate(definition);
    if (!validation.valid) {
      if (this.options.strictValidation) {
        throw new Error(`Invalid SKILL.md: ${validation.errors.join(", ")}`);
      }
      logger.warn(
        `[SkillMdParser] Validation warnings for ${sourcePath}: ${validation.errors.join(", ")}`,
      );
    }

    return definition;
  }

  /**
   * 验证 SkillDefinition
   * @param {object} definition - 技能定义
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate(definition) {
    const errors = [];

    // 必填字段检查
    if (!definition.name) {
      errors.push("name is required");
    } else if (!/^[a-z][a-z0-9-]*$/i.test(definition.name)) {
      errors.push("name must be alphanumeric with hyphens (e.g., my-skill)");
    }

    if (!definition.description) {
      errors.push("description is required");
    } else if (
      definition.description.length > this.options.maxDescriptionLength
    ) {
      errors.push(
        `description exceeds ${this.options.maxDescriptionLength} characters`,
      );
    }

    // 版本格式检查
    if (definition.version && !/^\d+\.\d+\.\d+/.test(definition.version)) {
      errors.push("version should follow semver format (e.g., 1.0.0)");
    }

    // handler 路径检查（如果指定）
    if (definition.handler && !definition.handler.startsWith("./")) {
      errors.push("handler path should be relative (start with ./)");
    }

    // 平台检查
    const validPlatforms = ["win32", "darwin", "linux"];
    if (definition.os) {
      for (const platform of definition.os) {
        if (!validPlatforms.includes(platform)) {
          errors.push(`invalid platform: ${platform}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 规范化字段名
   * @private
   */
  _normalizeFields(obj) {
    const result = {};

    const fieldMap = {
      name: "name",
      description: "description",
      "display-name": "displayName",
      displayName: "displayName",
      version: "version",
      category: "category",
      tags: "tags",
      "user-invocable": "userInvocable",
      userInvocable: "userInvocable",
      hidden: "hidden",
      requires: "requires",
      os: "os",
      enabled: "enabled",
      handler: "handler",
      capabilities: "capabilities",
      "supported-file-types": "supportedFileTypes",
      supportedFileTypes: "supportedFileTypes",
    };

    for (const [key, value] of Object.entries(obj)) {
      const normalizedKey = fieldMap[key] || key;
      result[normalizedKey] = value;
    }

    return result;
  }
}

module.exports = { SkillMdParser };
