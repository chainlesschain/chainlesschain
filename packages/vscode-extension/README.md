# ChainlessChain IDE Bridge (VS Code)

Bridges the ChainlessChain **`cc` agent CLI** to VS Code. When this extension is
active, running `cc agent` inside the editor's integrated terminal lets the
agent read your editor context and propose changes as native diffs.

All seven phases of the IDE bridge design
(`docs/design/modules/98_IDE桥接对标方案.md`) have shipped: discovery, the
VS Code + JetBrains extensions, blocking diff review, marketplace releases,
live awareness, and the chat panel.

## How it works

The extension runs a tiny **MCP server** (Model Context Protocol) on
`127.0.0.1` and advertises it two ways:

1. **Lockfile** — `~/.chainlesschain/ide/<port>.json` (file `0600`, dir `0700`)
   with the URL, a per-session bearer token, and the workspace folders.
2. **Terminal env** — `CHAINLESSCHAIN_IDE_PORT` / `CHAINLESSCHAIN_IDE_TOKEN` are
   injected into integrated terminals so `cc` locks onto *this* window
   deterministically (no scanning).

`cc agent` discovers the server, connects as the reserved MCP server **`ide`**,
and the editor tools become callable by the model as `mcp__ide__*`:

| Tool | What it does |
|------|--------------|
| `getSelection` | active file + selected range + text |
| `getDiagnostics` | errors/warnings (optionally scoped to a file) |
| `getOpenEditors` | open tabs, active one flagged |
| `openDiff` | open a native side-by-side diff for review |
| `executeCode` | run code in the active Jupyter notebook's kernel (needs `ms-toolsai.jupyter` + a running kernel; state persists across calls) |

The token + `127.0.0.1` binding stop other local processes from driving your
editor.

## Automatic awareness (cc ≥ 0.162.39)

With a current `cc` CLI the agent doesn't just *have* these tools — it uses
them on its own:

- **Your selection rides along with every prompt.** Each prompt you submit
  (one-shot `-p`, stream, or the interactive REPL) automatically carries an
  `<ide-context>` block: active file, open tabs, and the selected text. Ask
  "what does this do?" without pasting anything. The block is ephemeral — it
  is never written into the saved session, so `--resume` replays your words,
  not a stale editor snapshot.
- **Post-edit diagnostics feed back into the loop.** After the agent writes or
  edits a file, the editor's fresh errors/warnings for that file are attached
  to the tool result, so the model sees — and fixes — what it just broke in
  the same run.
- **`@` tab-completion prefers your open tabs.** In the REPL, typing `@<TAB>`
  completes file references; files open in the editor rank first.

Set `CC_IDE_CONTEXT=0` to turn the automatic sharing off (the `mcp__ide__*`
tools stay available for explicit calls).

## Project memory (cc ≥ 0.162.41)

The CLI auto-loads file-based project memory — `cc.md` > `CLAUDE.md` >
`AGENTS.md` per directory, plus path-scoped `.claude/rules` — into every agent
run, so agents started from this workspace already know your conventions. Two
palette commands drive it without leaving the editor:

- **ChainlessChain: Generate Project Memory (cc.md)** — runs
  `chainlesschain init` in the shared terminal (offline folder inventory, or
  pick *AI refine* to let a bounded agent fill the Conventions section).
- **ChainlessChain: Show Project Memory Files** — runs
  `chainlesschain memory files` to list exactly what the agent will load.

Everything else from the 0.162.41 batch works in the integrated terminal
as-is: REPL steering (queued input, Esc interrupt, `/rewind` double-Esc),
`! <cmd>` bash passthrough, `# <note>` quick-memorize into cc.md, `/` command
TAB completion, and `--json-schema` structured output for scripted runs.

## Chat panel

Activity Bar → **ChainlessChain IDE → Chat**: a sidebar conversation with the
agent, no terminal needed. Under the hood it keeps one persistent
`cc agent` duplex process (`--input/output-format stream-json`) and streams
replies token by token, with a live tool-call trace. Because the child runs
inside this window's bridge, the agent automatically knows your selection and
open tabs, pulls diagnostics after its edits, and can review edits as native
diffs. Needs the `cc` CLI installed (`npm i -g chainlesschain`); point
`chainlesschain.cli.path` at a custom binary if it is not on PATH. Conversations **survive restarts** (cc ≥ 0.162.40): the panel resumes this
workspace's last session automatically. The **New**
button starts a fresh conversation; `chainlesschain.chat.provider` /
`chainlesschain.chat.model` pick the panel LLM (empty = the CLI default).

## Try it

1. Run the extension (F5 → Extension Development Host), open a folder.
2. In that window's integrated terminal: `cc ide status` should show the
   bridge, then `cc agent -p "what's selected?"` will see your selection.
3. `cc ide doctor` explains discovery if something is off.

> No-extension self-check: the whole protocol is covered by
> `packages/cli/__tests__/unit/vscode-ext-ide-bridge.test.js`, which drives this
> extension's MCP server with the real CLI MCP client.

## Visualization (0.2.0)

The bridge surfaces live state three ways, all fed by one activity log
(`onActivity` hook on the MCP server → status bar / tree / dashboard):

- **Status bar** (bottom-right): `◉ IDE :<port> →N` — running + port + tool-call
  count, flashes the active tool on each call. Click opens the dashboard.
- **Sidebar** (Activity Bar → *ChainlessChain IDE*): a tree of status, workspace
  folders, the bridge tools, and the recent tool-call log.
- **Dashboard** (*ChainlessChain IDE: Open Dashboard*): status cards + a live
  tool-call stream + a Restart button.

The bearer token is never displayed in any of these.

## Status

- ✅ MCP server + lockfile + env injection + 5 tools (incl. `executeCode`),
  wired and tested.
- ✅ `openDiff` blocking review with accept/reject + user-edited `finalText`.
- ✅ Live awareness with cc ≥ 0.162.39: selection shared per prompt,
  post-edit diagnostics fed back, edit approvals as native diffs.
- ✅ **Chat panel** (0.4.x): sidebar conversation over a persistent
  `cc agent` stream-json child.
- ✅ Status bar + sidebar tree + dashboard fed by one activity log.
- ✅ Published on [Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide);
  the JetBrains sibling plugin is live on the
  [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge).
- ✅ Chat session resume across panel/editor restarts (0.5.0, cc ≥ 0.162.40).
- ✅ Plan mode in the chat panel: Plan → live plan card → Approve & run (0.6.0).
- ✅ Turn interrupt: Stop/Esc aborts the in-flight turn, conversation survives (0.7.0).
- ⏳ Future polish: hunk-level partial accept.

## Packaging

```bash
npx @vscode/vsce package --no-dependencies   # produces a .vsix
```
The extension has no runtime npm dependencies (pure Node + the VS Code API).
