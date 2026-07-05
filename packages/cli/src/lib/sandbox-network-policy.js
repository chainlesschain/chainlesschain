/**
 * Sandbox network domain policy (Phase 1) — decide whether a Shell subprocess is
 * allowed to reach a given URL/host under `sandbox.network.allowedDomains` /
 * `deniedDomains`. OS-level ENFORCEMENT is platform-specific (a proxy / seatbelt
 * / bwrap egress filter), but the POLICY decision is pure, shared, and must get
 * the tricky cases right — so it lives here, fully unit-tested:
 *
 *   - wildcard subdomains (`*.example.com` matches `api.example.com` AND the
 *     apex `example.com`), exact hosts, and `*` (all);
 *   - deny takes precedence over allow;
 *   - default-DENY when an allowlist is set and the host isn't on it
 *     (Phase 1 acceptance "未授权域名无法通过 curl/npm/pip 访问");
 *   - private / loopback / link-local / metadata targets are blocked unless
 *     explicitly allowed — an SSRF / DNS-rebinding guard, and it fixes the
 *     `new URL()` IPv6-bracket gotcha where `[::1]` leaks brackets into the
 *     hostname and defeats a naive string check.
 */

/** Extract a normalized lowercase host from a URL or bare host:port. */
export function extractHost(target) {
  if (target == null) return null;
  let s = String(target).trim();
  if (!s) return null;
  // Try URL parse first (covers scheme://host:port/path, userinfo, etc.).
  try {
    // Add a scheme if it looks scheme-less so URL() can parse host:port.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
    const u = new URL(withScheme);
    s = u.hostname; // may be "[::1]" for IPv6 — normalize below
  } catch {
    // Not a URL — treat as a bare host, strip any :port.
    s = s.replace(/:\d+$/, "");
  }
  // Strip IPv6 brackets ("[::1]" → "::1") — the documented SSRF gotcha.
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  // Strip the trailing DNS root dot. "localhost." / "example.com." resolve to
  // the exact same host as the dot-less form, but the extra dot defeats BOTH
  // the deny/allow matcher (host !== "example.com") AND the loopback/private
  // guard ("localhost." !== "localhost") — a one-character SSRF / deny-list
  // bypass. (Node's URL already normalizes a trailing dot away for IPv4 literals
  // but NOT for named hosts, so we must do it here.)
  s = s.replace(/\.+$/, "");
  return s.toLowerCase() || null;
}

/** Does `host` match a domain `pattern` (`*`, `*.example.com`, or exact)? */
export function matchesDomain(host, pattern) {
  if (!host || !pattern) return false;
  const p = String(pattern).trim().toLowerCase();
  if (p === "*") return true;
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    // `*.example.com` matches subdomains AND the apex `example.com`.
    return host === base || host.endsWith(`.${base}`);
  }
  return host === p;
}

function anyMatch(host, patterns) {
  return (patterns || []).some((p) => matchesDomain(host, p));
}

/** Private / loopback / link-local / cloud-metadata target? (SSRF guard) */
export function isPrivateHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // Cloud metadata endpoint.
  if (h === "169.254.169.254" || h === "metadata.google.internal") return true;
  // IPv6 loopback / unique-local / link-local.
  if (h === "::1" || h === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true; // fc00::/7 unique-local
  if (/^fe80:/i.test(h)) return true; // link-local
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — check the tail.
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const ipv4 = mapped ? mapped[1] : h;
  const m = ipv4.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8
  }
  return false;
}

/**
 * Evaluate network access for a target under a policy.
 *
 * @param {string} target  URL or host (optionally with :port)
 * @param {object} policy  { allowedDomains?:string[], deniedDomains?:string[],
 *                           allowPrivate?:boolean }
 * @returns {{ allowed:boolean, host:string|null, reason:string }}
 */
export function evaluateNetworkAccess(target, policy = {}) {
  const allowed = policy.allowedDomains || [];
  const denied = policy.deniedDomains || [];
  const host = extractHost(target);
  if (!host) {
    return { allowed: false, host: null, reason: "unparseable target" };
  }
  // 1) Deny wins over everything.
  if (anyMatch(host, denied)) {
    return { allowed: false, host, reason: "denied by deniedDomains" };
  }
  // 2) A SPECIFIC (non-`*`) allow-list match overrides the private-host guard,
  //    so an intentionally-allowed localhost/dev host still works. A bare `*`
  //    does NOT — it means "all public domains", never internal/metadata.
  const explicitNonStar = anyMatch(
    host,
    allowed.filter((p) => String(p).trim() !== "*"),
  );
  if (explicitNonStar) {
    // `specific: true` marks a host the user vetted by exact/subdomain name (not
    // a bare `*`). The egress proxy trusts these even when they resolve to a
    // private IP (intentional internal/dev allowlisting) and so SKIPS the
    // DNS-rebinding re-check for them — whereas `*`/permissive allows still get
    // their resolved IP checked.
    return {
      allowed: true,
      host,
      reason: "matched allowedDomains",
      specific: true,
    };
  }
  // 3) Private / loopback / metadata targets are blocked unless allowed above.
  if (isPrivateHost(host) && !policy.allowPrivate) {
    return {
      allowed: false,
      host,
      reason: "private/loopback target blocked (SSRF guard)",
    };
  }
  // 4) A `*` (or any remaining) allow-list match → allow.
  if (anyMatch(host, allowed)) {
    return { allowed: true, host, reason: "matched allowedDomains" };
  }
  // 5) With an allow-list present, anything not on it is denied (default-deny).
  if (allowed.length > 0) {
    return {
      allowed: false,
      host,
      reason: "not in allowedDomains (default-deny)",
    };
  }
  // 6) No allow-list → permissive (deny-list + private guard still applied).
  return { allowed: true, host, reason: "no allowlist (permissive)" };
}
