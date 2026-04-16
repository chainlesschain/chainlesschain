/**
 * STIX 2.1 Indicator Parser — extracts IoC (indicators of compromise)
 * from STIX 2.1 bundles or loose objects.
 *
 * Supports the most common observable types used in threat feeds:
 *   file-hash (md5/sha1/sha256/sha512), ipv4-addr, ipv6-addr,
 *   domain-name, url, email-addr.
 *
 * Reference: https://docs.oasis-open.org/cti/stix/v2.1/stix-v2.1.html
 *
 * The STIX pattern grammar is too rich for a full parser to live here;
 * this module handles the simple `[<object-path> = '<value>']` shape
 * (optionally joined by OR / AND / FOLLOWEDBY) that covers the vast
 * majority of real-world indicator feeds (AlienVault OTX, MISP export,
 * MITRE ATT&CK, etc.).
 */

export const IOC_TYPES = Object.freeze([
  "file-md5",
  "file-sha1",
  "file-sha256",
  "file-sha512",
  "ipv4",
  "ipv6",
  "domain",
  "url",
  "email",
]);

/**
 * Map a STIX object-path + hash-key to one of our IOC_TYPES.
 * Returns null for unsupported observable types.
 */
function _classify(objectPath, hashKey) {
  const p = objectPath.toLowerCase();
  switch (p) {
    case "file:hashes":
      switch ((hashKey || "").toUpperCase()) {
        case "MD5":
          return "file-md5";
        case "SHA-1":
        case "SHA1":
          return "file-sha1";
        case "SHA-256":
        case "SHA256":
          return "file-sha256";
        case "SHA-512":
        case "SHA512":
          return "file-sha512";
        default:
          return null;
      }
    case "ipv4-addr:value":
      return "ipv4";
    case "ipv6-addr:value":
      return "ipv6";
    case "domain-name:value":
      return "domain";
    case "url:value":
      return "url";
    case "email-addr:value":
      return "email";
    default:
      return null;
  }
}

const _termRegex =
  /([a-z0-9_-]+(?::[a-z0-9_-]+)?)(?:\.'([^']+)'|\.([a-z0-9_-]+))?\s*=\s*'((?:\\'|[^'])*)'/gi;

/**
 * Parse a STIX pattern string and yield raw matches of the simple
 * comparison form: `<object:path>[.<key>] = '<value>'`. Joiners
 * (OR/AND/FOLLOWEDBY) between terms are ignored — each matched term
 * becomes its own IoC.
 */
export function parseStixPattern(pattern) {
  if (typeof pattern !== "string") return [];
  const out = [];
  let m;
  _termRegex.lastIndex = 0;
  while ((m = _termRegex.exec(pattern)) !== null) {
    const [, rawObjectPath, quotedKey, bareKey, rawValue] = m;
    const hashKey = quotedKey || bareKey || null;
    const objectPath = hashKey
      ? `${rawObjectPath.toLowerCase()}`
      : rawObjectPath.toLowerCase();
    const iocType = _classify(objectPath, hashKey);
    if (!iocType) continue;
    const value = rawValue.replace(/\\'/g, "'");
    out.push({ type: iocType, value });
  }
  return out;
}

/**
 * Extract indicators from a parsed STIX 2.1 object. Returns an array
 * of `{type, value, source: {indicatorId, name, labels, confidence,
 * valid_from, valid_until}}` entries.
 */
export function extractIndicatorsFromObject(obj) {
  if (!obj || typeof obj !== "object") return [];
  if (obj.type !== "indicator") return [];
  const pattern = obj.pattern;
  if (!pattern) return [];
  if (obj.pattern_type && obj.pattern_type !== "stix") {
    // Only STIX-pattern indicators are supported; feeds may ship
    // snort/yara/pcre patterns which we ignore.
    return [];
  }
  const iocs = parseStixPattern(pattern);
  const source = {
    indicatorId: obj.id || null,
    name: obj.name || null,
    labels: Array.isArray(obj.indicator_types)
      ? obj.indicator_types.slice()
      : Array.isArray(obj.labels)
        ? obj.labels.slice()
        : [],
    confidence: typeof obj.confidence === "number" ? obj.confidence : null,
    validFrom: obj.valid_from || null,
    validUntil: obj.valid_until || null,
  };
  return iocs.map((ioc) => ({ ...ioc, source }));
}

/**
 * Extract indicators from a STIX 2.1 bundle (`{type:"bundle", objects:[…]}`)
 * or a loose array of STIX objects. Unknown inputs return [].
 */
export function extractIndicatorsFromBundle(bundle) {
  if (!bundle) return [];
  const objects = Array.isArray(bundle)
    ? bundle
    : bundle.type === "bundle" && Array.isArray(bundle.objects)
      ? bundle.objects
      : null;
  if (!objects) return [];
  const out = [];
  for (const obj of objects) {
    for (const ioc of extractIndicatorsFromObject(obj)) {
      out.push(ioc);
    }
  }
  return out;
}

/**
 * Best-effort classifier for an arbitrary observable string supplied
 * by the user (via `cc compliance threat-intel match <value>`).
 * Returns one of IOC_TYPES or "unknown".
 */
export function classifyObservable(value) {
  if (typeof value !== "string") return "unknown";
  const v = value.trim();
  if (!v) return "unknown";
  if (/^[a-f0-9]{32}$/i.test(v)) return "file-md5";
  if (/^[a-f0-9]{40}$/i.test(v)) return "file-sha1";
  if (/^[a-f0-9]{64}$/i.test(v)) return "file-sha256";
  if (/^[a-f0-9]{128}$/i.test(v)) return "file-sha512";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return "ipv4";
  if (/^[0-9a-f:]+$/i.test(v) && v.includes(":")) return "ipv6";
  if (/^https?:\/\//i.test(v)) return "url";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
  if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(v)) return "domain";
  return "unknown";
}
