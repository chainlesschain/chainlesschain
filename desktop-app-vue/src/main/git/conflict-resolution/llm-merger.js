/**
 * LLM-based Merger (Level 3)
 * Intelligent semantic merge using local Ollama LLM (<10s)
 * Intent understanding, semantic merge suggestions, conflict explanation
 *
 * @module git/conflict-resolution/llm-merger
 * @version 1.2.0
 */

const { logger } = require("../../utils/logger.js");
const { MERGE_RESULT } = require("./rule-merger");

// LLM request timeout
const LLM_TIMEOUT_MS = 10000;

// Max tokens for LLM context
const MAX_CONTEXT_TOKENS = 4096;

/**
 * LLMMerger - Level 3 conflict resolution
 * Uses local Ollama LLM for semantic understanding and merge
 */
class LLMMerger {
  /**
   * @param {Object} options
   * @param {Object} [options.llmManager] - LLM manager instance
   * @param {string} [options.model='qwen2:7b'] - LLM model to use
   * @param {number} [options.maxTokens=4096] - Max context tokens
   * @param {number} [options.timeout=10000] - Request timeout in ms
   * @param {number} [options.confidenceThreshold=0.85] - Min confidence for auto-accept
   */
  constructor(options = {}) {
    this.llmManager = options.llmManager || null;
    this.model = options.model || "qwen2:7b";
    this.maxTokens = options.maxTokens || MAX_CONTEXT_TOKENS;
    this.timeout = options.timeout || LLM_TIMEOUT_MS;
    this.confidenceThreshold = options.confidenceThreshold || 0.85;
  }

  /**
   * Attempt LLM-based semantic merge
   *
   * @param {Object} conflict
   * @param {string} conflict.base
   * @param {string} conflict.local
   * @param {string} conflict.remote
   * @param {string} conflict.filePath
   * @returns {Promise<Object>}
   */
  async merge(conflict) {
    if (!this.llmManager) {
      return {
        result: MERGE_RESULT.CONFLICT,
        merged: null,
        strategy: "llm-unavailable",
        confidence: 0,
        explanation: "LLM service is not available",
      };
    }

    const { base, local, remote, filePath } = conflict;
    const fileType = this._detectFileType(filePath);

    try {
      // Step 1: Analyze intent
      const intentAnalysis = await this._analyzeIntent(
        base,
        local,
        remote,
        fileType,
      );

      // Step 2: Generate merge suggestion
      const mergeResult = await this._generateMerge(
        base,
        local,
        remote,
        fileType,
        intentAnalysis,
      );

      // Step 3: Generate explanation
      const explanation = await this._generateExplanation(
        base,
        local,
        remote,
        mergeResult,
        intentAnalysis,
      );

      if (mergeResult.merged) {
        return {
          result: MERGE_RESULT.MERGED,
          merged: mergeResult.merged,
          strategy: "llm-semantic-merge",
          confidence: mergeResult.confidence || 0.7,
          explanation,
          intentAnalysis,
        };
      }

      return {
        result: MERGE_RESULT.CONFLICT,
        merged: null,
        strategy: "llm-conflict",
        confidence: 0,
        explanation,
        intentAnalysis,
        suggestion: mergeResult.suggestion,
      };
    } catch (error) {
      logger.error("[LLMMerger] Merge failed:", error.message);
      return {
        result: MERGE_RESULT.CONFLICT,
        merged: null,
        strategy: "llm-error",
        confidence: 0,
        explanation: `LLM merge failed: ${error.message}`,
      };
    }
  }

  /**
   * Analyze the intent behind both sets of changes
   */
  async _analyzeIntent(base, local, remote, fileType) {
    const prompt = this._buildIntentPrompt(base, local, remote, fileType);

    try {
      const response = await this._callLLM(prompt);

      // Parse structured response
      return this._parseIntentResponse(response);
    } catch (error) {
      logger.warn("[LLMMerger] Intent analysis failed:", error.message);
      return {
        localIntent: "Unknown",
        remoteIntent: "Unknown",
        compatibility: "unknown",
      };
    }
  }

  /**
   * Generate a merged version of the content
   */
  async _generateMerge(base, local, remote, fileType, intentAnalysis) {
    const prompt = this._buildMergePrompt(
      base,
      local,
      remote,
      fileType,
      intentAnalysis,
    );

    try {
      const response = await this._callLLM(prompt);
      return this._parseMergeResponse(response);
    } catch (error) {
      logger.warn("[LLMMerger] Merge generation failed:", error.message);
      return { merged: null, confidence: 0 };
    }
  }

  /**
   * Generate a natural language explanation of the conflict and merge
   */
  async _generateExplanation(base, local, remote, mergeResult, intentAnalysis) {
    const prompt = this._buildExplanationPrompt(
      base,
      local,
      remote,
      mergeResult,
      intentAnalysis,
    );

    try {
      const response = await this._callLLM(prompt);
      return response.trim();
    } catch (error) {
      return "Unable to generate explanation.";
    }
  }

