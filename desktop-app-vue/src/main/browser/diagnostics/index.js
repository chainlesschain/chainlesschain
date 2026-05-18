/**
 * Browser Diagnostics - Entry Point
 *
 * @module browser/diagnostics
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { OCREngine, OCRLanguage } = require('./ocr-engine');
const { ScreenshotDiff, DiffStatus } = require('./screenshot-diff');
const { SmartDiagnostics, DiagnosisSeverity, FailureCategory } = require('./smart-diagnostics');

module.exports = {
  // OCR
  OCREngine,
  OCRLanguage,

  // Screenshot Diff
  ScreenshotDiff,
  DiffStatus,

  // Smart Diagnostics
  SmartDiagnostics,
  DiagnosisSeverity,
  FailureCategory
};
