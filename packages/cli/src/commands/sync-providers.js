/**
 * cc sync webdav / cc sync oss subcommand groups — Phase 3c follow-up.
 *
 * v0.1 (Phase 1)：configure / status / clear — 凭据落 ~/.chainlesschain/
 * sync-credentials.enc (AES-256-GCM)，与 desktop secure-config 同 shape。
 *
 * v0.2 (Phase 2)：test (real connectivity probe) + run (本机 vault 同步)
 * — 需 @aws-sdk/client-s3 + webdav npm dep + better-sqlite3 vault wiring，
 * 工程更大；本 commit 不含。
 *
 * 命令树：
 *   cc sync webdav configure --url ... --username ... --password ... [--remote-path]
 *   cc sync webdav status                   显示 mask 后凭据 + configured 标记
 *   cc sync webdav clear                    擦除凭据 + 在 vault 内移除该 provider
 *   cc sync oss configure --endpoint --region --bucket --access-key-id
 *                         --secret-access-key [--remote-path] [--force-path-style]
 *   cc sync oss status
 *   cc sync oss clear
 *
 * password / secretAccessKey 走 stdin 提示也支持（避免 shell history 留痕）—
 * 留 v0.2 加 prompts；v0.1 仅 flag。
 */

"use strict";

import chalk from "chalk";
import {
  ALLOWED_PROVIDER_IDS,
  getCredentialsSanitized,
  hasCredentials,
  setCredentials,
  clearCredentials,
} from "../lib/sync-credentials.js";

function _ensureValidProvider(name) {
  if (!ALLOWED_PROVIDER_IDS.includes(name)) {
    throw new Error(
      `Unknown sync provider '${name}' (allowed: ${ALLOWED_PROVIDER_IDS.join(", ")})`,
    );
  }
}

function _printStatus(providerId) {
  _ensureValidProvider(providerId);
  const masked = getCredentialsSanitized(providerId);
  const configured = hasCredentials(providerId);
  console.log(
    JSON.stringify(
      {
        provider: providerId,
        configured,
        credentials: masked,
        notes: configured
          ? [
              "secrets are masked; raw values stored encrypted at ~/.chainlesschain/sync-credentials.enc",
            ]
          : ["not configured; run `cc sync <provider> configure --<flags>`"],
      },
      null,
      2,
    ),
  );
}

function _configureWebDAV(opts) {
  const url = (opts.url || "").trim();
  if (!url) throw new Error("--url required");
  const username = (opts.username || "").trim();
  const password = opts.password;
  if (!password)
    throw new Error("--password required (use stdin or env in v0.2)");
  const remotePath = (opts.remotePath || "/").trim();
  setCredentials("webdav", { url, username, password, remotePath });
  console.log(chalk.green("✓ WebDAV credentials saved"));
  console.log(chalk.dim(`  url:        ${url}`));
  console.log(chalk.dim(`  username:   ${username}`));
  console.log(chalk.dim(`  password:   ********`));
  console.log(chalk.dim(`  remotePath: ${remotePath}`));
}

function _configureOSS(opts) {
  const endpoint = (opts.endpoint || "").trim();
  if (!endpoint) throw new Error("--endpoint required");
  const bucket = (opts.bucket || "").trim();
  if (!bucket) throw new Error("--bucket required");
  const accessKeyId = (opts.accessKeyId || "").trim();
  if (!accessKeyId) throw new Error("--access-key-id required");
  const secretAccessKey = opts.secretAccessKey;
  if (!secretAccessKey) {
    throw new Error("--secret-access-key required (use stdin or env in v0.2)");
  }
  const region = (opts.region || "auto").trim();
  const remotePath = (opts.remotePath || "").trim();
  const forcePathStyle = opts.forcePathStyle === true;
  setCredentials("oss", {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    remotePath,
    forcePathStyle,
  });
  console.log(chalk.green("✓ OSS / S3 credentials saved"));
  console.log(chalk.dim(`  endpoint:        ${endpoint}`));
  console.log(chalk.dim(`  region:          ${region}`));
  console.log(chalk.dim(`  bucket:          ${bucket}`));
  console.log(chalk.dim(`  accessKeyId:     ${accessKeyId}`));
  console.log(chalk.dim(`  secretAccessKey: ********`));
  console.log(chalk.dim(`  remotePath:      ${remotePath}`));
  console.log(chalk.dim(`  forcePathStyle:  ${forcePathStyle}`));
}

