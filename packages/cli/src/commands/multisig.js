/**
 * v1.2 m-of-n Phase 1d — `cc multisig` CLI surface.
 *
 * Subcommands:
 *   cc multisig propose <domain> --payload-file <path> [--initiator <did>] [--key <hex|path>]
 *   cc multisig sign <proposalId> --signer <did> [--key <hex|path>]
 *   cc multisig cancel <proposalId> [--reason <text>]
 *   cc multisig list [--state <s>] [--domain <d>] [--limit <n>] [--json]
 *   cc multisig show <proposalId> [--json]
 *   cc multisig finalize <proposalId>           # 业务方完成后标 consumed
 *   cc multisig policy show <domain> [--json]
 *   cc multisig policy set <domain> --m <M> --members <json|file>
 *   cc multisig sweep                           # expire stale pending
 *
 * 设计：CLI 端持 better-sqlite3 DB (默认 ~/.chainlesschain/multisig.db) +
 *      governance log (默认 ~/.chainlesschain/multisig.governance.log)。
 *      secretKey 来源：--key <hex> 直接读 / --key-file <path> 读文件 hex。
 *      Phase 1d 内 keystore 集成留 v1.3 (与 core-did/UnifiedKeyStore 接通)。
 */

import chalk from "chalk";
import multisig from "@chainlesschain/core-multisig";
import {
  openMultisigManager,
  defaultMultisigDbPath,
  defaultMultisigLogPath,
  readSecretKey,
  readJsonArg,
} from "../lib/multisig-runtime.js";

const { normalizePolicy } = multisig;

// Phase 2 refactor: open / readKey / readJsonArg moved to lib/multisig-runtime.js
// so commands/marketplace.js can reuse the same SQLite cascade + manager loader.
// Aliases below preserve Phase 1 internal names without rewriting every callsite.
const _openManager = openMultisigManager;
const _defaultDbPath = defaultMultisigDbPath;
const _defaultLogPath = defaultMultisigLogPath;
const _readKey = readSecretKey;
const _readJsonArg = readJsonArg;

function _formatProposalTable(proposal, sigs = []) {
  const lines = [
    `${chalk.bold("ID")}        ${proposal.id}`,
    `${chalk.bold("Domain")}    ${proposal.domain}`,
    `${chalk.bold("State")}     ${_colorState(proposal.state)}`,
    `${chalk.bold("M / N")}     ${proposal.thresholdM} / ${proposal.memberSet.length}`,
    `${chalk.bold("Sigs")}      ${sigs.length} / ${proposal.thresholdM}`,
    `${chalk.bold("Initiator")} ${proposal.initiatorDid}`,
    `${chalk.bold("Created")}   ${new Date(proposal.createdAtMs).toISOString()}`,
    `${chalk.bold("Expires")}   ${new Date(proposal.expiresAtMs).toISOString()}`,
  ];
  return lines.join("\n");
}

function _colorState(state) {
  switch (state) {
    case "pending":
      return chalk.yellow(state);
    case "reached":
      return chalk.cyan(state);
    case "consumed":
      return chalk.green(state);
    case "cancelled":
      return chalk.gray(state);
    case "expired":
      return chalk.red(state);
    default:
      return state;
  }
}

