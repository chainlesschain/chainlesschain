/**
 * #21 A.1 PR1 — Linux LAN pairing preflight diagnostics.
 *
 * Pure-JS read-only checks for "why doesn't mobile→desktop QR pairing work
 * on my Linux box". Five inspections:
 *
 *   1. interfaces   — non-loopback IPv4 NICs available
 *   2. multicastBind— can we bind UDP 5353 + join 224.0.0.251?
 *   3. port5353Holders — on Linux, who else is listening on 5353 (avahi etc.)
 *   4. platform     — OS / distro context (Linux: /etc/os-release)
 *   5. firewallHint — print actionable commands for the detected firewall tool
 *
 * Read-only — never modifies firewall config, never starts daemons. Outputs
 * suggested commands; user runs them.
 *
 * Spike doc: docs/design/A1_Linux_Native_Pairing_spike.md §3.2
 *
 * @module lib/lan-pairing-preflight
 * @version 0.1.0 (#21 A.1 PR1)
 */

import os from "node:os";
import fs from "node:fs";
import dgram from "node:dgram";
import executionBroker from "./process-execution-broker/index.js";

export const _deps = {
  execFileSync: (...args) => executionBroker.execFileSync(...args),
};

const MDNS_PORT = 5353;
const MDNS_GROUP = "224.0.0.251";

const STATUS = Object.freeze({
  OK: "ok",
  WARNING: "warning",
  BLOCKER: "blocker",
  SKIP: "skip",
});

// ─── 1. interfaces ──────────────────────────────────────────

/**
 * List non-loopback IPv4 interfaces. Returns an array of
 * `{ name, address, mac, internal:false, family: 'IPv4' }`.
 *
 * Exported for unit tests so caller can verify filter logic.
 */
export function listInterfaces() {
  const all = os.networkInterfaces();
  const out = [];
  for (const [name, addrs] of Object.entries(all)) {
    if (!Array.isArray(addrs)) continue;
    for (const a of addrs) {
      if (a.family !== "IPv4") continue;
      if (a.internal) continue;
      out.push({
        name,
        address: a.address,
        mac: a.mac,
        netmask: a.netmask,
        cidr: a.cidr,
      });
    }
  }
  return out;
}

function checkInterfaces() {
  const ifs = listInterfaces();
  if (ifs.length === 0) {
    return {
      name: "interfaces",
      status: STATUS.WARNING,
      detail: "no non-loopback IPv4 interface — check Wi-Fi / Ethernet",
      data: { interfaces: [] },
    };
  }
  return {
    name: "interfaces",
    status: STATUS.OK,
    detail: `${ifs.length} active IPv4 interface(s)`,
    data: {
      interfaces: ifs.map((i) => ({
        name: i.name,
        address: i.address,
        cidr: i.cidr,
      })),
    },
  };
}

// ─── 2. multicastBind ───────────────────────────────────────

/**
 * Try to bind UDP 5353 with multicast membership. Returns a promise so the
 * test harness can race a timeout. Failure case usually means firewall (ufw
 * default-deny) or kernel multicast disabled.
 *
 * Uses `reuseAddr: true` so we don't fight with system mDNS daemons that
 * may already be on the port — what we're actually testing is whether the
 * kernel accepts the membership join.
 */
