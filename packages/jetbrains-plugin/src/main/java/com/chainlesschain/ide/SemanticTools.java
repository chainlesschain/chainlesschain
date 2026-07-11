package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * PSI-backed semantic tools for the IDE bridge (gap-analysis #7 「更深 IDE
 * 语义工具」): getHover / goToDefinition / findReferences / renamePreview /
 * getCallHierarchy / getSymbolInfo / getProjectModel, served as
 * {@code mcp__ide__*} alongside the {@link IdeTools} set.
 *
 * This class is the PURE half: argument validation, result shaping, caps and
 * truncation flags, and the {@link SemanticFacade} contract the IntelliJ glue
 * ({@code com.chainlesschain.ide.intellij.PsiSemanticFacade}) implements with
 * real PSI. Everything here is SDK-free and JUnit-tested headless.
 *
 * <b>Position contract (documented in every tool description):</b> {@code line}
 * and {@code column} are <b>1-based</b>, exactly as shown in the IDE's status
 * bar and diff gutters. The facade receives them 1-based and converts to
 * 0-based document offsets itself.
 */
public final class SemanticTools {
    private SemanticTools() {}

    /** Hard cap on returned definitions (multi-resolve fan-out). */
    public static final int MAX_DEFINITIONS = 20;
    /** findReferences: default / hard cap for the `max` argument. */
    public static final int DEFAULT_REFERENCES = 100;
    public static final int MAX_REFERENCES = 200;
    /** Call hierarchy: default / hard cap PER DIRECTION (callers, callees). */
    public static final int DEFAULT_HIERARCHY = 25;
    public static final int MAX_HIERARCHY = 50;
    /** Hover text cap (chars) after HTML stripping. */
    public static final int MAX_HOVER_CHARS = 8000;
    /** Project model caps. */
    public static final int MAX_MODULES = 100;
    public static final int MAX_DEPENDENCIES = 100;
    /** renamePreview: cap on distinct files listed. */
    public static final int MAX_RENAME_FILES = 200;
    /** How many raw occurrences the glue should collect before giving up —
     *  keeps a hot symbol's search bounded while still letting the pure layer
     *  flag truncation correctly. */
    public static final int COLLECT_BOUND = 500;

    // ── Facade the IntelliJ glue implements ────────────────────────────────
    /**
     * Raw (uncapped, unshaped) semantic answers from the IDE. All maps use
     * JSON-safe values (String / Long / Boolean / Map / List). Locations are
     * 1-based {@code line}/{@code column}. Implementations must NEVER mutate
     * the project (renamePreview is served from {@link #references} counts).
     * Returning {@code null} (or a map carrying only {@code reason}) means
     * "unavailable" — the pure layer degrades gracefully.
     */
    public interface SemanticFacade {
        /** { text (may be HTML), symbol? } or null when nothing to show. */
        Map<String, Object> hover(String path, int line, int column);

        /** [{ file, line, column, preview? }] — declaration site(s). */
        List<Map<String, Object>> definitions(String path, int line, int column);

        /**
         * Usages of the symbol at the position (declaration NOT included):
         * [{ file, line, column, preview? }]. Stop collecting at
         * {@code collectBound} entries.
         */
        List<Map<String, Object>> references(String path, int line, int column, int collectBound);

        /** { name, kind, containingClass?, package?, owner?, file?, line?, language?, reason? } or null. */
        Map<String, Object> symbolInfo(String path, int line, int column);

        /**
         * One level of callers/callees for the (method) symbol at the position:
         * { symbol?, callers:[{name, file?, line?}], callees:[…], reason? }.
         * Unsupported language/element → empty lists + a human `reason`.
         */
        Map<String, Object> callHierarchy(String path, int line, int column, int collectBound);

        /** { jdk?, modules:[{ name, sourceRoots:[…], dependencies:[…] }] } or null. */
        Map<String, Object> projectModel();
    }

    // ── Validation ──────────────────────────────────────────────────────────
    /** Validated 1-based position. */
    public static final class Position {
        public final String path;
        public final int line;
        public final int column;
        Position(String path, int line, int column) {
            this.path = path;
            this.line = line;
            this.column = column;
        }
    }

