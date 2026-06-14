---
name: run
description: Launch and drive this project's app to see a change actually working — not just passing tests. Use when asked to run, start, or screenshot the app, or to confirm a change works in the real running app. Detects the project type (CLI, server, TUI, Electron, browser app, or library) and uses the right launch pattern.
category: development
activation: manual
tags: [run, launch, app, dev, smoke-test]
---

# Run the app

Goal: actually launch this project and exercise the change, so "it works" means
observed behavior — not a green test suite. $ARGUMENTS may name what to run or
which change to exercise; if empty, infer from the recent work.

## 1. Find how this project is meant to run (in priority order)

1. **A project skill/command** that already launches it — check `.chainlesschain/`,
   `.claude/`, `package.json` `scripts` (`dev`, `start`, `serve`), `Makefile`,
   `Procfile`, `docker-compose.yml`, README "Quick Start".
2. **The dev command** for the detected stack. Prefer the one a human would use
   locally, not the production/CI one.

## 2. Launch pattern by project type

- **CLI tool**: run the binary with a realistic subcommand + flags (e.g.
  `node bin/<cli>.js <cmd> --help`, then a real invocation). Read stdout/stderr.
- **HTTP/API server**: start it in the background, poll the health/route until it
  responds, hit the relevant endpoint with `curl`, then stop it. Never leave a
  server running — capture its task id and kill it when done.
- **TUI**: launch with a scripted/non-interactive path if one exists; otherwise
  describe the exact keystrokes and capture the first screen.
- **Electron / desktop**: use the project's `dev` script (e.g. `npm run dev`);
  if there's no display, say so and fall back to building + smoke-importing the
  changed module.
- **Browser/web app**: start the dev server, open the route that exercises the
  change, take a screenshot or read the rendered DOM/console.
- **Library (no app)**: there's nothing to "launch" — write a tiny throwaway
  script that imports the changed API and runs the new path, then run it.

## 3. Drive the change, then report

- Exercise the specific path the change touched (the new flag, route, screen,
  function) with realistic input.
- Report what you OBSERVED: the actual output / status code / screenshot / log
  line — quoting it. Distinguish "ran and behaved correctly" from "started but I
  couldn't reach the changed path".
- Clean up: stop any background process you started. If you couldn't run it
  (no display, missing service, needs a device), say exactly what's blocking and
  what you'd run once unblocked — don't claim success you didn't observe.