export async function checkMulticastBind(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let socket;
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (socket) {
        try {
          socket.close();
        } catch (_e) {
          /* already closed */
        }
      }
    };
    try {
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch (err) {
      return resolve({
        name: "multicast_bind",
        status: STATUS.BLOCKER,
        detail: `dgram.createSocket failed: ${err.message}`,
        data: { errno: err.errno, code: err.code },
      });
    }
    socket.once("error", (err) => {
      cleanup();
      resolve({
        name: "multicast_bind",
        status: STATUS.BLOCKER,
        detail: `socket bind/join failed: ${err.code || err.message}`,
        data: {
          errno: err.errno,
          code: err.code,
          // Most common Linux culprits:
          //   EADDRINUSE — already bound w/o reuseAddr (unlikely with reuseAddr:true)
          //   EACCES — firewall (ufw/firewalld) blocking
          //   ENODEV — interface gone / multicast disabled on iface
        },
      });
    });
    timer = setTimeout(() => {
      cleanup();
      resolve({
        name: "multicast_bind",
        status: STATUS.BLOCKER,
        detail: `bind+addMembership timed out after ${timeoutMs}ms`,
        data: { timeoutMs },
      });
    }, timeoutMs);
    try {
      socket.bind(0, "0.0.0.0", () => {
        try {
          socket.addMembership(MDNS_GROUP);
          cleanup();
          resolve({
            name: "multicast_bind",
            status: STATUS.OK,
            detail: `bound + joined ${MDNS_GROUP} on ephemeral port`,
            data: { group: MDNS_GROUP },
          });
        } catch (err) {
          cleanup();
          resolve({
            name: "multicast_bind",
            status: STATUS.BLOCKER,
            detail: `addMembership(${MDNS_GROUP}) failed: ${err.code || err.message}`,
            data: { errno: err.errno, code: err.code },
          });
        }
      });
    } catch (err) {
      cleanup();
      resolve({
        name: "multicast_bind",
        status: STATUS.BLOCKER,
        detail: `socket.bind sync threw: ${err.message}`,
        data: { errno: err.errno, code: err.code },
      });
    }
  });
}

// ─── 3. port5353Holders (Linux only) ─────────────────────────

/**
 * Parse /proc/net/udp to find what's holding port 5353. Linux-only —
 * non-Linux platforms return SKIP. Output: list of `{ uid, inode }`
 * placeholders (mapping inode→process needs root, so we report inode
 * + hint to use `ss -lup` for resolution).
 */
export function checkPort5353Holders(parseProcText) {
  if (os.platform() !== "linux") {
    return {
      name: "port_5353_holders",
      status: STATUS.SKIP,
      detail: "/proc/net/udp parser is Linux-only",
      data: {},
    };
  }
  let raw;
  try {
    if (typeof parseProcText === "string") {
      // Injected for tests.
      raw = parseProcText;
    } else {
      raw = fs.readFileSync("/proc/net/udp", "utf-8");
    }
  } catch (err) {
    return {
      name: "port_5353_holders",
      status: STATUS.WARNING,
      detail: `read /proc/net/udp failed: ${err.message}`,
      data: {},
    };
  }
  // /proc/net/udp format:
  //   sl  local_address rem_address st tx_q rx_q tr tm uid timeout inode ref ...
  // local_address column 2 is "AABBCCDD:PPPP" hex (little-endian addr + port).
  const lines = raw.split("\n").slice(1);
  const holders = [];
  const portHex = MDNS_PORT.toString(16).toUpperCase().padStart(4, "0");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split(/\s+/);
    if (cols.length < 11) continue;
    const localAddr = cols[1]; // "AABBCCDD:PPPP"
    const parts = localAddr.split(":");
    if (parts.length !== 2) continue;
    if (parts[1] !== portHex) continue;
    const uid = parseInt(cols[7], 10);
    const inode = cols[9];
    holders.push({ uid, inode });
  }
  if (holders.length === 0) {
    return {
      name: "port_5353_holders",
      status: STATUS.OK,
      detail: "port 5353 unbound — bonjour-service can advertise freely",
      data: { holders: [] },
    };
  }
  // Holders ≠ blocker because `reuseAddr:true` lets multiple peers bind.
  // But it's a warning because if avahi-daemon owns the port with a TXT
  // record schema we don't match, there may be advertise conflicts.
  return {
    name: "port_5353_holders",
    status: STATUS.WARNING,
    detail: `${holders.length} other process holding port 5353 (likely avahi-daemon). bonjour-service should still work via SO_REUSEADDR; run \`ss -lup sport = :5353\` to identify`,
    data: { holders },
  };
}

// ─── 4. platform / linux release ─────────────────────────────

