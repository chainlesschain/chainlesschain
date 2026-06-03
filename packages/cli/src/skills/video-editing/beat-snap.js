/**
 * beat-snap.js — Snap shot_plan timestamps to nearest beat positions
 *
 * CutClaw 对齐逻辑：每个 shot 的 start/end 对齐到最近的 beat，
 * 保证剪辑点落在节拍上，产生音画同步感。
 */

export function snapToBeats(shotPlan, beats, options = {}) {
  const tolerance = options.tolerance ?? 0.5;
  if (!beats || beats.length === 0) return shotPlan;

  const snapped = {
    ...shotPlan,
    sections: (shotPlan.sections || []).map((section) => ({
      ...section,
      music_segment: section.music_segment
        ? snapSegment(section.music_segment, beats, tolerance)
        : section.music_segment,
      shots: (section.shots || []).map((shot) =>
        snapShot(shot, beats, tolerance),
      ),
    })),
  };

  return snapped;
}

function snapSegment(seg, beats, tolerance) {
  return {
    ...seg,
    start: findNearestBeat(seg.start, beats, tolerance),
    end: findNearestBeat(seg.end, beats, tolerance),
  };
}

function snapShot(shot, beats, tolerance) {
  if (shot.target_duration == null) return shot;
  const snappedDuration = snapDurationToBeats(
    shot.target_duration,
    beats,
    tolerance,
  );
  return { ...shot, target_duration: snappedDuration };
}

export function findNearestBeat(time, beats, tolerance = 0.5) {
  if (!beats || beats.length === 0) return time;

  let best = beats[0];
  let bestDist = Math.abs(time - beats[0]);

  for (let i = 1; i < beats.length; i++) {
    const dist = Math.abs(time - beats[i]);
    if (dist < bestDist) {
      best = beats[i];
      bestDist = dist;
    }
    if (beats[i] > time + tolerance) break;
  }

  return bestDist <= tolerance ? best : time;
}

export function snapDurationToBeats(duration, beats, tolerance = 0.5) {
  if (!beats || beats.length < 2) return duration;

  const avgInterval = (beats[beats.length - 1] - beats[0]) / (beats.length - 1);
  if (avgInterval <= 0) return duration;

  const beatCount = Math.round(duration / avgInterval);
  const snapped = beatCount * avgInterval;

  return Math.abs(snapped - duration) <= tolerance
    ? parseFloat(snapped.toFixed(3))
    : duration;
}

export function buildBeatGrid(beats, downbeats) {
  if (!beats || beats.length === 0) return { bars: [], beatsPerBar: 4 };

  const dbSet = new Set((downbeats || []).map((d) => d.toString()));
  let beatsPerBar = 4;
  if (downbeats && downbeats.length >= 2) {
    const dbIntervals = [];
    for (let i = 1; i < downbeats.length; i++) {
      const count = beats.filter(
        (b) => b >= downbeats[i - 1] && b < downbeats[i],
      ).length;
      if (count > 0) dbIntervals.push(count);
    }
    if (dbIntervals.length > 0) {
      beatsPerBar = median(dbIntervals);
    }
  }

  const bars = [];
  let barStart = 0;
  let barBeats = [];

  for (const b of beats) {
    if (dbSet.has(b.toString()) && barBeats.length > 0) {
      bars.push({ start: barStart, end: b, beats: barBeats });
      barStart = b;
      barBeats = [b];
    } else {
      if (barBeats.length === 0) barStart = b;
      barBeats.push(b);
    }
  }
  if (barBeats.length > 0) {
    bars.push({
      start: barStart,
      end: barBeats[barBeats.length - 1],
      beats: barBeats,
    });
  }

  return { bars, beatsPerBar };
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}
