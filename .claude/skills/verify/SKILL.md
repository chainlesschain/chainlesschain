---
name: verify
description: Verify that a code change actually does what it's supposed to by running the app and observing behavior. Use when asked to verify a PR, confirm a fix works, test a change manually, check that a feature works, or validate local changes before pushing — beyond just unit tests.
category: development
activation: manual
tags: [verify, validate, confirm, qa, smoke-test]
---

# Verify the change

Goal: confirm a specific change does what it claims, by observing real behavior —
not by trusting the diff or a passing test alone. $ARGUMENTS may name the change /
PR / expected behavior to verify; if empty, infer it from the recent work or the
current diff.

## 1. State the claim precisely

Write down, in one line, what the change is supposed to do and how you'd know it
worked ("after the fix, `avg([1,2,3])` returns 2, not NaN"). If you can't state a
checkable claim, ask for one rather than guessing.

## 2. Establish the before/after when feasible

- If practical and safe, observe the BUGGY behavior first (e.g. on the base
  revision, or by reverting the change in a scratch copy / `cc checkpoint`), then
  the FIXED behavior — so the verification is differential, not just "it ran".
- For a pure feature add, exercising the new path is enough.

## 3. Exercise it for real

- Use the `run` skill's launch patterns to start the app and drive the exact path
  the change touches (the new flag / route / screen / function) with realistic
  input — including an edge case the change was meant to handle.
- Prefer observing the running app; fall back to a focused script or a targeted
  test ONLY if the app genuinely can't be launched here (say which and why).
- Run the existing tests too if they're relevant, but treat them as supporting
  evidence, not the verification itself.

## 4. Verdict

Give a clear verdict with evidence:

- **VERIFIED** — quote the observed output/behavior that proves the claim, and
  note any edge case you checked.
- **NOT VERIFIED** — show what you observed that contradicts the claim (the bug
  still reproduces, an error, wrong output).
- **BLOCKED** — state exactly what stopped you (no display, missing service,
  needs a device/credentials) and the precise command/steps you'd run once
  unblocked. Never report VERIFIED for something you did not actually observe.