    /**
     * Validate the { path, line, column } argument triple. Throws
     * {@link IllegalArgumentException} with a message that restates the
     * contract (line/column are 1-based) so a mis-calling MCP client learns
     * the fix from the error itself.
     */
    public static Position requirePosition(Map<String, Object> args) {
        Object path = args == null ? null : args.get("path");
        if (!(path instanceof String) || ((String) path).trim().isEmpty()) {
            throw new IllegalArgumentException(
                    "`path` is required: the file's absolute path (or project-relative path)");
        }
        int line = requireOneBased(args.get("line"), "line");
        int column = requireOneBased(args.get("column"), "column");
        return new Position(((String) path).trim(), line, column);
    }

    private static int requireOneBased(Object raw, String name) {
        if (!(raw instanceof Number)) {
            throw new IllegalArgumentException(
                    "`" + name + "` is required and must be a 1-based number (first " + name + " = 1)");
        }
        int v = ((Number) raw).intValue();
        if (v < 1) {
            throw new IllegalArgumentException(
                    "`" + name + "` must be >= 1 — line/column are 1-based, as shown in the IDE gutter");
        }
        return v;
    }

    /** Clamp an optional `max` argument: non-numbers / <1 → def; cap at hardCap. */
    public static int clampMax(Object raw, int def, int hardCap) {
        if (!(raw instanceof Number)) return def;
        int v = ((Number) raw).intValue();
        if (v < 1) return def;
        return Math.min(v, hardCap);
    }

    // ── Shaping / truncation ────────────────────────────────────────────────
    /** Hover: strip HTML, cap length, or degrade to { found:false, reason }. */
    public static Map<String, Object> shapeHover(Map<String, Object> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        String text = raw == null ? null : asString(raw.get("text"));
        if (text == null || text.trim().isEmpty()) {
            out.put("found", Boolean.FALSE);
            out.put("reason", reasonOr(raw, "no documentation available at this position"));
            return out;
        }
        String plain = stripHtml(text).trim();
        boolean truncated = plain.length() > MAX_HOVER_CHARS;
        if (truncated) plain = plain.substring(0, MAX_HOVER_CHARS) + "…";
        out.put("found", Boolean.TRUE);
        Object symbol = raw.get("symbol");
        if (symbol != null) out.put("symbol", symbol);
        out.put("text", plain);
        if (truncated) out.put("truncated", Boolean.TRUE);
        return out;
    }

    /** Definitions: cap at {@link #MAX_DEFINITIONS}; empty → found:false. */
    public static Map<String, Object> shapeDefinitions(List<Map<String, Object>> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        List<Map<String, Object>> defs = raw == null ? new ArrayList<>() : new ArrayList<>(raw);
        boolean truncated = defs.size() > MAX_DEFINITIONS;
        if (truncated) defs = new ArrayList<>(defs.subList(0, MAX_DEFINITIONS));
        out.put("found", !defs.isEmpty());
        out.put("definitions", defs);
        if (truncated) out.put("truncated", Boolean.TRUE);
        if (defs.isEmpty()) out.put("reason", "no definition found at this position");
        return out;
    }

    /** References: cap at `max`, report the (collected) total + truncation. */
    public static Map<String, Object> shapeReferences(List<Map<String, Object>> raw, int max) {
        List<Map<String, Object>> refs = raw == null ? new ArrayList<>() : new ArrayList<>(raw);
        int total = refs.size();
        boolean truncated = total > max;
        if (truncated) refs = new ArrayList<>(refs.subList(0, max));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("references", refs);
        out.put("total", (long) total);
        if (truncated) {
            out.put("truncated", Boolean.TRUE);
            if (total >= COLLECT_BOUND) out.put("totalIsLowerBound", Boolean.TRUE);
        }
        return out;
    }