function _clearProvider(providerId) {
  _ensureValidProvider(providerId);
  if (!hasCredentials(providerId)) {
    console.log(chalk.dim(`(${providerId} was already empty)`));
    return;
  }
  clearCredentials(providerId);
  console.log(chalk.green(`✓ ${providerId} credentials cleared`));
}

/**
 * Attach `cc sync webdav *` and `cc sync oss *` subcommands to the existing
 * `cc sync` parent command. Caller passes the program; we find the sync
 * parent and add children.
 */
export function registerSyncProviderCommands(program) {
  const parent = program.commands.find((c) => c.name() === "sync");
  if (!parent) {
    throw new Error(
      "registerSyncProviderCommands: parent `sync` command not registered yet — call after registerSyncCommand",
    );
  }

  // ── webdav subgroup ────────────────────────────────────────────
  const webdav = parent
    .command("webdav")
    .description(
      "WebDAV (Nextcloud / 坚果云 / 群晖) sync provider — credential management",
    );

  webdav
    .command("configure")
    .description(
      "Save WebDAV credentials to ~/.chainlesschain/sync-credentials.enc",
    )
    .requiredOption("--url <url>", "WebDAV endpoint URL")
    .option("--username <name>", "WebDAV username", "")
    .requiredOption(
      "--password <pw>",
      "WebDAV password (use stdin in v0.2 — for now this WILL hit shell history)",
    )
    .option("--remote-path <p>", "remote directory path", "/")
    .action(async (opts) => {
      try {
        _configureWebDAV(opts);
      } catch (err) {
        console.error(chalk.red(`✗ ${err?.message || err}`));
        process.exitCode = 2;
      }
    });

  webdav
    .command("status")
    .description("Show sanitized WebDAV credentials + configured flag")
    .action(() => {
      try {
        _printStatus("webdav");
      } catch (err) {
        console.error(chalk.red(`✗ ${err?.message || err}`));
        process.exitCode = 2;
      }
    });

  webdav
    .command("clear")
    .description("Remove WebDAV credentials from vault")
    .action(() => {
      try {
        _clearProvider("webdav");
      } catch (err) {
        console.error(chalk.red(`✗ ${err?.message || err}`));
        process.exitCode = 2;
      }
    });

  // ── oss subgroup ───────────────────────────────────────────────
  const oss = parent
    .command("oss")
    .description(
      "S3 / OSS (AWS / 阿里云 / R2 / B2) sync provider — credential management",
    );

  oss
    .command("configure")
    .description(
      "Save OSS credentials to ~/.chainlesschain/sync-credentials.enc",
    )
    .requiredOption(
      "--endpoint <url>",
      "S3-compat endpoint URL (e.g. https://oss-cn-hangzhou.aliyuncs.com)",
    )
    .option(
      "--region <r>",
      "region (default: auto for R2 / explicit for AWS+aliyun)",
      "auto",
    )
    .requiredOption("--bucket <name>", "target bucket name")
    .requiredOption("--access-key-id <id>", "access key id")
    .requiredOption(
      "--secret-access-key <secret>",
      "secret access key (use stdin in v0.2 — hits shell history now)",
    )
    .option("--remote-path <p>", "object key prefix", "")
    .option(
      "--force-path-style",
      "use path-style URLs (R2 / MinIO need true)",
      false,
    )
    .action(async (opts) => {
      try {
        _configureOSS(opts);
      } catch (err) {
        console.error(chalk.red(`✗ ${err?.message || err}`));
        process.exitCode = 2;
      }
    });

  oss
    .command("status")
    .description("Show sanitized OSS credentials + configured flag")
    .action(() => {
      try {
        _printStatus("oss");
      } catch (err) {
        console.error(chalk.red(`✗ ${err?.message || err}`));
        process.exitCode = 2;
      }
    });

  oss
    .command("clear")
    .description("Remove OSS credentials from vault")
    .action(() => {
      try {
        _clearProvider("oss");
      } catch (err) {
        console.error(chalk.red(`✗ ${err?.message || err}`));
        process.exitCode = 2;
      }
    });
}
