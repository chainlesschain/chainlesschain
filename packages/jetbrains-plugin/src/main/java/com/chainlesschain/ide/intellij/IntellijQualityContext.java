package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.Project;

import java.lang.reflect.Array;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Read-only adapters for JetBrains test, coverage, and debugger state.
 *
 * <p>The related platform APIs move between IDE editions and optional bundled
 * plugins. Reflection keeps the bridge loadable when a runner, coverage engine,
 * or debugger is absent. Every failure becomes an explicit unavailable reason;
 * it never becomes invented "zero tests" or "zero coverage" data.
 */
final class IntellijQualityContext {
    private static final String SCHEMA = "cc-ide-quality/v1";
    private static final int MAX_TEST_ITEMS = 500;
    private static final int MAX_COVERAGE_FILES = 500;
    private static final int MAX_BREAKPOINTS = 200;

    private IntellijQualityContext() {}

    static Map<String, Object> testResults(Project project, int requestedLimit) {
        Map<String, Object> out = base("test-results");
        List<Map<String, Object>> runs = new ArrayList<>();
        Map<String, Integer> summary = emptySummary();
        int limit = Math.max(1, Math.min(20, requestedLimit));
        int[] remaining = new int[] { MAX_TEST_ITEMS };
        try {
            List<Object> descriptors = runDescriptors(project);
            int count = Math.min(limit, descriptors.size());
            for (int i = 0; i < count && remaining[0] > 0; i++) {
                Object descriptor = descriptors.get(i);
                Map<String, Object> run = new LinkedHashMap<>();
                run.put("id", "run-" + i);
                run.put("name", bounded(invoke(descriptor, "getDisplayName"), 512));
                Object handler = invoke(descriptor, "getProcessHandler");
                boolean terminated = bool(invoke(handler, "isProcessTerminated"));
                Number exitCode = number(invoke(handler, "getExitCode"));
                String runState = !terminated
                        ? "running"
                        : exitCode != null && exitCode.intValue() == 0
                                ? "passed" : "failed";
                run.put("state", runState);
                run.put("exitCode", exitCode);
                run.put("completedAt", null);

                List<Map<String, Object>> items = new ArrayList<>();
                Object console = invoke(descriptor, "getExecutionConsole");
                Object viewer = invoke(console, "getResultsViewer");
                Object root = invoke(viewer, "getTestsRootNode");
                if (root != null) {
                    for (Object child : children(root)) {
                        collectTestNode(child, null, items, summary, remaining);
                        if (remaining[0] <= 0) break;
                    }
                }
                run.put("items", items);
                run.put("truncated", Boolean.valueOf(remaining[0] <= 0));
                runs.add(run);
            }
            out.put("available", Boolean.TRUE);
            out.put("source", "jetbrains-test-runner");
            out.put("runs", runs);
            out.put("summary", summary);
            out.put("truncated", Boolean.valueOf(remaining[0] <= 0));
            return out;
        } catch (Throwable unavailable) {
            out.put("available", Boolean.FALSE);
            out.put("source", "jetbrains-test-runner");
            out.put("reason", "test-runner-api-unavailable");
            out.put("runs", runs);
            out.put("summary", summary);
            return out;
        }
    }

    static Map<String, Object> coverage(Project project, String scopedPath) {
        Map<String, Object> out = base("coverage");
        List<Map<String, Object>> files = new ArrayList<>();
        try {
            Class<?> managerClass =
                    Class.forName("com.intellij.coverage.CoverageDataManager");
            Object manager = invokeStatic(
                    managerClass, "getInstance", project);
            Object bundle = invoke(manager, "getCurrentSuitesBundle");
            if (bundle == null) {
                out.put("available", Boolean.FALSE);
                out.put("source", "jetbrains-coverage");
                out.put("reason", "no-published-coverage");
                out.put("files", files);
                return out;
            }
            Object data = invoke(bundle, "getCoverageData");
            Object classes = invoke(data, "getClasses");
            if (!(classes instanceof Map)) {
                out.put("available", Boolean.FALSE);
                out.put("source", "jetbrains-coverage");
                out.put("reason", "coverage-data-unavailable");
                out.put("files", files);
                return out;
            }
            for (Object rawEntry : ((Map<?, ?>) classes).entrySet()) {
                if (files.size() >= MAX_COVERAGE_FILES) break;
                Map.Entry<?, ?> entry = (Map.Entry<?, ?>) rawEntry;
                String className = bounded(entry.getKey(), 512);
                if (!matchesScope(className, scopedPath)) continue;
                Object lineArray = invoke(entry.getValue(), "getLines");
                int total = 0;
                int covered = 0;
                int partial = 0;
                int length = lineArray != null && lineArray.getClass().isArray()
                        ? Array.getLength(lineArray) : 0;
                for (int i = 0; i < length; i++) {
                    Object line = Array.get(lineArray, i);
                    if (line == null) continue;
                    Number status = number(invoke(line, "getStatus"));
                    if (status == null) continue;
                    total++;
                    if (status.intValue() > 0) covered++;
                    if (status.intValue() == 1) partial++;
                }
                Map<String, Object> file = new LinkedHashMap<>();
                file.put("uri", null);
                file.put("className", className);
                file.put("lines", coverageCount(covered, total));
                file.put("partialLines", Integer.valueOf(partial));
                file.put("statements", null);
                file.put("branches", null);
                file.put("functions", null);
                files.add(file);
            }
            out.put("available", Boolean.TRUE);
            out.put("source", "jetbrains-coverage");
            out.put("completedAt", null);
            out.put("files", files);
            out.put("truncated",
                    Boolean.valueOf(((Map<?, ?>) classes).size()
                            > MAX_COVERAGE_FILES));
            return out;
        } catch (Throwable unavailable) {
            out.put("available", Boolean.FALSE);
            out.put("source", "jetbrains-coverage");
            out.put("reason", "coverage-api-unavailable");
            out.put("files", files);
            return out;
        }
    }

