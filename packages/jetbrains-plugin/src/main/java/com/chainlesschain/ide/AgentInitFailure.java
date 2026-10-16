package com.chainlesschain.ide;

import java.util.Map;
import java.util.regex.Pattern;

/** Classifies failures before the CLI's system/init without exposing provider text. */
public final class AgentInitFailure {
    private static final Pattern CREDENTIALS = Pattern.compile(
            "(?:\\b(?:401|403|unauthorized|forbidden|authentication|credentials)\\b|invalid.{0,20}api[ _-]?key|api[ _-]?key.{0,20}invalid)",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern ENDPOINT = Pattern.compile(
            "(?:\\bHTTP\\s*404\\b|(?:endpoint|model).{0,80}(?:unsupported|not supported|not found|unavailable)|unsupported.{0,80}(?:endpoint|model))",
            Pattern.CASE_INSENSITIVE);

    private AgentInitFailure() {}

    public static String fromEarlyEvent(Map<String, Object> event) {
        if (event == null) return null;
        Object type = event.get("type");
        if ("session_error".equals(type)) {
            return "Agent process failed to initialize; check the CLI installation and Doctor. Input was not dispatched";
        }
        if (!"result".equals(type) || !Boolean.TRUE.equals(event.get("is_error"))) return null;
        String reason = String.valueOf(event.get("error") != null ? event.get("error") : event.get("result"));
        if (CREDENTIALS.matcher(reason).find()) {
            return "Agent failed to initialize: provider credentials were rejected; check provider settings. Input was not dispatched";
        }
        if (ENDPOINT.matcher(reason).find()) {
            return "Agent failed to initialize: provider endpoint or model is unavailable; check the configured endpoint and model. Input was not dispatched";
        }
        return "Agent failed to initialize; check Doctor. Input was not dispatched";
    }

    public static String processStart() {
        return "Agent process could not start; check the CLI installation and Doctor. Input was not dispatched";
    }

    public static String earlyExit() {
        return "Agent exited before initialization; check Doctor. Input was not dispatched";
    }
}
