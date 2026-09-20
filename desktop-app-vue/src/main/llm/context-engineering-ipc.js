"use strict";

/**
 * Legacy Context Engineering helpers.
 *
 * The former 17-channel Electron IPC surface was retired after the canonical
 * Context/Memory App Server cutover. This module keeps only local helpers used
 * by diagnostic scripts; it does not import Electron or register IPC handlers.
 */

const {
  RecoverableCompressor,
  getContextEngineering,
} = require("./context-engineering");

let contextEngineeringInstance = null;
let compressorInstance = null;
let tokenEstimatorInstance = null;

function getOrCreateContextEngineering(options = {}) {
  if (!contextEngineeringInstance) {
    contextEngineeringInstance = getContextEngineering(options);
  }
  return contextEngineeringInstance;
}

function getOrCreateCompressor() {
  if (!compressorInstance) {
    compressorInstance = new RecoverableCompressor();
  }
  return compressorInstance;
}

class TokenEstimator {
  constructor() {
    this.ratios = Object.freeze({
      english: 4,
      chinese: 1.5,
      mixed: 2.5,
    });
  }

  estimate(content, language = "mixed") {
    if (!content) {
      return 0;
    }
    const text =
      typeof content === "string" ? content : JSON.stringify(content);
    const chineseCharacters = (text.match(/[\u4e00-\u9fff]/gu) || []).length;
    const chineseRatio = text.length > 0 ? chineseCharacters / text.length : 0;
    const ratio =
      language === "chinese" || chineseRatio > 0.5
        ? this.ratios.chinese
        : language === "english" || chineseRatio < 0.1
          ? this.ratios.english
          : this.ratios.mixed;
    return Math.ceil(text.length / ratio);
  }

  estimateMessages(messages) {
    if (!Array.isArray(messages)) {
      return { total: 0, byRole: {}, byMessage: [] };
    }
    const result = { total: 0, byRole: {}, byMessage: [] };
    for (const message of messages) {
      const content = message?.content || "";
      const tokens = this.estimate(content);
      const role = typeof message?.role === "string" ? message.role : "unknown";
      result.total += tokens;
      result.byRole[role] = (result.byRole[role] || 0) + tokens;
      result.byMessage.push({
        role,
        tokens,
        preview:
          typeof content === "string" ? content.slice(0, 50) : "[object]",
      });
    }
    return result;
  }
}

function getTokenEstimator() {
  if (!tokenEstimatorInstance) {
    tokenEstimatorInstance = new TokenEstimator();
  }
  return tokenEstimatorInstance;
}

module.exports = {
  TokenEstimator,
  getOrCreateCompressor,
  getOrCreateContextEngineering,
  getTokenEstimator,
};
