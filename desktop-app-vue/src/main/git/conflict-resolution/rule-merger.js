/**
 * Rule-based Merger (Level 1)
 * Fast, deterministic merge for simple conflict patterns (<100ms)
 * Non-overlapping 3-way merge, append-only, JSON/YAML key merge, whitespace normalization
 *
 * @module git/conflict-resolution/rule-merger
 * @version 1.2.0
 */

const { logger } = require("../../utils/logger.js");

// Merge result types
const MERGE_RESULT = {
  MERGED: "merged",
  CONFLICT: "conflict",
  SKIPPED: "skipped",
};

/**
 * RuleMerger - Level 1 conflict resolution
 * Handles simple, deterministic merge patterns
 */
class RuleMerger {
  constructor(options = {}) {
    this.ignoreWhitespace = options.ignoreWhitespace !== false;
    this.ignoreTrailingNewline = options.ignoreTrailingNewline !== false;
  }

  /**
   * Attempt rule-based merge of conflicting content
   *
   * @param {Object} conflict
   * @param {string} conflict.base - Common ancestor content
   * @param {string} conflict.local - Local (ours) content
   * @param {string} conflict.remote - Remote (theirs) content
   * @param {string} conflict.filePath - File path for type detection
   * @returns {{ result: string, merged: string|null, strategy: string, confidence: number }}
   */
  merge(conflict) {
    const { base, local, remote, filePath } = conflict;

    // Normalize whitespace if configured
    const normBase = this.ignoreWhitespace
      ? this._normalizeWhitespace(base)
      : base;
    const normLocal = this.ignoreWhitespace
      ? this._normalizeWhitespace(local)
      : local;
    const normRemote = this.ignoreWhitespace
      ? this._normalizeWhitespace(remote)
      : remote;

    // Check if only whitespace/format differences exist
    if (normLocal === normRemote) {
      return {
        result: MERGE_RESULT.MERGED,
        merged: local, // Prefer local for whitespace-only diffs
        strategy: "format-ignore",
        confidence: 1.0,
      };
    }

    // Try non-overlapping 3-way merge
    const threeWayResult = this._threeWayMerge(base, local, remote);
    if (threeWayResult.success) {
      return {
        result: MERGE_RESULT.MERGED,
        merged: threeWayResult.content,
        strategy: "three-way-non-overlapping",
        confidence: 0.95,
      };
    }

    // Try append-only detection
    const appendResult = this._tryAppendMerge(base, local, remote);
    if (appendResult.success) {
      return {
        result: MERGE_RESULT.MERGED,
        merged: appendResult.content,
        strategy: "append-merge",
        confidence: 0.9,
      };
    }

    // Try config file merge (JSON/YAML)
    if (this._isConfigFile(filePath)) {
      const configResult = this._tryConfigMerge(base, local, remote, filePath);
      if (configResult.success) {
        return {
          result: MERGE_RESULT.MERGED,
          merged: configResult.content,
          strategy: "config-key-merge",
          confidence: 0.9,
        };
      }
    }

    // Cannot resolve with rules
    return {
      result: MERGE_RESULT.CONFLICT,
      merged: null,
      strategy: "none",
      confidence: 0,
    };
  }

  /**
   * Non-overlapping 3-way merge
   * Merges changes from both sides when they modify different regions
   *
   * @param {string} base
   * @param {string} local
   * @param {string} remote
   * @returns {{ success: boolean, content: string }}
   */
  _threeWayMerge(base, local, remote) {
    const baseLines = (base || "").split("\n");
    const localLines = (local || "").split("\n");
    const remoteLines = (remote || "").split("\n");

    // Compute diffs against base
    const localDiff = this._computeLineDiff(baseLines, localLines);
    const remoteDiff = this._computeLineDiff(baseLines, remoteLines);

    // Check for overlapping changes
    for (const localChange of localDiff.changes) {
      for (const remoteChange of remoteDiff.changes) {
        if (this._rangesOverlap(localChange, remoteChange)) {
          // Overlapping changes - can't auto-merge
          return { success: false, content: "" };
        }
      }
    }

    // Apply both sets of changes (non-overlapping)
    const result = [...baseLines];
    const allChanges = [
      ...localDiff.changes.map((c) => ({ ...c, source: "local" })),
      ...remoteDiff.changes.map((c) => ({ ...c, source: "remote" })),
    ].sort((a, b) => b.startLine - a.startLine); // Apply in reverse order

    for (const change of allChanges) {
      if (change.type === "replace") {
        result.splice(
          change.startLine,
          change.deleteCount,
          ...change.insertLines,
        );
      } else if (change.type === "insert") {
        result.splice(change.startLine, 0, ...change.insertLines);
      } else if (change.type === "delete") {
        result.splice(change.startLine, change.deleteCount);
      }
    }

    return { success: true, content: result.join("\n") };
  }

