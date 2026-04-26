/**
 * Merkle Tree Certificate (MTC) commands
 * chainlesschain mtc batch | verify | landmark inspect
 *
 * Phase 1 Week 3+4 — file-IO only; libp2p / IPFS distribution is future work.
 * Tree-head signature uses real Ed25519 (via @noble/curves) as a stop-gap;
 * SLH-DSA-128f remains the protocol target — module will be swapped when
 * @noble/post-quantum lands without touching CLI / cache.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import { getAllIdentities, getIdentity } from "../lib/did-manager.js";
import mtcLib from "@chainlesschain/core-mtc";

const {
  MerkleTree,
  encodeHashStr,
  sha256,
  leafHash,
  jcs,
  LandmarkCache,
  verify,
  SCHEMA_ENVELOPE,
  SCHEMA_TREE_HEAD,
  SCHEMA_LANDMARK,
  TREE_HEAD_SIG_PREFIX,
  ed25519,
} = mtcLib;

const STOPGAP_BANNER = chalk.yellow(
  "⚠ STOPGAP — tree-head signed with Ed25519 (will switch to SLH-DSA when @noble/post-quantum lands).",
);

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${filePath}: ${err.message}`);
  }
}

function writeJsonFile(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
}

function loadOrGenerateKeyPair(secretKeyPath) {
  if (secretKeyPath && fs.existsSync(secretKeyPath)) {
    const secretKey = Buffer.from(
      fs.readFileSync(secretKeyPath, "utf-8").trim(),
      "hex",
    );
    if (secretKey.length !== 32) {
      throw new Error(
        `Secret key file ${secretKeyPath} must contain 32 bytes (64 hex chars)`,
      );
    }
    // Derive publicKey from secretKey via @noble/curves through ed25519.* — use generateKeyPair-style reload
    // Simpler: re-derive via a helper. Since lib doesn't expose pubkey-from-secret directly, sign a probe
    // and use ed25519.signRaw + ed25519.signTreeHead to recover pubkey isn't possible. Fall back to using
    // a fresh keypair if no helper. Rather than add a helper, use @noble/curves directly here.
    const { ed25519: ed25519Curve } = require("@noble/curves/ed25519");
    const publicKey = Buffer.from(ed25519Curve.getPublicKey(secretKey));
    return {
      secretKey,
      publicKey,
      pubkeyId: ed25519.pubkeyId(publicKey),
    };
  }
  return ed25519.generateKeyPair();
}

function buildBatch(rawLeaves, opts) {
  const namespace = opts.namespace;
  const issuer = opts.issuer;
  const issuedAt = opts.issuedAt || new Date().toISOString();
  const expiresAt =
    opts.expiresAt || new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

  const keys = loadOrGenerateKeyPair(opts.secretKeyFile);

  const leafHashes = rawLeaves.map((l) => leafHash(jcs(l)));
  const tree = new MerkleTree(leafHashes);
  const root = tree.root();

  const treeHead = {
    schema: SCHEMA_TREE_HEAD,
    namespace,
    tree_size: leafHashes.length,
    root_hash: encodeHashStr(root),
    issued_at: issuedAt,
    expires_at: expiresAt,
    issuer,
  };
  const canonical = jcs(treeHead);
  const treeHeadId = encodeHashStr(sha256(canonical));
  const signingInput = Buffer.concat([TREE_HEAD_SIG_PREFIX, canonical]);
  const signature = ed25519.signTreeHead(signingInput, {
    secretKey: keys.secretKey,
    publicKey: keys.publicKey,
    issuer,
  });

  const landmark = {
    schema: SCHEMA_LANDMARK,
    namespace: namespace.split("/").slice(0, -1).join("/"),
    snapshots: [{ tree_head: treeHead, tree_head_id: treeHeadId, signature }],
    trust_anchors: [ed25519.trustAnchorEntry(keys.publicKey, issuer)],
    published_at: issuedAt,
    publisher_signature: {
      alg: "Ed25519",
      key_id: issuer + "#key-1",
      sig: "TODO-PUBLISHER-SIG",
    },
  };

  const envelopes = rawLeaves.map((leaf, i) => ({
    schema: SCHEMA_ENVELOPE,
    namespace,
    tree_head_id: treeHeadId,
    leaf,
    inclusion_proof: {
      leaf_index: i,
      tree_size: leafHashes.length,
      audit_path: tree.prove(i).map((b) => encodeHashStr(b)),
    },
  }));

  return { landmark, envelopes, treeHeadId, keys };
}

export function registerMtcCommand(program) {
  const mtc = program
    .command("mtc")
    .description("Merkle Tree Certificates — batch issuance & verification");

  // mtc batch
  mtc
    .command("batch")
    .description("Build a tree + landmark + envelopes from a list of leaves")
    .argument("<input>", "JSON file containing an array of leaf objects")
    .requiredOption("--namespace <ns>", "Namespace, e.g. mtc/v1/did/000142")
    .requiredOption(
      "--issuer <issuer>",
      "MTCA issuer string, e.g. mtca:cc:zQ3sh...",
    )
    .option("--out <dir>", "Output directory (default: ./mtc-out)", "./mtc-out")
    .option("--issued-at <iso>", "Override issued_at timestamp")
    .option("--expires-at <iso>", "Override expires_at timestamp")
    .option(
      "--secret-key-file <path>",
      "Reuse Ed25519 secret key from this hex file (creates one if missing)",
    )
    .option("--json", "Print JSON summary instead of human output")
    .action(async (inputPath, options) => {
      try {
        const rawLeaves = readJsonFile(inputPath);
        if (!Array.isArray(rawLeaves) || rawLeaves.length === 0) {
          throw new Error("Input must be a non-empty JSON array of leaves");
        }

        const { landmark, envelopes, treeHeadId, keys } = buildBatch(
          rawLeaves,
          {
            namespace: options.namespace,
            issuer: options.issuer,
            issuedAt: options.issuedAt,
            expiresAt: options.expiresAt,
            secretKeyFile: options.secretKeyFile,
          },
        );

        const outDir = path.resolve(options.out);
        const landmarkPath = path.join(outDir, "landmark.json");
        writeJsonFile(landmarkPath, landmark);

        // If a secret-key-file path was given but didn't exist, save the new key for reuse
        if (options.secretKeyFile && !fs.existsSync(options.secretKeyFile)) {
          fs.mkdirSync(path.dirname(options.secretKeyFile), {
            recursive: true,
          });
          fs.writeFileSync(
            options.secretKeyFile,
            keys.secretKey.toString("hex"),
            { mode: 0o600 },
          );
        }

        const envelopePaths = [];
        for (let i = 0; i < envelopes.length; i++) {
          const p = path.join(
            outDir,
            `envelope-${String(i).padStart(6, "0")}.json`,
          );
          writeJsonFile(p, envelopes[i]);
          envelopePaths.push(p);
        }

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                tree_head_id: treeHeadId,
                tree_size: landmark.snapshots[0].tree_head.tree_size,
                root_hash: landmark.snapshots[0].tree_head.root_hash,
                landmark_path: landmarkPath,
                envelope_paths: envelopePaths,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(STOPGAP_BANNER);
          logger.success("Batch built");
          logger.log(`  ${chalk.bold("Namespace:")}    ${options.namespace}`);
          logger.log(`  ${chalk.bold("Tree size:")}    ${rawLeaves.length}`);
          logger.log(
            `  ${chalk.bold("Root hash:")}    ${landmark.snapshots[0].tree_head.root_hash}`,
          );
          logger.log(`  ${chalk.bold("Tree head ID:")} ${treeHeadId}`);
          logger.log(
            `  ${chalk.bold("Landmark:")}     ${chalk.cyan(landmarkPath)}`,
          );
          logger.log(
            `  ${chalk.bold("Envelopes:")}    ${envelopePaths.length} files in ${outDir}`,
          );
        }
      } catch (err) {
        logger.error(`mtc batch failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc verify
  mtc
    .command("verify")
    .description("Verify an MTC envelope against a landmark")
    .argument("<envelope>", "Path to envelope JSON file")
    .requiredOption("--landmark <path>", "Path to landmark JSON file")
    .option("--now <iso>", "Override current time for expiry check (ISO 8601)")
    .option("--json", "Output structured JSON")
    .action(async (envelopePath, options) => {
      try {
        const envelope = readJsonFile(envelopePath);
        const landmark = readJsonFile(options.landmark);

        const cache = new LandmarkCache({
          signatureVerifier: ed25519.makeVerifierFromLandmark(landmark),
        });
        cache.ingest(landmark);

        const now = options.now ? Date.parse(options.now) : Date.now();
        const result = verify(envelope, cache, { now });

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          if (!result.ok) process.exit(2);
          return;
        }
        if (result.ok) {
          logger.log(STOPGAP_BANNER);
          logger.success(`Envelope verified`);
          logger.log(
            `  ${chalk.bold("Subject:")}   ${result.leaf.subject || "(no subject)"}`,
          );
          logger.log(
            `  ${chalk.bold("Kind:")}      ${result.leaf.kind || "(unknown)"}`,
          );
          logger.log(
            `  ${chalk.bold("Tree size:")} ${result.treeHead.tree_size}`,
          );
          logger.log(`  ${chalk.bold("Issuer:")}    ${result.treeHead.issuer}`);
        } else {
          logger.error(`Verification failed: ${result.code}`);
          if (result.recoverable) {
            logger.log(
              chalk.yellow(
                "  This error is recoverable — try fetching a fresher landmark.",
              ),
            );
          }
          process.exit(2);
        }
      } catch (err) {
        logger.error(`mtc verify failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc landmark inspect
  const landmarkCmd = mtc.command("landmark").description("Landmark utilities");

  landmarkCmd
    .command("inspect")
    .description("Pretty-print a landmark file's structure")
    .argument("<landmark>", "Path to landmark JSON file")
    .option("--json", "Output structured JSON")
    .action(async (landmarkPath, options) => {
      try {
        const landmark = readJsonFile(landmarkPath);
        if (landmark.schema !== SCHEMA_LANDMARK) {
          throw new Error(`Not a landmark file (schema = ${landmark.schema})`);
        }

        const summary = {
          namespace_prefix: landmark.namespace,
          published_at: landmark.published_at,
          snapshot_count: (landmark.snapshots || []).length,
          trust_anchor_count: (landmark.trust_anchors || []).length,
          snapshots: (landmark.snapshots || []).map((s) => ({
            namespace: s.tree_head.namespace,
            tree_size: s.tree_head.tree_size,
            root_hash: s.tree_head.root_hash,
            tree_head_id: s.tree_head_id,
            issued_at: s.tree_head.issued_at,
            expires_at: s.tree_head.expires_at,
            issuer: s.tree_head.issuer,
            signature_alg: s.signature && s.signature.alg,
          })),
        };

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          logger.log(`${chalk.bold("Landmark:")}        ${landmarkPath}`);
          logger.log(
            `${chalk.bold("Namespace prefix:")} ${summary.namespace_prefix}`,
          );
          logger.log(
            `${chalk.bold("Published at:")}     ${summary.published_at}`,
          );
          logger.log(
            `${chalk.bold("Snapshots:")}        ${summary.snapshot_count}`,
          );
          logger.log(
            `${chalk.bold("Trust anchors:")}    ${summary.trust_anchor_count}`,
          );
          for (const s of summary.snapshots) {
            logger.log("");
            logger.log(`  ${chalk.cyan(s.namespace)}`);
            logger.log(`    tree_size:  ${s.tree_size}`);
            logger.log(`    root_hash:  ${s.root_hash}`);
            logger.log(`    issuer:     ${s.issuer}`);
            logger.log(`    expires_at: ${s.expires_at}`);
            logger.log(`    sig_alg:    ${s.signature_alg}`);
          }
        }
      } catch (err) {
        logger.error(`mtc landmark inspect failed: ${err.message}`);
        process.exit(1);
      }
    });

  // mtc batch-dids — read DIDs from local DB and produce a batch
  mtc
    .command("batch-dids")
    .description("Build a batch from DIDs in the local DB (all by default)")
    .requiredOption("--namespace <ns>", "Namespace, e.g. mtc/v1/did/000007")
    .requiredOption("--issuer <issuer>", "MTCA issuer string")
    .option(
      "--did <did>",
      "Include only this DID (repeatable)",
      (val, prev) => [...(prev || []), val],
    )
    .option("--out <dir>", "Output directory (default: ./mtc-out)", "./mtc-out")
    .option("--issued-at <iso>", "Override issued_at timestamp")
    .option("--expires-at <iso>", "Override expires_at timestamp")
    .option(
      "--secret-key-file <path>",
      "Reuse Ed25519 secret key from this hex file (creates one if missing)",
    )
    .option("--json", "Print JSON summary instead of human output")
    .action(async (options) => {
      let ctx;
      try {
        ctx = await bootstrap({});
        if (!ctx.db) throw new Error("Database not available");
        const db = ctx.db.getDatabase();

        let rows;
        if (options.did && options.did.length > 0) {
          rows = options.did
            .map((d) => getIdentity(db, d))
            .filter((r) => r != null);
          if (rows.length === 0)
            throw new Error("No matching DIDs found in local DB");
        } else {
          rows = getAllIdentities(db);
          if (rows.length === 0) {
            throw new Error(
              "No DIDs in local DB. Run `cc did create` first or pass --did <did>.",
            );
          }
        }

        const rawLeaves = rows.map((row) => {
          let didDoc;
          try {
            didDoc = JSON.parse(row.did_document);
          } catch (_err) {
            throw new Error(`DID ${row.did} has malformed did_document in DB`);
          }
          return {
            kind: "did-document",
            content_hash: encodeHashStr(sha256(jcs(didDoc))),
            issued_at: row.created_at || new Date().toISOString(),
            subject: row.did,
            metadata: { version: "1.0.0", supersedes: null },
          };
        });

        const { landmark, envelopes, treeHeadId, keys } = buildBatch(
          rawLeaves,
          {
            namespace: options.namespace,
            issuer: options.issuer,
            issuedAt: options.issuedAt,
            expiresAt: options.expiresAt,
            secretKeyFile: options.secretKeyFile,
          },
        );

        const outDir = path.resolve(options.out);
        const landmarkPath = path.join(outDir, "landmark.json");
        writeJsonFile(landmarkPath, landmark);

        if (options.secretKeyFile && !fs.existsSync(options.secretKeyFile)) {
          fs.mkdirSync(path.dirname(options.secretKeyFile), {
            recursive: true,
          });
          fs.writeFileSync(
            options.secretKeyFile,
            keys.secretKey.toString("hex"),
            { mode: 0o600 },
          );
        }

        const envelopePaths = [];
        for (let i = 0; i < envelopes.length; i++) {
          const p = path.join(
            outDir,
            `envelope-${String(i).padStart(6, "0")}.json`,
          );
          writeJsonFile(p, envelopes[i]);
          envelopePaths.push(p);
        }

        const subjects = rawLeaves.map((l) => l.subject);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                tree_head_id: treeHeadId,
                tree_size: rawLeaves.length,
                root_hash: landmark.snapshots[0].tree_head.root_hash,
                landmark_path: landmarkPath,
                envelope_paths: envelopePaths,
                subjects,
              },
              null,
              2,
            ),
          );
        } else {
          logger.log(STOPGAP_BANNER);
          logger.success(`Batched ${rawLeaves.length} DID(s)`);
          logger.log(`  ${chalk.bold("Namespace:")}    ${options.namespace}`);
          logger.log(`  ${chalk.bold("Tree size:")}    ${rawLeaves.length}`);
          logger.log(
            `  ${chalk.bold("Root hash:")}    ${landmark.snapshots[0].tree_head.root_hash}`,
          );
          logger.log(`  ${chalk.bold("Tree head ID:")} ${treeHeadId}`);
          logger.log(
            `  ${chalk.bold("Landmark:")}     ${chalk.cyan(landmarkPath)}`,
          );
          logger.log(
            `  ${chalk.bold("Envelopes:")}    ${envelopePaths.length} files in ${outDir}`,
          );
          logger.log(`  ${chalk.bold("Subjects:")}`);
          for (const s of subjects) logger.log(`    ${chalk.gray(s)}`);
        }

        await shutdown();
      } catch (err) {
        logger.error(`mtc batch-dids failed: ${err.message}`);
        if (ctx) await shutdown().catch(() => {});
        process.exit(1);
      }
    });
}
