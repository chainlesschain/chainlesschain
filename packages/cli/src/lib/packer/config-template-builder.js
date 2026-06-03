/**
 * Phase 3: config-template-builder
 *
 * Build the .chainlesschain/ template that the artifact will release into the
 * user's data dir on first run. Optionally merges a --preset-config provided
 * by the packager, after a strict secret scan.
 *
 * Secrets policy: any non-empty string at a path matching SECRET_PATTERNS
 * causes a hard error unless --allow-secrets is passed. Reason: if the
 * packager accidentally bundles their own API key, every downstream user
 * gets it.
 */

import fs from "node:fs";
import path from "node:path";
import { PackError, EXIT } from "./errors.js";

/**
 * Field paths (regex on the joined dotted path) that, if set to a non-empty
 * string, are considered sensitive credentials.
 */
export const SECRET_PATTERNS = Object.freeze([
  /(^|\.)apiKey$/i,
  /(^|\.)api_key$/i,
  /(^|\.)secret$/i,
  /(^|\.)privateKey$/i,
  /(^|\.)private_key$/i,
  /(^|\.)mnemonic$/i,
  /(^|\.)password$/i,
  /(^|\.)token$/i,
  /(^|\.)access_token$/i,
  /(^|\.)refresh_token$/i,
]);

/**
 * Walk an object, return [{ path, value }] for every leaf that matches a
 * secret pattern with a non-empty string value. Numbers / booleans / nulls
 * are ignored.
 */
export function findSecrets(obj, prefix = "") {
  const hits = [];
  if (obj === null || typeof obj !== "object") return hits;
  for (const [key, val] of Object.entries(obj)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      hits.push(...findSecrets(val, dotted));
    } else if (typeof val === "string" && val.length > 0) {
      if (SECRET_PATTERNS.some((re) => re.test(dotted))) {
        hits.push({ path: dotted, value: val });
      }
    }
  }
  return hits;
}

/**
 * @param {object} ctx
 * @param {string|null} ctx.presetConfigPath
 * @param {boolean} ctx.allowSecrets
 * @param {object} [ctx.logger]
 * @returns {{ template: object, secrets: Array<{path:string}> }}
 */
export function buildConfigTemplate(ctx) {
  const { presetConfigPath, allowSecrets, logger } = ctx;
  const log = logger?.log || (() => {});

  const baseTemplate = {
    schema: 1,
    server: {
      bindHost: ctx.bindHost || "127.0.0.1",
      wsPort: ctx.wsPort || 18800,
      uiPort: ctx.uiPort || 18810,
      enableTls: Boolean(ctx.enableTls),
    },
    llm: { providers: {} },
    mcp: { servers: {} },
    note: {},
  };

  let preset = null;
  if (presetConfigPath) {
    if (!fs.existsSync(presetConfigPath)) {
      throw new PackError(
        `--preset-config file not found: ${presetConfigPath}`,
        EXIT.PRECHECK,
      );
    }
    try {
      preset = JSON.parse(fs.readFileSync(presetConfigPath, "utf-8"));
    } catch (e) {
      throw new PackError(
        `--preset-config is not valid JSON: ${e.message}`,
        EXIT.PRECHECK,
      );
    }
  }

  if (preset) {
    const secrets = findSecrets(preset);
    if (secrets.length > 0 && !allowSecrets) {
      const list = secrets.map((s) => `    - ${s.path}`).join("\n");
      throw new PackError(
        `Preset config contains ${secrets.length} sensitive field(s):\n${list}\n` +
          "  Refusing to bundle credentials into a distributable artifact.\n" +
          "  Pass --allow-secrets to override (DANGEROUS), or remove the values from the preset.",
        EXIT.SECRETS,
      );
    }
    if (secrets.length > 0 && allowSecrets) {
      log(
        `  [config-template] WARNING: bundling ${secrets.length} secret value(s) — artifact must NOT be redistributed.`,
      );
    }
    deepMerge(baseTemplate, preset);
    return { template: baseTemplate, secrets };
  }

  return { template: baseTemplate, secrets: [] };
}

/**
 * In-place deep merge: source overrides target on conflict; arrays replaced wholesale.
 */
function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      target[k] &&
      typeof target[k] === "object" &&
      !Array.isArray(target[k])
    ) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/**
 * Write the resolved template to disk inside the build temp dir.
 * Returns the absolute path so pkg-config-generator can include it as an asset.
 */
export function writeTemplate(template, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "config.example.json");
  fs.writeFileSync(file, JSON.stringify(template, null, 2), "utf-8");
  return file;
}
