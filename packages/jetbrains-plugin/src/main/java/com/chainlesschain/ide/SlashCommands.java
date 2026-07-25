package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure slash-command manifest + completion/routing helpers for the chat tool
 * window. This mirrors the VS Code panel's {@code slash-commands.js}: menu
 * labels, aliases, help text and execution routes all come from one catalog.
 */
public final class SlashCommands {
    private SlashCommands() {}

    public enum Route {
        LOCAL,
        SESSION,
        CLI,
        HELP
    }

    public static final class Definition {
        public final String name;
        public final String description;
        public final Route route;
        public final String target;
        public final List<String> aliases;

        private Definition(String name, String description, Route route,
                           String target, String... aliases) {
            this.name = name;
            this.description = description;
            this.route = route;
            this.target = target;
            this.aliases = Collections.unmodifiableList(Arrays.asList(aliases));
        }
    }

    private static Definition command(String name, String description,
                                      Route route, String target,
                                      String... aliases) {
        return new Definition(name, description, route, target, aliases);
    }

    /** Canonical command order and wording match the VS Code panel. */
    public static final List<Definition> DEFINITIONS =
            Collections.unmodifiableList(Arrays.asList(
                    command("/new", "start a new conversation", Route.LOCAL, null),
                    command("/clear", "clear this conversation and start fresh",
                            Route.LOCAL, null),
                    command("/sessions", "resume a saved session", Route.LOCAL,
                            null, "/resume"),
                    command("/plan", "enter plan mode", Route.LOCAL, null),
                    command("/approve", "approve the current plan", Route.LOCAL, null),
                    command("/reject", "reject the current plan", Route.LOCAL, null),
                    command("/auto", "auto-accept file edits", Route.LOCAL, null),
                    command("/bypass", "bypass all approvals", Route.LOCAL, null),
                    command("/normal", "normal approvals (default)", Route.LOCAL, null),
                    command("/think", "extended thinking on (Anthropic)",
                            Route.LOCAL, null),
                    command("/ultrathink", "extended thinking, max budget",
                            Route.LOCAL, null),
                    command("/think-off", "extended thinking off", Route.LOCAL, null),
                    command("/stop", "interrupt the running turn", Route.LOCAL, null),
                    command("/compact", "compact the conversation history",
                            Route.LOCAL, null),
                    command("/cost", "token cost for this session", Route.LOCAL, null),
                    command("/context", "context-window usage", Route.LOCAL, null),
                    command("/rewind", "restore a checkpoint", Route.LOCAL, null),
                    command("/retry", "regenerate the last prompt", Route.LOCAL, null),
                    command("/handoff", "hand off to a background agent (web/mobile)",
                            Route.LOCAL, null),
                    command("/review", "review the current git diff", Route.LOCAL, null),
                    command("/goal", "set or show the session completion goal",
                            Route.LOCAL, null),
                    command("/loop",
                            "repeat a prompt on an interval (use /loop stop to stop)",
                            Route.LOCAL, null),
                    command("/status", "show CLI, model, session, IDE and MCP status",
                            Route.SESSION, "status"),
                    command("/doctor", "diagnose this live session",
                            Route.SESSION, "doctor"),
                    command("/init", "initialize project instructions",
                            Route.CLI, "init"),
                    command("/mcp", "show MCP servers connected to this session",
                            Route.SESSION, "mcp"),
                    command("/hooks", "show hooks loaded in this session",
                            Route.SESSION, "hooks"),
                    command("/permissions", "show effective session permissions",
                            Route.SESSION, "permissions"),
                    command("/agents", "show configured agent definitions",
                            Route.SESSION, "agents"),
                    command("/tasks", "show background shell tasks in this session",
                            Route.SESSION, "tasks"),
                    command("/memory", "show project memory loaded in this session",
                            Route.SESSION, "memory"),
                    command("/plugin", "show installed plugin information",
                            Route.CLI, "plugin"),
                    command("/release-notes", "show CLI release notes",
                            Route.CLI, "changelog"),
                    command("/expand", "expand or collapse all reasoning blocks",
                            Route.LOCAL, null),
                    command("/help", "list panel commands", Route.HELP, null)));

    /** {@code [command, one-line help]} consumed by the Swing completion popup. */
    public static final List<String[]> COMMANDS;

