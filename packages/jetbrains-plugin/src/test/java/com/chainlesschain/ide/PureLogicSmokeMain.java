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
 *   javac --release 17 -encoding UTF-8 -d .smoke-out \
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
        cliVersionCheck();
        binaryResolution();
        cliLauncher();
        fixWithCc();
        markdownLite();
        transcriptCap();
        lockfilePrune();
        jetbrainsMcpProbe();

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
        // FULL block (7-arg): --base-url + --api-key passed so a cloud provider's
        // endpoint/key isn't dropped (the "配置了火山却 fetch failed" root-cure).
        eq(SessionArgs.build("volcengine", "doubao-x",
                        "https://ark.cn-beijing.volces.com/api/v3", "sk-volc",
                        "sess-1", "default", null),
                Arrays.asList("--provider", "volcengine", "--model", "doubao-x",
                        "--base-url", "https://ark.cn-beijing.volces.com/api/v3",
                        "--api-key", "sk-volc", "--resume", "sess-1"),
                "full block: base-url + api-key in order");
        eq(SessionArgs.build("ollama", "m", "  ", "", "s1", "default", null),
                Arrays.asList("--provider", "ollama", "--model", "m",
                        "--resume", "s1"),
                "blank base-url/api-key omitted (back-compat)");
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

        // looksLikeLlmConfigError: nudge to the wizard only on auth/key failures.
        check(LlmConfig.looksLikeLlmConfigError("Anthropic error: 401"), "401 -> config error");
        check(LlmConfig.looksLikeLlmConfigError("ANTHROPIC_API_KEY required"), "api key -> config error");
        check(LlmConfig.looksLikeLlmConfigError("403 Forbidden"), "403 -> config error");
        check(!LlmConfig.looksLikeLlmConfigError("network timeout"), "network -> not config error");
        check(!LlmConfig.looksLikeLlmConfigError(null), "null -> not config error");

        // suggestVisionModel: volcengine has a distinct vision model; others blank.
        eq(LlmConfig.suggestVisionModel("volcengine"), "doubao-seed-2-0-lite-260215", "volcengine vision");
        eq(LlmConfig.suggestVisionModel("ollama"), "", "ollama vision blank");

        // buildConfigSetArgs: visionModel adds one set; blank omits it.
        java.util.List<java.util.List<String>> withVis = LlmConfig.buildConfigSetArgs(
                "volcengine", "doubao-seed-1-6", "k", "https://x", "doubao-vision");
        boolean hasVision = false;
        for (java.util.List<String> s : withVis) {
            if (s.size() >= 4 && "llm.visionModel".equals(s.get(2)) && "doubao-vision".equals(s.get(3))) {
                hasVision = true;
            }
        }
        check(hasVision, "buildConfigSetArgs emits llm.visionModel");
        int noVis = LlmConfig.buildConfigSetArgs("ollama", "m", "", "u", "").size();
        int yesVis = LlmConfig.buildConfigSetArgs("ollama", "m", "", "u", "v").size();
        check(yesVis == noVis + 1, "blank visionModel omitted, set when present");
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
        List<String[]> rev = SlashCommands.filter("rev");
        check(rev.size() == 1 && rev.get(0)[0].equals("/review"), "rev -> only /review");
        // label
        eq(SlashCommands.label(new String[] { "/cost", "token cost" }),
                "/cost  —  token cost", "label format");
    }

    private static void binaryResolution() {
        System.out.println("AgentChatSession.looksLikeCcVersion (cc-conflict resolution):");
        check(AgentChatSession.looksLikeCcVersion("0.162.95"), "bare semver → chainlesschain");
        check(AgentChatSession.looksLikeCcVersion("0.162.95\n"), "trailing newline ok");
        check(AgentChatSession.looksLikeCcVersion("v1.2.3"), "v-prefixed ok");
        check(!AgentChatSession.looksLikeCcVersion("cc (GCC) 12.2.0"), "C compiler banner → reject");
        check(!AgentChatSession.looksLikeCcVersion("Apple clang version 15.0.0"), "clang → reject");
        check(!AgentChatSession.looksLikeCcVersion("Microsoft Windows [Version 10.0.19045]"), "win banner → reject");
        check(!AgentChatSession.looksLikeCcVersion(""), "empty → reject");
        check(!AgentChatSession.looksLikeCcVersion(null), "null → reject");
        check(!AgentChatSession.looksLikeCcVersion("not a version"), "junk → reject");
    }

    private static void cliLauncher() {
        System.out.println("CliLauncher (PATH augmentation — makes cc reachable from the IDE):");
        // Windows: the npm default global prefix (%APPDATA%\npm) is offered — the
        // exact dir whose absence triggers "'cc' is not recognized".
        java.util.Map<String, String> win = new java.util.HashMap<String, String>();
        win.put("APPDATA", "C:\\Users\\u\\AppData\\Roaming");
        win.put("ProgramFiles", "C:\\Program Files");
        java.util.List<String> wd = CliLauncher.candidateBinDirs(win, true);
        check(wd.contains("C:\\Users\\u\\AppData\\Roaming\\npm"), "win: %APPDATA%\\npm offered");
        check(wd.contains("C:\\Program Files\\nodejs"), "win: ProgramFiles\\nodejs offered");
        // posix: homebrew + npm-global covered
        java.util.Map<String, String> nix = new java.util.HashMap<String, String>();
        nix.put("HOME", "/home/u");
        java.util.List<String> nd = CliLauncher.candidateBinDirs(nix, false);
        check(nd.contains("/usr/local/bin") && nd.contains("/opt/homebrew/bin"), "posix: brew dirs offered");
        check(nd.contains("/home/u/.npm-global/bin"), "posix: ~/.npm-global/bin offered");
        // node version managers take precedence (active node's bin)
        java.util.Map<String, String> nvm = new java.util.HashMap<String, String>();
        nvm.put("HOME", "/home/u");
        nvm.put("NVM_BIN", "/home/u/.nvm/versions/node/v22.0.0/bin");
        check(CliLauncher.candidateBinDirs(nvm, false).get(0).equals("/home/u/.nvm/versions/node/v22.0.0/bin"),
                "posix: NVM_BIN listed first");
        // augmentedPath appends missing dirs, dedups, preserves existing order
        eq(CliLauncher.augmentedPath("/usr/bin", java.util.Arrays.asList("/opt/x", "/usr/bin"), ':'),
                "/usr/bin:/opt/x", "append new dir, drop duplicate, keep order");
        eq(CliLauncher.augmentedPath(null, java.util.Arrays.asList("/a", "/b"), ':'),
                "/a:/b", "null PATH → just the candidates");
        // missing-cli detection across the OS-specific shell messages
        check(CliLauncher.looksLikeMissingCli("'cc' is not recognized as an internal or external command"),
                "win 'not recognized' → missing");
        check(CliLauncher.looksLikeMissingCli("/bin/sh: cc: command not found"), "posix 'command not found' → missing");
        check(CliLauncher.looksLikeMissingCli("Cannot run program \"cc\": error=2, No such file or directory"),
                "java CreateProcess error=2 → missing");
        check(!CliLauncher.looksLikeMissingCli("llm.provider = volcengine"), "normal output → not missing");
        check(!CliLauncher.looksLikeMissingCli(null), "null → not missing");
        check(CliLauncher.missingCliMessage().contains("npm i -g chainlesschain"), "guidance names the install command");
        check(CliLauncher.missingCliMessage().contains("22.12.0"), "guidance names the Node.js floor");
    }

    private static void cliVersionCheck() {
        System.out.println("CliVersionCheck:");
        eq(CliVersionCheck.parseVersion("chainlesschain 0.162.80\n"), "0.162.80",
                "parse from cc --version output");
        check(CliVersionCheck.parseVersion("no version here") == null, "junk -> null");
        check(CliVersionCheck.compare("0.162.80", "0.162.93") < 0, "older < newer");
        check(CliVersionCheck.compare("0.162.93", "0.162.93") == 0, "equal");
        check(CliVersionCheck.compare("0.163.0", "0.162.99") > 0, "newer > older");
        eq(CliVersionCheck.parseNpmLatest("{\"name\":\"chainlesschain\",\"version\":\"0.162.93\"}"),
                "0.162.93", "parseNpmLatest pulls version");
        check(CliVersionCheck.parseNpmLatest("{}") == null, "no version field -> null");
        String notice = CliVersionCheck.updateNotice("0.162.80", "0.162.93");
        check(notice != null && notice.contains("0.162.93"), "trails latest -> notice mentions latest");
        check(CliVersionCheck.updateNotice("0.162.93", "0.162.93") == null, "up to date -> null");
        check(CliVersionCheck.updateNotice("0.163.0", "0.162.93") == null, "ahead -> null");
        check(CliVersionCheck.updateNotice(null, "0.162.93") == null, "unknown installed -> null");
        check(CliVersionCheck.updateNotice("0.162.80", null) == null, "no npm latest -> null");
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

    private static void lockfilePrune() {
        System.out.println("LockfileWriter.pruneStale:");
        java.nio.file.Path tmp = null;
        try {
            tmp = java.nio.file.Files.createTempDirectory("ide-prune-");
            // Only pid 100 is "alive"; 200 is dead.
            LockfileWriter w = new LockfileWriter(tmp, pid -> pid == 100L);
            w.write(1, "t", java.util.Collections.singletonList("/ws"), "http://x", 0L, 100L);
            w.write(2, "t", java.util.Collections.singletonList("/ws"), "http://x", 0L, 200L);
            java.nio.file.Files.write(tmp.resolve("3.json"),
                    "{ not json".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            java.nio.file.Files.write(tmp.resolve("4.json"),
                    "{\"port\":4}".getBytes(java.nio.charset.StandardCharsets.UTF_8)); // no pid

            eq(w.pruneStale(), 3, "removes dead + corrupt + pidless");
            check(java.nio.file.Files.exists(tmp.resolve("1.json")), "alive (pid 100) kept");
            check(!java.nio.file.Files.exists(tmp.resolve("2.json")), "dead (pid 200) removed");
            check(!java.nio.file.Files.exists(tmp.resolve("3.json")), "corrupt removed");
            check(!java.nio.file.Files.exists(tmp.resolve("4.json")), "pidless removed");

            // Absent dir → 0.
            eq(new LockfileWriter(tmp.resolve("nope"), pid -> true).pruneStale(), 0, "absent dir → 0");
        } catch (Exception e) {
            check(false, "pruneStale smoke threw: " + e);
        } finally {
            if (tmp != null) {
                try (java.util.stream.Stream<java.nio.file.Path> s = java.nio.file.Files.walk(tmp)) {
                    s.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                        try { java.nio.file.Files.deleteIfExists(p); } catch (Exception ignore) { }
                    });
                } catch (Exception ignore) { }
            }
        }
    }

    private static void transcriptCap() {
        System.out.println("TranscriptCap:");
        final int CAP = 100;
        // Within / at the cap → nothing removed.
        check(TranscriptCap.removeCount(50, -1, false, CAP) == 0, "under cap → 0");
        check(TranscriptCap.removeCount(100, -1, false, CAP) == 0, "exactly cap → 0");
        check(TranscriptCap.removeCount(0, -1, false, CAP) == 0, "empty doc → 0");
        // Over cap, no active run → trim exactly the overflow from the front.
        check(TranscriptCap.removeCount(150, -1, false, CAP) == 50, "over cap, no run → excess");
        // Over cap during a run → never trim past the run start.
        check(TranscriptCap.removeCount(150, 30, true, CAP) == 30, "run at 30 → capped at runStart");
        check(TranscriptCap.removeCount(150, 80, true, CAP) == 50, "run at 80 → full excess (< runStart)");
        check(TranscriptCap.removeCount(150, 0, true, CAP) == 0, "run at 0 → nothing removable");
        check(TranscriptCap.removeCount(150, 30, true, CAP) <= 30, "removeLen ≤ runStart while in run");
        // A stale runStart with inRun=false is ignored (whole prefix is free).
        check(TranscriptCap.removeCount(150, 30, false, CAP) == 50, "not in run → ignore runStart");
        // Degenerate caps.
        check(TranscriptCap.removeCount(10, -1, false, 0) == 10, "cap 0 → remove all");
        check(TranscriptCap.removeCount(10, -1, false, -5) == 10, "negative cap → treated as 0");
        // The default cap is positive and generous.
        check(TranscriptCap.DEFAULT_MAX_CHARS > 0, "default cap > 0");
        check(TranscriptCap.removeCount(TranscriptCap.DEFAULT_MAX_CHARS, -1, false,
                TranscriptCap.DEFAULT_MAX_CHARS) == 0, "exactly default cap → 0");
    }

    private static void jetbrainsMcpProbe() {
        System.out.println("JetbrainsMcpProbe:");
        List<String> c = JetbrainsMcpProbe.candidateUrls();
        // Native MCP range (64342…) is tried before the built-in range (63342…).
        check(c.get(0).equals("http://127.0.0.1:64342/stream"), "first = 64342/stream");
        int i64 = c.indexOf("http://127.0.0.1:64342/stream");
        int i63 = c.indexOf("http://127.0.0.1:63342/stream");
        check(i64 >= 0 && i63 >= 0 && i64 < i63, "native 64342 before builtin 63342");
        // /stream before /sse for the same port.
        check(c.indexOf("http://127.0.0.1:64342/stream")
                < c.indexOf("http://127.0.0.1:64342/sse"), "/stream before /sse");
        check(c.contains("http://127.0.0.1:64342/mcp"), "/mcp path included");
        check(c.size() == new HashSet<>(c).size(), "no duplicate candidates");
        // 11 ports × 2 ranges × 3 paths = 66.
        check(c.size() == 66, "66 candidates (11+11 ports × 3 paths)");
        // A pinned URL is tried first and never duplicated.
        List<String> p = JetbrainsMcpProbe.candidateUrls("http://127.0.0.1:64342/stream");
        check(p.get(0).equals("http://127.0.0.1:64342/stream"), "pinned url first");
        check(p.size() == 66, "pinned dups collapse (already a candidate)");
        List<String> p2 = JetbrainsMcpProbe.candidateUrls("http://127.0.0.1:9999/custom");
        check(p2.get(0).equals("http://127.0.0.1:9999/custom"), "novel pinned url first");
        check(p2.size() == 67, "novel pinned url adds one");

        // looksLikeMcpResponse: 2xx + handshake marker accepted; others rejected.
        check(JetbrainsMcpProbe.looksLikeMcpResponse(200,
                "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":\"2024-11-05\"}}"),
                "200 + jsonrpc result accepted");
        check(JetbrainsMcpProbe.looksLikeMcpResponse(200,
                "event: message\ndata: {\"jsonrpc\":\"2.0\",\"result\":{\"serverInfo\":{}}}\n"),
                "200 + SSE data line accepted");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(404, "Not Found"), "404 rejected");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(200, "<html>hi</html>"), "200 non-MCP body rejected");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(500,
                "{\"jsonrpc\":\"2.0\"}"), "5xx rejected even with marker");
        check(!JetbrainsMcpProbe.looksLikeMcpResponse(200, null), "null body rejected");

        // selectLiveUrl: first live candidate wins; a throwing probe is skipped.
        List<String> cand = java.util.Arrays.asList("a", "b", "c");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, u -> u.equals("b")), "b", "first live wins");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, u -> false), null, "none live → null");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, u -> {
            if (u.equals("a")) throw new RuntimeException("boom");
            return u.equals("c");
        }), "c", "throwing probe skipped, scan continues");
        eq(JetbrainsMcpProbe.selectLiveUrl(null, u -> true), null, "null candidates → null");
        eq(JetbrainsMcpProbe.selectLiveUrl(cand, null), null, "null prober → null");
    }
}
