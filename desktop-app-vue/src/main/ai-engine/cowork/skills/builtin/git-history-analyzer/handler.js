/**
 * Git History Analyzer Skill Handler
 *
 * Analyzes git history for development insights: hotspots,
 * contributor patterns, code churn, and file coupling.
 * Modes: --hotspots, --contributors, --churn, --coupling
 */

const { execSync } = require("child_process");
const { logger } = require("../../../../../utils/logger.js");

// ── Git helpers ─────────────────────────────────────────────────────

function git(cmd, cwd) {
  try {
    return execSync("git " + cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
  } catch (_e) {
    return "";
  }
}

// ── Hotspot analysis ────────────────────────────────────────────────

function analyzeHotspots(cwd, limit) {
  limit = limit || 200;
  const raw = git("log --pretty=format: --name-only -n " + limit, cwd);
  if (!raw) {
    return { hotspots: [], totalCommits: 0 };
  }

  const freq = {};
  const files = raw.split("\n").filter(Boolean);
  for (const file of files) {
    const trimmed = file.trim();
    if (
      !trimmed ||
      trimmed.includes("node_modules") ||
      trimmed.startsWith(".")
    ) {
      continue;
    }
    freq[trimmed] = (freq[trimmed] || 0) + 1;
  }

  const hotspots = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([file, changes]) => ({ file, changes }));

  const totalCommits = parseInt(git("rev-list --count HEAD", cwd)) || 0;

  return { hotspots, totalCommits };
}

// ── Contributor analysis ────────────────────────────────────────────

function analyzeContributors(cwd, limit) {
  limit = limit || 500;
  // Get shortlog
  const shortlog = git("shortlog -sn --all -n " + limit, cwd);
  const contributors = [];

  if (shortlog) {
    const lines = shortlog.split("\n").filter(Boolean);
    for (const line of lines) {
      const match = line.trim().match(/^\s*(\d+)\s+(.+)$/);
      if (match) {
        const commits = parseInt(match[1]);
        const name = match[2].trim();
        contributors.push({ name, commits });
      }
    }
  }

  // Get detailed stats for top contributors
  for (const contrib of contributors.slice(0, 10)) {
    const stats = git(
      'log --author="' +
        contrib.name +
        '" --pretty=tformat: --numstat -n ' +
        limit,
      cwd,
    );
    let added = 0,
      deleted = 0,
      filesChanged = new Set();
    if (stats) {
      for (const line of stats.split("\n").filter(Boolean)) {
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const a = parseInt(parts[0]) || 0;
          const d = parseInt(parts[1]) || 0;
          added += a;
          deleted += d;
          filesChanged.add(parts[2]);
        }
      }
    }
    contrib.linesAdded = added;
    contrib.linesDeleted = deleted;
    contrib.filesChanged = filesChanged.size;

    // Active hours
    const hours = git(
      'log --author="' + contrib.name + '" --pretty=format:%H -n 50',
      cwd,
    );
    if (hours) {
      const hourCounts = {};
      hours
        .split("\n")
        .filter(Boolean)
        .forEach((h) => {
          const hour = parseInt(h) || 0;
          hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });
      const sorted = Object.entries(hourCounts).sort((a, b) => b[1] - a[1]);
      contrib.peakHours = sorted
        .slice(0, 3)
        .map(([h]) => h + ":00")
        .join(", ");
    }
  }

  return { contributors };
}

// ── Churn analysis ──────────────────────────────────────────────────

function analyzeChurn(cwd, limit) {
  limit = limit || 200;
  const raw = git("log --pretty=tformat: --numstat -n " + limit, cwd);
  if (!raw) {
    return { files: [], totalAdded: 0, totalDeleted: 0 };
  }

  const fileStats = {};
  for (const line of raw.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    if (parts.length < 3) {
      continue;
    }
    const added = parseInt(parts[0]) || 0;
    const deleted = parseInt(parts[1]) || 0;
    const file = parts[2].trim();
    if (
      !file ||
      file.includes("node_modules") ||
      /\.(lock|svg|png|jpg)$/.test(file)
    ) {
      continue;
    }

    if (!fileStats[file]) {
      fileStats[file] = { added: 0, deleted: 0, changes: 0 };
    }
    fileStats[file].added += added;
    fileStats[file].deleted += deleted;
    fileStats[file].changes++;
  }

  // Calculate churn rate (deleted / added)
  const files = Object.entries(fileStats)
    .map(([file, stats]) => ({
      file,
      added: stats.added,
      deleted: stats.deleted,
      changes: stats.changes,
      churnRate:
        stats.added > 0 ? Math.round((stats.deleted / stats.added) * 100) : 0,
      netLines: stats.added - stats.deleted,
    }))
    .filter((f) => f.changes >= 2)
    .sort((a, b) => b.churnRate - a.churnRate);

  const totalAdded = Object.values(fileStats).reduce((s, f) => s + f.added, 0);
  const totalDeleted = Object.values(fileStats).reduce(
    (s, f) => s + f.deleted,
    0,
  );

  return {
    files: files.slice(0, 30),
    totalAdded,
    totalDeleted,
    overallChurn:
      totalAdded > 0 ? Math.round((totalDeleted / totalAdded) * 100) : 0,
  };
}

