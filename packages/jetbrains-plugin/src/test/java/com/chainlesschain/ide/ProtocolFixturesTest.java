package com.chainlesschain.ide;

import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Cross-language protocol fixture contract (JetBrains side).
 *
 * <p>Drives the plugin's real event mapper ({@link ChatEvents#mapAgentEvent})
 * over the SAME shared NDJSON fixtures the TypeScript side uses
 * ({@code packages/agent-sdk/__fixtures__/protocol/}, consumed by
 * {@code protocol-fixtures.test.ts} against the VS Code panel's
 * {@code chat-events.js}). Both panels MUST produce byte-identical UI
 * projections on these files — the fixtures are read directly from the
 * agent-sdk package (never copied, never modified), and {@link
 * #sharedFixturesExistAndAreWellFormed()} fails loudly on drift.
 *
 * <p>The contract is docs/PROTOCOL.md — see the fixtures' README.md for the
 * projection schema and the per-file turn-state rule.
 */
class ProtocolFixturesTest {

    private static final String[] FIXTURE_FILES = {
            "session-lifecycle.ndjson", "assistant-stream.ndjson",
            "tools.ndjson", "interaction.ndjson", "misc.ndjson",
    };

    /** Gradle's test working dir is the plugin dir; tolerate the repo root too. */
    private static Path fixturesDir() {
        for (String root : new String[] {
                "../agent-sdk", "packages/agent-sdk",
                "../../packages/agent-sdk" }) {
            Path p = Paths.get(root, "__fixtures__", "protocol");
            if (Files.isDirectory(p)) return p;
        }
        throw new AssertionError(
                "shared protocol twin fixtures not found (fixture drift or moved dir?)"
                        + " cwd=" + Paths.get("").toAbsolutePath());
    }

    private static List<Map<String, Object>> readNdjson(String name) {
        List<Map<String, Object>> out = new ArrayList<>();
        try {
            for (String line : Files.readAllLines(
                    fixturesDir().resolve(name), StandardCharsets.UTF_8)) {
                if (line.trim().isEmpty()) continue;
                out.add(MiniJson.parseObject(line));
            }
        } catch (IOException e) {
            throw new AssertionError("cannot read fixture " + name, e);
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> expectedDoc() {
        try {
            return (Map<String, Object>) MiniJson.parse(Files.readString(
                    fixturesDir().resolve("expected.json"), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new AssertionError("cannot read expected.json", e);
        }
    }

    @SuppressWarnings("unchecked")
    private static List<Object> expectedFor(String file) {
        Object v = expectedDoc().get(file);
        assertTrue(v instanceof List, "missing expected for " + file);
        return (List<Object>) v;
    }

    private static Object orNull(Map<String, Object> ui, String key) {
        return ui == null ? null : ui.get(key);
    }

    private static boolean truthy(Object v) {
        return Boolean.TRUE.equals(v);
    }

    /**
     * Stable projection of a UI message map (README §Projection) — the exact
     * Java twin of the TS test's {@code project()}. Keeps only the
     * machine-comparable dimensions; the benign {@code tool_done} note wording
     * (which differs between the panels by design) collapses to {@code hasNote}.
     */
    private static Map<String, Object> project(Map<String, Object> ui) {
        Map<String, Object> p = new LinkedHashMap<>();
        if (ui == null) {
            p.put("kind", null);
            return p;
        }
        String kind = String.valueOf(ui.get("kind"));
        p.put("kind", kind);
        switch (kind) {
            case "init":
                p.put("model", ui.get("model"));
                p.put("provider", ui.get("provider"));
                p.put("sessionId", ui.get("sessionId"));
                break;
            case "delta":
            case "thinking":
                p.put("text", ui.get("text"));
                break;
            case "tool":
                p.put("tool", ui.get("tool"));
                p.put("summary", ui.get("summary"));
                break;
            case "tool_done":
                p.put("tool", ui.get("tool"));
                p.put("isError", truthy(ui.get("isError")));
                p.put("hasNote", ui.get("note") != null);
                break;
            case "turn_end":
                p.put("isError", truthy(ui.get("isError")));
                p.put("text", ui.get("text"));
                p.put("hasUsage", ui.get("usage") != null);
                break;
            case "approval":
                p.put("id", ui.get("id"));
                p.put("tool", orNull(ui, "tool"));
                p.put("command", orNull(ui, "command"));
                p.put("risk", orNull(ui, "risk"));
                p.put("rule", orNull(ui, "rule"));
                p.put("reason", orNull(ui, "reason"));
                break;
            case "approval_done":
                p.put("id", ui.get("id"));
                p.put("approved", truthy(ui.get("approved")));
                p.put("via", ui.get("via"));
                break;
            case "question":
                p.put("id", ui.get("id"));
                p.put("question", ui.get("question"));
                p.put("multiSelect", truthy(ui.get("multiSelect")));
                p.put("hasOptions", ui.get("options") != null);
                p.put("elicitation", truthy(ui.get("elicitation")));
                p.put("server", ui.get("server"));
                p.put("hasSchema", ui.get("requestedSchema") != null);
                break;
            case "plan":
                p.put("active", truthy(ui.get("active")));
                p.put("state", ui.get("state"));
                break;
            case "usage":
                break;
            case "info":
            case "error":
                p.put("text", ui.get("text"));
                break;
            default:
                break;
        }
        return p;
    }

    @Test
    void sharedFixturesExistAndAreWellFormed() {
        // Drift guard: the twin contract lives in the agent-sdk package; a
        // moved/renamed fixture must fail HERE, not silently run zero cases.
        Path dir = fixturesDir();
        for (String f : FIXTURE_FILES) {
            assertTrue(Files.isRegularFile(dir.resolve(f)), "missing fixture " + f);
        }
        assertTrue(Files.isRegularFile(dir.resolve("expected.json")),
                "missing expected.json");
        Map<String, Object> exp = expectedDoc();
        for (String f : FIXTURE_FILES) {
            assertTrue(exp.get(f) instanceof List, "missing expected for " + f);
        }
    }

    @TestFactory
    List<DynamicTest> mapsEachFixtureToExpectedProjections() {
        List<DynamicTest> tests = new ArrayList<>();
        for (String file : FIXTURE_FILES) {
            tests.add(DynamicTest.dynamicTest("maps " + file, () -> {
                List<Map<String, Object>> events = readNdjson(file);
                List<Object> want = expectedFor(file);
                assertEquals(want.size(), events.size(), "line count for " + file);
                // ONE fresh turn-state per file, events fed top-to-bottom.
                ChatEvents.TurnState state = new ChatEvents.TurnState();
                for (int i = 0; i < events.size(); i++) {
                    Map<String, Object> got = project(
                            ChatEvents.mapAgentEvent(events.get(i), state));
                    assertEquals(want.get(i), got,
                            file + " line " + (i + 1));
                }
            }));
        }
        return tests;
    }

    @Test
    void ignoresUnknownEventTypes() {
        ChatEvents.TurnState state = new ChatEvents.TurnState();
        Map<String, Object> evt = new LinkedHashMap<>();
        evt.put("type", "totally_new_event_v9");
        assertNull(ChatEvents.mapAgentEvent(evt, state));
    }

    @Test
    void toleratesAdditiveSeqAndToolIdFields() {
        ChatEvents.TurnState state = new ChatEvents.TurnState();
        Map<String, Object> withMeta = new LinkedHashMap<>();
        withMeta.put("type", "tool_use");
        withMeta.put("id", "tu-9");
        withMeta.put("tool", "read_file");
        withMeta.put("seq", 7L);
        Map<String, Object> args = new LinkedHashMap<>();
        args.put("path", "x");
        withMeta.put("args", args);

        Map<String, Object> withoutMeta = new LinkedHashMap<>();
        withoutMeta.put("type", "tool_use");
        withoutMeta.put("tool", "read_file");
        Map<String, Object> args2 = new LinkedHashMap<>();
        args2.put("path", "x");
        withoutMeta.put("args", args2);

        assertEquals(
                ChatEvents.mapAgentEvent(withoutMeta, state),
                ChatEvents.mapAgentEvent(withMeta, state));
    }
}
