# ChainlessChain IDE Bridge (VS Code)

Bridges the ChainlessChain **`cc` agent CLI** to VS Code. When this extension is
active, running `cc agent` inside the editor's integrated terminal lets the
agent read your editor context and propose changes as native diffs.

All seven phases of the IDE bridge design
(`docs/design/modules/98_IDE桥接对标方案.md`) have shipped: discovery, the
VS Code + JetBrains extensions, blocking diff review, marketplace releases,
live awareness, and the chat panel.

## Install — Open VSX only (NOT the Microsoft VS Code Marketplace)

> ⚠️ This extension is published to **[Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide)**
> only. It is **not** on the official Microsoft VS Code Marketplace, so a search
> inside stock Microsoft VS Code will **not** find it.

- **VSCodium / Cursor / Windsurf / Gitpod** (and anything that uses Open VSX):
  search **"ChainlessChain IDE"** in the Extensions panel.
- **Stock Microsoft VS Code**: download the `.vsix` from the Open VSX page above
  (or the direct link below) → Command Palette → **Extensions: Install from VSIX…**.
  Direct: `https://open-vsx.org/api/chainlesschain/chainlesschain-ide/<version>/file/chainlesschain.chainlesschain-ide-<version>.vsix`
- The **JetBrains** sibling is on the
  [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge).

_(Why not the Microsoft Marketplace? Publishing there requires an Azure-backed
publisher subscription the project doesn't maintain; Open VSX is the open registry
used by VSCodium/Cursor/etc.)_

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

## Configure the LLM (first run)

Run **ChainlessChain: Configure LLM** from the command palette — pick a
provider (volcengine/doubao, Ollama, Anthropic, OpenAI, DeepSeek, DashScope,
Kimi, Gemini, Mistral, MiniMax), enter the model/API key/base URL (sane
defaults prefilled), and the wizard writes `~/.chainlesschain/config.json`
via `cc config set` and verifies connectivity with `cc llm test`. The chat
panel also offers this wizard automatically when nothing is configured or a
turn fails to reach the LLM. The API key stays in the local config file —
never in VS Code settings.

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
button starts a fresh conversation (also `/new`, `/sessions`, `/plan`, `/stop`… — type `/help`); `chainlesschain.chat.provider` /
`chainlesschain.chat.model` pick the panel LLM (empty = the CLI default).

In the input box, **`@` mentions workspace files** (ranked dropdown — Tab/Enter
inserts `@relative/path`, and the CLI pulls that file into the conversation),
and you can **paste screenshots** straight from the clipboard (📷 chips, up to
4 per message; needs cc ≥ 0.162.47 and a vision-capable model). Replies render
**markdown**: code blocks, inline code, bold/italic, headings, bordered tables
and ☐/☑ task lists — through an escape-first whitelist renderer, so the panel
stays XSS-safe by construction.

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

- ✅ MCP server + lockfile + env injection + 7 tools (incl. `executeCode`,
  `openMultiDiff`, `getTerminalOutput`), wired and tested.
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
- ✅ Approve/Deny cards for risky actions (0.9.0, cc ≥ 0.162.45) — no more silent fail-closed in the panel.
- ✅ Hunk-level partial accept: "Pick hunks…" multi-select on diff review (0.12.0).
- ✅ Markdown replies (md-lite, 0.13.0) + GFM tables and ☐/☑ task lists (0.17.0).
- ✅ Closing the diff tab rejects the review immediately (0.14.0).
- ✅ `@` file mentions with a ranked completion dropdown (0.15.0).
- ✅ Paste screenshots as vision input (0.16.0, cc ≥ 0.162.47).
- ✅ Mid-session IDE restart hot-reconnect (cc ≥ 0.162.47): a window reload no
  longer kills the agent's IDE tools — the next call re-finds the new instance.
- ✅ Keybindings + Insert File Reference + `@selection`/`@diagnostics` hints (0.18.0).
- ✅ **Fix with ChainlessChain**: QuickFix lightbulb on diagnostics seeds a scoped
  fix request (0.19.0).
- ✅ **Explain / Refactor** selection (right-click) + `/cost` and `/context` panel
  commands (0.20.0).
- ✅ Workspace-symbol `@`-mention: find a file by a function/class name (0.21.0).
- ✅ **Conversation tabs** (0.22.0): multiple chats, each its own `cc agent` process;
  switching restores that tab's transcript.
- ✅ **App Preview** (0.22.0): run the project's dev server and open it in the built-in
  Simple Browser; the dev server's HMR live-reloads on edits.
- ✅ **Inline diff comments — "Request changes…"** (0.22.0): annotate diff lines with
  revision notes that the agent revises against.
- ✅ **Batch multi-file diff — `openMultiDiff`** (0.22.0): review a whole changeset in
  one native multi-file diff (Accept all / pick a subset / Reject).
- ✅ **Terminal-context sharing — `getTerminalOutput`** (0.23.0): the agent sees recent
  integrated-terminal commands + their output + exit code (VS Code 1.93+ shell
  integration), so it knows what you just ran and how it failed.
- ✅ **CLI version-sync** (0.24.0): on activation, checks `cc --version` and offers a
  one-click upgrade if your `chainlesschain` CLI is older than the extension needs —
  keeps the extension and the npm CLI in step.
- ✅ **`ChainlessChain: Upgrade CLI` command** (0.26.0): command-palette action to run
  `npm i -g chainlesschain@latest` on demand — update `cc` from the IDE any time.
- ✅ **`@terminal` mention + App Preview crash recovery** (0.27.0): `@`-completion offers
  `@terminal` (pulls recent terminal commands/output into the prompt); a crashed dev
  server now offers a one-click Restart.
- ✅ **Background-tab completion signal** (0.28.0): a turn finishing in a conversation
  tab you're not looking at flags the tab with a green ● dot and offers a "Show" toast
  to jump to it — no more silently-finished background chats.

## Packaging

```bash
npx @vscode/vsce package --no-dependencies   # produces a .vsix
```
The extension has no runtime npm dependencies (pure Node + the VS Code API).