  /**
   * Compute line-level diff between two arrays
   */
  _computeLineDiff(baseLines, changedLines) {
    const changes = [];
    const maxLen = Math.max(baseLines.length, changedLines.length);

    let i = 0;
    while (i < maxLen) {
      if (i >= baseLines.length) {
        // Lines added at end
        changes.push({
          type: "insert",
          startLine: i,
          deleteCount: 0,
          insertLines: changedLines.slice(i),
        });
        break;
      }

      if (i >= changedLines.length) {
        // Lines deleted at end
        changes.push({
          type: "delete",
          startLine: i,
          deleteCount: baseLines.length - i,
          insertLines: [],
        });
        break;
      }

      if (baseLines[i] !== changedLines[i]) {
        // Find extent of change
        let baseEnd = i + 1;
        let changedEnd = i + 1;

        // Look for next matching line
        while (baseEnd < baseLines.length && changedEnd < changedLines.length) {
          if (baseLines[baseEnd] === changedLines[changedEnd]) {
            break;
          }
          baseEnd++;
          changedEnd++;
        }

        changes.push({
          type: "replace",
          startLine: i,
          deleteCount: baseEnd - i,
          insertLines: changedLines.slice(i, changedEnd),
        });

        i = baseEnd;
      } else {
        i++;
      }
    }

    return { changes };
  }

  /**
   * Check if two change ranges overlap
   */
  _rangesOverlap(a, b) {
    const aEnd = a.startLine + (a.deleteCount || 0);
    const bEnd = b.startLine + (b.deleteCount || 0);
    return a.startLine < bEnd && b.startLine < aEnd;
  }

  /**
   * Try append-only merge
   * Both sides appended content to the end of the file
   */
  _tryAppendMerge(base, local, remote) {
    if (!base) {
      return { success: false };
    }

    const baseNorm = base.trimEnd();
    const localNorm = local.trimEnd();
    const remoteNorm = remote.trimEnd();

    // Check if both are append-only
    if (localNorm.startsWith(baseNorm) && remoteNorm.startsWith(baseNorm)) {
      const localAppend = localNorm.slice(baseNorm.length);
      const remoteAppend = remoteNorm.slice(baseNorm.length);

      // Sort appended content by length (shorter first, as a heuristic for time ordering)
      const merged = baseNorm + localAppend + remoteAppend;

      return { success: true, content: merged + "\n" };
    }

    return { success: false };
  }

  /**
   * Try config file merge (JSON/YAML key-level)
   */
  _tryConfigMerge(base, local, remote, filePath) {
    const ext = (filePath || "").split(".").pop()?.toLowerCase();

    if (ext === "json") {
      return this._tryJsonMerge(base, local, remote);
    }

    if (ext === "yaml" || ext === "yml") {
      return this._tryYamlMerge(base, local, remote);
    }

    return { success: false };
  }

