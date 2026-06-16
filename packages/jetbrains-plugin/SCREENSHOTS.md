# JetBrains Marketplace screenshots — capture guide

Screenshots are uploaded manually via the plugin dashboard (can't be automated).
Upload at: **plugins.jetbrains.com → your plugin (id 32208) → Edit → Media** (drag
images into the Screenshots section; reorder by dragging — the first one is the
carousel hero).

## Capture environment
Use a real **2024.2+ IDE** with the plugin installed, **or** the dev sandbox:
`cd packages/jetbrains-plugin && JAVA_HOME=<Adoptium JDK17> ./gradlew runIde`.
Open a small/medium project so the chat + editor both fit. **Dark theme** matches
the plugin's icon work and reads best in the carousel.

## Format / size
- PNG (preferred) or JPG. Keep them legible — capture the relevant region, not the
  whole 4K screen; ~1200–1600 px wide is plenty.
- Be consistent (same theme + similar zoom across all shots).
- No personal data / API keys visible (the LLM-config dialog masks the key field,
  but double-check the terminal/editor content).

## Shot list (in suggested carousel order)

1. **Chat with conversation tabs** *(hero)*
   - Open the right-dock **ChainlessChain** tool window. Create 2–3 tabs with
     **+ New chat**; send a prompt and capture mid-stream (streaming reply + a
     tool-call line visible).
   - Caption: *"Chat with the cc agent in conversation tabs — streaming replies,
     tool trace, sessions that resume across restarts."*

2. **Native diff review**
   - Ask the agent to edit a file → the side-by-side diff with the
     **Accept / Request changes… / Reject** dialog visible.
   - Caption: *"Review every edit in the IDE's native diff — Accept, Request
     changes (inline notes), or Reject. Multi-file changes batch into one review."*

3. **Approval / plan card**
   - Trigger a tool that needs approval (or type `/plan`) so the **Approve / Deny**
     (or Approve / Reject) card shows above the input.
   - Caption: *"Interactive approval & plan cards — approve or deny right in the chat."*

4. **Selection action + @-mention**
   - Right-click a code selection → the context menu showing **ChainlessChain:
     Explain Selection / Refactor Selection**. (Or: type `@` in the input to show
     the completion popup of `@selection` / `@diagnostics` + files/symbols.)
   - Caption: *"Right-click Explain/Refactor, or @-mention files, selection,
     diagnostics, and project symbols."*

5. **App Preview**
   - On a project with a dev script: **Tools → ChainlessChain: Start App Preview**;
     capture the **ChainlessChain Preview** bottom tool window with the app embedded.
   - Caption: *"Run your app inside the IDE — Start App Preview detects the dev
     server and embeds it; one-click restart on crash."*

6. **Slash commands / help** *(optional)*
   - Type `/help` in the chat to show the command list (`/auto` `/bypass` `/normal`
     `/think` `/ultrathink` `/plan` `/approve` `/reject` `/new` `/stop` `/cost`
     `/context`).
   - Caption: *"Approval modes, extended thinking, and panel controls via slash commands."*

## Tip
JetBrains shows the first 1–2 screenshots prominently; lead with the chat-tabs +
diff-review shots (the strongest "AI agent in your IDE" story).
