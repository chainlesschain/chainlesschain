#!/usr/bin/env python3
"""
madmom-beats.py — Beat + downbeat detection sidecar for CutClaw-inspired pipeline.

Usage:
  python madmom-beats.py <audio_path>

Outputs JSON to stdout:
  {
    "duration": 180.5,
    "tempo": 128.0,
    "beats": [0.48, 0.96, 1.44, ...],
    "downbeats": [0.48, 2.40, 4.32, ...],
    "segments": [
      { "idx": 0, "start": 0.0, "end": 12.5, "label": "intro", "beat_count": 16 },
      ...
    ]
  }

Requirements:
  pip install madmom numpy

Falls back to librosa if madmom is not installed.
"""

import json
import sys
import os

def detect_beats_madmom(audio_path):
    import madmom
    import numpy as np

    proc = madmom.features.beats.RNNBeatProcessor()(audio_path)
    beats = madmom.features.beats.DBNBeatTrackingProcessor(fps=100)(proc)
    beats = [round(float(b), 3) for b in beats]

    try:
        down_proc = madmom.features.downbeats.RNNDownBeatProcessor()(audio_path)
        downbeat_result = madmom.features.downbeats.DBNDownBeatTrackingProcessor(
            beats_per_bar=[3, 4], fps=100
        )(down_proc)
        downbeats = [round(float(row[0]), 3) for row in downbeat_result if int(row[1]) == 1]
    except Exception:
        downbeats = beats[::4]

    if len(beats) >= 2:
        intervals = np.diff(beats)
        median_ibi = float(np.median(intervals))
        tempo = round(60.0 / median_ibi, 1) if median_ibi > 0 else 0
    else:
        tempo = 0

    return beats, downbeats, tempo


def detect_beats_librosa(audio_path):
    import librosa
    import numpy as np

    y, sr = librosa.load(audio_path, sr=22050)
    tempo_arr, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    beats = [round(float(t), 3) for t in librosa.frames_to_time(beat_frames, sr=sr)]
    tempo = round(float(tempo_arr[0]) if hasattr(tempo_arr, '__len__') else float(tempo_arr), 1)
    downbeats = beats[::4]
    return beats, downbeats, tempo


def get_duration(audio_path):
    try:
        import subprocess
        result = subprocess.run(
            ["ffprobe", "-i", audio_path, "-show_entries", "format=duration",
             "-v", "quiet", "-of", "csv=p=0"],
            capture_output=True, text=True, timeout=30,
        )
        return round(float(result.stdout.strip()), 3)
    except Exception:
        return 0


def classify_position(pct):
    if pct < 0.1:
        return "intro"
    elif pct < 0.3:
        return "build-up"
    elif pct < 0.7:
        return "chorus"
    elif pct < 0.9:
        return "bridge"
    else:
        return "outro"


def build_segments(beats, downbeats, duration):
    if not downbeats or len(downbeats) < 2:
        if not beats:
            return []
        chunk = max(4, len(beats) // 8)
        downbeats = beats[::chunk]

    segments = []
    for i, db in enumerate(downbeats):
        start = db
        end = downbeats[i + 1] if i + 1 < len(downbeats) else duration
        beat_count = sum(1 for b in beats if start <= b < end)
        pct = start / duration if duration > 0 else 0
        segments.append({
            "idx": i,
            "start": round(start, 3),
            "end": round(end, 3),
            "label": classify_position(pct),
            "beat_count": beat_count,
        })
    return segments


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: madmom-beats.py <audio_path>"}), file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.isfile(audio_path):
        print(json.dumps({"error": f"File not found: {audio_path}"}), file=sys.stderr)
        sys.exit(1)

    duration = get_duration(audio_path)

    try:
        beats, downbeats, tempo = detect_beats_madmom(audio_path)
    except ImportError:
        try:
            beats, downbeats, tempo = detect_beats_librosa(audio_path)
        except ImportError:
            print(json.dumps({"error": "Neither madmom nor librosa installed"}), file=sys.stderr)
            sys.exit(1)

    segments = build_segments(beats, downbeats, duration)

    result = {
        "duration": duration,
        "tempo": tempo,
        "beats": beats,
        "downbeats": downbeats,
        "segments": segments,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
