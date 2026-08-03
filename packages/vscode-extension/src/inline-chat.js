/**
 * Inline Chat (Cmd+K parity with Claude Code IDE):
 * Show an input box at the current selection, accept a prompt, seed the chat
 * panel with the selected code context + the user's question, and focus it.
 *
 * This is the lightweight, dependency-free implementation — it doesn't try to
 * render an inline widget inside the editor (that requires the proposed
 * interactiveEditor API); it uses VS Code's native showInputBox anchored to the
 * current selection range, then routes through the existing ChatViewProvider
 * so the agent conversation, diff review, and tool approval flows stay
 * centralized in one place.
 */

/**
 * Build the @selection context string the CLI already understands, same shape
 * used by the right-click "Explain / Refactor selection" actions.
 */
function buildSelectionPrompt({ prompt, relPath, startLine, endLine, selectedText }) {
  const lines = selectedText ? `\n\nSelected code:\n\`\`\`\n${selectedText}\n\`\`\`` : '';
  return `@selection(${relPath}:${startLine + 1}-${endLine + 1}) ${prompt}${lines}`;
}

/**
 * Create the inline chat command handler.
 *
 * @param {object} opts
 * @param {import('vscode')} opts.vscode  - the VS Code module (injected so this
 *   file stays vscode-free for unit testing)
 * @param {(text: string) => void} opts.seedInput - ChatViewProvider.seedInput
 * @param {() => void} [opts.focusChat]    - optional: focus the chat panel
 * @returns {() => Promise<void>}
 */
function createInlineChatHandler({ vscode, seedInput, focusChat }) {
  return async function triggerInlineChat() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage(
        'ChainlessChain: open a file first to use Inline Chat (Cmd/Ctrl+K).',
      );
      return;
    }

    const document = editor.document;
    const sel = editor.selection;
    const relPath = vscode.workspace.asRelativePath(document.uri, false);

    // If there's no selection, use the current line as context (Claude Code
    // also lets you Cmd+K without an explicit selection — it uses the line
    // under the cursor).
    let rangeForContext;
    let contextLabel;
    if (sel.isEmpty) {
      const line = document.lineAt(sel.active.line);
      rangeForContext = line.range;
      contextLabel = `${relPath}:${sel.active.line + 1} (current line)`;
    } else {
      rangeForContext = new vscode.Range(sel.start, sel.end);
      contextLabel = `${relPath}:${sel.start.line + 1}-${sel.end.line + 1} (${
        sel.end.line - sel.start.line + 1
      } lines selected)`;
    }
    const selectedText = document.getText(rangeForContext);

    const prompt = await vscode.window.showInputBox({
      placeHolder: 'Ask ChainlessChain about this code (or type instructions to refactor it)...',
      prompt: `Inline Chat — context: ${contextLabel}.  Esc to cancel.`,
      ignoreFocusOut: false,
      value: '',
      valueSelection: undefined,
    });

    if (!prompt || !prompt.trim()) {
      return; // user cancelled or entered nothing
    }

    // Build the same @selection-scoped prompt the existing actions use, then
    // seed it into the chat panel and focus it. The panel already handles
    // sending to cc agent, streaming, diff review, etc.
    const message = buildSelectionPrompt({
      prompt: prompt.trim(),
      relPath,
      startLine: rangeForContext.start.line,
      endLine: rangeForContext.end.line,
      selectedText,
    });

    seedInput(message);
    if (focusChat) focusChat();
  };
}

module.exports = {
  createInlineChatHandler,
  buildSelectionPrompt,
};
