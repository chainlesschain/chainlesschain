package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure logic for the chat input's {@code @}-mention completion — a Java port of
 * the VS Code extension's at-mention.js + symbol-mentions.js. Detect an
 * in-progress {@code @token}, rank workspace files against it, offer the IDE
 * pseudo-mentions ({@code @selection}/{@code @diagnostics}), format workspace
 * symbols into "find a file by symbol name" items, and dedupe. No IntelliJ SDK
 * (the glue feeds symbols from PSI); compiles + tests with plain {@code javac}.
 *
 * The CLI expands {@code @<path>} server-side, so the panel only helps the user
 * TYPE the reference — a picked symbol inserts the file that CONTAINS it.
 */
public final class Mentions {

    private Mentions() {}

    /** A detected in-progress @token: the typed prefix + the index of '@'. */
    public static final class AtToken {
        public final String prefix;
        public final int start;
        AtToken(String prefix, int start) {
            this.prefix = prefix;
            this.start = start;
        }
    }

    /** A completion item: a file path (label==value) or a symbol ({@code <kind> <name> · <path>} → path). */
    public static final class MentionItem {
        public final String label;
        public final String value;
        MentionItem(String label, String value) {
            this.label = label;
            this.value = value;
        }
        public static MentionItem path(String p) { return new MentionItem(p, p); }
        public static MentionItem symbol(String label, String value) { return new MentionItem(label, value); }
    }

    /** Input symbol for formatSymbolItems — the glue maps PSI to this. */
    public static final class Symbol {
        public final String name;
        public final int kind;     // VS Code SymbolKind numeric (see SYMBOL_KIND)
        public final String fsPath; // absolute path of the file containing it
        public Symbol(String name, int kind, String fsPath) {
            this.name = name;
            this.kind = kind;
            this.fsPath = fsPath;
        }
    }

    /** Result of applyMention: the new text + caret position. */
    public static final class ApplyResult {
        public final String text;
        public final int caret;
        ApplyResult(String text, int caret) {
            this.text = text;
            this.caret = caret;
        }
    }

    // "@" preceded by start / whitespace / opening bracket-quote (so user@host
    // is not a mention); the token is path chars only.
    private static final Pattern AT_TOKEN_RE =
            Pattern.compile("(^|[\\s({\\[<\"'])@([A-Za-z0-9_\\-./\\\\]*)$");

    /** Detect an in-progress @token immediately before the caret, or null. */
    public static AtToken detectAtToken(String textBeforeCaret) {
        String s = textBeforeCaret == null ? "" : textBeforeCaret;
        Matcher m = AT_TOKEN_RE.matcher(s);
        if (!m.find()) return null;
        String prefix = m.group(2);
        return new AtToken(prefix, s.length() - prefix.length() - 1);
    }

    /**
     * Rank workspace-relative paths against the typed prefix: basename-prefix
     * hits first, then path-prefix, then substring anywhere. Case-insensitive;
     * backslashes in the query are normalized to "/".
     */
    public static List<String> filterFiles(List<String> files, String prefix, int limit) {
        int max = limit > 0 ? limit : 20;
        List<String> list = files != null ? files : new ArrayList<String>();
        String q = (prefix == null ? "" : prefix).toLowerCase().replace("\\", "/");
        if (q.isEmpty()) {
            return new ArrayList<String>(list.subList(0, Math.min(max, list.size())));
        }
        List<String> baseHits = new ArrayList<String>();
        List<String> pathHits = new ArrayList<String>();
        List<String> subHits = new ArrayList<String>();
        for (String fRaw : list) {
            String f = String.valueOf(fRaw);
            String lower = f.toLowerCase();
            String base = lower.substring(lower.lastIndexOf('/') + 1);
            if (base.indexOf(q) == 0) baseHits.add(f);
            else if (lower.indexOf(q) == 0) pathHits.add(f);
            else if (lower.indexOf(q) >= 0) subHits.add(f);
        }
        List<String> out = new ArrayList<String>();
        out.addAll(baseHits);
        out.addAll(pathHits);
        out.addAll(subHits);
        return new ArrayList<String>(out.subList(0, Math.min(max, out.size())));
    }