    static Map<String, Object> debugState(Project project) {
        Map<String, Object> out = base("debug-state");
        List<Map<String, Object>> breakpoints = new ArrayList<>();
        try {
            Class<?> managerClass =
                    Class.forName("com.intellij.xdebugger.XDebuggerManager");
            Object manager = invokeStatic(
                    managerClass, "getInstance", project);
            Object session = invoke(manager, "getCurrentSession");
            Map<String, Object> sessionRecord = null;
            if (session != null) {
                sessionRecord = new LinkedHashMap<>();
                sessionRecord.put("id", null);
                sessionRecord.put("name",
                        bounded(invoke(session, "getSessionName"), 256));
                Object process = invoke(session, "getDebugProcess");
                sessionRecord.put("type", process == null
                        ? null : bounded(process.getClass().getSimpleName(), 96));
                String state = bool(invoke(session, "isStopped"))
                        ? "stopped"
                        : bool(invoke(session, "isPaused"))
                                ? "paused" : "running";
                sessionRecord.put("state", state);
                sessionRecord.put("currentFrame",
                        sourcePosition(invoke(
                                session, "getCurrentStackFrame")));
            }

            Object breakpointManager = invoke(manager, "getBreakpointManager");
            List<Object> all = asList(invoke(
                    breakpointManager, "getAllBreakpoints"));
            for (int i = 0;
                    i < all.size() && i < MAX_BREAKPOINTS; i++) {
                Object breakpoint = all.get(i);
                Map<String, Object> record = new LinkedHashMap<>();
                Object type = invoke(breakpoint, "getType");
                record.put("kind",
                        bounded(invoke(type, "getId"), 128));
                record.put("enabled",
                        Boolean.valueOf(!Boolean.FALSE.equals(
                                invoke(breakpoint, "isEnabled"))));
                Map<String, Object> position = sourcePosition(breakpoint);
                if (position != null) {
                    record.putAll(position);
                }
                breakpoints.add(record);
            }

            out.put("available", Boolean.TRUE);
            out.put("source", "jetbrains-debugger-api");
            out.put("session", sessionRecord);
            out.put("breakpoints", breakpoints);
            out.put("truncated",
                    Boolean.valueOf(all.size() > MAX_BREAKPOINTS));
            return out;
        } catch (Throwable unavailable) {
            out.put("available", Boolean.FALSE);
            out.put("source", "jetbrains-debugger-api");
            out.put("reason", "debugger-api-unavailable");
            out.put("session", null);
            out.put("breakpoints", breakpoints);
            return out;
        }
    }

