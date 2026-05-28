#!/usr/bin/env python3
"""
Rewrite short commit SHA pointers in CLAUDE.md / CLAUDE.local.md / memory files
after `git filter-repo` rewrote history (Phase D of the .git slim operation,
2026-05-28).

Reads .git/filter-repo/commit-map (one `<old-full-sha> <new-full-sha>` row per
commit, with new == 0000... for dropped commits) and replaces every hex token
that appears as an OLD short SHA with the matching NEW short SHA of the same
length. Dropped commits (new SHA all zeros) get a `<dropped>` marker so the
breakage is visible rather than silently leaving a stale pointer.

Run once after filter-repo. Writes <file>.bak siblings for manual review on
the first pass.
"""

import argparse
import os
import re
import sys
from pathlib import Path


HEX_TOKEN_RE = re.compile(r"\b([0-9a-f]{7,40})\b")


def load_commit_map(path: Path) -> tuple[dict[str, str], set[str]]:
    """Returns (old_full → new_full mapping, set of dropped full OIDs)."""
    mapping: dict[str, str] = {}
    dropped: set[str] = set()
    with path.open("r", encoding="utf-8") as fh:
        first = fh.readline().strip()
        # filter-repo writes a header row "old  new"; skip it if present.
        if not re.match(r"^[0-9a-f]{40}\s+[0-9a-f]{40}", first):
            pass
        else:
            old, new = first.split()
            if old != new:
                if set(new) == {"0"}:
                    dropped.add(old)
                else:
                    mapping[old] = new
        for line in fh:
            parts = line.split()
            if len(parts) != 2:
                continue
            old, new = parts
            if old == new:
                continue
            if set(new) == {"0"}:
                dropped.add(old)
            else:
                mapping[old] = new
    return mapping, dropped


def build_prefix_index(mapping: dict[str, str], dropped: set[str]) -> dict[str, tuple[str, bool]]:
    """For each old full SHA, register every prefix length 7..40 → (new_or_dropped, is_dropped).
    If multiple OLD SHAs share the same short prefix we keep only the first one
    seen — short-SHA collisions in a repo this size are extremely rare but the
    main risk is replacing with a NEW SHA that wasn't actually mentioned, which
    `verify_callers` (manual diff review) catches.
    """
    by_prefix: dict[str, tuple[str, bool]] = {}
    for old, new in mapping.items():
        for length in range(7, 41):
            short = old[:length]
            by_prefix.setdefault(short, (new[:length], False))
    for old in dropped:
        for length in range(7, 41):
            short = old[:length]
            by_prefix.setdefault(short, ("<dropped>", True))
    return by_prefix


def rewrite_file(path: Path, by_prefix: dict[str, tuple[str, bool]], dry_run: bool) -> tuple[int, int]:
    """Returns (replacements_made, dropped_markers_inserted)."""
    if not path.is_file():
        return 0, 0
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Skip binary or non-utf8 files.
        return 0, 0

    replaced = 0
    dropped_count = 0

    def sub(match: re.Match[str]) -> str:
        nonlocal replaced, dropped_count
        token = match.group(1)
        hit = by_prefix.get(token)
        if hit is None:
            return token
        new_token, is_dropped = hit
        if is_dropped:
            dropped_count += 1
            return f"{token}<dropped-by-slim-2026-05-28>"
        replaced += 1
        return new_token

    new_text = HEX_TOKEN_RE.sub(sub, text)
    if new_text != text and not dry_run:
        path.with_suffix(path.suffix + ".bak").write_text(text, encoding="utf-8")
        path.write_text(new_text, encoding="utf-8")
    return replaced, dropped_count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commit-map", default=".git/filter-repo/commit-map")
    parser.add_argument(
        "--targets",
        nargs="+",
        default=[
            "CLAUDE.md",
            "CLAUDE.local.md",
        ],
        help="Files / globs to rewrite in place (relative to cwd).",
    )
    parser.add_argument(
        "--memory-dir",
        default=os.path.expanduser(
            r"~/.claude/projects/C--code-chainlesschain/memory"
        ),
        help="Walk this dir for *.md files and rewrite each one.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    commit_map_path = Path(args.commit_map)
    if not commit_map_path.exists():
        sys.stderr.write(f"commit-map not found: {commit_map_path}\n")
        return 2
    mapping, dropped = load_commit_map(commit_map_path)
    print(f"commit-map: {len(mapping)} changed, {len(dropped)} dropped")

    by_prefix = build_prefix_index(mapping, dropped)
    print(f"prefix index: {len(by_prefix)} short-SHA → new mappings")

    total_replaced = 0
    total_dropped_markers = 0
    files_touched = 0

    targets = list(args.targets)
    memory_dir = Path(args.memory_dir)
    if memory_dir.is_dir():
        for md in sorted(memory_dir.rglob("*.md")):
            targets.append(str(md))

    for tgt in targets:
        path = Path(tgt)
        r, d = rewrite_file(path, by_prefix, args.dry_run)
        if r or d:
            files_touched += 1
            print(f"  {path}: {r} rewrites, {d} dropped markers")
        total_replaced += r
        total_dropped_markers += d

    print(f"\nTotal: {total_replaced} rewrites, {total_dropped_markers} dropped, "
          f"{files_touched} files touched ({'dry-run' if args.dry_run else 'live'})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
