/**
 * SSO commands — Phase 14 SSO Enterprise Authentication CLI.
 * `cc sso ...`
 *
 * Scope: configuration CRUD, PKCE helpers, authorization-URL / SAML
 * AuthnRequest builders, session lifecycle, DID ↔ SSO identity bridge.
 * The browser round-trip to the IdP is driven by an external tool; callers
 * feed the resulting tokens back in via `cc sso complete-login`.
 */

import chalk from "chalk";
import { logger } from "../lib/logger.js";
import { bootstrap, shutdown } from "../runtime/bootstrap.js";
import {
  SSO_PROTOCOLS,
  PROVIDER_TYPES,
  SESSION_STATUS,
  TEST_STATUS,
  listProviderTemplates,
  getProviderTemplate,
  ensureSSOTables,
  createConfiguration,
  getConfiguration,
  listConfigurations,
  updateConfiguration,
  deleteConfiguration,
  recordTestResult,
  generatePKCE,
  buildAuthorizationUrl,
  buildSamlAuthnRequest,
  createSession,
  getSession,
  listSessions,
  refreshSessionTokens,
  destroySession,
  expireSession,
  isSessionValid,
  linkIdentity,
  unlinkIdentity,
  getSSOIdentities,
  getDIDForSSO,
  listIdentityMappings,
  checkIdentityConflict,
  getStats,
  PROVIDER_MATURITY_V2 as PMV2,
  LOGIN_LIFECYCLE_V2 as LLV2,
  registerProviderV2,
  activateProviderV2,
  deprecateProviderV2,
  retireProviderV2,
  touchProviderV2,
  getProviderV2,
  listProvidersV2,
  createLoginV2,
  startLoginV2,
  completeLoginV2,
  failLoginV2,
  cancelLoginV2,
  getLoginV2,
  listLoginsV2,
  autoDeprecateIdleProvidersV2,
  autoFailStuckLoginsV2,
  getSsoManagerStatsV2,
  setMaxActiveProvidersPerOwnerV2,
  setMaxPendingLoginsPerProviderV2,
  setProviderIdleMsV2,
  setLoginStuckMsV2,
  getMaxActiveProvidersPerOwnerV2,
  getMaxPendingLoginsPerProviderV2,
  getProviderIdleMsV2,
  getLoginStuckMsV2,
} from "../lib/sso-manager.js";

function _dbFromCtx(cmd) {
  const root = cmd?.parent?.parent ?? cmd?.parent;
  return root?._db;
}

async function _prepare(cmd) {
  const verbose = cmd?.parent?.parent?.opts?.()?.verbose;
  const ctx = await bootstrap({ verbose });
  if (!ctx.db) {
    logger.error("Database not available");
    process.exit(1);
  }
  const db = ctx.db.getDatabase();
  ensureSSOTables(db);
  return db;
}

function _parseJson(value, label) {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch (_e) {
    throw new Error(`Invalid JSON for ${label}`);
  }
}

