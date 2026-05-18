/**
 * .ccprofile Packager — Enterprise Profile Bundle
 *
 * 将一组插件 + 品牌 + 策略打包成单一 `.ccprofile` JSON 文件，并附带
 * ed25519 签名。签名覆盖：manifest 字段 + 每个插件的 sha256 哈希。
 *
 * 文件格式（JSON，utf-8）：
 * {
 *   "manifest": {
 *     "id": "acme-enterprise",
 *     "name": "Acme 企业版",
 *     "version": "1.0.0",
 *     "signer": "did:cc:acme:root",
 *     "createdAt": 1700000000000,
 *     "plugins": [ { "id": "...", "version": "...", "sha256": "..." } ],
 *     "brand": { "theme": {...}, "identity": {...} },
 *     "policies": { "autoUpdate": true, ... }
 *   },
 *   "signature": {
 *     "alg": "ed25519",
 *     "value": "<base64>",
 *     "publicKey": "<base64>"
 *   },
 *   "payload": {
 *     "plugins": { "<id>": { "manifest": {...}, "files": { "<relpath>": "<base64>" } } }
 *   }
 * }
 *
 * 注：当前版本使用 JSON + base64 而非 tar/zip，简单可审计；
 * 后续可演进到二进制容器格式。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROFILE_FORMAT_VERSION = 1;

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function toBase64(buf) {
  return Buffer.isBuffer(buf)
    ? buf.toString("base64")
    : Buffer.from(buf).toString("base64");
}

function fromBase64(str) {
  return Buffer.from(str, "base64");
}

/**
 * 递归读取目录中所有文件，返回 { relPath -> Buffer }
 */
function readPluginFiles(pluginDir) {
  const files = {};
  function walk(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        files[rel] = fs.readFileSync(full);
      }
    }
  }
  walk(pluginDir, "");
  return files;
}

/**
 * 计算一个插件目录的确定性哈希：按 relPath 字典序拼接 "<rel>:<sha256(content)>\n"
 */
function computePluginHash(files) {
  const keys = Object.keys(files).sort();
  const hasher = crypto.createHash("sha256");
  for (const k of keys) {
    hasher.update(`${k}:${sha256Hex(files[k])}\n`);
  }
  return hasher.digest("hex");
}

/**
 * 生成新的 ed25519 密钥对（PEM 格式）
 */
function generateSignerKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "pem" }),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

/**
 * 对 manifest 进行规范化序列化（字段按键名排序），保证签名可复现
 */
function canonicalize(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/**
 * 打包企业 Profile
 *
 * @param {object} profileDef
 * @param {string} profileDef.id
 * @param {string} profileDef.name
 * @param {string} profileDef.version
 * @param {string} profileDef.signer  签名者 DID / 标识
 * @param {string} profileDef.privateKeyPem  ed25519 私钥（PEM）
 * @param {string} profileDef.publicKeyPem   ed25519 公钥（PEM）
 * @param {Array<{id:string, version:string, dir:string}>} profileDef.plugins
 * @param {object} [profileDef.brand]    { theme, identity }
 * @param {object} [profileDef.policies] 可选策略
 * @param {string} outPath  输出 .ccprofile 文件路径
 * @returns {Promise<{ id:string, sha256:string, size:number }>}
 */
async function pack(profileDef, outPath) {
  if (!profileDef || !profileDef.id) {
    throw new Error("profileDef.id is required");
  }
  if (!profileDef.privateKeyPem) {
    throw new Error("profileDef.privateKeyPem is required");
  }
  if (!profileDef.publicKeyPem) {
    throw new Error("profileDef.publicKeyPem is required");
  }

  const pluginEntries = Array.isArray(profileDef.plugins)
    ? profileDef.plugins
    : [];
  const pluginsManifest = [];
  const pluginsPayload = {};

  for (const p of pluginEntries) {
    if (!p.id || !p.dir) {
      throw new Error("plugin entry requires id + dir");
    }
    if (!fs.existsSync(p.dir)) {
      throw new Error(`plugin dir not found: ${p.dir}`);
    }
    const files = readPluginFiles(p.dir);
    const manifestPath = path.join(p.dir, "plugin.json");
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`plugin.json missing in ${p.dir}`);
    }
    const pluginManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const hash = computePluginHash(files);

    pluginsManifest.push({
      id: p.id,
      version: p.version || pluginManifest.version || "0.0.0",
      sha256: hash,
    });

    const encoded = {};
    for (const [rel, buf] of Object.entries(files)) {
      encoded[rel] = toBase64(buf);
    }
    pluginsPayload[p.id] = {
      manifest: pluginManifest,
      files: encoded,
    };
  }

  const manifest = {
    formatVersion: PROFILE_FORMAT_VERSION,
    id: profileDef.id,
    name: profileDef.name || profileDef.id,
    version: profileDef.version || "1.0.0",
    signer: profileDef.signer || "unknown",
    createdAt: Date.now(),
    plugins: pluginsManifest,
    brand: profileDef.brand || null,
    policies: profileDef.policies || {},
  };

  const canonical = canonicalize(manifest);
  const signer = crypto.createPrivateKey(profileDef.privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(canonical, "utf-8"), signer);

  const publicKeyDer = crypto
    .createPublicKey(profileDef.publicKeyPem)
    .export({ type: "spki", format: "der" });

  const profile = {
    manifest,
    signature: {
      alg: "ed25519",
      value: toBase64(signature),
      publicKey: toBase64(publicKeyDer),
    },
    payload: {
      plugins: pluginsPayload,
    },
  };

  const body = JSON.stringify(profile, null, 2);
  fs.writeFileSync(outPath, body, "utf-8");

  return {
    id: manifest.id,
    sha256: sha256Hex(Buffer.from(body, "utf-8")),
    size: Buffer.byteLength(body, "utf-8"),
  };
}

