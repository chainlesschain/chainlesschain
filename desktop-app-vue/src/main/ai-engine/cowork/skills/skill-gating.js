/**
 * SkillGating - 技能门控系统
 *
 * 检查技能的运行条件，包括二进制依赖、环境变量和操作系统兼容性。
 *
 * @module ai-engine/cowork/skills/skill-gating
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const { logger } = require("../../../utils/logger.js");

const execAsync = promisify(exec);

/**
 * SkillGating 类
 */
class SkillGating {
  constructor(options = {}) {
    this.options = {
      // 检查超时（毫秒）
      timeout: options.timeout || 5000,
      // 缓存二进制检查结果
      cacheResults: options.cacheResults !== false,
      ...options,
    };

    // 二进制检查结果缓存
    this.binaryCache = new Map();
  }

  /**
   * 检查所有门控条件
   * @param {object} definition - SkillDefinition
   * @returns {Promise<{passed: boolean, results: object}>}
   */
  async checkRequirements(definition) {
    const results = {
      platform: { passed: true, detail: null },
      bins: { passed: true, missing: [] },
      env: { passed: true, missing: [] },
      enabled: { passed: true },
    };

    // 检查 enabled 标志
    if (definition.enabled === false) {
      results.enabled.passed = false;
      return { passed: false, results };
    }

    // 检查平台兼容性
    const platformResult = this.checkPlatform(definition.os);
    results.platform = platformResult;

    // 检查二进制依赖
    if (definition.requires?.bins?.length > 0) {
      const binsResult = await this.checkBinaries(definition.requires.bins);
      results.bins = binsResult;
    }

    // 检查环境变量
    if (definition.requires?.env?.length > 0) {
      const envResult = this.checkEnvVars(definition.requires.env);
      results.env = envResult;
    }

    // 计算总体结果
    const passed =
      results.platform.passed &&
      results.bins.passed &&
      results.env.passed &&
      results.enabled.passed;

    return { passed, results };
  }

  /**
   * 检查平台兼容性
   * @param {string[]} osList - 支持的平台列表
   * @returns {{passed: boolean, detail: string}}
   */
  checkPlatform(osList) {
    const currentPlatform = process.platform;

    // 如果没有指定平台限制，默认通过
    if (!osList || osList.length === 0) {
      return { passed: true, detail: `current: ${currentPlatform}` };
    }

    const passed = osList.includes(currentPlatform);

    return {
      passed,
      detail: passed
        ? `current: ${currentPlatform}`
        : `current platform '${currentPlatform}' not in supported list: [${osList.join(", ")}]`,
    };
  }

  /**
   * 检查多个二进制是否存在
   * @param {string[]} binNames - 二进制名称列表
   * @returns {Promise<{passed: boolean, missing: string[]}>}
   */
  async checkBinaries(binNames) {
    const missing = [];

    for (const binName of binNames) {
      const exists = await this.checkBinary(binName);
      if (!exists) {
        missing.push(binName);
      }
    }

    return {
      passed: missing.length === 0,
      missing,
    };
  }

  /**
   * 检查单个二进制是否存在
   * @param {string} binName - 二进制名称
   * @returns {Promise<boolean>}
   */
  async checkBinary(binName) {
    // 检查缓存
    if (this.options.cacheResults && this.binaryCache.has(binName)) {
      return this.binaryCache.get(binName);
    }

    try {
      // Windows 使用 where，Unix 使用 which
      const command =
        process.platform === "win32" ? `where ${binName}` : `which ${binName}`;

      await execAsync(command, { timeout: this.options.timeout });

      if (this.options.cacheResults) {
        this.binaryCache.set(binName, true);
      }

      return true;
    } catch {
      if (this.options.cacheResults) {
        this.binaryCache.set(binName, false);
      }

      return false;
    }
  }

  /**
   * 检查环境变量
   * @param {string[]} envNames - 环境变量名称列表
   * @returns {{passed: boolean, missing: string[]}}
   */
  checkEnvVars(envNames) {
    const missing = [];

    for (const envName of envNames) {
      if (!this.checkEnv(envName)) {
        missing.push(envName);
      }
    }

    return {
      passed: missing.length === 0,
      missing,
    };
  }

  /**
   * 检查单个环境变量
   * @param {string} envName - 环境变量名称
   * @returns {boolean}
   */
  checkEnv(envName) {
    const value = process.env[envName];
    return value !== undefined && value !== "";
  }

  /**
   * 获取门控检查摘要
   * @param {object} checkResult - checkRequirements 的返回值
   * @returns {string}
   */
  getSummary(checkResult) {
    if (checkResult.passed) {
      return "All gating requirements passed";
    }

    const issues = [];

    if (!checkResult.results.enabled.passed) {
      issues.push("Skill is disabled");
    }

    if (!checkResult.results.platform.passed) {
      issues.push(checkResult.results.platform.detail);
    }

    if (!checkResult.results.bins.passed) {
      issues.push(
        `Missing binaries: ${checkResult.results.bins.missing.join(", ")}`,
      );
    }

    if (!checkResult.results.env.passed) {
      issues.push(
        `Missing env vars: ${checkResult.results.env.missing.join(", ")}`,
      );
    }

    return issues.join("; ");
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.binaryCache.clear();
  }
}

module.exports = { SkillGating };
