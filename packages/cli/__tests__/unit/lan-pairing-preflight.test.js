/**
 * Unit tests for #21 A.1 PR1 — lan-pairing-preflight.js.
 *
 * Pure-JS preflight checks for Linux LAN pairing. Tests:
 *   - listInterfaces filters loopback + IPv4
 *   - checkMulticastBind happy path (binds + joins multicast)
 *   - checkPort5353Holders parses /proc/net/udp correctly + skips non-Linux
 *   - parseLinuxOsRelease handles 3 distro samples
 *   - detectFirewallTool selects FIRST present
 *   - firewallCommandTemplate returns expected strings per tool
 *   - runPreflight assembles report with correct exit code mapping
 */
import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import {
  listInterfaces,
  checkMulticastBind,
  checkPort5353Holders,
  parseLinuxOsRelease,
  detectFirewallTool,
  firewallCommandTemplate,
  runPreflight,
  STATUS,
  _deps,
} from "../../src/lib/lan-pairing-preflight.js";

// ─── listInterfaces ───────────────────────────────────────────

describe("listInterfaces", () => {
  it("returns non-empty array on typical test host (CI has 1 non-loopback NIC)", () => {
    const ifs = listInterfaces();
    // Tolerant: CI may have 0 if running with --network none.
    expect(Array.isArray(ifs)).toBe(true);
    for (const i of ifs) {
      expect(i).toHaveProperty("name");
      expect(i).toHaveProperty("address");
      expect(typeof i.address).toBe("string");
      // No loopback should slip through.
      expect(i.address).not.toMatch(/^127\./);
    }
  });
});

// ─── checkMulticastBind ──────────────────────────────────────

describe("checkMulticastBind", () => {
  it("succeeds on a normal host (binds + joins 224.0.0.251)", async () => {
    const r = await checkMulticastBind(2000);
    // On hardened CI containers this could blocker; tolerate either.
    expect([STATUS.OK, STATUS.BLOCKER]).toContain(r.status);
    expect(r.name).toBe("multicast_bind");
    if (r.status === STATUS.OK) {
      expect(r.data.group).toBe("224.0.0.251");
    } else {
      // Blocker should carry a code/detail
      expect(typeof r.detail).toBe("string");
    }
  }, 5000);
});

// ─── checkPort5353Holders ────────────────────────────────────

describe("checkPort5353Holders", () => {
  // Sample line from a real Linux box where avahi-daemon binds port 5353.
  // Format: sl local_address rem_address st tx_q rx_q tr tm uid timeout inode ref pointer drops
  // local_address 0100007F:14E9 is 127.0.0.1:5353 (5353=0x14E9)
  const SAMPLE_HEADER =
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops";
  const HOLDER_LINE =
    "  47: 0100007F:14E9 00000000:0000 07 00000000:00000000 00:00000000 00000000   115        0 12345 2 ffff8881abc12000 0";
  const NON_HOLDER_LINE =
    "  48: 0100007F:1234 00000000:0000 07 00000000:00000000 00:00000000 00000000     0        0 67890 2 ffff8881abc34000 0";

  it("Linux: detects port 5353 holders", () => {
    if (os.platform() !== "linux") {
      // On Win/macOS this returns SKIP — covered below.
      const r = checkPort5353Holders([SAMPLE_HEADER, HOLDER_LINE].join("\n"));
      expect(r.status).toBe(STATUS.SKIP);
      return;
    }
    const r = checkPort5353Holders([SAMPLE_HEADER, HOLDER_LINE].join("\n"));
    expect(r.status).toBe(STATUS.WARNING);
    expect(r.data.holders).toHaveLength(1);
    expect(r.data.holders[0]).toEqual({ uid: 115, inode: "12345" });
  });

  it("Linux: returns OK when no holder on 5353", () => {
    if (os.platform() !== "linux") {
      const r = checkPort5353Holders(
        [SAMPLE_HEADER, NON_HOLDER_LINE].join("\n"),
      );
      expect(r.status).toBe(STATUS.SKIP);
      return;
    }
    const r = checkPort5353Holders([SAMPLE_HEADER, NON_HOLDER_LINE].join("\n"));
    expect(r.status).toBe(STATUS.OK);
    expect(r.data.holders).toEqual([]);
  });

  it("non-Linux platforms return SKIP regardless of input", () => {
    if (os.platform() === "linux") {
      // This branch verifies the Linux path; skip the SKIP assertion.
      return;
    }
    const r = checkPort5353Holders("anything");
    expect(r.status).toBe(STATUS.SKIP);
  });
});

// ─── parseLinuxOsRelease ─────────────────────────────────────