export function registerSsoCommand(program) {
  const sso = program
    .command("sso")
    .description(
      "SSO enterprise authentication — SAML / OAuth2 / OIDC (Phase 14)",
    )
    .hook("preAction", async (thisCommand, actionCommand) => {
      if (actionCommand && actionCommand.name().endsWith("-v2")) return;
      const db = await _prepare(thisCommand);
      thisCommand._db = db;
    });

  // ─── Catalog ────────────────────────────────────────────────

  sso
    .command("protocols")
    .description("List supported SSO protocols")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = Object.values(SSO_PROTOCOLS);
      if (options.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      for (const p of list) logger.log(`  ${chalk.cyan(p)}`);
    });

  sso
    .command("provider-types")
    .description("List supported provider types")
    .option("--json", "Output as JSON")
    .action((options) => {
      if (options.json) {
        console.log(JSON.stringify(PROVIDER_TYPES, null, 2));
        return;
      }
      for (const p of PROVIDER_TYPES) logger.log(`  ${chalk.cyan(p)}`);
    });

  sso
    .command("templates")
    .description("List built-in provider templates")
    .option("--json", "Output as JSON")
    .action((options) => {
      const list = listProviderTemplates();
      if (options.json) {
        console.log(JSON.stringify(list, null, 2));
        return;
      }
      logger.info(`${list.length} templates`);
      for (const t of list) {
        logger.log(
          `  ${chalk.cyan(t.id.padEnd(18))} ${chalk.dim(t.protocol.padEnd(8))} ${t.name}`,
        );
      }
    });

  sso
    .command("template <id>")
    .description("Show a provider template")
    .option("--json", "Output as JSON")
    .action((id, options) => {
      const t = getProviderTemplate(id);
      if (!t) {
        logger.error(`Template not found: ${id}`);
        process.exit(1);
      }
      if (options.json) {
        console.log(JSON.stringify(t, null, 2));
        return;
      }
      logger.log(`  ${chalk.bold(t.name)} (${t.id})`);
      logger.log(`  protocol:     ${t.protocol}`);
      logger.log(`  providerType: ${t.providerType}`);
      logger.log(`  hints:        ${JSON.stringify(t.hints)}`);
    });

  // ─── Configuration CRUD ─────────────────────────────────────

  sso
    .command("create")
    .description("Create an SSO configuration")
    .requiredOption("-n, --name <name>", "Configuration name")
    .requiredOption("-p, --protocol <protocol>", "saml | oauth2 | oidc")
    .option("-t, --provider-type <type>", "Provider type", "custom")
    .requiredOption("-c, --config <json>", "Protocol-specific config as JSON")
    .option("-m, --metadata <json>", "Metadata as JSON")
    .option("--disabled", "Create as disabled")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const config = createConfiguration(db, {
          name: opts.name,
          protocol: opts.protocol,
          providerType: opts.providerType,
          config: _parseJson(opts.config, "--config") || {},
          metadata: _parseJson(opts.metadata, "--metadata") || {},
          enabled: !opts.disabled,
        });
        logger.success(`Configuration created: ${chalk.cyan(config.id)}`);
        logger.log(`  name:         ${config.name}`);
        logger.log(`  protocol:     ${config.protocol}`);
        logger.log(`  providerType: ${config.providerType}`);
        logger.log(`  enabled:      ${config.enabled}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("configs")
    .description("List SSO configurations")
    .option("-p, --protocol <protocol>", "Filter by protocol")
    .option("-t, --provider-type <type>", "Filter by provider type")
    .option("--enabled", "Show only enabled")
    .option("--disabled", "Show only disabled")
    .option("-l, --limit <n>", "Limit", "50")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const filter = {
          protocol: opts.protocol,
          providerType: opts.providerType,
          limit: parseInt(opts.limit, 10),
        };
        if (opts.enabled) filter.enabled = true;
        else if (opts.disabled) filter.enabled = false;
        const rows = listConfigurations(db, filter);
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        logger.info(`${rows.length} configurations`);
        for (const r of rows) {
          const flag = r.enabled ? chalk.green("●") : chalk.dim("○");
          logger.log(
            `  ${flag} ${chalk.cyan(r.id.padEnd(22))} ${chalk.dim(r.protocol.padEnd(7))} ${r.name}`,
          );
        }
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("show <configId>")
    .description("Show an SSO configuration")
    .option("--json", "Output as JSON")
    .action(async (configId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const c = getConfiguration(db, configId);
        if (!c) {
          logger.error(`Configuration not found: ${configId}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(c, null, 2));
          return;
        }
        logger.log(`  ${chalk.bold(c.name)} (${c.id})`);
        logger.log(`  protocol:     ${c.protocol}`);
        logger.log(`  providerType: ${c.providerType}`);
        logger.log(`  enabled:      ${c.enabled}`);
        logger.log(`  testStatus:   ${c.testStatus}`);
        logger.log(`  config:       ${JSON.stringify(c.config)}`);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("update <configId>")
    .description("Update an SSO configuration")
    .option("-n, --name <name>", "New name")
    .option("-p, --protocol <protocol>", "New protocol")
    .option("-t, --provider-type <type>", "New provider type")
    .option("-c, --config <json>", "New config JSON")
    .option("-m, --metadata <json>", "New metadata JSON")
    .option("--enable", "Enable")
    .option("--disable", "Disable")
    .action(async (configId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const updates = {};
        if (opts.name) updates.name = opts.name;
        if (opts.protocol) updates.protocol = opts.protocol;
        if (opts.providerType) updates.providerType = opts.providerType;
        if (opts.config) updates.config = _parseJson(opts.config, "--config");
        if (opts.metadata)
          updates.metadata = _parseJson(opts.metadata, "--metadata");
        if (opts.enable) updates.enabled = true;
        if (opts.disable) updates.enabled = false;
        const next = updateConfiguration(db, configId, updates);
        logger.success(`Configuration updated: ${chalk.cyan(next.id)}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("delete <configId>")
    .description("Delete an SSO configuration")
    .action(async (configId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const result = deleteConfiguration(db, configId);
        if (result.deleted)
          logger.success(`Configuration deleted: ${configId}`);
        else logger.warn(`Configuration not found: ${configId}`);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("test <configId>")
    .description("Record a test result for a configuration")
    .option("--success", "Mark as success")
    .option("--failure", "Mark as failure")
    .option("-e, --error <text>", "Error detail for failure")
    .action(async (configId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        if (!opts.success && !opts.failure) {
          logger.error("Must specify --success or --failure");
          process.exit(1);
        }
        const next = recordTestResult(
          db,
          configId,
          !!opts.success,
          opts.error || null,
        );
        logger.success(`Test result recorded: ${next.testStatus}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ─── PKCE / URL / AuthnRequest builders ─────────────────────

  sso
    .command("generate-pkce")
    .description("Generate a PKCE verifier + S256 challenge")
    .option("--json", "Output as JSON")
    .action((options) => {
      const pkce = generatePKCE();
      if (options.json) {
        console.log(JSON.stringify(pkce, null, 2));
        return;
      }
      logger.log(`  codeVerifier:        ${pkce.codeVerifier}`);
      logger.log(`  codeChallenge:       ${pkce.codeChallenge}`);
      logger.log(`  codeChallengeMethod: ${pkce.codeChallengeMethod}`);
    });

  sso
    .command("login-url <configId>")
    .description("Build an OAuth2/OIDC authorization URL")
    .option("--state <state>", "State parameter")
    .option("--nonce <nonce>", "OIDC nonce")
    .option(
      "--prompt <prompt>",
      "OIDC prompt (login|consent|none|select_account)",
    )
    .option("--code-challenge <s>", "Precomputed PKCE challenge")
    .option("--code-verifier <s>", "Precomputed PKCE verifier (for record)")
    .option("--json", "Output as JSON")
    .action(async (configId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const c = getConfiguration(db, configId);
        if (!c) {
          logger.error(`Configuration not found: ${configId}`);
          process.exit(1);
        }
        if (c.protocol === SSO_PROTOCOLS.SAML) {
          logger.error("Use saml-authn-request for SAML configs");
          process.exit(1);
        }
        const pkce = opts.codeChallenge
          ? {
              codeVerifier: opts.codeVerifier || null,
              codeChallenge: opts.codeChallenge,
              codeChallengeMethod: "S256",
            }
          : generatePKCE();
        const url = buildAuthorizationUrl(c.config, pkce, {
          state: opts.state,
          nonce: opts.nonce,
          prompt: opts.prompt,
        });
        if (opts.json) {
          console.log(JSON.stringify({ url, pkce }, null, 2));
          return;
        }
        logger.log(`  url:                 ${url}`);
        logger.log(`  codeVerifier:        ${pkce.codeVerifier}`);
        logger.log(`  codeChallenge:       ${pkce.codeChallenge}`);
        logger.log(`  codeChallengeMethod: ${pkce.codeChallengeMethod}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("saml-authn-request <configId>")
    .description("Build a SAML 2.0 AuthnRequest XML")
    .option("--relay-state <s>", "RelayState value")
    .option("--json", "Output as JSON")
    .action(async (configId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const c = getConfiguration(db, configId);
        if (!c) {
          logger.error(`Configuration not found: ${configId}`);
          process.exit(1);
        }
        if (c.protocol !== SSO_PROTOCOLS.SAML) {
          logger.error(`Not a SAML configuration: ${configId}`);
          process.exit(1);
        }
        const req = buildSamlAuthnRequest(c.config, {
          relayState: opts.relayState,
        });
        if (opts.json) {
          console.log(JSON.stringify(req, null, 2));
          return;
        }
        logger.log(`  id:           ${req.id}`);
        logger.log(`  issueInstant: ${req.issueInstant}`);
        logger.log(`  relayState:   ${req.relayState}`);
        logger.log(`  xml:          ${req.xml}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  // ─── Sessions ───────────────────────────────────────────────

  sso
    .command("complete-login <configId>")
    .description("Complete a login — record session with tokens from IdP")
    .option("-d, --did <did>", "DID to associate with this session")
    .option("-a, --access-token <s>", "Access token")
    .option("-r, --refresh-token <s>", "Refresh token")
    .option("-i, --id-token <s>", "ID token")
    .option("-u, --user-info <json>", "User info claims as JSON")
    .option("-e, --expires-at <ms>", "Token expiration (epoch ms)")
    .option("-k, --master-key <key>", "Master key for AES-256-GCM encryption")
    .action(async (configId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const sess = createSession(db, {
          configId,
          did: opts.did || null,
          tokens: {
            accessToken: opts.accessToken || null,
            refreshToken: opts.refreshToken || null,
            idToken: opts.idToken || null,
          },
          userInfo: _parseJson(opts.userInfo, "--user-info") || {},
          tokenExpiresAt: opts.expiresAt ? parseInt(opts.expiresAt, 10) : null,
          masterKey: opts.masterKey || null,
        });
        logger.success(`Session created: ${chalk.cyan(sess.id)}`);
        logger.log(`  configId: ${sess.configId}`);
        logger.log(`  status:   ${sess.status}`);
        if (sess.did) logger.log(`  did:      ${sess.did}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("sessions")
    .description("List SSO sessions")
    .option("-c, --config-id <id>", "Filter by configId")
    .option(
      "-s, --status <status>",
      "Filter by status (active|expired|revoked)",
    )
    .option("-d, --did <did>", "Filter by DID")
    .option("-l, --limit <n>", "Limit", "50")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const rows = listSessions(db, {
          configId: opts.configId,
          status: opts.status,
          did: opts.did,
          limit: parseInt(opts.limit, 10),
        });
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        logger.info(`${rows.length} sessions`);
        for (const s of rows) {
          const statusColor =
            s.status === SESSION_STATUS.ACTIVE
              ? chalk.green
              : s.status === SESSION_STATUS.EXPIRED
                ? chalk.yellow
                : chalk.red;
          logger.log(
            `  ${chalk.cyan(s.id.padEnd(22))} ${statusColor(s.status.padEnd(8))} ${chalk.dim(s.configId)}${s.did ? " → " + s.did : ""}`,
          );
        }
      } finally {
        await shutdown();
      }
    });

  sso
    .command("session <sessionId>")
    .description("Show a session")
    .option("--json", "Output as JSON")
    .action(async (sessionId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const s = getSession(db, sessionId);
        if (!s) {
          logger.error(`Session not found: ${sessionId}`);
          process.exit(1);
        }
        if (opts.json) {
          console.log(JSON.stringify(s, null, 2));
          return;
        }
        logger.log(`  id:              ${s.id}`);
        logger.log(`  configId:        ${s.configId}`);
        logger.log(`  did:             ${s.did || "-"}`);
        logger.log(`  status:          ${s.status}`);
        logger.log(`  createdAt:       ${s.createdAt}`);
        logger.log(`  lastRefreshed:   ${s.lastRefreshed || "-"}`);
        logger.log(`  tokenExpiresAt:  ${s.tokenExpiresAt || "-"}`);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("refresh-session <sessionId>")
    .description("Refresh a session's tokens")
    .option("-a, --access-token <s>", "New access token")
    .option("-r, --refresh-token <s>", "New refresh token")
    .option("-i, --id-token <s>", "New id token")
    .option("-e, --expires-at <ms>", "New token expiration (epoch ms)")
    .option("-k, --master-key <key>", "Master key for encryption")
    .action(async (sessionId, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const tokens = {};
        if (opts.accessToken) tokens.accessToken = opts.accessToken;
        if (opts.refreshToken !== undefined)
          tokens.refreshToken = opts.refreshToken;
        if (opts.idToken !== undefined) tokens.idToken = opts.idToken;
        const next = refreshSessionTokens(db, sessionId, tokens, {
          masterKey: opts.masterKey || null,
          tokenExpiresAt: opts.expiresAt ? parseInt(opts.expiresAt, 10) : null,
        });
        logger.success(`Session refreshed: ${chalk.cyan(next.id)}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("destroy-session <sessionId>")
    .description("Revoke a session")
    .action(async (sessionId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const result = destroySession(db, sessionId);
        if (result.deleted) logger.success(`Session revoked: ${sessionId}`);
        else logger.warn(`Session not found: ${sessionId}`);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("expire-session <sessionId>")
    .description("Mark a session as expired")
    .action(async (sessionId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const next = expireSession(db, sessionId);
        if (next) logger.success(`Session expired: ${next.id}`);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("valid <sessionId>")
    .description("Check whether a session is valid")
    .action(async (sessionId, _opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const ok = isSessionValid(db, sessionId);
        logger.log(ok ? chalk.green("valid") : chalk.yellow("invalid"));
      } finally {
        await shutdown();
      }
    });

  // ─── Identity bridge ────────────────────────────────────────

  sso
    .command("link")
    .description("Link a DID to an SSO identity")
    .requiredOption("-d, --did <did>", "DID")
    .requiredOption("-p, --sso-provider <provider>", "SSO provider name")
    .requiredOption("-u, --sso-user-id <userId>", "SSO user ID")
    .option("-e, --sso-email <email>", "SSO email")
    .option("-n, --sso-display-name <name>", "SSO display name")
    .option("-a, --attributes <json>", "Extra attributes as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const mapping = linkIdentity(db, {
          did: opts.did,
          ssoProvider: opts.ssoProvider,
          ssoUserId: opts.ssoUserId,
          ssoEmail: opts.ssoEmail,
          ssoDisplayName: opts.ssoDisplayName,
          attributes: _parseJson(opts.attributes, "--attributes") || {},
        });
        logger.success(`Identity linked: ${chalk.cyan(mapping.id)}`);
        logger.log(`  did:         ${mapping.did}`);
        logger.log(`  ssoProvider: ${mapping.ssoProvider}`);
        logger.log(`  ssoUserId:   ${mapping.ssoUserId}`);
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("unlink")
    .description("Unlink a DID from an SSO provider")
    .requiredOption("-d, --did <did>", "DID")
    .requiredOption("-p, --sso-provider <provider>", "SSO provider")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const result = unlinkIdentity(db, opts.did, opts.ssoProvider);
        if (result.unlinked)
          logger.success(`Unlinked ${result.count} mapping(s)`);
        else logger.warn("No mapping found");
      } catch (e) {
        logger.error(e.message);
        process.exit(1);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("identities <did>")
    .description("List SSO identities bound to a DID")
    .option("--json", "Output as JSON")
    .action(async (did, opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const rows = getSSOIdentities(db, did);
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        logger.info(`${rows.length} identities`);
        for (const m of rows) {
          logger.log(
            `  ${chalk.cyan(m.ssoProvider.padEnd(12))} ${m.ssoUserId}${m.ssoEmail ? " (" + m.ssoEmail + ")" : ""}`,
          );
        }
      } finally {
        await shutdown();
      }
    });

  sso
    .command("did-for-sso")
    .description("Resolve a DID given an SSO identity")
    .requiredOption("-p, --sso-provider <provider>", "SSO provider")
    .requiredOption("-u, --sso-user-id <userId>", "SSO user ID")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const m = getDIDForSSO(db, opts.ssoProvider, opts.ssoUserId);
        if (!m) {
          logger.warn("No mapping found");
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(m, null, 2));
          return;
        }
        logger.log(`  did:         ${m.did}`);
        logger.log(`  ssoProvider: ${m.ssoProvider}`);
        logger.log(`  ssoUserId:   ${m.ssoUserId}`);
      } finally {
        await shutdown();
      }
    });

  sso
    .command("identity-mappings")
    .description("List all identity mappings")
    .option("-p, --sso-provider <provider>", "Filter by provider")
    .option("-d, --did <did>", "Filter by DID")
    .option("-l, --limit <n>", "Limit", "50")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const rows = listIdentityMappings(db, {
          ssoProvider: opts.ssoProvider,
          did: opts.did,
          limit: parseInt(opts.limit, 10),
        });
        if (opts.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        logger.info(`${rows.length} mappings`);
        for (const m of rows) {
          logger.log(
            `  ${chalk.cyan(m.ssoProvider.padEnd(12))} ${m.ssoUserId.padEnd(22)} → ${chalk.dim(m.did)}`,
          );
        }
      } finally {
        await shutdown();
      }
    });

  sso
    .command("conflict-check")
    .description("Check whether an SSO identity is already linked")
    .requiredOption("-p, --sso-provider <provider>", "SSO provider")
    .requiredOption("-u, --sso-user-id <userId>", "SSO user ID")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const r = checkIdentityConflict(db, opts.ssoProvider, opts.ssoUserId);
        if (r.conflict) {
          logger.warn(`Conflict: already linked to DID ${r.did}`);
        } else {
          logger.success("No conflict");
        }
      } finally {
        await shutdown();
      }
    });

  // ─── Stats ──────────────────────────────────────────────────

  sso
    .command("stats")
    .description("Show SSO statistics")
    .option("--json", "Output as JSON")
    .action(async (opts, cmd) => {
      const db = _dbFromCtx(cmd);
      try {
        const stats = getStats(db);
        if (opts.json) {
          console.log(JSON.stringify(stats, null, 2));
          return;
        }
        logger.log(chalk.bold("Configurations"));
        logger.log(`  total:    ${stats.configurations.total}`);
        logger.log(`  enabled:  ${stats.configurations.enabled}`);
        logger.log(`  disabled: ${stats.configurations.disabled}`);
        logger.log(
          `  by protocol:     ${JSON.stringify(stats.configurations.byProtocol)}`,
        );
        logger.log(
          `  by providerType: ${JSON.stringify(stats.configurations.byProviderType)}`,
        );
        logger.log(chalk.bold("Sessions"));
        logger.log(`  total:    ${stats.sessions.total}`);
        logger.log(`  active:   ${stats.sessions.active}`);
        logger.log(`  expired:  ${stats.sessions.expired}`);
        logger.log(`  revoked:  ${stats.sessions.revoked}`);
        logger.log(chalk.bold("Identities"));
        logger.log(`  totalMappings: ${stats.identities.totalMappings}`);
        logger.log(`  uniqueDIDs:    ${stats.identities.uniqueDIDs}`);
        logger.log(
          `  by provider:   ${JSON.stringify(stats.identities.byProvider)}`,
        );
      } finally {
        await shutdown();
      }
    });

  // ===== V2 Commands (cli 0.130.0) =====
  const _v2json = (o) => console.log(JSON.stringify(o, null, 2));
  sso
    .command("provider-maturities-v2")
    .description("List V2 provider maturity states")
    .action(() => Object.values(PMV2).forEach((s) => console.log(s)));
  sso
    .command("login-lifecycles-v2")
    .description("List V2 login lifecycle states")
    .action(() => Object.values(LLV2).forEach((s) => console.log(s)));
  sso
    .command("stats-v2")
    .description("V2 stats")
    .action(() => _v2json(getSsoManagerStatsV2()));
  sso
    .command("config-v2")
    .description("V2 config")
    .action(() => {
      console.log(
        `maxActiveProvidersPerOwner: ${getMaxActiveProvidersPerOwnerV2()}`,
      );
      console.log(
        `maxPendingLoginsPerProvider: ${getMaxPendingLoginsPerProviderV2()}`,
      );
      console.log(`providerIdleMs: ${getProviderIdleMsV2()}`);
      console.log(`loginStuckMs: ${getLoginStuckMsV2()}`);
    });
  sso
    .command("set-max-active-providers-v2 <n>")
    .description("Set V2 active provider cap")
    .action((n) => {
      setMaxActiveProvidersPerOwnerV2(Number(n));
      console.log("ok");
    });
  sso
    .command("set-max-pending-logins-v2 <n>")
    .description("Set V2 pending login cap")
    .action((n) => {
      setMaxPendingLoginsPerProviderV2(Number(n));
      console.log("ok");
    });
  sso
    .command("set-provider-idle-ms-v2 <n>")
    .description("Set V2 provider idle ms")
    .action((n) => {
      setProviderIdleMsV2(Number(n));
      console.log("ok");
    });
  sso
    .command("set-login-stuck-ms-v2 <n>")
    .description("Set V2 login stuck ms")
    .action((n) => {
      setLoginStuckMsV2(Number(n));
      console.log("ok");
    });
  sso
    .command("register-provider-v2 <id>")
    .description("V2 register provider")
    .requiredOption("-o, --owner <o>")
    .requiredOption("-p, --protocol <p>")
    .option("-d, --display-name <n>")
    .action((id, opts) =>
      _v2json(
        registerProviderV2({
          id,
          owner: opts.owner,
          protocol: opts.protocol,
          displayName: opts.displayName,
        }),
      ),
    );
  sso
    .command("activate-provider-v2 <id>")
    .description("V2 activate provider")
    .action((id) => _v2json(activateProviderV2(id)));
  sso
    .command("deprecate-provider-v2 <id>")
    .description("V2 deprecate provider")
    .action((id) => _v2json(deprecateProviderV2(id)));
  sso
    .command("retire-provider-v2 <id>")
    .description("V2 retire provider")
    .action((id) => _v2json(retireProviderV2(id)));
  sso
    .command("touch-provider-v2 <id>")
    .description("V2 touch provider")
    .action((id) => _v2json(touchProviderV2(id)));
  sso
    .command("get-provider-v2 <id>")
    .description("V2 get provider")
    .action((id) => _v2json(getProviderV2(id)));
  sso
    .command("list-providers-v2")
    .description("V2 list providers")
    .option("-o, --owner <o>")
    .option("-s, --status <s>")
    .option("-p, --protocol <p>")
    .action((opts) => _v2json(listProvidersV2(opts)));
  sso
    .command("create-login-v2 <id>")
    .description("V2 create login")
    .requiredOption("-p, --provider-id <p>")
    .option("-s, --subject <s>")
    .action((id, opts) =>
      _v2json(
        createLoginV2({
          id,
          providerId: opts.providerId,
          subject: opts.subject,
        }),
      ),
    );
  sso
    .command("start-login-v2 <id>")
    .description("V2 start login")
    .action((id) => _v2json(startLoginV2(id)));
  sso
    .command("complete-login-v2 <id>")
    .description("V2 complete login")
    .action((id) => _v2json(completeLoginV2(id)));
  sso
    .command("fail-login-v2 <id>")
    .description("V2 fail login")
    .option("-e, --error <e>")
    .action((id, opts) => _v2json(failLoginV2(id, opts.error)));
  sso
    .command("cancel-login-v2 <id>")
    .description("V2 cancel login")
    .action((id) => _v2json(cancelLoginV2(id)));
  sso
    .command("get-login-v2 <id>")
    .description("V2 get login")
    .action((id) => _v2json(getLoginV2(id)));
  sso
    .command("list-logins-v2")
    .description("V2 list logins")
    .option("-p, --provider-id <p>")
    .option("-s, --status <s>")
    .option("-S, --subject <s>")
    .action((opts) =>
      _v2json(
        listLoginsV2({
          providerId: opts.providerId,
          status: opts.status,
          subject: opts.subject,
        }),
      ),
    );
  sso
    .command("auto-deprecate-idle-providers-v2")
    .description("V2 auto-deprecate idle")
    .action(() => _v2json(autoDeprecateIdleProvidersV2()));
  sso
    .command("auto-fail-stuck-logins-v2")
    .description("V2 auto-fail stuck")
    .action(() => _v2json(autoFailStuckLoginsV2()));
}

