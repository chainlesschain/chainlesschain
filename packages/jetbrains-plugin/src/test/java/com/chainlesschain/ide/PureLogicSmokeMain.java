package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Headless smoke for the pure logic layers ported from the VS Code extension:
 * ConversationManager (tabs + approval mode), PreviewDetect (App Preview),
 * MultiDiff (batch diff), Mentions (@-completion), SessionArgs (--permission-mode
 * selector), IntrospectArgs (cost/context args + context-window parser). No
 * IntelliJ SDK, no cc, no LLM — just plain {@code javac} + {@code java}.
 *
 * Repro (from packages/jetbrains-plugin):
 *   javac --release 8 -encoding UTF-8 -d .smoke-out \
 *     src/main/java/com/chainlesschain/ide/*.java \
 *     src/test/java/com/chainlesschain/ide/PureLogicSmokeMain.java
 *   java -cp .smoke-out com.chainlesschain.ide.PureLogicSmokeMain
 */
public final class PureLogicSmokeMain {

    private static int passed = 0;
    private static int failed = 0;

    private static void check(boolean cond, String name) {
        if (cond) { passed++; }
        else { failed++; System.out.println("  FAIL: " + name); }
    }

    private static void eq(Object got, Object want, String name) {
        boolean ok = (got == null) ? (want == null) : got.equals(want);
        if (!ok) System.out.println("  FAIL: " + name + " -> got[" + got + "] want[" + want + "]");
        if (ok) passed++; else failed++;
    }

    public static void main(String[] args) {
        conversationManager();
        previewDetect();
        multiDiff();
        mentions();
        sessionArgs();
        introspectArgs();
        llmConfig();
        slashCommands();
        fixWithCc();
        markdownLite();

        System.out.println("\n=== PureLogicSmokeMain: " + passed + " passed, " + failed + " failed ===");
        if (failed > 0) System.exit(1);
    }

    private static void conversationManager() {
        System.out.println("ConversationManager:");
        ConversationManager m = new ConversationManager();
        ConversationManager.Conversation a = m.create();
        eq(a.id, "conv-1", "first id");
        eq(a.title, "Chat 1", "first title");
        eq(m.activeId(), "conv-1", "first active");

        ConversationManager.Conversation b = m.create("Bugfix", null, true);
        eq(b.title, "Bugfix", "custom title");
        eq(m.activeId(), "conv-2", "create activates");

        ConversationManager.Conversation c = m.create(null, null, false);
        eq(c.id, "conv-3", "third id");
        eq(m.activeId(), "conv-2", "activate=false keeps active");
        eq(m.count(), 3, "count 3");

        // list order + flags
        List<ConversationManager.TabInfo> tabs = m.list();
        eq(tabs.size(), 3, "list size");
        eq(tabs.get(1).active, Boolean.TRUE, "conv-2 active in list");
        m.setSession(c.id, new Object());
        eq(m.list().get(2).hasSession, Boolean.TRUE, "hasSession reflects set");

        // switchTo unknown
        eq(m.switchTo("nope"), null, "switchTo unknown -> null");
        eq(m.activeId(), "conv-2", "active unchanged after bad switch");

        // close active middle -> right neighbor
        m.switchTo(b.id);
        ConversationManager.CloseResult r = m.close(b.id);
        check(r.closed, "close returns closed");
        eq(m.activeId(), c.id, "close active -> right neighbor");

        // close active last -> left neighbor
        m.switchTo(c.id);
        m.close(c.id);
        eq(m.activeId(), a.id, "close last active -> left neighbor");

        // close final -> null active
        ConversationManager.CloseResult last = m.close(a.id);
        check(last.closed, "final close ok");
        eq(m.activeId(), null, "no active after final close");
        eq(m.count(), 0, "count 0");

        // ids keep increasing (no reuse)
        ConversationManager.Conversation d = m.create();
        eq(d.id, "conv-4", "ids not reused after closes");
        eq(d.title, "Chat 4", "title follows seq");

        // setters + allSessions order
        ConversationManager m2 = new ConversationManager();
        ConversationManager.Conversation x = m2.create();
        ConversationManager.Conversation y = m2.create();
        ConversationManager.Conversation z = m2.create();
        eq(m2.setSessionId(x.id, "sess").sessionId, "sess", "setSessionId");
        eq(m2.setSessionId(x.id, "").sessionId, null, "empty sessionId -> null");
        Object hx = new Object(); Object hz = new Object();
        m2.setSession(x.id, hx); m2.setSession(z.id, hz);
        eq(m2.allSessions(), Arrays.asList(hx, hz), "allSessions only live, in order");
        eq(m2.setTitle(x.id, "Renamed").title, "Renamed", "setTitle");
        eq(m2.setTitle(x.id, "").title, "Renamed", "empty title ignored");

        // approval mode (default + setMode, mirrors VS Code per-conversation mode)
        eq(x.mode, "default", "conversation mode defaults to 'default'");
        eq(m2.setMode(x.id, "acceptEdits").mode, "acceptEdits", "setMode");
        eq(m2.setMode(x.id, "").mode, "default", "empty mode -> default");

        // extended thinking (default + setThinking)
        eq(x.thinking, "off", "conversation thinking defaults to 'off'");
        eq(m2.setThinking(x.id, "ultra").thinking, "ultra", "setThinking");
        eq(m2.setThinking(x.id, "").thinking, "off", "empty thinking -> off");
    }