export function parseLinuxOsRelease(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function checkPlatform() {
  const platform = os.platform();
  const data = { platform, arch: os.arch(), release: os.release() };
  if (platform === "linux") {
    try {
      const text = fs.readFileSync("/etc/os-release", "utf-8");
      const parsed = parseLinuxOsRelease(text);
      data.distro = {
        id: parsed.ID || null,
        idLike: parsed.ID_LIKE || null,
        name: parsed.PRETTY_NAME || parsed.NAME || null,
        version: parsed.VERSION_ID || null,
      };
    } catch (_err) {
      data.distro = null;
    }
  }
  return {
    name: "platform",
    status: STATUS.OK,
    detail: data.distro?.name || `${platform} ${data.release}`,
    data,
  };
}

// ─── 5. firewall hint ────────────────────────────────────────

/**
 * Detect which Linux firewall tool is installed. Returns the FIRST tool
 * found — most distros have only one in PATH. Defensive: never errors
 * (returns null when none found).
 */
export function detectFirewallTool(whichRunner = which) {
  const candidates = ["ufw", "firewall-cmd", "nft", "iptables"];
  for (const tool of candidates) {
    if (whichRunner(tool)) return tool;
  }
  return null;
}

function which(cmd) {
  try {
    const platform = os.platform();
    const probe = platform === "win32" ? "where" : "which";
    _deps.execFileSync(probe, [cmd], {
      origin: "lan-pairing:firewall-probe",
      scope: "network-diagnostics",
      policy: "allow",
      shell: false,
      stdio: "pipe",
      windowsHide: true,
    });
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Build distro-appropriate command template for opening UDP 5353. Static
 * strings — caller copies and runs. Never executes.
 */
export function firewallCommandTemplate(tool) {
  switch (tool) {
    case "ufw":
      return [
        "# Open UDP 5353 (mDNS) on ufw:",
        "sudo ufw allow 5353/udp",
        "# Verify:",
        "sudo ufw status numbered",
      ].join("\n");
    case "firewall-cmd":
      return [
        "# Open UDP 5353 (mDNS) on firewalld:",
        "sudo firewall-cmd --add-port=5353/udp --permanent",
        "sudo firewall-cmd --reload",
        "# Verify:",
        "sudo firewall-cmd --list-ports",
      ].join("\n");
    case "nft":
      return [
        "# Open UDP 5353 (mDNS) on nftables:",
        "# Edit /etc/nftables.conf, add to inet filter input chain:",
        "#   udp dport 5353 accept",
        "sudo systemctl reload nftables",
      ].join("\n");
    case "iptables":
      return [
        "# Open UDP 5353 (mDNS) on iptables:",
        "sudo iptables -A INPUT -p udp --dport 5353 -j ACCEPT",
        "# Persist (varies by distro):",
        "#   Debian/Ubuntu: sudo iptables-save > /etc/iptables/rules.v4",
        "#   RHEL/CentOS:   sudo iptables-save > /etc/sysconfig/iptables",
      ].join("\n");
    default:
      return null;
  }
}

function checkFirewall() {
  if (os.platform() !== "linux") {
    return {
      name: "firewall_hint",
      status: STATUS.SKIP,
      detail: "firewall hint only generated for Linux",
      data: {},
    };
  }
  const tool = detectFirewallTool();
  if (!tool) {
    return {
      name: "firewall_hint",
      status: STATUS.WARNING,
      detail:
        "no firewall tool detected in PATH (ufw/firewall-cmd/nft/iptables) — check your distro's firewall guide",
      data: { tool: null },
    };
  }
  return {
    name: "firewall_hint",
    status: STATUS.OK,
    detail: `detected ${tool} — run \`cc pair preflight\` with --show-firewall to see commands`,
    data: { tool, commands: firewallCommandTemplate(tool) },
  };
}

// ─── orchestrator ────────────────────────────────────────────

/**
 * Run all 5 checks. Returns `{ checks, summary, exitCode }`.
 *
 *   exitCode 0 — all OK (or only SKIP)
 *   exitCode 1 — any WARNING
 *   exitCode 2 — any BLOCKER
 */
export async function runPreflight(options = {}) {
  const checks = [];
  checks.push(checkPlatform());
  checks.push(checkInterfaces());
  checks.push(await checkMulticastBind(options.multicastBindTimeoutMs));
  checks.push(checkPort5353Holders());
  checks.push(checkFirewall());

  let exitCode = 0;
  let warnings = 0;
  let blockers = 0;
  for (const c of checks) {
    if (c.status === STATUS.BLOCKER) blockers += 1;
    else if (c.status === STATUS.WARNING) warnings += 1;
  }
  if (blockers > 0) exitCode = 2;
  else if (warnings > 0) exitCode = 1;

  return {
    checks,
    summary: { blockers, warnings, ok: checks.length - blockers - warnings },
    exitCode,
  };
}

export { STATUS };