  /**
   * Merge knowledge notes with AI understanding
   */
  async mergeNotes(conflict) {
    const { base, local, remote, filePath } = conflict;

    const prompt = `You are a knowledge management assistant. Two versions of a note have diverged.
Merge them intelligently, preserving all unique information from both versions.

Original note:
\`\`\`
${this._truncate(base, 1000)}
\`\`\`

Version A changes:
\`\`\`
${this._truncate(local, 1000)}
\`\`\`

Version B changes:
\`\`\`
${this._truncate(remote, 1000)}
\`\`\`

Instructions:
1. Preserve ALL unique information from both versions
2. Remove duplicated content
3. Maintain the original structure and formatting
4. If both versions add similar content, combine them logically
5. Output ONLY the merged note content, no explanations

Merged note:`;

    try {
      const response = await this._callLLM(prompt);
      const merged = this._extractCodeBlock(response) || response.trim();

      return {
        result: MERGE_RESULT.MERGED,
        merged,
        strategy: "llm-note-merge",
        confidence: 0.8,
      };
    } catch (error) {
      return {
        result: MERGE_RESULT.CONFLICT,
        merged: null,
        strategy: "llm-note-error",
        confidence: 0,
      };
    }
  }

  // ==========================================
  // Prompt builders
  // ==========================================

  _buildIntentPrompt(base, local, remote, fileType) {
    return `Analyze the intent behind two sets of changes to a ${fileType} file.

Base version:
\`\`\`
${this._truncate(base, 800)}
\`\`\`

Local changes:
\`\`\`
${this._truncate(local, 800)}
\`\`\`

Remote changes:
\`\`\`
${this._truncate(remote, 800)}
\`\`\`

Respond in this exact JSON format:
{
  "localIntent": "Brief description of what the local changes aim to do",
  "remoteIntent": "Brief description of what the remote changes aim to do",
  "compatibility": "compatible|conflicting|complementary",
  "conflictAreas": ["area1", "area2"]
}`;
  }

  _buildMergePrompt(base, local, remote, fileType, intentAnalysis) {
    return `Merge two conflicting versions of a ${fileType} file.

Intent analysis:
- Local intent: ${intentAnalysis.localIntent}
- Remote intent: ${intentAnalysis.remoteIntent}
- Compatibility: ${intentAnalysis.compatibility}

Base version:
\`\`\`
${this._truncate(base, 800)}
\`\`\`

Local version:
\`\`\`
${this._truncate(local, 800)}
\`\`\`

Remote version:
\`\`\`
${this._truncate(remote, 800)}
\`\`\`

Instructions:
1. Preserve the intent of BOTH sets of changes
2. The merge must be syntactically valid ${fileType}
3. If changes truly conflict (same line, incompatible semantics), prefer the more complete version
4. Output ONLY the merged content in a code block, then a confidence score

\`\`\`merged
[merged content here]
\`\`\`
confidence: [0.0-1.0]`;
  }

  _buildExplanationPrompt(base, local, remote, mergeResult, intentAnalysis) {
    return `Explain this file conflict in simple terms (2-3 sentences).

Local intent: ${intentAnalysis.localIntent}
Remote intent: ${intentAnalysis.remoteIntent}
Result: ${mergeResult.merged ? "Successfully merged" : "Could not auto-merge"}
${mergeResult.confidence ? `Confidence: ${(mergeResult.confidence * 100).toFixed(0)}%` : ""}

Write a brief, friendly explanation for the user.`;
  }

  // ==========================================
  // Response parsers
  // ==========================================

  _parseIntentResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (_e) {
      // Fallback
    }

    return {
      localIntent: "Changes detected",
      remoteIntent: "Changes detected",
      compatibility: "unknown",
      conflictAreas: [],
    };
  }

  _parseMergeResponse(response) {
    // Extract merged content from code block
    const merged = this._extractCodeBlock(response);

    // Extract confidence score
    const confMatch = response.match(/confidence:\s*([\d.]+)/i);
    const confidence = confMatch ? parseFloat(confMatch[1]) : 0.7;

    if (merged) {
      return { merged, confidence };
    }

    return { merged: null, confidence: 0, suggestion: response.trim() };
  }

  // ==========================================
  // Helpers
  // ==========================================

  /**
   * Call the LLM with a prompt
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async _callLLM(prompt) {
    if (!this.llmManager) {
      throw new Error("LLM manager not available");
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      // Use llmManager's chat/completion method
      const response = await this.llmManager.chat?.(
        [{ role: "user", content: prompt }],
        {
          model: this.model,
          maxTokens: this.maxTokens,
          temperature: 0.3,
          signal: controller.signal,
        },
      );

      return typeof response === "string"
        ? response
        : response?.content || response?.text || "";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Extract content from a markdown code block
   */
  _extractCodeBlock(text) {
    if (!text) {
      return null;
    }
    const match = text.match(/```(?:merged|[\w]*)\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  }

  /**
   * Truncate text to a max character count
   */
  _truncate(text, maxChars) {
    if (!text) {
      return "(empty)";
    }
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, maxChars) + "\n... (truncated)";
  }

  /**
   * Detect file type from path
   */
  _detectFileType(filePath) {
    if (!filePath) {
      return "text";
    }
    const ext = filePath.split(".").pop()?.toLowerCase();
    const typeMap = {
      js: "JavaScript",
      ts: "TypeScript",
      py: "Python",
      md: "Markdown",
      json: "JSON",
      yaml: "YAML",
      yml: "YAML",
      html: "HTML",
      css: "CSS",
    };
    return typeMap[ext] || "text";
  }
}

module.exports = {
  LLMMerger,
};