    private static void previewDetect() {
        System.out.println("PreviewDetect:");
        Map<String, String> s1 = new LinkedHashMap<String, String>();
        s1.put("build", "vite build"); s1.put("dev", "vite"); s1.put("start", "node .");
        PreviewDetect.DevScript d1 = PreviewDetect.pickDevScript(s1);
        eq(d1.script, "dev", "priority picks dev");
        eq(d1.command, "vite", "dev command");

        Map<String, String> s2 = new LinkedHashMap<String, String>();
        s2.put("ui:watch", "vite --host"); s2.put("build", "tsc");
        PreviewDetect.DevScript d2 = PreviewDetect.pickDevScript(s2);
        eq(d2.script, "ui:watch", "fallback to recognized tool");

        Map<String, String> s3 = new LinkedHashMap<String, String>();
        s3.put("build", "vite build"); s3.put("test", "vitest");
        check(PreviewDetect.pickDevScript(s3) == null, "no dev script -> null");
        check(PreviewDetect.pickDevScript(new LinkedHashMap<String, String>()) == null, "empty -> null");
        check(PreviewDetect.pickDevScript(null) == null, "null -> null");

        eq(PreviewDetect.detectServerUrl("  Local:   http://localhost:5173/"),
                "http://localhost:5173/", "vite banner");
        eq(PreviewDetect.detectServerUrl("ready - started server on http://localhost:3000"),
                "http://localhost:3000", "next banner");
        eq(PreviewDetect.detectServerUrl("[32m  ➜  Local:[39m [36mhttp://localhost:4321/[39m"),
                "http://localhost:4321/", "ANSI stripped");
        eq(PreviewDetect.detectServerUrl("see (http://localhost:3000)."),
                "http://localhost:3000", "trailing punctuation trimmed");
        eq(PreviewDetect.detectServerUrl("Network: http://0.0.0.0:5000/"),
                "http://localhost:5000/", "0.0.0.0 -> localhost");
        check(PreviewDetect.detectServerUrl("building for production...") == null, "no url -> null");
        check(PreviewDetect.detectServerUrl("see https://example.com/docs") == null, "non-local -> null");
        check(PreviewDetect.detectServerUrl(null) == null, "null line -> null");

        String out = "VITE v5.0  ready\n\n  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.10:5173/";
        eq(PreviewDetect.detectServerUrlInText(out), "http://localhost:5173/", "first url in text");
        check(PreviewDetect.detectServerUrlInText("compiling...\nstill...") == null, "no url in text");
    }

