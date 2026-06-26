/**
 * Credential READ guard — Claude-Code 2.1.189 parity ("`sandbox.credentials`
 * setting blocks sandboxed commands from reading credential files and secret
 * environment variables").
 *
 * cc has no OS sandbox (by design), but the same intent applies one layer up:
 * the agent must not silently slurp the user's secrets into model context,
 * where they could be echoed back, logged, summarized into a transcript, or
 * exfiltrated by a later tool call. This guard flags two read paths —
 *   1. the `read_file` tool pointed at a credential file (.env, ~/.aws/credentials,
 *      private keys, …), and
 *   2. `run_shell` commands that read a credential file (`cat .env`) or print a
 *      secret-looking environment variable (`echo $ANTHROPIC_API_KEY`, `printenv`).
 * — so `executeTool` can confirm first (interactive) or fail closed (headless),
 * exactly like the sensitive-file WRITE guard ([[sensitive-file-guard.js]]).
 *
 * An explicit settings `allow` rule pre-authorizes; `CC_CREDENTIAL_GUARD=0`
 * disables it. Deliberately, `--safe-mode` does NOT disable this guard: like
 * permission deny rules, it is a SAFETY surface, not a customization — "debug
 * my customizations bare" must never widen what secrets the agent may read.
 *
 * Precision over recall: matches are conservative so everyday reads
 * (.env.example, public keys, package.json) never trip a confirm — a guard that
 * cries wolf trains users to blind-approve.
 */

import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
// Reuse the shell policy's compound-command splitter (separators + $()/backtick
// extraction). It is regex-based on separators and leaves backslashes intact,
// so Windows paths survive (unlike the escaping tokenizer, which strips `\`).
const { splitCommandSegments } = require_(
  "../runtime/coding-agent-shell-policy.cjs",
);

// ── credential FILE patterns ────────────────────────────────────────────────

// Exact basenames that are, by convention, secret stores.
const CREDENTIAL_BASENAMES = new Set([
  ".npmrc",
  ".netrc",
  "_netrc",
  ".pgpass",
  ".git-credentials",
  ".pypirc",
  ".dockercfg",
  "credentials", // ~/.aws/credentials, gcloud, …
  ".credentials",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519", // private SSH keys (the `.pub` siblings have a different basename)
  "id_ecdsa_sk",
  "id_ed25519_sk", // FIDO/security-key SSH keys
  ".htpasswd", // web-server basic-auth hashes
  "kubeconfig", // bare KUBECONFIG file (the ~/.kube/config form is matched below)
  ".terraformrc", // Terraform registry/API tokens
  "terraform.rc",
]);

// Extensions whose BYTES are the secret (private keys / cert bundles / keyrings).
// Public material (.pub/.crt/.cert/.cer) is intentionally absent.
const SECRET_EXT_RE = /\.(pem|key|pfx|p12|keystore|jks|ppk|asc|gpg|pgp)$/i;

// `.env` and real env files — but NOT the committed template/example forms.
const ENV_SAFE_SUFFIX_RE = /\.(example|sample|template|dist|defaults|tpl)$/i;

// Directory-scoped credential files (the basename alone is too generic).
const CREDENTIAL_PATH_RE = [
  /[\\/]\.aws[\\/]credentials$/i,
  /[\\/]\.kube[\\/]config$/i,
  /[\\/]\.docker[\\/]config\.json$/i,
  /[\\/]\.config[\\/]gh[\\/]hosts\.yml$/i, // GitHub CLI OAuth token
  /[\\/]\.gnupg[\\/]/i, // GPG keyring directory
  /service[-_]account[^\\/]*\.json$/i, // GCP service-account key JSON
];

// secret(s).{json,yml,yaml,env,txt}
const SECRETS_FILE_RE = /(^|[\\/])secrets?\.(json|ya?ml|env|txt)$/i;

function isEnvSecret(base) {
  if (base.toLowerCase() === ".env") return true;
  if (/^\.env\./i.test(base)) return !ENV_SAFE_SUFFIX_RE.test(base);
  return false;
}

/**
 * Is this path a credential / secret file the agent should not read unprompted?
 * @param {string} targetPath  path as the tool received it (rel or abs)
 * @returns {string|null} human reason when sensitive, null otherwise
 */
export function credentialFileReason(targetPath) {
  const p = String(targetPath || "");
  if (!p) return null;
  const norm = p.replace(/\\/g, "/");
  const base = norm.split("/").pop() || "";
  if (!base) return null;
  if (isEnvSecret(base)) return `environment/secret file (${base})`;
  if (CREDENTIAL_BASENAMES.has(base.toLowerCase()))
    return `credential file (${base})`;
  if (SECRET_EXT_RE.test(base))
    return `private key / certificate material (${base})`;
  if (SECRETS_FILE_RE.test(norm)) return `secrets file (${base})`;
  for (const re of CREDENTIAL_PATH_RE) {
    if (re.test(norm)) return `credential file (${base})`;
  }
  return null;
}

// ── secret ENV-VAR + command detection ──────────────────────────────────────

// Content-reader commands: when one of these is aimed at a credential file, the
// file's bytes land in the agent's tool output.
const READ_COMMANDS = new Set([
  "cat",
  "tac",
  "type",
  "gc",
  "get-content",
  "less",
  "more",
  "head",
  "tail",
  "bat",
  "nl",
  "xxd",
  "od",
  "strings",
]);

