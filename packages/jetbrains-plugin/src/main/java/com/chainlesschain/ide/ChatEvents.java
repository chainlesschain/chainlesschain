package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Map the CLI's stream-json NDJSON events onto the small message vocabulary
 * the chat tool window renders — the Java twin of the VS Code extension's
 * {@code chat/chat-events.js} (same kinds, same delta-dedup rule, so the two
 * IDE panels stay behaviorally identical).
 *
 * UI message kinds: init / delta / tool / tool_done / info / turn_end /
 * approval / approval_done / plan / error. Pure JDK, headless-testable.
 */
public final class ChatEvents {
    private ChatEvents() {}

    /** Per-conversation state: did text stream via deltas this turn? */
    public static final class TurnState {
        public boolean sawDelta;
    }

    /** One-line argument summary for the tool trace (mirrors the CLI). */
    public static String summarizeToolArgs(Object args) {
        if (!(args instanceof Map)) return "";
        Map<?, ?> m = (Map<?, ?>) args;
        Object s = first(m, "path", "command", "pattern", "query", "url", "code");
        if (s == null) return "";
        String str = String.valueOf(s);
        return str.length() > 80 ? str.substring(0, 80) + "…" : str;
    }

    private static Object first(Map<?, ?> m, String... keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v != null && !"".equals(v)) return v;
        }
        return null;
    }

    private static String str(Map<String, Object> m, String key, String dflt) {
        Object v = m.get(key);
        return v == null ? dflt : String.valueOf(v);
    }

    private static boolean isTrue(Object v) {
        return Boolean.TRUE.equals(v);
    }

    private static Map<String, Object> ui(String kind) {
        Map<String, Object> m = MiniJson.obj();
        m.put("kind", kind);
        return m;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object v) {
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /**
     * @return a UI message map (key {@code kind}), or null when the event is
     *         UI-silent (token_usage, iteration_warning, …).
     */
    public static Map<String, Object> mapAgentEvent(
            Map<String, Object> evt, TurnState state) {
        if (evt == null) return null;
        String type = str(evt, "type", "");
        if ("system".equals(type)) {
            if ("init".equals(str(evt, "subtype", ""))) {
                Map<String, Object> m = ui("init");
                m.put("model", str(evt, "model", ""));
                m.put("provider", str(evt, "provider", ""));
                m.put("sessionId", str(evt, "session_id", ""));
                return m;
            }
            return null;
        }
        if ("stream_event".equals(type)) {
            Map<String, Object> event = asMap(evt.get("event"));
            Map<String, Object> delta = event == null ? null : asMap(event.get("delta"));
            if (delta != null
                    && "text_delta".equals(str(delta, "type", ""))
                    && delta.get("text") instanceof String) {
                state.sawDelta = true;
                Map<String, Object> m = ui("delta");
                m.put("text", delta.get("text"));
                return m;
            }
            // Extended-thinking reasoning delta (Anthropic; only when /think is on)
            // → a dimmed "thinking" line, like the VS Code panel.
            if (delta != null
                    && "thinking_delta".equals(str(delta, "type", ""))
                    && delta.get("thinking") instanceof String) {
                Map<String, Object> m = ui("thinking");
                m.put("text", delta.get("thinking"));
                return m;
            }
            return null;
        }
        if ("tool_use".equals(type)) {
            Map<String, Object> m = ui("tool");
            m.put("tool", str(evt, "tool", "?"));
            m.put("summary", summarizeToolArgs(evt.get("args")));
            return m;
        }
        if ("tool_result".equals(type)) {
            Map<String, Object> m = ui("tool_done");
            m.put("tool", str(evt, "tool", "?"));
            m.put("isError", isTrue(evt.get("is_error")));
            return m;
        }
        if ("compaction".equals(type)) {
            Map<String, Object> stats = asMap(evt.get("stats"));
            Object saved = stats == null ? null : stats.get("saved");
            Map<String, Object> m = ui("info");
            m.put("text", "compacted: saved " + (saved == null ? "?" : saved) + " tokens");
            return m;
        }
        if ("result".equals(type)) {
            boolean sawDelta = state.sawDelta;
            state.sawDelta = false; // reset for the next turn
            Map<String, Object> m = ui("turn_end");
            if ("interrupted".equals(str(evt, "subtype", ""))
                    || isTrue(evt.get("interrupted"))) {
                m.put("isError", false);
                m.put("text", "⏹ interrupted");
                m.put("usage", null);
                return m;
            }
            boolean isError = isTrue(evt.get("is_error"));
            m.put("isError", isError);
            Object text;
            if (isError) {
                text = evt.get("error") != null ? evt.get("error")
                        : evt.get("result") != null ? evt.get("result") : "turn failed";
            } else {
                // If text streamed via deltas, the final result repeats it — drop.
                text = sawDelta ? null : evt.get("result");
            }
            m.put("text", text);
            m.put("usage", evt.get("usage"));
            return m;
        }
        if ("approval_request".equals(type)) {
            Map<String, Object> m = ui("approval");
            m.put("id", evt.get("id"));
            m.put("tool", evt.get("tool"));
            m.put("command", evt.get("command"));
            m.put("risk", evt.get("risk"));
            m.put("rule", evt.get("rule"));
            m.put("reason", evt.get("reason"));
            return m;
        }
        if ("approval_resolved".equals(type)) {
            Map<String, Object> m = ui("approval_done");
            m.put("id", evt.get("id"));
            m.put("approved", isTrue(evt.get("approved")));
            m.put("via", evt.get("via"));
            return m;
        }
        if ("plan_update".equals(type)) {
            Map<String, Object> m = ui("plan");
            m.put("active", isTrue(evt.get("active")));
            m.put("state", evt.get("state"));
            m.put("items", evt.get("items") instanceof List ? evt.get("items") : new ArrayList<>());
            m.put("risk", evt.get("risk"));
            m.put("note", evt.get("note"));
            return m;
        }
        if ("session_error".equals(type)) {
            Map<String, Object> m = ui("error");
            Object err = evt.get("error");
            m.put("text", err == null ? "agent session error" : String.valueOf(err));
            return m;
        }
        if ("raw".equals(type)) {
            Map<String, Object> m = ui("info");
            m.put("text", str(evt, "text", ""));
            return m;
        }
        return null;
    }

    /**
     * Extra CLI args from settings + stored session. Empty values fall through
     * to the CLI's own config defaults; {@code resume} makes the CLI rebuild
     * that conversation so the panel survives IDE restarts with full context.
     */
    public static List<String> buildSessionArgs(
            String provider, String model, String resume) {
        List<String> args = new ArrayList<>();
        if (provider != null && !provider.trim().isEmpty()) {
            args.add("--provider");
            args.add(provider.trim());
        }
        if (model != null && !model.trim().isEmpty()) {
            args.add("--model");
            args.add(model.trim());
        }
        if (resume != null && !resume.trim().isEmpty()) {
            args.add("--resume");
            args.add(resume.trim());
        }
        return args;
    }
}
