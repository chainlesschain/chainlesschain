---
name: cc-cli
description: Invoke ChainlessChain `cc` CLI commands from natural language. Triggers when the user wants to run any `cc …` action (skill / note / chat / ask / search / did / session / memory / mcp / cowork / agent / workflow / automation / pack / orchestrate / pipeline / kg / marketplace / did-v2 / activitypub / matrix / terraform / crosschain / etc.) without remembering the exact subcommand. Always discovers the current command set via `cc --help` at runtime, so newly added commands work without updating this skill.
---

# cc CLI — natural-language invocation

The `cc` binary (aliases: `chainlesschain`, `clc`, `clchain`) exposes 100+ top-level commands, each with its own subcommands and flags. The command set grows frequently, so **never rely on a memorized list** — always discover the current surface from `cc --help` and `cc <cmd> --help`.

## How to run

1. **Parse intent** — identify (a) the domain the user cares about (skill, note, did, chat, session, mcp, cowork, workflow, etc.) and (b) the verb (list, create, run, sync, publish, show, delete, …).

2. **Enumerate top-level commands**: `cc --help`. The `Commands:` block lists `  <name>|<alias>  <description>`. Pick the command whose name/alias or description best matches the user's domain.
   - If multiple fit, ask the user to disambiguate rather than guessing.
   - Aliases are shown after `|` (e.g. `agent|a`, `activitypub|ap`, `multimodal|mm`).

3. **Enumerate subcommands**: `cc <command> --help` (or `cc help <command>`). Parse the `Commands:` block the same way.

4. **Enumerate options**: `cc <command> <sub> --help`. The `Options:` block shows each flag, its argument shape, and default. Prefer non-interactive flags when available:
   - `--json` — machine-readable output, easier to summarize back to the user
   - `--yes` / `-y` — skip confirmation prompts
   - `--quiet` — suppress banners
   - `--dry-run` — preview without side effects (use this first for sync/publish/pack/reset operations)

5. **Execute**: run `cc <command> <sub> [--flags] [positional]` with `Bash`. Capture stdout; surface stderr to the user if non-empty.

6. **Summarize**: give the user a 1–2 line plain-language answer plus the exact command you ran, so they can re-run or tweak it manually. Never invent output — if parsing fails, show the raw tail.

## Rules

- **Help is the source of truth.** If a memory, CLAUDE.md entry, or doc references a command that isn't in `cc --help`, trust `--help` and flag the stale reference.
- **`-v2` governance surfaces are separate commands.** Many domains have both a base command and a `…gov-…-v2` suffixed variant (maturity / lifecycle governance). Pick the base unless the user explicitly mentions governance, maturity, lifecycle, or V2.
- **Confirm destructive operations.** For `stop`, `db reset`, anything with `--delete` / `--purge` / `--remove` / `--force`, paste the exact command and ask the user to confirm before running — even if their original request was vaguely phrased.
- **Prefer dry-run first.** For `skill sync-cli`, `marketplace publish`, `pack`, migrations, or any sync/publish flow, run with `--dry-run` first when available and show the planned actions before the real run.
- **Connection errors ≠ bugs.** Some commands need the desktop app or backend services. If you see `ECONNREFUSED` / `service unavailable`, run `cc status` and tell the user what's down before retrying.
- **Don't shell-inject user text.** When the user's input becomes a CLI argument (e.g. `cc ask "<question>"`, `cc search <query>`), quote it properly — single-quote preferred on bash, and escape embedded quotes.
- **Keep working directory in mind.** `cc init`, `cc pack --project`, `cc persona`, and other project-scoped commands operate on `cwd`. Confirm you're in the intended repo before running them.

## Seed mapping (verify with `cc --help` — do not trust blindly)

| User says | Command starts with |
|-----------|---------------------|
| start the app, open ChainlessChain | `cc start` |
| stop / shutdown | `cc stop` |
| what's broken, diagnose | `cc doctor` |
| initial setup, first run | `cc setup` / `cc init` |
| chat with AI | `cc chat` |
| ask a one-shot question | `cc ask <question>` |
| run an agent session | `cc agent` (alias `cc a`) |
| list / run / sync skills | `cc skill` |
| search notes / knowledge | `cc search <query>` / `cc note` |
| memory / remember this | `cc memory` / `cc permmem` |
| DID / identity | `cc did` (or `cc did-v2` / `cc didv2` for W3C v2) |
| session / history | `cc session` |
| MCP servers/tools | `cc mcp` |
| cowork / multi-agent | `cc cowork` |
| workflow / automation | `cc workflow` / `cc automation` / `cc auto` |
| web UI panel | `cc ui` |
| orchestrate / pipeline | `cc orchestrate` / `cc pipeline` (alias `pipe`) |
| marketplace / publish skill | `cc marketplace` |
| federation / activitypub / matrix | `cc activitypub` (alias `ap`) / `cc matrix` |
| cross-chain / privacy / inference | `cc crosschain` / `cc privacy` / `cc inference` |
| token / billing / incentive | `cc tokens` / `cc incentive` |
| knowledge graph | `cc kg` |
| IPFS / storage | `cc ipfs` |
| tenant / SSO / SCIM | `cc tenant` / `cc sso` / `cc scim` |
| video montage | `cc video` |
| CLI-anything bridge | `cc cli-anything` |
| EvoMap | `cc evomap` |

## Self-update

This skill does not need to be edited when new CLI commands are added — the runtime discovery via `cc --help` picks them up automatically. It only needs editing if:
- The help format changes (Commander output structure).
- A new convention appears (e.g. a new common flag like `--json`).
- Domain→command mapping gets a new well-known alias worth seeding above.

To verify current coverage:
```bash
cc --help | grep -E '^\s{2}[a-z]' | wc -l   # total top-level commands
cc --version                                  # CLI version
```
