package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure slash-command catalog + completion logic for the chat tool window
 * (mirrors the VS Code panel's {@code slash-commands.js}). The panel's slash
 * commands are otherwise invisible until {@code /help}; this drives the
 * autocomplete popup that makes them discoverable as you type. SDK-free, Java 8,
 * locally testable — kept in sync with ConversationView's command switch.
 */
public final class SlashCommands {
    private SlashCommands() {}

    /** {@code [command, one-line help]} in menu order. */
    public static final List<String[]> COMMANDS = Collections.unmodifiableList(Arrays.asList(
            new String[] { "/new", "start a new conversation" },
            new String[] { "/compact", "compact the conversation history" },
            new String[] { "/stop", "interrupt the running turn" },
            new String[] { "/auto", "auto-accept file edits" },
            new String[] { "/bypass", "bypass all approvals" },
            new String[] { "/normal", "normal approvals (default)" },
            new String[] { "/think", "extended thinking on (Anthropic)" },
            new String[] { "/ultrathink", "extended thinking, max budget" },
            new String[] { "/think-off", "extended thinking off" },
            new String[] { "/plan", "enter plan mode" },
            new String[] { "/approve", "approve the current plan" },
            new String[] { "/reject", "reject the current plan" },
            new String[] { "/context", "context-window usage" },
            new String[] { "/cost", "token cost for this session" },
            new String[] { "/help", "list panel commands" }));

    // Whole input so far is `/` + command chars at the start of the line, no
    // space yet: "/co" -> "co", "/cost x" -> null, "hi /x" -> null.
    private static final Pattern SLASH = Pattern.compile("^\\s*/([a-z-]*)$", Pattern.CASE_INSENSITIVE);

    /**
     * The in-progress slash prefix, or {@code null} when the caret is not on a
     * bare leading slash token. Empty string means just "/" was typed.
     */
    public static String detectSlashToken(String textBeforeCaret) {
        if (textBeforeCaret == null) return null;
        Matcher m = SLASH.matcher(textBeforeCaret);
        return m.matches() ? m.group(1).toLowerCase() : null;
    }

    /** Commands whose name (sans '/') starts with {@code prefix}; empty → all. */
    public static List<String[]> filter(String prefix) {
        String q = prefix == null ? "" : prefix.toLowerCase();
        List<String[]> out = new ArrayList<>();
        for (String[] row : COMMANDS) {
            if (row[0].substring(1).startsWith(q)) out.add(row);
        }
        return out;
    }

    /** "/cmd  —  help" label for the popup. */
    public static String label(String[] row) {
        return row[0] + "  —  " + row[1];
    }
}