    static {
        List<String[]> rows = new ArrayList<>();
        for (Definition definition : DEFINITIONS) {
            rows.add(new String[] { definition.name, definition.description });
        }
        COMMANDS = Collections.unmodifiableList(rows);
    }

    private static final Pattern SLASH =
            Pattern.compile("^\\s*/([a-z-]*)$", Pattern.CASE_INSENSITIVE);

    /**
     * The in-progress slash prefix, or {@code null} when the caret is not on a
     * bare leading slash token. Empty string means just "/" was typed.
     */
    public static String detectSlashToken(String textBeforeCaret) {
        if (textBeforeCaret == null) return null;
        Matcher matcher = SLASH.matcher(textBeforeCaret);
        return matcher.matches()
                ? matcher.group(1).toLowerCase(Locale.ROOT) : null;
    }

    /** Commands whose canonical name starts with {@code prefix}. */
    public static List<String[]> filter(String prefix) {
        String query = prefix == null ? "" : prefix.toLowerCase(Locale.ROOT);
        List<String[]> matches = new ArrayList<>();
        for (String[] row : COMMANDS) {
            if (row[0].substring(1).startsWith(query)) matches.add(row);
        }
        return matches;
    }

    /** Find a canonical command or alias, case-insensitively. */
    public static Definition find(String name) {
        String key = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
        for (Definition definition : DEFINITIONS) {
            if (definition.name.equals(key)
                    || definition.aliases.contains(key)) {
                return definition;
            }
        }
        return null;
    }

    /** Build the live-session protocol event used by the eight session routes. */
    public static Map<String, Object> sessionEvent(
            Definition definition, String args, String requestId) {
        if (definition == null || definition.route != Route.SESSION) return null;
        Map<String, Object> event = MiniJson.obj();
        event.put("type", "slash_command");
        event.put("request_id", requestId == null ? "" : requestId);
        event.put("command", definition.target);
        event.put("args", args == null ? "" : args.trim());
        return event;
    }