// === Iter19 V2 governance overlay ===
export function registerSsogovV2Commands(program) {
  const parent = program.commands.find((c) => c.name() === "sso");
  if (!parent) return;
  const L = async () => await import("../lib/sso-manager.js");
  parent
    .command("ssogov-enums-v2")
    .description("Show V2 enums")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            profileMaturity: m.SSOGOV_PROFILE_MATURITY_V2,
            loginLifecycle: m.SSOGOV_LOGIN_LIFECYCLE_V2,
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ssogov-config-v2")
    .description("Show V2 config")
    .action(async () => {
      const m = await L();
      console.log(
        JSON.stringify(
          {
            maxActive: m.getMaxActiveSsogovProfilesPerOwnerV2(),
            maxPending: m.getMaxPendingSsogovLoginsPerProfileV2(),
            idleMs: m.getSsogovProfileIdleMsV2(),
            stuckMs: m.getSsogovLoginStuckMsV2(),
          },
          null,
          2,
        ),
      );
    });
  parent
    .command("ssogov-set-max-active-v2 <n>")
    .description("Set max active")
    .action(async (n) => {
      (await L()).setMaxActiveSsogovProfilesPerOwnerV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ssogov-set-max-pending-v2 <n>")
    .description("Set max pending")
    .action(async (n) => {
      (await L()).setMaxPendingSsogovLoginsPerProfileV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ssogov-set-idle-ms-v2 <n>")
    .description("Set idle threshold ms")
    .action(async (n) => {
      (await L()).setSsogovProfileIdleMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ssogov-set-stuck-ms-v2 <n>")
    .description("Set stuck threshold ms")
    .action(async (n) => {
      (await L()).setSsogovLoginStuckMsV2(Number(n));
      console.log("ok");
    });
  parent
    .command("ssogov-register-v2 <id> <owner>")
    .description("Register V2 profile")
    .option("--protocol <v>", "protocol")
    .action(async (id, owner, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.registerSsogovProfileV2({ id, owner, protocol: o.protocol }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ssogov-activate-v2 <id>")
    .description("Activate profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).activateSsogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ssogov-suspend-v2 <id>")
    .description("Suspend profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).suspendSsogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ssogov-archive-v2 <id>")
    .description("Archive profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).archiveSsogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ssogov-touch-v2 <id>")
    .description("Touch profile")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).touchSsogovProfileV2(id), null, 2),
      );
    });
  parent
    .command("ssogov-get-v2 <id>")
    .description("Get profile")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSsogovProfileV2(id), null, 2));
    });
  parent
    .command("ssogov-list-v2")
    .description("List profiles")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSsogovProfilesV2(), null, 2));
    });
  parent
    .command("ssogov-create-login-v2 <id> <profileId>")
    .description("Create login")
    .option("--subject <v>", "subject")
    .action(async (id, profileId, o) => {
      const m = await L();
      console.log(
        JSON.stringify(
          m.createSsogovLoginV2({ id, profileId, subject: o.subject }),
          null,
          2,
        ),
      );
    });
  parent
    .command("ssogov-authenticating-login-v2 <id>")
    .description("Mark login as authenticating")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).authenticatingSsogovLoginV2(id), null, 2),
      );
    });
  parent
    .command("ssogov-complete-login-v2 <id>")
    .description("Complete login")
    .action(async (id) => {
      console.log(
        JSON.stringify((await L()).completeLoginSsogovV2(id), null, 2),
      );
    });
  parent
    .command("ssogov-fail-login-v2 <id> [reason]")
    .description("Fail login")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).failSsogovLoginV2(id, reason), null, 2),
      );
    });
  parent
    .command("ssogov-cancel-login-v2 <id> [reason]")
    .description("Cancel login")
    .action(async (id, reason) => {
      console.log(
        JSON.stringify((await L()).cancelSsogovLoginV2(id, reason), null, 2),
      );
    });
  parent
    .command("ssogov-get-login-v2 <id>")
    .description("Get login")
    .action(async (id) => {
      console.log(JSON.stringify((await L()).getSsogovLoginV2(id), null, 2));
    });
  parent
    .command("ssogov-list-logins-v2")
    .description("List logins")
    .action(async () => {
      console.log(JSON.stringify((await L()).listSsogovLoginsV2(), null, 2));
    });
  parent
    .command("ssogov-auto-suspend-idle-v2")
    .description("Auto-suspend idle")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoSuspendIdleSsogovProfilesV2(), null, 2),
      );
    });
  parent
    .command("ssogov-auto-fail-stuck-v2")
    .description("Auto-fail stuck logins")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).autoFailStuckSsogovLoginsV2(), null, 2),
      );
    });
  parent
    .command("ssogov-gov-stats-v2")
    .description("V2 gov stats")
    .action(async () => {
      console.log(
        JSON.stringify((await L()).getSsoManagerGovStatsV2(), null, 2),
      );
    });
}