    private static void collectTestNode(
            Object node,
            String parentId,
            List<Map<String, Object>> items,
            Map<String, Integer> summary,
            int[] remaining) {
        if (node == null || remaining[0] <= 0) return;
        String id = "item-" + items.size();
        String state = testState(invoke(node, "getMagnitude"));
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id);
        item.put("parentId", parentId);
        item.put("label", bounded(invoke(node, "getName"), 512));
        item.put("state", state);
        Number duration = number(invoke(node, "getDuration"));
        item.put("durationMs", duration == null
                ? null : Long.valueOf(Math.max(0L, duration.longValue())));
        Object location = invoke(node, "getLocationUrl");
        item.put("uri", location == null
                ? null : bounded(location, 1024));
        item.put("range", null);
        item.put("messages", new ArrayList<String>());
        items.add(item);
        summary.put(state, Integer.valueOf(summary.get(state) + 1));
        remaining[0]--;
        for (Object child : children(node)) {
            collectTestNode(child, id, items, summary, remaining);
            if (remaining[0] <= 0) break;
        }
    }

    private static Map<String, Object> sourcePosition(Object owner) {
        if (owner == null) return null;
        Object position = invoke(owner, "getSourcePosition");
        if (position == null) return null;
        Object file = invoke(position, "getFile");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("uri", bounded(invoke(file, "getUrl"), 1024));
        Number line = number(invoke(position, "getLine"));
        out.put("line", line == null
                ? null : Integer.valueOf(Math.max(0, line.intValue())));
        out.put("character", Integer.valueOf(0));
        return out;
    }

    private static List<Object> runDescriptors(Project project)
            throws Exception {
        Class<?> managerClass =
                Class.forName("com.intellij.execution.ui.RunContentManager");
        Object manager = invokeStatic(
                managerClass, "getInstance", project);
        return asList(invoke(manager, "getAllDescriptors"));
    }

    private static List<Object> children(Object node) {
        Object raw = invoke(node, "getChildren");
        if (raw == null) raw = invoke(node, "getChildrenList");
        return asList(raw);
    }

    private static List<Object> asList(Object value) {
        List<Object> out = new ArrayList<>();
        if (value == null) return out;
        if (value instanceof Collection) {
            out.addAll((Collection<?>) value);
            return out;
        }
        if (value instanceof Iterable) {
            for (Object item : (Iterable<?>) value) out.add(item);
            return out;
        }
        if (value.getClass().isArray()) {
            int length = Array.getLength(value);
            for (int i = 0; i < length; i++) out.add(Array.get(value, i));
        }
        return out;
    }

    private static Object invoke(Object target, String name, Object... args) {
        if (target == null) return null;
        try {
            for (Method method : target.getClass().getMethods()) {
                if (method.getName().equals(name)
                        && method.getParameterCount() == args.length) {
                    return method.invoke(target, args);
                }
            }
        } catch (Throwable ignored) {
            // Optional host API or incompatible plugin version.
        }
        return null;
    }

    private static Object invokeStatic(
            Class<?> type, String name, Object... args) throws Exception {
        for (Method method : type.getMethods()) {
            if (method.getName().equals(name)
                    && method.getParameterCount() == args.length) {
                return method.invoke(null, args);
            }
        }
        throw new NoSuchMethodException(type.getName() + "." + name);
    }

    private static Map<String, Object> base(String kind) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("schema", SCHEMA);
        out.put("kind", kind);
        return out;
    }

    private static Map<String, Integer> emptySummary() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (String state : List.of(
                "passed", "failed", "skipped", "errored",
                "running", "queued", "unknown")) {
            out.put(state, Integer.valueOf(0));
        }
        return out;
    }

    private static String testState(Object magnitude) {
        String raw = magnitude == null
                ? "" : String.valueOf(magnitude).toLowerCase();
        if (raw.contains("pass") || raw.contains("complete")) return "passed";
        if (raw.contains("error") || raw.contains("terminate")) return "errored";
        if (raw.contains("fail")) return "failed";
        if (raw.contains("ignore") || raw.contains("skip")) return "skipped";
        if (raw.contains("run")) return "running";
        if (raw.contains("pending") || raw.contains("queue")) return "queued";
        return "unknown";
    }

    private static Map<String, Object> coverageCount(int covered, int total) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("covered", Integer.valueOf(Math.max(0, covered)));
        out.put("total", Integer.valueOf(Math.max(0, total)));
        out.put("percent", total <= 0
                ? null
                : Double.valueOf(
                        Math.round((covered * 10000.0d) / total) / 100.0d));
        return out;
    }

    private static boolean matchesScope(String className, String path) {
        if (path == null || path.isEmpty()) return true;
        if (className == null || className.isEmpty()) return false;
        String normalizedPath = path.replace('\\', '/');
        int dot = normalizedPath.lastIndexOf('.');
        if (dot > normalizedPath.lastIndexOf('/')) {
            normalizedPath = normalizedPath.substring(0, dot);
        }
        String classPath = className.replace('.', '/');
        return normalizedPath.endsWith(classPath)
                || classPath.endsWith(
                        normalizedPath.substring(
                                normalizedPath.lastIndexOf('/') + 1));
    }

    private static Number number(Object value) {
        return value instanceof Number ? (Number) value : null;
    }

    private static boolean bool(Object value) {
        return Boolean.TRUE.equals(value);
    }

    private static String bounded(Object value, int max) {
        if (value == null) return null;
        String text = String.valueOf(value);
        return text.length() <= max ? text : text.substring(0, max);
    }
}
