const fs = require("node:fs");
const path = require("node:path");

class MCPSecurityAuditStore {
  constructor(filePath, deps = {}) {
    if (!path.isAbsolute(filePath || "")) {
      throw new TypeError("MCP security audit path must be absolute");
    }
    this.filePath = filePath;
    this.fs = deps.fs || fs;
  }

  append(entry) {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, {
      encoding: "utf8",
      flag: "a",
      mode: 0o600,
    });
    // POSIX mode bits are also honored by Node on supported Windows filesystems.
    // Any failure is intentional: an unverifiable security action must not run.
    this.fs.chmodSync(directory, 0o700);
    this.fs.chmodSync(this.filePath, 0o600);
  }

  query({ decision, serverName, since, limit = 100 } = {}) {
    let raw;
    try {
      raw = this.fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const boundedLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => !decision || entry.decision === decision)
      .filter((entry) => !serverName || entry.serverName === serverName)
      .filter((entry) => !since || entry.timestamp >= since)
      .slice(-boundedLimit);
  }
}

module.exports = { MCPSecurityAuditStore };