    private static void multiDiff() {
        System.out.println("MultiDiff:");
        // normalize: dedupe last-wins + drop invalid
        List<MultiDiff.FileChange> raw = new ArrayList<MultiDiff.FileChange>();
        raw.add(new MultiDiff.FileChange("a.js", "1", null));
        raw.add(new MultiDiff.FileChange("a.js", "2", null)); // supersedes
        raw.add(new MultiDiff.FileChange("b.js", null, null)); // no modified -> dropped
        raw.add(new MultiDiff.FileChange("c.js", "z", "y"));
        List<MultiDiff.FileChange> norm = MultiDiff.normalizeMultiDiffFiles(raw);
        eq(norm.size(), 2, "normalize size");
        eq(norm.get(0).path, "a.js", "normalize keeps order");
        eq(norm.get(0).modifiedText, "2", "last write wins");

        // changeset summary +/- with new-file flag
        List<MultiDiff.FileChange> cs = new ArrayList<MultiDiff.FileChange>();
        cs.add(new MultiDiff.FileChange("edit.js", "a\nX\nc", "a\nb\nc")); // +1 -1
        cs.add(new MultiDiff.FileChange("new.js", "hello\nworld", "")); // +2 new
        MultiDiff.Summary sum = MultiDiff.changesetSummary(cs);
        eq(sum.count, 2, "summary count");
        eq(sum.totalAdded, 3, "total added");
        eq(sum.totalRemoved, 1, "total removed");
        MultiDiff.FileStat fresh = sum.files.get(1);
        check(fresh.isNew && fresh.added == 2 && fresh.removed == 0, "new file stat");

        // unchanged flag
        MultiDiff.Summary same = MultiDiff.changesetSummary(
                Arrays.asList(new MultiDiff.FileChange("same.js", "x\ny", "x\ny")));
        check(same.files.get(0).unchanged, "unchanged flagged");

        // fileLabel
        eq(MultiDiff.fileLabel(new MultiDiff.FileStat("a.js", 12, 3, false, false)),
                "a.js  +12 -3", "label counts");
        eq(MultiDiff.fileLabel(new MultiDiff.FileStat("n.js", 5, 0, true, false)),
                "n.js  +5 (new)", "label new");

        // selectWrites: null = all changed (drop no-op), subset, empty
        List<MultiDiff.FileChange> files = Arrays.asList(
                new MultiDiff.FileChange("a.js", "2", "1"),
                new MultiDiff.FileChange("b.js", "y", "x"),
                new MultiDiff.FileChange("noop.js", "same", "same"));
        List<MultiDiff.FileChange> all = MultiDiff.selectWrites(files, null);
        eq(all.size(), 2, "selectWrites null -> all changed");
        Set<String> pick = new HashSet<String>(Arrays.asList("a.js", "noop.js"));
        List<MultiDiff.FileChange> sub = MultiDiff.selectWrites(files, pick);
        eq(sub.size(), 1, "selectWrites subset drops no-op");
        eq(sub.get(0).path, "a.js", "selectWrites subset content");
        eq(MultiDiff.selectWrites(files, new HashSet<String>()).size(), 0, "empty selection writes nothing");
    }

