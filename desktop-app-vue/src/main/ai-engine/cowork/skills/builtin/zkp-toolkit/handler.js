"use strict";

/**
 * ZKP Toolkit Skill Handler
 *
 * Provides zero-knowledge proof operations: proof generation, verification,
 * selective disclosure (age/balance), ZK-Rollup batching, and benchmarking.
 *
 * @module skills/builtin/zkp-toolkit/handler
 */

const { logger } = require("../../../../../utils/logger.js");

let zkManager = null;

function getZKManager() {
  if (!zkManager) {
    try {
      const {
        getZeroKnowledgeManager,
      } = require("../../../../../crypto/zero-knowledge-manager.js");
      zkManager = getZeroKnowledgeManager();
    } catch {
      // Manager not available
    }
  }
  return zkManager;
}

/**
 * Extract argument value after a flag
 */
function extractArg(input, flag) {
  const regex = new RegExp(flag + "\\s+", "i");
  const after = input.replace(regex, "").trim();
  // If quoted, extract quoted value
  const quoteMatch = after.match(/^["'](.+?)["']/);
  if (quoteMatch) {
    return quoteMatch[1];
  }
  // Otherwise take first word/token
  return after.split(/\s+--/)[0].trim();
}

/**
 * Extract a named flag value like --witness "value"
 */
function extractNamedArg(input, name) {
  const regex = new RegExp(`--${name}\\s+["'](.+?)["']`, "i");
  const match = input.match(regex);
  if (match) {
    return match[1];
  }
  const regex2 = new RegExp(`--${name}\\s+(\\S+)`, "i");
  const match2 = input.match(regex2);
  return match2 ? match2[1] : null;
}

module.exports = {
  async init(skill) {
    logger.info(`[zkp-toolkit] handler initialized for "${skill?.name}"`);
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();

    // No input — show usage
    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message: [
          "ZKP Toolkit",
          "==========",
          "Usage:",
          "  /zkp-toolkit --prove <statement> --witness <secret>  Generate ZK proof",
          "  /zkp-toolkit --verify <proofId>                      Verify a proof",
          "  /zkp-toolkit --keygen <scope> [--permissions p1,p2]  Generate audit key",
          "  /zkp-toolkit --age-proof <birthDate> <minAge>        Prove age >= minimum",
          "  /zkp-toolkit --balance-proof <balance> <min>         Prove balance >= min",
          "  /zkp-toolkit --rollup <txCount>                      Create ZK-Rollup batch",
          "  /zkp-toolkit --benchmark                             Compare ZK systems",
        ].join("\n"),
      };
    }

    const manager = getZKManager();
    if (!manager?.initialized) {
      return {
        success: false,
        error: "ZeroKnowledgeManager not initialized",
        message:
          "ZKP Toolkit requires the ZeroKnowledgeManager to be initialized. Start the application first.",
      };
    }

    try {
      // ── --prove ────────────────────────────────────────
      if (/--prove\b/i.test(input)) {
        const statement = extractArg(input, /.*--prove\s*/i);
        const witness = extractNamedArg(input, "witness") || "default-witness";
        const result = await manager.generateZKProof(statement, witness);
        return {
          success: true,
          result,
          message: [
            "## ZK Proof Generated",
            "",
            `- **Proof ID**: \`${result.proofId}\``,
            `- **Proof Size**: ${result.proofSize} bytes`,
            `- **Proving Time**: ${result.provingTimeMs}ms`,
            `- **Public Inputs**: ${JSON.stringify(result.publicInputs)}`,
          ].join("\n"),
        };
      }

      // ── --verify ───────────────────────────────────────
      if (/--verify\b/i.test(input)) {
        const proofId = extractArg(input, /.*--verify\s*/i);
        const result = await manager.verifyZKProof(proofId);
        return {
          success: true,
          result,
          message: [
            "## ZK Proof Verification",
            "",
            `- **Valid**: ${result.valid ? "✓ Yes" : "✗ No"}`,
            `- **Proof Type**: ${result.proofType}`,
            `- **Verification Time**: ${result.verificationTimeMs}ms`,
          ].join("\n"),
        };
      }

      // ── --keygen ───────────────────────────────────────
      if (/--keygen\b/i.test(input)) {
        const scope = extractArg(input, /.*--keygen\s*/i);
        const permStr = extractNamedArg(input, "permissions") || "read,verify";
        const permissions = permStr.split(",").map((p) => p.trim());
        const result = await manager.createAuditKey(scope, permissions);
        return {
          success: true,
          result,
          message: [
            "## ZK Audit Key Generated",
            "",
            `- **Key ID**: \`${result.keyId}\``,
            `- **Scope**: ${result.scope}`,
            `- **Permissions**: ${result.permissions.join(", ")}`,
          ].join("\n"),
        };
      }

      // ── --age-proof ────────────────────────────────────
      if (/--age-proof\b/i.test(input)) {
        const args = input
          .replace(/.*--age-proof\s*/i, "")
          .trim()
          .split(/\s+/);
        const birthDate = args[0] || "2000-01-01";
        const minAge = parseInt(args[1], 10) || 18;
        const result = await manager.createAgeProof(birthDate, minAge);
        return {
          success: true,
          result,
          message: [
            "## Age Proof",
            "",
            `- **Claim**: ${result.claim}`,
            `- **Verified**: ${result.verified ? "✓ Yes" : "✗ No"}`,
            `- **Proof ID**: \`${result.proofId}\``,
          ].join("\n"),
        };
      }

      // ── --balance-proof ────────────────────────────────
      if (/--balance-proof\b/i.test(input)) {
        const args = input
          .replace(/.*--balance-proof\s*/i, "")
          .trim()
          .split(/\s+/);
        const balance = parseFloat(args[0]) || 1000;
        const minBalance = parseFloat(args[1]) || 100;
        const result = await manager.createBalanceProof(balance, minBalance);
        return {
          success: true,
          result,
          message: [
            "## Balance Proof",
            "",
            `- **Claim**: ${result.claim}`,
            `- **Verified**: ${result.verified ? "✓ Yes" : "✗ No"}`,
            `- **Proof ID**: \`${result.proofId}\``,
          ].join("\n"),
        };
      }

      // ── --rollup ───────────────────────────────────────
      if (/--rollup\b/i.test(input)) {
        const countStr = extractArg(input, /.*--rollup\s*/i);
        const count = parseInt(countStr, 10) || 10;
        // Generate simulated transactions
        const transactions = Array.from({ length: count }, (_, i) => ({
          id: `tx-${i + 1}`,
          from: `addr-${i}`,
          to: `addr-${i + 1}`,
          amount: Math.floor(Math.random() * 1000),
        }));
        const result = await manager.createZKRollupBatch(transactions);
        return {
          success: true,
          result,
          message: [
            "## ZK-Rollup Batch",
            "",
            `- **Batch ID**: \`${result.batchId}\``,
            `- **Transactions**: ${result.txCount}`,
            `- **Merkle Root**: \`${result.merkleRoot.slice(0, 16)}...\``,
            `- **Compression Ratio**: ${result.compressionRatio}x`,
          ].join("\n"),
        };
      }

      // ── --benchmark ────────────────────────────────────
      if (/--benchmark\b/i.test(input)) {
        const result = await manager.benchmarkSystems();
        const lines = ["## ZK Systems Benchmark", ""];
        for (const [system, data] of Object.entries(result)) {
          lines.push(
            `### ${system.toUpperCase()}`,
            `- Proving Time: ${data.provingTimeMs}ms`,
            `- Verify Time: ${data.verifyTimeMs}ms`,
            `- Proof Size: ${data.proofSizeBytes} bytes`,
            `- Setup Required: ${data.setupRequired ? "Yes" : "No"}`,
            "",
          );
        }
        return {
          success: true,
          result,
          message: lines.join("\n"),
        };
      }

      // ── Unknown command ────────────────────────────────
      return {
        success: false,
        error: "Unknown command",
        message:
          "Unrecognized command: " + input + "\nRun /zkp-toolkit for usage.",
      };
    } catch (err) {
      logger.error("[zkp-toolkit] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "ZKP operation failed: " + err.message,
      };
    }
  },
};