    /**
     * Rename preview — per-file occurrence counts, NO mutation. The declaration
     * site (from symbolInfo) counts as one occurrence in its own file; the rest
     * come from the references list. Files are sorted most-occurrences-first.
     */
    public static Map<String, Object> shapeRenamePreview(Map<String, Object> symbol,
                                                         List<Map<String, Object>> refs) {
        Map<String, Long> perFile = new LinkedHashMap<>();
        long total = 0;
        if (refs != null) {
            for (Map<String, Object> r : refs) {
                String f = r == null ? null : asString(r.get("file"));
                if (f == null) continue;
                perFile.merge(f, 1L, Long::sum);
                total++;
            }
        }
        String declFile = symbol == null ? null : asString(symbol.get("file"));
        if (declFile != null) {
            perFile.merge(declFile, 1L, Long::sum);
            total++;
        }
        List<Map<String, Object>> files = new ArrayList<>();
        perFile.entrySet().stream()
                .sorted((a, b) -> {
                    int byCount = Long.compare(b.getValue(), a.getValue());
                    return byCount != 0 ? byCount : a.getKey().compareTo(b.getKey());
                })
                .forEach(e -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("file", e.getKey());
                    m.put("occurrences", e.getValue());
                    if (e.getKey().equals(declFile)) m.put("declaration", Boolean.TRUE);
                    files.add(m);
                });
        boolean truncated = files.size() > MAX_RENAME_FILES;
        List<Map<String, Object>> capped =
                truncated ? new ArrayList<>(files.subList(0, MAX_RENAME_FILES)) : files;
        Map<String, Object> out = new LinkedHashMap<>();
        if (symbol != null && symbol.get("name") != null) out.put("symbol", symbol.get("name"));
        out.put("files", capped);
        out.put("fileCount", (long) files.size());
        out.put("totalOccurrences", total);
        if (truncated) out.put("truncated", Boolean.TRUE);
        out.put("preview", Boolean.TRUE);
        out.put("note", "preview only — nothing was renamed");
        return out;
    }

    /** Call hierarchy: cap each direction at `max`; degrade with a reason. */
    public static Map<String, Object> shapeCallHierarchy(Map<String, Object> raw, int max) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (raw == null) {
            out.put("callers", new ArrayList<>());
            out.put("callees", new ArrayList<>());
            out.put("reason", "call hierarchy unavailable at this position");
            return out;
        }
        if (raw.get("symbol") != null) out.put("symbol", raw.get("symbol"));
        List<Map<String, Object>> callers = asListOfMaps(raw.get("callers"));
        List<Map<String, Object>> callees = asListOfMaps(raw.get("callees"));
        out.put("callers", capList(callers, max, out, "callersTruncated"));
        out.put("callees", capList(callees, max, out, "calleesTruncated"));
        Object reason = raw.get("reason");
        if (reason != null) out.put("reason", reason);
        return out;
    }

    /** Symbol info: whitelist the known keys; null → found:false + reason. */
    public static Map<String, Object> shapeSymbolInfo(Map<String, Object> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (raw == null || raw.get("name") == null) {
            out.put("found", Boolean.FALSE);
            out.put("reason", reasonOr(raw, "no named symbol at this position"));
            return out;
        }
        out.put("found", Boolean.TRUE);
        for (String key : new String[] {
                "name", "kind", "containingClass", "package", "owner",
                "file", "line", "language" }) {
            Object v = raw.get(key);
            if (v != null) out.put(key, v);
        }
        return out;
    }

    /** Project model: cap modules + per-module dependency lists. */
    public static Map<String, Object> shapeProjectModel(Map<String, Object> raw) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (raw == null) {
            out.put("modules", new ArrayList<>());
            out.put("jdk", null);
            out.put("reason", "project model unavailable");
            return out;
        }
        out.put("jdk", raw.get("jdk"));
        List<Map<String, Object>> modules = asListOfMaps(raw.get("modules"));
        boolean modulesTruncated = modules.size() > MAX_MODULES;
        List<Map<String, Object>> shaped = new ArrayList<>();
        for (Map<String, Object> m : modules.subList(0, Math.min(modules.size(), MAX_MODULES))) {
            Map<String, Object> sm = new LinkedHashMap<>();
            sm.put("name", m.get("name"));
            sm.put("sourceRoots", m.get("sourceRoots") instanceof List
                    ? m.get("sourceRoots") : new ArrayList<>());
            Object depsObj = m.get("dependencies");
            List<Object> deps = new ArrayList<>();
            if (depsObj instanceof List) {
                for (Object d : (List<?>) depsObj) deps.add(d);
            }
            if (deps.size() > MAX_DEPENDENCIES) {
                sm.put("dependencies", new ArrayList<>(deps.subList(0, MAX_DEPENDENCIES)));
                sm.put("dependenciesTruncated", Boolean.TRUE);
                sm.put("dependencyCount", (long) deps.size());
            } else {
                sm.put("dependencies", deps);
            }
            shaped.add(sm);
        }
        out.put("modules", shaped);
        out.put("moduleCount", (long) modules.size());
        if (modulesTruncated) out.put("modulesTruncated", Boolean.TRUE);
        return out;
    }

    // ── Tool registration ───────────────────────────────────────────────────
    /** Build the 7 semantic tools over a non-null facade. */
    public static List<Tool> build(SemanticFacade sem) {
        List<Tool> tools = new ArrayList<>();

        tools.add(new IdeTools.BaseTool(
                "getHover",
                "Return hover/quick-doc info (rendered documentation, signature) for the "
                        + "symbol at a position — what the IDE shows on mouse-hover, backed by "
                        + "its semantic index. `line` and `column` are 1-based (first line = 1, "
                        + "first column = 1), exactly as displayed in the IDE gutter.",
                positionSchema(false)) {
            @Override public Object call(Map<String, Object> args) {
                Position p = requirePosition(args);
                return shapeHover(sem.hover(p.path, p.line, p.column));
            }
        });

        tools.add(new IdeTools.BaseTool(
                "goToDefinition",
                "Resolve the symbol at a position to its definition location(s) using the "
                        + "IDE's semantic index (does NOT navigate the user's editor). Returns "
                        + "{ definitions:[{file,line,column,preview}] }; multiple entries mean an "
                        + "ambiguous/poly-variant reference. `line`/`column` are 1-based.",
                positionSchema(false)) {
            @Override public Object call(Map<String, Object> args) {
                Position p = requirePosition(args);
                return shapeDefinitions(sem.definitions(p.path, p.line, p.column));
            }
        });

        tools.add(new IdeTools.BaseTool(
                "findReferences",
                "Find usages of the symbol at a position via the IDE's semantic index "
                        + "(same engine as Find Usages; declaration not included). Returns "
                        + "{ references:[{file,line,column,preview}], total, truncated? }. "
                        + "`max` caps the list (default " + DEFAULT_REFERENCES + ", hard cap "
                        + MAX_REFERENCES + "). `line`/`column` are 1-based.",
                positionSchema(true)) {
            @Override public Object call(Map<String, Object> args) {
                Position p = requirePosition(args);
                int max = clampMax(args.get("max"), DEFAULT_REFERENCES, MAX_REFERENCES);
                return shapeReferences(sem.references(p.path, p.line, p.column, COLLECT_BOUND), max);
            }
        });

        tools.add(new IdeTools.BaseTool(
                "renamePreview",
                "Preview the blast radius of renaming the symbol at a position: the "
                        + "affected files with per-file occurrence counts (declaration + usages), "
                        + "computed from the IDE's semantic index. STRICTLY read-only — no "
                        + "refactoring is executed and no file is modified. `line`/`column` are "
                        + "1-based.",
                positionSchema(false)) {
            @Override public Object call(Map<String, Object> args) {
                Position p = requirePosition(args);
                Map<String, Object> symbol = sem.symbolInfo(p.path, p.line, p.column);
                List<Map<String, Object>> refs = sem.references(p.path, p.line, p.column, COLLECT_BOUND);
                return shapeRenamePreview(symbol, refs);
            }
        });

        tools.add(new IdeTools.BaseTool(
                "getCallHierarchy",
                "One level of call hierarchy for the method at a position: who calls it "
                        + "(callers) and what it calls (callees), from the IDE's semantic index. "
                        + "Non-method symbols or unsupported languages return empty lists plus a "
                        + "`reason`. `max` caps each direction (default " + DEFAULT_HIERARCHY
                        + ", hard cap " + MAX_HIERARCHY + "). `line`/`column` are 1-based.",
                positionSchema(true)) {
            @Override public Object call(Map<String, Object> args) {
                Position p = requirePosition(args);
                int max = clampMax(args.get("max"), DEFAULT_HIERARCHY, MAX_HIERARCHY);
                return shapeCallHierarchy(
                        sem.callHierarchy(p.path, p.line, p.column, COLLECT_BOUND), max);
            }
        });

        tools.add(new IdeTools.BaseTool(
                "getSymbolInfo",
                "Describe the symbol at a position: name, kind (class/method/field/…), "
                        + "containing class, package and owner — i.e. who the symbol belongs to, "
                        + "resolved by the IDE's semantic index. `line`/`column` are 1-based.",
                positionSchema(false)) {
            @Override public Object call(Map<String, Object> args) {
                Position p = requirePosition(args);
                return shapeSymbolInfo(sem.symbolInfo(p.path, p.line, p.column));
            }
        });

        tools.add(new IdeTools.BaseTool(
                "getProjectModel",
                "Return the IDE's project structure model: modules with their source "
                        + "roots and declared dependencies (capped), plus the project JDK — the "
                        + "ground truth the IDE compiles against, richer than guessing from "
                        + "build files.",
                emptySchema()) {
            @Override public Object call(Map<String, Object> args) {
                return shapeProjectModel(sem.projectModel());
            }
        });

        return tools;
    }

    // ── HTML → text (hover docs come back as HTML from the IDE) ────────────
    /** Best-effort HTML→plain-text: block tags become newlines, entities decode. */
    public static String stripHtml(String html) {
        if (html == null) return "";
        String s = html
                .replaceAll("(?is)<style[^>]*>.*?</style>", "")
                .replaceAll("(?is)<script[^>]*>.*?</script>", "")
                .replaceAll("(?i)<br\\s*/?>", "\n")
                .replaceAll("(?i)</(p|div|tr|li|h[1-6]|pre|table)>", "\n")
                .replaceAll("<[^>]+>", "");
        s = s.replace("&nbsp;", " ")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&quot;", "\"")
                .replace("&#39;", "'")
                .replace("&amp;", "&");
        // collapse runs of blank lines / trailing spaces
        s = s.replaceAll("[ \\t]+\\n", "\n").replaceAll("\\n{3,}", "\n\n");
        return s;
    }

    // ── helpers ─────────────────────────────────────────────────────────────
    private static String reasonOr(Map<String, Object> raw, String fallback) {
        Object r = raw == null ? null : raw.get("reason");
        return r instanceof String && !((String) r).isEmpty() ? (String) r : fallback;
    }

    private static String asString(Object o) {
        return o instanceof String ? (String) o : null;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> asListOfMaps(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (o instanceof List) {
            for (Object e : (List<?>) o) {
                if (e instanceof Map) out.add((Map<String, Object>) e);
            }
        }
        return out;
    }

    private static List<Map<String, Object>> capList(List<Map<String, Object>> list, int max,
                                                     Map<String, Object> out, String flag) {
        if (list.size() > max) {
            out.put(flag, Boolean.TRUE);
            return new ArrayList<>(list.subList(0, max));
        }
        return list;
    }

    private static Map<String, Object> positionSchema(boolean withMax) {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("path", prop("string",
                "File path — absolute, or relative to the project root."));
        props.put("line", prop("number", "1-based line number (first line = 1)."));
        props.put("column", prop("number", "1-based column number (first column = 1)."));
        if (withMax) {
            props.put("max", prop("number", "Optional cap on returned entries."));
        }
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", props);
        s.put("required", new ArrayList<>(Arrays.asList("path", "line", "column")));
        return s;
    }

    private static Map<String, Object> emptySchema() {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", new LinkedHashMap<>());
        return s;
    }

    private static Map<String, Object> prop(String type, String desc) {
        Map<String, Object> p = new LinkedHashMap<>();
        p.put("type", type);
        p.put("description", desc);
        return p;
    }
}