    private static void mentions() {
        System.out.println("Mentions:");
        // detectAtToken: at start / after space / bracket; glued @ is NOT a mention.
        Mentions.AtToken t = Mentions.detectAtToken("see @src/ap");
        check(t != null && t.prefix.equals("src/ap") && t.start == 4, "detectAtToken after space");
        Mentions.AtToken t2 = Mentions.detectAtToken("@a");
        check(t2 != null && t2.prefix.equals("a") && t2.start == 0, "detectAtToken at start");
        check(Mentions.detectAtToken("user@host") == null, "glued @ is not a mention");
        check(Mentions.detectAtToken("done @x ") == null, "no token when not at caret");

        // filterFiles: basename-prefix first, then path-prefix, then substring; case-insensitive.
        List<String> files = Arrays.asList(
                "src/app.js", "src/chat/at-mention.js", "lib/app-helper.js", "README.md");
        List<String> hits = Mentions.filterFiles(files, "app", 20);
        eq(hits.get(0), "src/app.js", "basename-prefix ranks first");
        check(hits.contains("lib/app-helper.js"), "basename-prefix includes app-helper");
        check(!hits.contains("src/chat/at-mention.js"), "no 'app' substring -> excluded");
        // substring match works on a real case:
        check(Mentions.filterFiles(files, "mention", 20).contains("src/chat/at-mention.js"),
                "substring match");
        eq(Mentions.filterFiles(files, "", 2).size(), 2, "empty prefix -> first N");
        check(Mentions.filterFiles(files, "SRC/APP", 20).contains("src/app.js"),
                "case-insensitive path-prefix");

        // ideMentionMatches
        eq(Mentions.ideMentionMatches("").size(), 2, "empty -> both ide mentions");
        eq(Mentions.ideMentionMatches("s"), Arrays.asList("selection"), "@s -> selection");
        eq(Mentions.ideMentionMatches("d"), Arrays.asList("diagnostics"), "@d -> diagnostics");

        // applyMention: splice with trailing space
        Mentions.AtToken at = Mentions.detectAtToken("look @ap");
        Mentions.ApplyResult ap = Mentions.applyMention("look @ap", at, "src/app.js", 8);
        eq(ap.text, "look @src/app.js ", "applyMention text");
        eq(ap.caret, "look @src/app.js ".length(), "applyMention caret");

        // symbolKindLabel + formatSymbolItems + dedupe
        eq(Mentions.symbolKindLabel(11), "function", "kind 11 -> function");
        eq(Mentions.symbolKindLabel(4), "class", "kind 4 -> class");
        eq(Mentions.symbolKindLabel(999), "symbol", "unknown kind -> symbol");
        List<Mentions.Symbol> syms = Arrays.asList(
                new Mentions.Symbol("handleClick", 11, "C:\\ws\\src\\ui\\button.ts"),
                new Mentions.Symbol("", 4, "C:\\ws\\x.ts"),         // nameless -> skipped
                new Mentions.Symbol("Widget", 4, "C:\\ws\\src\\widget.ts"));
        List<Mentions.MentionItem> items = Mentions.formatSymbolItems(syms, "C:\\ws", 8);
        eq(items.size(), 2, "formatSymbolItems skips nameless");
        eq(items.get(0).label, "function handleClick · src/ui/button.ts", "symbol label + relpath");
        eq(items.get(0).value, "src/ui/button.ts", "symbol value = relpath");

        // dedupeMentionItems: keep first per value
        List<Mentions.MentionItem> mixed = Arrays.asList(
                Mentions.MentionItem.path("src/app.js"),
                Mentions.MentionItem.symbol("function foo · src/app.js", "src/app.js"), // dup value
                Mentions.MentionItem.symbol("class Bar · src/bar.js", "src/bar.js"));
        List<Mentions.MentionItem> deduped = Mentions.dedupeMentionItems(mixed);
        eq(deduped.size(), 2, "dedupe by inserted value");
        eq(deduped.get(0).value, "src/app.js", "dedupe keeps first");
        eq(Mentions.mentionLabel(deduped.get(1)), "class Bar · src/bar.js", "mentionLabel");
        eq(Mentions.mentionValue(deduped.get(1)), "src/bar.js", "mentionValue");

        // formatInsertReference (§5 @file#L line ranges) — 0-based in, 1-based inclusive out
        eq(Mentions.formatInsertReference("src/app.ts", 0, 0, 0, 0), "@src/app.ts",
                "no selection -> bare @path");
        eq(Mentions.formatInsertReference("src/app.ts", 6, 2, 6, 9), "@src/app.ts#L7",
                "single line -> #L7");
        eq(Mentions.formatInsertReference("src/app.ts", 4, 0, 9, 3), "@src/app.ts#L5-10",
                "multi-line range -> #L5-10");
        eq(Mentions.formatInsertReference("src/app.ts", 4, 0, 9, 0), "@src/app.ts#L5-9",
                "trailing col-0 line dropped -> #L5-9");
        eq(Mentions.formatInsertReference("a.txt", 2, 0, 3, 0), "@a.txt#L3",
                "whole single line via col-0 end -> #L3");
    }