/**
 * 加载并验证 .ccprofile
 *
 * @param {string} profilePath
 * @param {object} [options]
 * @param {string[]} [options.trustedPublicKeys]  白名单公钥（base64 DER 或 PEM）。为空则不做白名单校验。
 * @returns {Promise<{ manifest: object, plugins: Record<string, {manifest:object, files:Record<string,Buffer>}>, trusted: boolean }>}
 */
async function loadProfile(profilePath, options = {}) {
  if (!fs.existsSync(profilePath)) {
    throw new Error(`profile not found: ${profilePath}`);
  }
  const body = fs.readFileSync(profilePath, "utf-8");
  const profile = JSON.parse(body);

  if (!profile || !profile.manifest || !profile.signature || !profile.payload) {
    throw new Error("invalid .ccprofile: missing required sections");
  }

  const { manifest, signature, payload } = profile;

  if (signature.alg !== "ed25519") {
    throw new Error(`unsupported signature algorithm: ${signature.alg}`);
  }

  const publicKey = crypto.createPublicKey({
    key: fromBase64(signature.publicKey),
    format: "der",
    type: "spki",
  });
  const canonical = canonicalize(manifest);
  const ok = crypto.verify(
    null,
    Buffer.from(canonical, "utf-8"),
    publicKey,
    fromBase64(signature.value),
  );
  if (!ok) {
    throw new Error("profile signature verification failed");
  }

  const plugins = {};
  for (const entry of manifest.plugins || []) {
    const raw = payload.plugins?.[entry.id];
    if (!raw) {
      throw new Error(`plugin payload missing for ${entry.id}`);
    }
    const files = {};
    for (const [rel, b64] of Object.entries(raw.files || {})) {
      files[rel] = fromBase64(b64);
    }
    const hash = computePluginHash(files);
    if (hash !== entry.sha256) {
      throw new Error(
        `plugin ${entry.id} hash mismatch: expected ${entry.sha256}, got ${hash}`,
      );
    }
    plugins[entry.id] = { manifest: raw.manifest, files };
  }

  let trusted = true;
  if (
    Array.isArray(options.trustedPublicKeys) &&
    options.trustedPublicKeys.length > 0
  ) {
    const actualSpki = publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64");
    trusted = options.trustedPublicKeys.some((pk) => {
      if (!pk) {
        return false;
      }
      if (pk.includes("BEGIN PUBLIC KEY")) {
        try {
          const der = crypto
            .createPublicKey(pk)
            .export({ type: "spki", format: "der" })
            .toString("base64");
          return der === actualSpki;
        } catch (_err) {
          return false;
        }
      }
      return pk === actualSpki;
    });
    if (!trusted) {
      throw new Error("profile signer is not in the trusted publicKeys list");
    }
  }

  return { manifest, plugins, trusted };
}

/**
 * 将 loadProfile 返回的 plugins 解包到目标目录（每个插件一个子目录）
 *
 * @param {Record<string, {manifest:object, files:Record<string,Buffer>}>} plugins
 * @param {string} targetDir
 */
function extractPluginsTo(plugins, targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const written = [];
  for (const [pluginId, { files }] of Object.entries(plugins)) {
    const pluginDir = path.join(targetDir, pluginId);
    if (!fs.existsSync(pluginDir)) {
      fs.mkdirSync(pluginDir, { recursive: true });
    }
    for (const [rel, buf] of Object.entries(files)) {
      const full = path.join(pluginDir, rel);
      const parent = path.dirname(full);
      if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
      }
      fs.writeFileSync(full, buf);
    }
    written.push(pluginDir);
  }
  return written;
}

module.exports = {
  PROFILE_FORMAT_VERSION,
  pack,
  loadProfile,
  extractPluginsTo,
  generateSignerKeyPair,
  computePluginHash,
  canonicalize,
};