    /**
     * Tokenize host-side CLI arguments without invoking a shell. Quotes group
     * values; backslashes stay literal except when escaping the active quote.
     */
    public static List<String> splitArguments(String raw) {
        String text = raw == null ? "" : raw;
        List<String> args = new ArrayList<>();
        StringBuilder token = new StringBuilder();
        Character quote = null;
        boolean started = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (quote != null) {
                if (ch == quote) {
                    quote = null;
                    started = true;
                } else if (ch == '\\' && i + 1 < text.length()
                        && text.charAt(i + 1) == quote) {
                    token.append(text.charAt(++i));
                    started = true;
                } else {
                    token.append(ch);
                    started = true;
                }
            } else if (ch == '"' || ch == '\'') {
                quote = ch;
                started = true;
            } else if (Character.isWhitespace(ch)) {
                if (started) {
                    args.add(token.toString());
                    token.setLength(0);
                    started = false;
                }
            } else {
                token.append(ch);
                started = true;
            }
        }
        if (quote != null) {
            throw new IllegalArgumentException("unterminated quoted argument");
        }
        if (started) args.add(token.toString());
        return args;
    }

    /**
     * Match the VS Code host's allowlist for the three top-level CLI routes.
     * In particular, mutating {@code /plugin} subcommands stay terminal-only.
     *
     * @return null when allowed, otherwise a user-facing validation error
     */
    public static String validateCliArguments(String command, List<String> args) {
        List<String> values = args == null ? Collections.emptyList() : args;
        if ("changelog".equals(command)) return null;
        if ("init".equals(command)) return validateInitArguments(values);
        if ("plugin".equals(command)) return validatePluginArguments(values);
        return "unsupported panel CLI command: " + command;
    }

    private static String validateInitArguments(List<String> args) {
        Set<String> templates = new HashSet<>(Arrays.asList(
                "code-project", "data-science", "devops", "medical-triage",
                "agriculture-expert", "general-assistant", "ai-media-creator",
                "ai-doc-creator", "empty"));
        Set<String> flags = new HashSet<>(Arrays.asList(
                "--force", "--memory", "--yes", "-y", "--bare"));
        for (int i = 0; i < args.size(); i++) {
            String arg = args.get(i);
            if (flags.contains(arg)) continue;
            if (arg.startsWith("--template=")) {
                String template = arg.substring("--template=".length());
                if (!templates.contains(template)) {
                    return "unknown /init template \"" + template + "\"";
                }
                continue;
            }
            if ("--template".equals(arg) || "-t".equals(arg)) {
                String template = i + 1 < args.size() ? args.get(++i) : "";
                if (!templates.contains(template)) {
                    return "unknown /init template \"" + template + "\"";
                }
                continue;
            }
            return "unsupported /init argument \"" + arg + "\". "
                    + "Use --force, --memory, --yes, --bare, or "
                    + "--template <name>.";
        }
        return null;
    }

    private static String validatePluginArguments(List<String> args) {
        if (args.isEmpty()) return null;
        Set<String> defaultListFlags =
                new HashSet<>(Arrays.asList("--enabled", "--json"));
        if (args.get(0).startsWith("-")) {
            return allAllowed(args, defaultListFlags)
                    ? null
                    : "/plugin list only accepts --enabled and --json in chat.";
        }
        String subcommand = args.get(0);
        List<String> rest = args.subList(1, args.size());
        if ("list".equals(subcommand)) {
            return allAllowed(rest, defaultListFlags)
                    ? null
                    : "/plugin list only accepts --enabled and --json in chat.";
        }
        if ("registry".equals(subcommand) || "summary".equals(subcommand)
                || "installed".equals(subcommand)) {
            return allAllowed(rest, Collections.singleton("--json"))
                    ? null
                    : "/plugin " + subcommand
                    + " only accepts --json in chat.";
        }
        if ("info".equals(subcommand) || "search".equals(subcommand)) {
            return onePositionalAndJson(rest)
                    ? null
                    : "/plugin " + subcommand
                    + " requires one name/query and optional --json.";
        }
        if ("options".equals(subcommand)) {
            return onePositionalAndJson(rest)
                    ? null
                    : "/plugin options is read-only in chat: use one plugin "
                    + "name and optional --json; run --set/--scope in a terminal.";
        }
        if ("monitors".equals(subcommand)) {
            return allAllowed(rest, Collections.singleton("--json"))
                    ? null
                    : "/plugin monitors is list-only in chat: --run/--seconds "
                    + "must be run explicitly in a terminal.";
        }
        if ("browse".equals(subcommand)) {
            int queryCount = 0;
            int registryCount = 0;
            for (int i = 0; i < rest.size(); i++) {
                String arg = rest.get(i);
                if ("--json".equals(arg)) continue;
                if ("--registry".equals(arg)) {
                    String value = i + 1 < rest.size() ? rest.get(++i) : "";
                    if (value.isEmpty() || value.startsWith("-")) {
                        return "/plugin browse requires --registry <url>.";
                    }
                    registryCount++;
                    continue;
                }
                if (arg.startsWith("--registry=")
                        && arg.length() > "--registry=".length()) {
                    registryCount++;
                    continue;
                }
                if (arg.startsWith("-")) {
                    return "/plugin browse only accepts an optional query, "
                            + "--registry <url>, and --json in chat; use tokens "
                            + "or insecure registries explicitly in a terminal.";
                }
                queryCount++;
            }
            return registryCount == 1 && queryCount <= 1
                    ? null
                    : "/plugin browse requires exactly one --registry <url> "
                    + "and at most one query.";
        }
        return "/plugin \"" + subcommand + "\" changes local plugin state "
                + "and is not available from chat; run it explicitly in a terminal.";
    }

    private static boolean allAllowed(List<String> args, Set<String> allowed) {
        for (String arg : args) {
            if (!allowed.contains(arg)) return false;
        }
        return true;
    }

    private static boolean onePositionalAndJson(List<String> args) {
        int positional = 0;
        for (String arg : args) {
            if ("--json".equals(arg)) continue;
            if (arg.startsWith("-")) return false;
            positional++;
        }
        return positional == 1;
    }

    /** Full panel help generated from the same manifest as completion/routing. */
    public static String formatHelp() {
        StringBuilder help = new StringBuilder("panel commands:");
        for (Definition definition : DEFINITIONS) {
            help.append("\n  ").append(definition.name);
            for (String alias : definition.aliases) {
                help.append(", ").append(alias);
            }
            help.append(" - ").append(definition.description);
        }
        return help.toString();
    }

    /** "/cmd  —  help" label for the popup. */
    public static String label(String[] row) {
        return row[0] + "  —  " + row[1];
    }
}