    private static void sessionArgs() {
        System.out.println("SessionArgs:");
        // permission mode → --permission-mode for the hands-off modes only
        eq(SessionArgs.build(null, null, null, "acceptEdits"),
                Arrays.asList("--permission-mode", "acceptEdits"), "mode acceptEdits");
        eq(SessionArgs.build(null, null, null, "bypassPermissions"),
                Arrays.asList("--permission-mode", "bypassPermissions"), "mode bypassPermissions");
        eq(SessionArgs.build(null, null, null, "default"),
                new ArrayList<String>(), "mode default -> no flag");
        eq(SessionArgs.build(null, null, null, "nonsense"),
                new ArrayList<String>(), "unknown mode -> no flag");
        eq(SessionArgs.build(null, null, null, null),
                new ArrayList<String>(), "null mode -> no flag");
        // composed after provider/model/resume, blanks omitted
        eq(SessionArgs.build("ollama", "qwen2.5:7b", "sess-1", "acceptEdits"),
                Arrays.asList("--provider", "ollama", "--model", "qwen2.5:7b",
                        "--resume", "sess-1", "--permission-mode", "acceptEdits"),
                "composed args order");
        eq(SessionArgs.build("  ", "", null, "default"),
                new ArrayList<String>(), "all blank -> empty");
        check(SessionArgs.PERMISSION_MODES.contains("acceptEdits")
                && !SessionArgs.PERMISSION_MODES.contains("default"),
                "PERMISSION_MODES allow-list (no 'default')");
        // extended thinking flag (on -> --think, ultra -> --ultrathink, else none)
        eq(SessionArgs.build(null, null, null, "default", "on"),
                Arrays.asList("--think"), "think on -> --think");
        eq(SessionArgs.build(null, null, null, "default", "ultra"),
                Arrays.asList("--ultrathink"), "think ultra -> --ultrathink");
        eq(SessionArgs.build(null, null, null, "default", "off"),
                new ArrayList<String>(), "think off -> no flag");
        eq(SessionArgs.build(null, null, null, "default", null),
                new ArrayList<String>(), "think null -> no flag");
        eq(SessionArgs.build("anthropic", null, "s1", "acceptEdits", "ultra"),
                Arrays.asList("--provider", "anthropic", "--resume", "s1",
                        "--permission-mode", "acceptEdits", "--ultrathink"),
                "mode + think composed");
        eq(SessionArgs.build(null, null, null, "default"),
                new ArrayList<String>(), "4-arg overload still works");
    }