  /**
   * JSON key-level merge
   */
  _tryJsonMerge(base, local, remote) {
    try {
      const baseObj = JSON.parse(base || "{}");
      const localObj = JSON.parse(local || "{}");
      const remoteObj = JSON.parse(remote || "{}");

      const merged = this._deepMergeObjects(baseObj, localObj, remoteObj);
      if (merged.conflict) {
        return { success: false };
      }

      return {
        success: true,
        content: JSON.stringify(merged.result, null, 2) + "\n",
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * YAML key-level merge (simplified - treats as JSON-like)
   */
  _tryYamlMerge(base, local, remote) {
    // For simplicity, try parsing YAML as a simple key-value format
    try {
      const baseObj = this._parseSimpleYaml(base);
      const localObj = this._parseSimpleYaml(local);
      const remoteObj = this._parseSimpleYaml(remote);

      const merged = this._deepMergeObjects(baseObj, localObj, remoteObj);
      if (merged.conflict) {
        return { success: false };
      }

      return {
        success: true,
        content: this._serializeSimpleYaml(merged.result),
      };
    } catch (error) {
      return { success: false };
    }
  }

  /**
   * Deep merge three objects (base, local, remote)
   * Handles field-level conflicts
   */
  _deepMergeObjects(base, local, remote) {
    const result = {};
    let conflict = false;

    const allKeys = new Set([
      ...Object.keys(base || {}),
      ...Object.keys(local || {}),
      ...Object.keys(remote || {}),
    ]);

    for (const key of allKeys) {
      const baseVal = base?.[key];
      const localVal = local?.[key];
      const remoteVal = remote?.[key];

      // Both same as base - no change
      if (
        JSON.stringify(localVal) === JSON.stringify(baseVal) &&
        JSON.stringify(remoteVal) === JSON.stringify(baseVal)
      ) {
        if (baseVal !== undefined) {
          result[key] = baseVal;
        }
        continue;
      }

      // Only local changed
      if (
        JSON.stringify(localVal) !== JSON.stringify(baseVal) &&
        JSON.stringify(remoteVal) === JSON.stringify(baseVal)
      ) {
        if (localVal !== undefined) {
          result[key] = localVal;
        }
        continue;
      }

      // Only remote changed
      if (
        JSON.stringify(localVal) === JSON.stringify(baseVal) &&
        JSON.stringify(remoteVal) !== JSON.stringify(baseVal)
      ) {
        if (remoteVal !== undefined) {
          result[key] = remoteVal;
        }
        continue;
      }

      // Both changed to same value
      if (JSON.stringify(localVal) === JSON.stringify(remoteVal)) {
        if (localVal !== undefined) {
          result[key] = localVal;
        }
        continue;
      }

      // Both changed to different values - conflict at this key
      if (
        typeof localVal === "object" &&
        typeof remoteVal === "object" &&
        !Array.isArray(localVal) &&
        !Array.isArray(remoteVal)
      ) {
        // Recurse for nested objects
        const nested = this._deepMergeObjects(
          baseVal || {},
          localVal,
          remoteVal,
        );
        if (nested.conflict) {
          conflict = true;
          break;
        }
        result[key] = nested.result;
      } else {
        conflict = true;
        break;
      }
    }

    return { result, conflict };
  }

  /**
   * Parse simple YAML (key: value pairs, one level)
   */
  _parseSimpleYaml(text) {
    const obj = {};
    if (!text) {
      return obj;
    }
    for (const line of text.split("\n")) {
      const match = line.match(/^(\s*)(\w[\w.-]*)\s*:\s*(.*)$/);
      if (match) {
        const key = match[2];
        let value = match[3].trim();
        // Parse simple types
        if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } else if (/^\d+$/.test(value)) {
          value = parseInt(value, 10);
        } else if (/^\d+\.\d+$/.test(value)) {
          value = parseFloat(value);
        } else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        obj[key] = value;
      }
    }
    return obj;
  }

  /**
   * Serialize object as simple YAML
   */
  _serializeSimpleYaml(obj) {
    return (
      Object.entries(obj)
        .map(([key, value]) => {
          if (typeof value === "string") {
            return `${key}: "${value}"`;
          }
          return `${key}: ${value}`;
        })
        .join("\n") + "\n"
    );
  }

  /**
   * Normalize whitespace for comparison
   */
  _normalizeWhitespace(text) {
    if (!text) {
      return "";
    }
    return text
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, "  ")
      .replace(/[ ]+$/gm, "")
      .trimEnd();
  }

  /**
   * Check if a file is a config file
   */
  _isConfigFile(filePath) {
    if (!filePath) {
      return false;
    }
    const ext = filePath.split(".").pop()?.toLowerCase();
    return ["json", "yaml", "yml", "toml", "ini", "conf"].includes(ext);
  }
}

module.exports = {
  RuleMerger,
  MERGE_RESULT,
};
