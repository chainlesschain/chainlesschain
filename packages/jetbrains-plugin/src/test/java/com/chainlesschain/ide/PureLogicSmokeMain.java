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
 * ConversationManager (tabs), PreviewDetect (App Preview), MultiDiff (batch
 * diff). No IntelliJ SDK, no cc, no LLM — just plain {@code javac} + {@code java}.
 *
 * Repro (from packages/jetbrains-plugin):
 *   javac --release 8 -encoding UTF-8 -d /tmp/cc-pure \
 *     src/main/java/com/chainlesschain/ide/ConversationManager.java \
 *     src/main/java/com/chainlesschain/ide/PreviewDetect.java \
 *     src/main/java/com/chainlesschain/ide/MultiDiff.java \
 *     src/test/java/com/chainlesschain/ide/PureLogicSmokeMain.java
 *   java -cp /tmp/cc-pure com.chainlesschain.ide.PureLogicSmokeMain
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
}