    private static void introspectArgs() {
        System.out.println("IntrospectArgs:");
        // --json only for context, never for cost
        eq(IntrospectArgs.build("context", "s1", null, null, true),
                Arrays.asList("context", "s1", "--json"), "context --json");
        eq(IntrospectArgs.build("context", "s1", "m", "p", true),
                Arrays.asList("context", "s1", "--model", "m", "--provider", "p", "--json"),
                "context with model/provider/json");
        eq(IntrospectArgs.build("cost", "s1", null, null, true),
                Arrays.asList("cost", "s1"), "cost ignores json");

        // parseContextStatus: derive total/window/pct/overflow from cc context --json
        IntrospectArgs.ContextStatus ok = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":200000,\"totalTokens\":12000}");
        check(ok != null && ok.total == 12000 && ok.window == 200000
                && ok.pct == 6 && !ok.overflow, "parse ok -> 6% no overflow");
        IntrospectArgs.ContextStatus over = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":1000,\"totalTokens\":1500}");
        check(over != null && over.pct == 150 && over.overflow, "overflow by ratio");
        IntrospectArgs.ContextStatus flag = IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":1000,\"totalTokens\":10,\"overflows\":true}");
        check(flag != null && flag.overflow, "overflow by 'overflows' field");
        // null cases
        check(IntrospectArgs.parseContextStatus("not json") == null, "bad JSON -> null");
        check(IntrospectArgs.parseContextStatus("") == null, "empty -> null");
        check(IntrospectArgs.parseContextStatus("{\"totalTokens\":5}") == null,
                "missing window -> null");
        check(IntrospectArgs.parseContextStatus(
                "{\"contextWindow\":0,\"totalTokens\":5}") == null, "zero window -> null");
    }

    private static void llmConfig() {
        System.out.println("LlmConfig.parseLlmProviderModel:");
        // THE FIX: the panel pins provider/model from ~/.chainlesschain/config.json
        // so it can't drift to a stale ambient default (the anthropic-401 bug).
        String[] full = LlmConfig.parseLlmProviderModel(
                "{\"llm\":{\"provider\":\"volcengine\",\"model\":\"doubao-seed-1-6\"}}");
        eq(full[0], "volcengine", "provider parsed");
        eq(full[1], "doubao-seed-1-6", "model parsed");
        // provider only (no model) → model null, provider still pinned
        String[] provOnly = LlmConfig.parseLlmProviderModel("{\"llm\":{\"provider\":\"ollama\"}}");
        eq(provOnly[0], "ollama", "provider-only provider");
        eq(provOnly[1], null, "provider-only model null");
        // blanks → null (SessionArgs then omits the flag → CLI resolves)
        String[] blank = LlmConfig.parseLlmProviderModel("{\"llm\":{\"provider\":\"  \"}}");
        eq(blank[0], null, "blank provider -> null");
        // no llm block / bad json → {null,null}
        eq(LlmConfig.parseLlmProviderModel("{}")[0], null, "no llm -> null");
        eq(LlmConfig.parseLlmProviderModel("not json")[0], null, "bad json -> null");
    }

    private static void slashCommands() {
        System.out.println("SlashCommands:");
        // detectSlashToken: only a bare leading slash token (whole input so far)
        eq(SlashCommands.detectSlashToken("/co"), "co", "/co -> co");
        eq(SlashCommands.detectSlashToken("/"), "", "/ -> empty (all)");
        eq(SlashCommands.detectSlashToken("  /TH"), "th", "lowercased + leading ws");
        check(SlashCommands.detectSlashToken("/cost x") == null, "full cmd + arg -> null");
        check(SlashCommands.detectSlashToken("hi /x") == null, "mid-line slash -> null");
        check(SlashCommands.detectSlashToken("") == null, "empty -> null");
        // filter: prefix-matches command name (sans '/'), in menu order
        List<String[]> co = SlashCommands.filter("co");
        check(co.size() == 3, "filter co -> /compact /context /cost (3)");
        eq(co.get(0)[0], "/compact", "co first = /compact (menu order)");
        List<String[]> comp = SlashCommands.filter("comp");
        check(comp.size() == 1 && comp.get(0)[0].equals("/compact"), "comp -> only /compact");
        eq(SlashCommands.filter("").size(), SlashCommands.COMMANDS.size(), "empty prefix -> all");
        check(SlashCommands.filter("zzz").isEmpty(), "no match -> empty");
        // label
        eq(SlashCommands.label(new String[] { "/cost", "token cost" }),
                "/cost  —  token cost", "label format");
    }

    private static void fixWithCc() {
        System.out.println("FixWithCc:");
        FixWithCc.Diag e = new FixWithCc.Diag(12, "Error", "Cannot find symbol foo", "javac", "compiler.err");
        eq(FixWithCc.formatDiagnosticLine(e),
                "- [Error] line 13: Cannot find symbol foo (javac compiler.err)",
                "diagnostic line (0→1-based, source+code)");
        // whitespace collapse in message
        FixWithCc.Diag w = new FixWithCc.Diag(0, "Warning", "unused\n   import", null, null);
        eq(FixWithCc.formatDiagnosticLine(w), "- [Warning] line 1: unused import",
                "message whitespace collapsed");
        // full prompt: @file reference + bullets
        java.util.List<FixWithCc.Diag> ds = java.util.Arrays.asList(e, w);
        String prompt = FixWithCc.formatFixPrompt("src\\Main.java", ds);
        check(prompt.startsWith("Fix the following problems in @src/Main.java"),
                "prompt: @-ref with forward slashes + plural");
        check(prompt.contains("line 13") && prompt.contains("line 1"),
                "prompt lists both problems");
        check(prompt.endsWith("\n"), "prompt ends with newline");
        // singular noun + no path → "this file"
        String one = FixWithCc.formatFixPrompt("", java.util.Arrays.asList(e));
        check(one.startsWith("Fix the following problem in this file"),
                "singular + no path → this file");
        // empty → ""
        eq(FixWithCc.formatFixPrompt("x", new java.util.ArrayList<FixWithCc.Diag>()), "",
                "no diagnostics → empty prompt");
        // title
        eq(FixWithCc.buildFixActionTitle(3), "Fix 3 problems with ChainlessChain", "counted title");
        eq(FixWithCc.buildFixActionTitle(1), "Fix with ChainlessChain", "singular title");
    }

    private static void markdownLite() {
        System.out.println("MarkdownLite:");
        // plain text → single TEXT span
        eq(MarkdownLite.parse("hello world"),
                java.util.Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "hello world")),
                "plain → one TEXT span");
        // inline code
        eq(MarkdownLite.parse("run `npm test` now"),
                java.util.Arrays.asList(
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "run "),
                        new MarkdownLite.Span(MarkdownLite.Kind.CODE, "npm test"),
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, " now")),
                "inline `code`");
        // bold
        eq(MarkdownLite.parse("a **bold** b"),
                java.util.Arrays.asList(
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "a "),
                        new MarkdownLite.Span(MarkdownLite.Kind.BOLD, "bold"),
                        new MarkdownLite.Span(MarkdownLite.Kind.TEXT, " b")),
                "**bold**");
        // fenced code with a language tag (tag line dropped)
        java.util.List<MarkdownLite.Span> fenced =
                MarkdownLite.parse("see:\n```java\nint x = 1;\n```\ndone");
        check(fenced.size() == 3, "fenced → TEXT + CODE + TEXT");
        eq(fenced.get(1).kind, MarkdownLite.Kind.CODE, "middle span is CODE");
        eq(fenced.get(1).text, "int x = 1;\n", "code body keeps newline, drops lang tag");
        // unclosed markers degrade to plain (never lose chars)
        eq(MarkdownLite.parse("a `b c"),
                java.util.Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "a `b c")),
                "unclosed backtick → plain");
        eq(MarkdownLite.parse("x **y"),
                java.util.Arrays.asList(new MarkdownLite.Span(MarkdownLite.Kind.TEXT, "x **y")),
                "unclosed bold → plain");
        // round-trip: concatenated span texts == input minus markers
        String md = "use `f()` and **g** in ```py\ncode\n```";
        StringBuilder rebuilt = new StringBuilder();
        for (MarkdownLite.Span s : MarkdownLite.parse(md)) rebuilt.append(s.text);
        eq(rebuilt.toString(), "use f() and g in code\n", "spans lose only the markers");
        // empty / null
        check(MarkdownLite.parse("").isEmpty(), "empty → no spans");
        check(MarkdownLite.parse(null).isEmpty(), "null → no spans");
    }
}
