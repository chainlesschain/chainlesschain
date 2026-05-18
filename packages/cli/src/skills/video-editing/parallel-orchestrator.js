/**
 * parallel-orchestrator.js — Section 级并行 Editor + 冲突检测 + 重跑
 *
 * 移植自 CutClaw ParallelShotOrchestrator:
 *   1. 每个 section 并行 spawn editor 循环
 *   2. 合并后检测时间区间冲突
 *   3. 质量打分: 0.6 * protagonist_ratio + 0.4 * duration_accuracy
 *   4. 输者重跑，注入 forbidden_time_ranges
 */

import { EventEmitter } from "events";

export class ParallelShotOrchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxConcurrency = options.maxConcurrency || 4;
    this.maxReruns = options.maxReruns || 3;
    this.qualityWeights = options.qualityWeights || {
      protagonist: 0.6,
      duration: 0.4,
    };
  }

  /**
   * Run editor loops in parallel by section, resolve conflicts, rerun losers.
   *
   * @param {object[]} sections - shot_plan.sections
   * @param {Function} runShotFn - async (section, shot, context) => result
   * @param {object} context - shared context (assetDir, llmCall, etc.)
   * @returns {object[]} merged shot_point entries
   */
  async run(sections, runShotFn, context) {
    const allResults = [];

    for (let i = 0; i < sections.length; i += this.maxConcurrency) {
      const batch = sections.slice(i, i + this.maxConcurrency);
      this.emit("event", {
        type: "parallel.batch_start",
        batchIdx: Math.floor(i / this.maxConcurrency),
        sectionCount: batch.length,
        ts: Date.now(),
      });

      const batchResults = await Promise.all(
        batch.map((section) => this._runSection(section, runShotFn, context)),
      );

      allResults.push(...batchResults.flat());
    }

    const resolved = await this._resolveConflicts(
      allResults,
      runShotFn,
      context,
    );
    return resolved;
  }

  async _runSection(section, runShotFn, context) {
    const results = [];
    for (const shot of section.shots || []) {
      try {
        const result = await runShotFn(section, shot, {
          ...context,
          forbiddenTimeRanges: [],
        });
        if (result) {
          results.push({
            ...result,
            section_idx: section.section_idx,
            shot_idx: shot.shot_idx,
            target_duration: shot.target_duration || 3,
          });
        }
      } catch (err) {
        this.emit("event", {
          type: "parallel.shot_error",
          section_idx: section.section_idx,
          shot_idx: shot.shot_idx,
          error: err.message,
          ts: Date.now(),
        });
      }
    }
    return results;
  }

  async _resolveConflicts(results, runShotFn, context) {
    let resolved = [...results];

    for (let round = 0; round < this.maxReruns; round++) {
      const conflicts = detectConflicts(resolved);
      if (conflicts.length === 0) break;

      this.emit("event", {
        type: "parallel.conflict_detected",
        round,
        conflictCount: conflicts.length,
        ts: Date.now(),
      });

      const toRerun = [];
      for (const [a, b] of conflicts) {
        const scoreA = this._qualityScore(a);
        const scoreB = this._qualityScore(b);

        const loser = scoreA >= scoreB ? b : a;
        const winner = scoreA >= scoreB ? a : b;

        this.emit("event", {
          type: "parallel.conflict_resolved",
          winner: {
            section: winner.section_idx,
            shot: winner.shot_idx,
            score: Math.max(scoreA, scoreB),
          },
          loser: {
            section: loser.section_idx,
            shot: loser.shot_idx,
            score: Math.min(scoreA, scoreB),
          },
          ts: Date.now(),
        });

        toRerun.push({
          entry: loser,
          forbiddenTimeRanges: this._extractTimeRanges(winner),
        });

        resolved = resolved.filter((r) => r !== loser);
      }

      for (const { entry, forbiddenTimeRanges } of toRerun) {
        const section = {
          section_idx: entry.section_idx,
          shots: [
            {
              shot_idx: entry.shot_idx,
              target_duration: entry.target_duration,
            },
          ],
          music_segment: entry.music_segment,
        };
        try {
          const rerunResult = await this._runSection(section, runShotFn, {
            ...context,
            forbiddenTimeRanges,
          });
          resolved.push(...rerunResult);
        } catch {
          // skip failed reruns
        }
      }
    }

    return resolved.sort(
      (a, b) => a.section_idx - b.section_idx || a.shot_idx - b.shot_idx,
    );
  }

  _qualityScore(entry) {
    const protagonist = entry.protagonist_ratio ?? 0.5;
    const targetDur = entry.target_duration || 3;
    const actualDur = entry.total_duration || 0;
    const durAccuracy =
      targetDur > 0
        ? 1 - Math.min(Math.abs(actualDur - targetDur) / targetDur, 1)
        : 0.5;

    return (
      this.qualityWeights.protagonist * protagonist +
      this.qualityWeights.duration * durAccuracy
    );
  }

  _extractTimeRanges(entry) {
    return (entry.clips || []).map((c) => ({
      start: c.start,
      end: c.end,
    }));
  }
}

/**
 * Detect time-range overlaps between shot_point entries.
 * Returns pairs [a, b] where a and b have overlapping clips.
 */
export function detectConflicts(results) {
  const conflicts = [];
  const allClips = results.map((r) => ({
    entry: r,
    ranges: (r.clips || []).map((c) => [c.start, c.end]),
  }));

  for (let i = 0; i < allClips.length; i++) {
    for (let j = i + 1; j < allClips.length; j++) {
      if (rangesOverlap(allClips[i].ranges, allClips[j].ranges)) {
        conflicts.push([allClips[i].entry, allClips[j].entry]);
      }
    }
  }
  return conflicts;
}

function rangesOverlap(rangesA, rangesB) {
  for (const [aStart, aEnd] of rangesA) {
    for (const [bStart, bEnd] of rangesB) {
      if (aStart < bEnd && aEnd > bStart) return true;
    }
  }
  return false;
}