    // IDE pseudo-mentions the CLI expands server-side (lib/ide-context.js).
    private static final String[] IDE_MENTIONS = {"selection", "diagnostics"};

    /** IDE keyword mentions whose name starts with the typed prefix (empty matches all). */
    public static List<String> ideMentionMatches(String prefix) {
        String q = (prefix == null ? "" : prefix).toLowerCase();
        List<String> out = new ArrayList<String>();
        for (String m : IDE_MENTIONS) {
            if (m.indexOf(q) == 0) out.add(m);
        }
        return out;
    }

    /** Splice an accepted suggestion into the input text, with a trailing space. */
    public static ApplyResult applyMention(String text, AtToken at, String relPath, int caretPos) {
        String s = text == null ? "" : text;
        String before = s.substring(0, at.start);
        int caret = caretPos < 0 ? s.length() : Math.min(caretPos, s.length());
        String after = s.substring(caret);
        String mention = "@" + relPath + " ";
        return new ApplyResult(before + mention + after, (before + mention).length());
    }

    public static String mentionLabel(MentionItem item) {
        if (item == null) return "";
        if (item.label != null && !item.label.isEmpty()) return item.label;
        return item.value == null ? "" : item.value;
    }

    public static String mentionValue(MentionItem item) {
        return (item == null || item.value == null) ? "" : item.value;
    }

    // ── workspace symbols (symbol-mentions.js) ──────────────────────────────

    /** VS Code SymbolKind (numeric) → short label for the dropdown row. */
    public static String symbolKindLabel(int kind) {
        switch (kind) {
            case 1: return "module";
            case 2: return "namespace";
            case 4: return "class";
            case 5: return "method";
            case 6: return "property";
            case 7: return "field";
            case 8: return "ctor";
            case 9: return "enum";
            case 10: return "interface";
            case 11: return "function";
            case 12: return "var";
            case 13: return "const";
            case 22: return "struct";
            case 23: return "event";
            case 25: return "typeparam";
            default: return "symbol";
        }
    }

    /**
     * Map workspace symbols → completion items where label is
     * "{@code <kind> <name> · <relpath>}" and value is the workspace-relative
     * file path inserted as {@code @<path>}. Skips nameless/pathless; caps.
     */
    public static List<MentionItem> formatSymbolItems(List<Symbol> symbols, String root, int limit) {
        int max = limit > 0 ? limit : 8;
        List<MentionItem> out = new ArrayList<MentionItem>();
        if (symbols == null) return out;
        for (Symbol s : symbols) {
            if (s == null || s.name == null || s.name.isEmpty()) continue;
            String p = s.fsPath == null ? "" : s.fsPath;
            if (root != null && !root.isEmpty() && p.indexOf(root) == 0) {
                p = p.substring(Math.min(root.length() + 1, p.length()));
            }
            p = p.replace("\\", "/");
            if (p.isEmpty()) continue;
            out.add(MentionItem.symbol(symbolKindLabel(s.kind) + " " + s.name + " · " + p, p));
            if (out.size() >= max) break;
        }
        return out;
    }

    /** Keep the first item per inserted value, so a path-matched file + its symbol don't both show. */
    public static List<MentionItem> dedupeMentionItems(List<MentionItem> items) {
        Set<String> seen = new LinkedHashSet<String>();
        List<MentionItem> out = new ArrayList<MentionItem>();
        if (items == null) return out;
        for (MentionItem it : items) {
            String value = (it == null || it.value == null) ? "" : it.value;
            if (value.isEmpty() || seen.contains(value)) continue;
            seen.add(value);
            out.add(it);
        }
        return out;
    }
}
