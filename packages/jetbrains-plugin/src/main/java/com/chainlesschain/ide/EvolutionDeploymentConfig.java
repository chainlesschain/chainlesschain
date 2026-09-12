package com.chainlesschain.ide;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Fixed argv and fail-closed parsing for the shared cc evolution deployment profile. */
public final class EvolutionDeploymentConfig {
    private EvolutionDeploymentConfig() {}

    /** Display-only admission; no runtime authority is inferred from this value. */
    public record Admission(String state, String detail, String remediation) {
        public boolean known() { return !"unknown".equals(state); }
        public boolean admitted() { return "admitted".equals(state); }
    }

    public record Status(boolean effectiveEnabled, boolean profileEnabled,
                         boolean verified, String source, String descriptorPath,
                         String trustRootPath, String profilePath, String error,
                         List<String> commands, Map<String, Admission> readiness) {}

    public static List<String> statusArgs() {
        return List.of("evolution", "deployment", "status", "--json");
    }

    public static List<String> configureArgs(String descriptorPath, String trustRootPath) {
        if (descriptorPath == null || descriptorPath.isBlank()
                || trustRootPath == null || trustRootPath.isBlank()) {
            throw new IllegalArgumentException("Descriptor and trust-root paths are required");
        }
        return List.of("evolution", "deployment", "configure", "--descriptor",
                descriptorPath.trim(), "--trust-root", trustRootPath.trim(), "--json");
    }

    public static List<String> toggleArgs(boolean enabled) {
        return List.of("evolution", "deployment", enabled ? "enable" : "disable", "--json");
    }

    public static Status parseStatus(String json) {
        Map<String, Object> value = MiniJson.parseObject(json == null ? "" : json.trim());
        if (Boolean.FALSE.equals(value.get("ok"))) {
            throw new IllegalArgumentException(text(value.get("error")));
        }
        List<String> commands = new ArrayList<>();
        Object rawCommands = value.get("commands");
        if (rawCommands instanceof List<?> list) {
            for (Object command : list) if (command instanceof String s) commands.add(s);
        }
        return new Status(Boolean.TRUE.equals(value.get("effectiveEnabled")),
                Boolean.TRUE.equals(value.get("profileEnabled")),
                Boolean.TRUE.equals(value.get("verified")), text(value.get("source")),
                text(value.get("descriptorPath")), text(value.get("trustRootPath")),
                text(value.get("profilePath")), text(value.get("error")), List.copyOf(commands),
                Map.of("ask", parseAdmission(value.get("readiness"), "ask"),
                        "agent", parseAdmission(value.get("readiness"), "agent")));
    }

    private static Admission parseAdmission(Object raw, String command) {
        Admission unknown = new Admission("unknown", null, null);
        if (!(raw instanceof Map<?, ?> entries) || !(entries.get(command) instanceof Map<?, ?> value))
            return unknown;
        String state = text(value.get("state"));
        boolean admitted = "admitted".equals(state);
        boolean known = "deployment-admission".equals(value.get("scope"))
                && "not_checked".equals(value.get("runtimeVerification"))
                && value.get("requiredCommands") instanceof List<?> required && required.contains(command)
                && (admitted
                    ? Boolean.TRUE.equals(value.get("ready")) && value.containsKey("taskReady") && value.get("taskReady") == null
                    : state != null && List.of("not_configured", "disabled", "invalid", "command_not_allowed").contains(state)
                        && Boolean.FALSE.equals(value.get("ready")) && Boolean.FALSE.equals(value.get("taskReady")));
        return known ? new Admission(state, text(value.get("detail")), text(value.get("remediation"))) : unknown;
    }

    public static Status run(List<String> args, File cwd, long timeoutMs) {
        String output = AgentChatSession.runCapture(args, cwd, timeoutMs);
        if (output == null || output.isBlank()) {
            throw new IllegalStateException("cc did not return a configuration result; update the CLI and retry");
        }
        return parseStatus(output);
    }

    private static String text(Object value) {
        return value instanceof String s && !s.isBlank() ? s : null;
    }
}
