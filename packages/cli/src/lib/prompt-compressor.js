/**
 * @deprecated — canonical implementation lives in
 * `../harness/prompt-compressor.js` as of the CLI Runtime Convergence
 * roadmap. This file is retained as a re-export shim for backwards
 * compatibility and will be removed once all external consumers have
 * migrated.
 *
 * Please import from `packages/cli/src/harness/prompt-compressor.js`
 * in new code.
 */

export {
  estimateTokens,
  estimateMessagesTokens,
  CONTEXT_WINDOWS,
  getContextWindow,
  COMPRESSION_VARIANTS,
  getCompressionVariant,
  adaptiveThresholds,
  PromptCompressor,
} from "../harness/prompt-compressor.js";