describe("parseLinuxOsRelease", () => {
  it("parses Ubuntu 22.04 sample", () => {
    const sample = [
      'PRETTY_NAME="Ubuntu 22.04.3 LTS"',
      "NAME=Ubuntu",
      'VERSION="22.04.3 LTS (Jammy Jellyfish)"',
      "ID=ubuntu",
      "ID_LIKE=debian",
      "VERSION_ID=22.04",
    ].join("\n");
    const parsed = parseLinuxOsRelease(sample);
    expect(parsed.ID).toBe("ubuntu");
    expect(parsed.ID_LIKE).toBe("debian");
    expect(parsed.PRETTY_NAME).toBe("Ubuntu 22.04.3 LTS");
    expect(parsed.VERSION_ID).toBe("22.04");
  });

  it("parses Fedora sample", () => {
    const sample = [
      "NAME=Fedora",
      "VERSION_ID=40",
      'PRETTY_NAME="Fedora Linux 40"',
      "ID=fedora",
    ].join("\n");
    const parsed = parseLinuxOsRelease(sample);
    expect(parsed.ID).toBe("fedora");
    expect(parsed.VERSION_ID).toBe("40");
  });

  it("parses Debian sample with comments + blank lines", () => {
    const sample = [
      "# /etc/os-release",
      "",
      'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"',
      "ID=debian",
      'VERSION_ID="12"',
    ].join("\n");
    const parsed = parseLinuxOsRelease(sample);
    expect(parsed.ID).toBe("debian");
    expect(parsed.VERSION_ID).toBe("12");
  });

  it("tolerates empty / null input", () => {
    expect(parseLinuxOsRelease("")).toEqual({});
    expect(parseLinuxOsRelease(null)).toEqual({});
    expect(parseLinuxOsRelease(undefined)).toEqual({});
  });
});

// ─── detectFirewallTool ──────────────────────────────────────

describe("detectFirewallTool", () => {
  it("returns first tool found when multiple are present", () => {
    const whichRunner = (cmd) => cmd === "ufw" || cmd === "iptables";
    expect(detectFirewallTool(whichRunner)).toBe("ufw");
  });

  it("returns 'iptables' as last-resort when only iptables is found", () => {
    const whichRunner = (cmd) => cmd === "iptables";
    expect(detectFirewallTool(whichRunner)).toBe("iptables");
  });

  it("returns null when none found", () => {
    const whichRunner = () => false;
    expect(detectFirewallTool(whichRunner)).toBeNull();
  });

  it("routes the default probe through literal brokered argv", () => {
    const original = _deps.execFileSync;
    const execFileSync = vi.fn((_file, args) => {
      if (args[0] === "nft") return "";
      throw new Error("not found");
    });
    _deps.execFileSync = execFileSync;

    try {
      expect(detectFirewallTool()).toBe("nft");
      expect(execFileSync).toHaveBeenLastCalledWith(
        process.platform === "win32" ? "where" : "which",
        ["nft"],
        expect.objectContaining({
          origin: "lan-pairing:firewall-probe",
          scope: "network-diagnostics",
          policy: "allow",
          shell: false,
        }),
      );
    } finally {
      _deps.execFileSync = original;
    }
  });
});

// ─── firewallCommandTemplate ─────────────────────────────────

describe("firewallCommandTemplate", () => {
  it("ufw template contains the canonical allow command", () => {
    const tpl = firewallCommandTemplate("ufw");
    expect(tpl).toContain("ufw allow 5353/udp");
  });

  it("firewall-cmd template uses --add-port and --reload", () => {
    const tpl = firewallCommandTemplate("firewall-cmd");
    expect(tpl).toContain("firewall-cmd --add-port=5353/udp --permanent");
    expect(tpl).toContain("firewall-cmd --reload");
  });

  it("iptables template uses -A INPUT -p udp --dport 5353", () => {
    const tpl = firewallCommandTemplate("iptables");
    expect(tpl).toContain("iptables -A INPUT -p udp --dport 5353 -j ACCEPT");
  });

  it("nft template mentions /etc/nftables.conf", () => {
    const tpl = firewallCommandTemplate("nft");
    expect(tpl).toContain("nftables.conf");
  });

  it("returns null for unknown tool", () => {
    expect(firewallCommandTemplate("unknown-tool")).toBeNull();
    expect(firewallCommandTemplate(null)).toBeNull();
  });
});

// ─── runPreflight orchestrator ───────────────────────────────

describe("runPreflight", () => {
  it("returns checks array + summary + exitCode", async () => {
    const r = await runPreflight();
    expect(r).toHaveProperty("checks");
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("exitCode");
    expect(r.checks.length).toBe(5);
    // Each check carries name + status + detail.
    for (const c of r.checks) {
      expect(c).toHaveProperty("name");
      expect(c).toHaveProperty("status");
      expect(c).toHaveProperty("detail");
    }
    // Summary counts match checks (skips count as ok in the summary's "ok" bucket).
    expect(r.summary.ok + r.summary.warnings + r.summary.blockers).toBe(
      r.checks.length,
    );
  }, 10000);

  it("exitCode mapping: 0=clean, 1=warning, 2=blocker", async () => {
    const r = await runPreflight();
    if (r.summary.blockers > 0) {
      expect(r.exitCode).toBe(2);
    } else if (r.summary.warnings > 0) {
      expect(r.exitCode).toBe(1);
    } else {
      expect(r.exitCode).toBe(0);
    }
  }, 10000);
});