export function registerMultisigCommand(program) {
  const cmd = program
    .command("multisig")
    .description(
      "M-of-N multi-signature proposals beyond MTC publisher_signature",
    );

  // ===== propose =====
  cmd
    .command("propose <domain>")
    .description("Create a new M-of-N proposal and sign as initiator")
    .requiredOption(
      "--payload-file <path>",
      "Path to JSON file containing the payload to be signed",
    )
    .requiredOption(
      "--initiator <did>",
      "Initiator DID — must be in policy.members",
    )
    .option("--alg <alg>", "Initiator signing alg", "Ed25519")
    .option(
      "--key <hex|path>",
      "Initiator secret key hex string or path to hex file",
    )
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON instead of human-readable")
    .action(async (domain, options) => {
      const { db, store, mgr, close } = await _openManager(
        options.db,
        options.log,
      );
      try {
        const policy = store.getPolicy(domain);
        if (!policy) {
          console.error(
            chalk.red(
              `No policy set for domain "${domain}". Run: cc multisig policy set ${domain} --m <M> --members <json>`,
            ),
          );
          process.exit(2);
        }
        const payload = _readJsonArg(options.payloadFile);
        const secretKey = _readKey(options.key);
        const result = mgr.propose({
          domain,
          payload,
          policy,
          initiator: { did: options.initiator, alg: options.alg, secretKey },
        });
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                proposalId: result.proposal.id,
                reachedThreshold: result.reachedThreshold,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(chalk.green("✓ Proposal created"));
          console.log(_formatProposalTable(result.proposal, [{}]));
          if (result.reachedThreshold) {
            console.log(
              chalk.cyan("\nThreshold reached on first signature (1-of-N)."),
            );
          }
        }
      } finally {
        close();
      }
    });

  // ===== sign =====
  cmd
    .command("sign <proposalId>")
    .description("Add a signature to an existing pending proposal")
    .requiredOption(
      "--signer <did>",
      "Signer DID — must be in proposal.memberSet",
    )
    .option("--alg <alg>", "Signer signing alg", "Ed25519")
    .option("--key <hex|path>", "Signer secret key hex or path")
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (proposalId, options) => {
      const { mgr, close } = await _openManager(options.db, options.log);
      try {
        const secretKey = _readKey(options.key);
        const r = mgr.sign({
          proposalId,
          signer: { did: options.signer, alg: options.alg, secretKey },
        });
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else if (r.accepted) {
          console.log(chalk.green("✓ Signature accepted"));
          if (r.reachedThreshold) {
            console.log(
              chalk.cyan("✓ Threshold reached — proposal ready for finalize"),
            );
          }
        } else {
          console.log(chalk.red(`✗ Signature rejected: ${r.reason}`));
        }
        if (!r.accepted) process.exit(1);
      } finally {
        close();
      }
    });

  // ===== cancel =====
  cmd
    .command("cancel <proposalId>")
    .description("Cancel a pending or reached proposal")
    .option("--reason <text>", "Free-text reason logged to governance.log")
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (proposalId, options) => {
      const { mgr, close } = await _openManager(options.db, options.log);
      try {
        const r = mgr.cancel(proposalId, options.reason);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else if (r.ok) {
          console.log(chalk.gray("✓ Proposal cancelled"));
        } else {
          console.log(chalk.red(`✗ Cancel rejected: ${r.reason}`));
          process.exit(1);
        }
      } finally {
        close();
      }
    });

  // ===== finalize =====
  cmd
    .command("finalize <proposalId>")
    .description(
      "Mark a reached proposal as consumed (business operation complete)",
    )
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (proposalId, options) => {
      const { mgr, close } = await _openManager(options.db, options.log);
      try {
        const r = mgr.finalize(proposalId);
        if (options.json) {
          console.log(JSON.stringify(r, null, 2));
        } else if (r.ok) {
          console.log(chalk.green("✓ Proposal finalized (state=consumed)"));
        } else {
          console.log(chalk.red(`✗ Finalize rejected: ${r.reason}`));
          process.exit(1);
        }
      } finally {
        close();
      }
    });

  // ===== list =====
  cmd
    .command("list")
    .description("List proposals")
    .option(
      "--state <s>",
      "Filter by state (pending|reached|consumed|cancelled|expired)",
    )
    .option("--domain <d>", "Filter by domain")
    .option("--limit <n>", "Max rows", (v) => parseInt(v, 10), 50)
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { store, close } = await _openManager(options.db, options.log);
      try {
        const proposals = store.listProposals({
          state: options.state,
          domain: options.domain,
          limit: options.limit,
        });
        if (options.json) {
          console.log(
            JSON.stringify(
              proposals.map((p) => ({
                id: p.id,
                domain: p.domain,
                state: p.state,
                m: p.thresholdM,
                n: p.memberSet.length,
                initiatorDid: p.initiatorDid,
                createdAtMs: p.createdAtMs,
                expiresAtMs: p.expiresAtMs,
              })),
              null,
              2,
            ),
          );
        } else {
          if (proposals.length === 0) {
            console.log(chalk.gray("(no proposals)"));
            return;
          }
          for (const p of proposals) {
            const sigCount = store.getSignatures(p.id).length;
            console.log(
              `${chalk.gray(p.id.padEnd(28))} ${_colorState(p.state.padEnd(10))} ${chalk.bold(
                p.domain.padEnd(24),
              )} ${sigCount}/${p.thresholdM}  ${new Date(p.createdAtMs).toISOString()}`,
            );
          }
        }
      } finally {
        close();
      }
    });

  // ===== show =====
  cmd
    .command("show <proposalId>")
    .description("Show detailed proposal with all signatures")
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (proposalId, options) => {
      const { mgr, close } = await _openManager(options.db, options.log);
      try {
        const got = mgr.get(proposalId);
        if (!got) {
          console.error(chalk.red(`No proposal: ${proposalId}`));
          process.exit(2);
        }
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                proposal: {
                  ...got.proposal,
                  payloadHash: got.proposal.payloadHash.toString("hex"),
                  payload: JSON.parse(got.proposal.payloadJcs),
                },
                signatures: got.signatures.map((s) => ({
                  signerDid: s.signerDid,
                  alg: s.alg,
                  signedAtMs: s.signedAtMs,
                  sigBytes: s.sig.length,
                })),
              },
              null,
              2,
            ),
          );
        } else {
          console.log(_formatProposalTable(got.proposal, got.signatures));
          console.log(`\n${chalk.bold("Payload:")}`);
          console.log(got.proposal.payloadJcs);
          console.log(`\n${chalk.bold("Signatures:")}`);
          for (const s of got.signatures) {
            console.log(
              `  ${chalk.green("✓")} ${s.signerDid.padEnd(36)} ${s.alg.padEnd(20)} ${new Date(
                s.signedAtMs,
              ).toISOString()}`,
            );
          }
        }
      } finally {
        close();
      }
    });

  // ===== sweep =====
  cmd
    .command("sweep")
    .description("Expire all pending proposals past their deadline")
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (options) => {
      const { mgr, close } = await _openManager(options.db, options.log);
      try {
        const count = mgr.expireStale();
        if (options.json) {
          console.log(JSON.stringify({ expired: count }, null, 2));
        } else {
          console.log(
            count === 0
              ? chalk.gray("Nothing to expire")
              : chalk.yellow(`✓ Expired ${count} stale proposal(s)`),
          );
        }
      } finally {
        close();
      }
    });

  // ===== policy =====
  const policy = cmd
    .command("policy")
    .description("Manage per-domain multisig policies");

  policy
    .command("show <domain>")
    .description("Show the policy for a domain")
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (domain, options) => {
      const { store, close } = await _openManager(options.db, options.log);
      try {
        const p = store.getPolicy(domain);
        if (!p) {
          console.error(chalk.red(`No policy: ${domain}`));
          process.exit(2);
        }
        if (options.json) {
          console.log(JSON.stringify(p, null, 2));
        } else {
          console.log(`${chalk.bold("Domain:")} ${p.domain}`);
          console.log(`${chalk.bold("M / N:")}  ${p.m} / ${p.members.length}`);
          console.log(
            `${chalk.bold("requirePqc:")} ${p.requirePqc === true ? "yes" : "no"}`,
          );
          console.log(`${chalk.bold("Members:")}`);
          for (const m of p.members) {
            console.log(`  ${m.did.padEnd(36)} ${m.alg}`);
          }
        }
      } finally {
        close();
      }
    });

  policy
    .command("set <domain>")
    .description("Set or update the policy for a domain")
    .requiredOption("--m <M>", "Threshold M", (v) => parseInt(v, 10))
    .requiredOption(
      "--members <json|file>",
      "JSON array of {did, alg, pubkeyJwk} or path to file",
    )
    .option("--require-pqc", "Require at least one SLH-DSA signature", false)
    .option("--expiry-ms <ms>", "Default proposal expiry in ms", (v) =>
      parseInt(v, 10),
    )
    .option("--db <path>", "SQLite DB path", _defaultDbPath())
    .option("--log <path>", "Governance log path", _defaultLogPath())
    .option("--json", "Output JSON")
    .action(async (domain, options) => {
      const { store, close } = await _openManager(options.db, options.log);
      try {
        const members = _readJsonArg(options.members);
        if (!Array.isArray(members) || members.length === 0) {
          console.error(chalk.red("--members must be a non-empty JSON array"));
          process.exit(2);
        }
        const policy = {
          domain,
          m: options.m,
          n: members.length,
          members,
          requirePqc: options.requirePqc === true,
        };
        if (options.expiryMs) policy.defaultExpiryMs = options.expiryMs;
        const normalized = normalizePolicy(policy); // validate + fill defaults
        store.setPolicy(domain, JSON.stringify(normalized), Date.now());
        if (options.json) {
          console.log(
            JSON.stringify(
              { ok: true, domain, m: normalized.m, n: normalized.n },
              null,
              2,
            ),
          );
        } else {
          console.log(
            chalk.green(
              `✓ Policy set: ${domain} (${normalized.m}-of-${normalized.n})`,
            ),
          );
        }
      } finally {
        close();
      }
    });
}

// 暴露给单测 / 集成测试
export const _multisigInternals = {
  _defaultDbPath,
  _defaultLogPath,
  _openManager,
  _readKey,
  _readJsonArg,
};