// ── Coupling analysis ───────────────────────────────────────────────

function analyzeCoupling(cwd, limit) {
  limit = limit || 200;
  const raw = git(
    "log --pretty=format:---COMMIT--- --name-only -n " + limit,
    cwd,
  );
  if (!raw) {
    return { couples: [] };
  }

  // Parse commits into file groups
  const commits = raw
    .split("---COMMIT---")
    .filter(Boolean)
    .map((block) =>
      block
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.includes("node_modules") && !l.startsWith(".")),
    )
    .filter((files) => files.length >= 2 && files.length <= 20);

  // Count co-occurrences
  const pairCounts = {};
  const fileCounts = {};
  for (const files of commits) {
    for (const f of files) {
      fileCounts[f] = (fileCounts[f] || 0) + 1;
    }
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const pair = [files[i], files[j]].sort().join(" <-> ");
        pairCounts[pair] = (pairCounts[pair] || 0) + 1;
      }
    }
  }

  // Calculate coupling strength
  const couples = Object.entries(pairCounts)
    .filter(([, count]) => count >= 3)
    .map(([pair, count]) => {
      const [fileA, fileB] = pair.split(" <-> ");
      const maxSingle = Math.max(
        fileCounts[fileA] || 1,
        fileCounts[fileB] || 1,
      );
      const strength = Math.round((count / maxSingle) * 100);
      return { fileA, fileB, coChanges: count, strength };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 20);

  return { couples, totalCommitsAnalyzed: commits.length };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[git-history-analyzer] init: " +
        (_skill?.name || "git-history-analyzer"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    const isHotspots = /--hotspots/i.test(input);
    const isContributors = /--contributors/i.test(input);
    const isChurn = /--churn/i.test(input);
    const isCoupling = /--coupling/i.test(input);
    const limitMatch = input.match(/--limit\s+(\d+)/i);
    const limit = limitMatch ? Math.min(parseInt(limitMatch[1]), 1000) : 200;

    try {
      const isGit = git("rev-parse --is-inside-work-tree", projectRoot);
      if (isGit !== "true") {
        return {
          success: false,
          error: "Not a git repository",
          message: "Not a git repository: " + projectRoot,
        };
      }

      if (isHotspots) {
        const { hotspots, totalCommits } = analyzeHotspots(projectRoot, limit);
        const recommendations = [];
        if (hotspots.length > 0 && hotspots[0].changes > 20) {
          recommendations.push(
            "'" +
              hotspots[0].file +
              "' has " +
              hotspots[0].changes +
              " changes — consider splitting into smaller modules",
          );
        }
        const topHotspots = hotspots.filter((h) => h.changes > 10);
        if (topHotspots.length > 5) {
          recommendations.push(
            topHotspots.length +
              " files have 10+ changes — review for code smell patterns",
          );
        }
        let msg = "Change Hotspots\n" + "=".repeat(30) + "\n";
        msg += "Total commits analyzed: " + totalCommits + "\n\n";
        msg += hotspots
          .slice(0, 20)
          .map(
            (h, i) =>
              "  " + (i + 1) + ". " + h.file + " (" + h.changes + " changes)",
          )
          .join("\n");
        if (recommendations.length > 0) {
          msg +=
            "\n\nRecommendations:\n" +
            recommendations.map((r) => "  - " + r).join("\n");
        }
        return {
          success: true,
          result: { analysis: { hotspots, totalCommits }, recommendations },
          message: msg,
        };
      }

      if (isContributors) {
        const { contributors } = analyzeContributors(projectRoot, limit);
        let msg = "Contributor Analysis\n" + "=".repeat(30) + "\n";
        msg += contributors.length + " contributors\n\n";
        msg += contributors
          .slice(0, 15)
          .map(
            (c) =>
              "  " +
              c.name +
              ": " +
              c.commits +
              " commits" +
              (c.linesAdded !== undefined
                ? ", +" + c.linesAdded + "/-" + c.linesDeleted + " lines"
                : "") +
              (c.filesChanged ? ", " + c.filesChanged + " files" : "") +
              (c.peakHours ? " (peak: " + c.peakHours + ")" : ""),
          )
          .join("\n");
        return {
          success: true,
          result: {
            analysis: { contributors },
            totalCommits: contributors.reduce((s, c) => s + c.commits, 0),
          },
          message: msg,
        };
      }

      if (isChurn) {
        const churn = analyzeChurn(projectRoot, limit);
        const recommendations = [];
        const highChurn = churn.files.filter((f) => f.churnRate > 80);
        if (highChurn.length > 0) {
          recommendations.push(
            highChurn.length +
              " files have >80% churn rate — these are unstable and may need redesign",
          );
        }
        if (churn.overallChurn > 60) {
          recommendations.push(
            "Overall churn is " +
              churn.overallChurn +
              "% — significant code rewrite activity",
          );
        }
        let msg = "Code Churn Analysis\n" + "=".repeat(30) + "\n";
        msg +=
          "Overall: +" +
          churn.totalAdded +
          " / -" +
          churn.totalDeleted +
          " lines (" +
          churn.overallChurn +
          "% churn)\n\n";
        msg += "High churn files:\n";
        msg += churn.files
          .slice(0, 20)
          .map(
            (f) =>
              "  " +
              f.file +
              " — +" +
              f.added +
              "/-" +
              f.deleted +
              " (" +
              f.churnRate +
              "% churn, " +
              f.changes +
              " changes)",
          )
          .join("\n");
        if (recommendations.length > 0) {
          msg +=
            "\n\nRecommendations:\n" +
            recommendations.map((r) => "  - " + r).join("\n");
        }
        return {
          success: true,
          result: { analysis: churn, recommendations },
          message: msg,
        };
      }

      if (isCoupling) {
        const coupling = analyzeCoupling(projectRoot, limit);
        const recommendations = [];
        const strongCouples = coupling.couples.filter((c) => c.strength > 70);
        if (strongCouples.length > 0) {
          recommendations.push(
            strongCouples.length +
              " file pairs have >70% coupling — consider extracting shared logic",
          );
        }
        let msg = "File Coupling Analysis\n" + "=".repeat(30) + "\n";
        msg += "Commits analyzed: " + coupling.totalCommitsAnalyzed + "\n\n";
        if (coupling.couples.length === 0) {
          msg += "No significant coupling detected.";
        } else {
          msg += "Coupled file pairs:\n";
          msg += coupling.couples
            .map(
              (c) =>
                "  " +
                c.fileA +
                " <-> " +
                c.fileB +
                " (" +
                c.strength +
                "% coupling, " +
                c.coChanges +
                " co-changes)",
            )
            .join("\n");
        }
        if (recommendations.length > 0) {
          msg +=
            "\n\nRecommendations:\n" +
            recommendations.map((r) => "  - " + r).join("\n");
        }
        return {
          success: true,
          result: { analysis: coupling, recommendations },
          message: msg,
        };
      }

      // No mode: show usage
      if (!input) {
        return {
          success: true,
          result: {},
          message:
            "Git History Analyzer\n" +
            "=".repeat(30) +
            "\nUsage:\n  /git-history-analyzer --hotspots [--limit N]\n  /git-history-analyzer --contributors [--limit N]\n  /git-history-analyzer --churn [--limit N]\n  /git-history-analyzer --coupling [--limit N]",
        };
      }

      // Default: hotspots
      const { hotspots, totalCommits } = analyzeHotspots(projectRoot, limit);
      let msg = "Change Hotspots (default)\n" + "=".repeat(30) + "\n";
      msg += hotspots
        .slice(0, 15)
        .map(
          (h, i) =>
            "  " + (i + 1) + ". " + h.file + " (" + h.changes + " changes)",
        )
        .join("\n");
      return {
        success: true,
        result: { analysis: { hotspots, totalCommits }, recommendations: [] },
        message: msg,
      };
    } catch (err) {
      logger.error("[git-history-analyzer] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Git history analysis failed: " + err.message,
      };
    }
  },
};
