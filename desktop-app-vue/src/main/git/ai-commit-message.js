/**
 * AI Git提交信息生成器
 * 使用LLM分析git diff并生成符合Conventional Commits规范的提交信息
 */
const { logger } = require("../utils/logger.js");
const { execSync } = require("child_process");
const path = require("path");

class AICommitMessageGenerator {
  constructor(llmManager) {
    this.llmManager = llmManager;
  }

  /**
   * 生成提交信息
   */
  async generateCommitMessage(projectPath) {
    try {
      // 1. 获取git diff
      const diff = this.getGitDiff(projectPath);

      if (!diff || diff.trim() === "") {
        throw new Error("没有待提交的更改");
      }

      // 2. 使用LLM生成提交信息
      const commitMessage = await this.callLLM(diff);

      // 3. 验证提交信息格式
      const validated = this.validateCommitMessage(commitMessage);

      return {
        success: true,
        message: validated,
        diff: diff.substring(0, 500), // 返回部分diff用于展示
      };
    } catch (error) {
      logger.error("[AICommitMessage] 生成失败:", error);
      throw error;
    }
  }

  /**
   * 获取git diff
   */
  getGitDiff(projectPath) {
    try {
      // 获取已暂存的更改
      const stagedDiff = execSync("git diff --cached", {
        cwd: projectPath,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 10, // 10MB
      });

      // 如果没有暂存的更改，获取工作区更改
      if (!stagedDiff || stagedDiff.trim() === "") {
        const workingDiff = execSync("git diff", {
          cwd: projectPath,
          encoding: "utf-8",
          maxBuffer: 1024 * 1024 * 10,
        });
        return workingDiff;
      }

      return stagedDiff;
    } catch (error) {
      logger.error("[AICommitMessage] 获取git diff失败:", error);
      return "";
    }
  }

  /**
   * 调用LLM生成提交信息
   */
  async callLLM(diff) {
    if (!this.llmManager) {
      return this.generateFallbackMessage(diff);
    }

    const prompt = `你是一个Git提交信息专家。根据以下git diff生成符合Conventional Commits规范的提交信息。

规则：
1. 使用类型前缀：feat/fix/docs/style/refactor/test/chore/perf
2. 简洁明了，50字以内
3. 描述"做了什么"和"为什么"
4. 使用中文
5. 格式：<type>(<scope>): <subject>

示例：
feat(项目统计): 添加实时代码行数统计功能
fix(PDF导出): 修复中文字符显示异常问题
docs(README): 更新安装说明和使用指南

Git Diff（前1000字符）:
${diff.substring(0, 1000)}

请直接返回提交信息，不要其他内容：`;

    try {
      const response = await this.llmManager.chat(
        [{ role: "user", content: prompt }],
        {
          temperature: 0.3,
          max_tokens: 100,
        },
      );

      let message = response.content.trim();

      // 移除可能的引号
      message = message.replace(/^["']|["']$/g, "");

      // 移除可能的markdown格式
      message = message.replace(/^```.*\n?|```$/g, "");

      return message;
    } catch (error) {
      logger.error("[AICommitMessage] LLM调用失败:", error);
      return this.generateFallbackMessage(diff);
    }
  }

  /**
   * 生成降级提交信息（当LLM不可用时）
   */
  generateFallbackMessage(diff) {
    // 简单分析diff确定类型
    let type = "chore";
    let scope = "";
    let subject = "更新文件";

    // 检测文件类型
    if (diff.includes("new file mode")) {
      type = "feat";
      subject = "添加新文件";
    } else if (diff.includes("deleted file mode")) {
      type = "chore";
      subject = "删除文件";
    } else if (diff.includes(".md") || diff.includes(".txt")) {
      type = "docs";
      subject = "更新文档";
    } else if (diff.includes(".test.") || diff.includes("test/")) {
      type = "test";
      subject = "更新测试";
    } else if (diff.includes(".css") || diff.includes(".scss")) {
      type = "style";
      subject = "更新样式";
    } else if (diff.includes("refactor") || diff.includes("重构")) {
      type = "refactor";
      subject = "重构代码";
    }

    // 尝试从diff中提取文件名作为scope
    const fileMatch = diff.match(/diff --git a\/([^\s]+)/);
    if (fileMatch && fileMatch[1]) {
      const filePath = fileMatch[1];
      const fileName = path.basename(filePath, path.extname(filePath));
      scope = fileName.substring(0, 20); // 限制长度
    }

    if (scope) {
      return `${type}(${scope}): ${subject}`;
    } else {
      return `${type}: ${subject}`;
    }
  }

  /**
   * 验证提交信息格式
   */
  validateCommitMessage(message) {
    // 基本格式验证
    const conventionalPattern =
      /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\(.+\))?: .+/;

    if (conventionalPattern.test(message)) {
      return message;
    }

    // 如果不符合规范，尝试修复
    logger.warn("[AICommitMessage] 提交信息不符合规范，尝试修复:", message);

    // 移除前缀空格和换行
    message = message.trim().split("\n")[0];

    // 如果消息太短，添加默认前缀
    if (message.length < 5) {
      return "chore: 更新代码";
    }

    // 如果没有类型前缀，添加chore
    if (!message.match(/^(feat|fix|docs|style|refactor|test|chore|perf):/)) {
      return `chore: ${message}`;
    }

    return message;
  }

  /**
   * 分析文件变更统计
   */
  getChangeStats(projectPath) {
    try {
      const stats = execSync("git diff --stat", {
        cwd: projectPath,
        encoding: "utf-8",
      });

      return stats;
    } catch (error) {
      return "";
    }
  }
}

module.exports = AICommitMessageGenerator;