// Commands whose job is to print a value into output — the exfil surface for a
// secret env var (a tool that merely CONSUMES `$API_KEY` does not echo it).
const PRINT_COMMANDS = new Set([
  "echo",
  "echo.",
  "print",
  "printf",
  "printenv",
  "write-host",
  "write-output",
  "write-information",
]);

// A var name looks secret when one of these words appears as an underscore- or
// boundary-delimited segment: ANTHROPIC_API_KEY, AWS_SECRET_ACCESS_KEY,
// GITHUB_TOKEN, DB_PASSWORD, MY_PASSPHRASE, OPENAI_APIKEY. `MONKEY`/`KEYBOARD`/
// `TOKENIZER` do NOT match (no boundary).
const SECRET_VAR_RE =
  /(?:^|_)(KEY|KEYS|TOKEN|SECRET|SECRETS|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|CREDENTIALS|PRIVATE|APIKEY|ACCESSKEY)(?:_|$)/i;

// Ways a secret var is referenced inside a shell segment.
const SECRET_REF_PATTERNS = [
  /\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, // PowerShell  $env:NAME
  /(?:^|[\s"'(=;|&])env:([A-Za-z_][A-Za-z0-9_]*)/gi, // PowerShell `env:` drive (Get-Content env:NAME)
  /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, // ${NAME}
  /\$([A-Za-z_][A-Za-z0-9_]*)/g, // $NAME
  /%([A-Za-z_][A-Za-z0-9_]*)%/g, // %NAME% (cmd.exe)
];

function referencedSecretVars(segment) {
  const out = [];
  for (const re of SECRET_REF_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(segment))) {
      if (SECRET_VAR_RE.test(m[1])) out.push(m[1]);
    }
  }
  return out;
}

function baseName(tok) {
  const b =
    String(tok || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "";
  return b.replace(/\.exe$/i, "");
}

function firstCommandToken(segment) {
  const m = segment
    .trim()
    .replace(/^["']/, "")
    .match(/^(\S+)/);
  return m ? baseName(m[1]).toLowerCase() : "";
}

/**
 * Does this (possibly compound) shell command read a credential file or print a
 * secret environment variable?
 * @param {string} command
 * @returns {{reason:string, kind:string, target?:string, segment:string}|null}
 */
export function commandReadsCredentials(command) {
  const cmd = String(command || "");
  if (!cmd.trim()) return null;
  let segments;
  try {
    segments = splitCommandSegments(cmd);
  } catch {
    segments = [cmd];
  }
  if (!segments.length) segments = [cmd];

  for (const segment of segments) {
    const seg = String(segment || "");
    if (!seg.trim()) continue;
    const first = firstCommandToken(seg);
    // Backslash-preserving split (the policy's escaping tokenizer would mangle
    // Windows paths); quotes flattened so grouping doesn't hide a token —
    // credentialFileReason keys off the basename, which survives the split.
    const rawTokens = seg.replace(/["']/g, " ").split(/\s+/).filter(Boolean);
    const args = rawTokens.slice(1);
    const nonFlagArgs = args.filter((t) => !t.startsWith("-"));

    // (a) full-environment dump — printenv/env with no var, or PowerShell
    //     `Get-ChildItem env:` family. Reveals EVERY secret at once.
    if (
      ((first === "printenv" || first === "env") && nonFlagArgs.length === 0) ||
      (["get-childitem", "gci", "dir", "ls"].includes(first) &&
        args.some((t) => /^env:?$/i.test(t)))
    ) {
      return {
        reason: "dumps all environment variables (may expose secrets)",
        kind: "env-dump",
        segment: seg,
      };
    }

    // (b) reading a credential file with a content-reader command.
    if (READ_COMMANDS.has(first)) {
      for (const tok of args) {
        const r = credentialFileReason(tok);
        if (r)
          return {
            reason: `reads ${r}`,
            kind: "file",
            target: tok,
            segment: seg,
          };
      }
    }

    // (c) printing / reading a secret-looking env var (via $VAR / %VAR% / env:).
    if (PRINT_COMMANDS.has(first) || READ_COMMANDS.has(first)) {
      const vars = referencedSecretVars(seg);
      if (vars.length)
        return {
          reason: `reads secret environment variable ${vars[0]}`,
          kind: "env-var",
          target: vars[0],
          segment: seg,
        };
    }

    // (d) `printenv ANTHROPIC_API_KEY` — bare var name (no $ sigil).
    if (first === "printenv") {
      const hit = nonFlagArgs.find((t) => SECRET_VAR_RE.test(t));
      if (hit)
        return {
          reason: `reads secret environment variable ${hit}`,
          kind: "env-var",
          target: hit,
          segment: seg,
        };
    }
  }
  return null;
}

/**
 * Whether the credential guard is disabled via `CC_CREDENTIAL_GUARD`
 * (0 / false / no / off). Default ON — only an explicit opt-out turns it off.
 * @param {object} [env=process.env]
 * @returns {boolean}
 */
export function credentialGuardDisabled(env = process.env) {
  const raw = env && env.CC_CREDENTIAL_GUARD;
  return raw != null && /^(0|false|no|off)$/i.test(String(raw).trim());
}

export const _internals = {
  CREDENTIAL_BASENAMES,
  READ_COMMANDS,
  PRINT_COMMANDS,
  SECRET_VAR_RE,
  referencedSecretVars,
  isEnvSecret,
};
