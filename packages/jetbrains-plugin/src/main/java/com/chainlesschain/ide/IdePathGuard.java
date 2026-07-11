package com.chainlesschain.ide;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * Pure path-boundary guard for the IDE MCP tools (openDiff / openMultiDiff /
 * getDiagnostics-with-path) — the JetBrains twin of the VS Code extension's
 * ide-path-guard.js. The agent supplies these paths over the bridge, so
 * without a boundary it could point a write-capable tool at ANY file the IDE
 * process can touch (absolute paths outside the project, `..` traversal, UNC
 * `\\host\share` targets).
 *
 * Rules:
 *   - normalize() folds `..` before any check.
 *   - UNC / device paths (`\\host\share`, `//host/share`, `\\?\...`) are
 *     rejected outright — the bridge is same-machine, workspace-scoped.
 *   - The resolved path must fall inside ONE of the workspace roots. The
 *     existing part of both sides is resolved with toRealPath() (follows
 *     symlinks), then containment uses component-wise Path.startsWith — so
 *     `/tmpfoo` is NOT inside `/tmp`, `C:\work2` is NOT inside `C:\work`,
 *     and the comparison is case-insensitive on Windows (WindowsPath).
 *   - A relative input resolves against the FIRST workspace root.
 *
 * Never throws — validation always yields an ok Result or a fail Result
 * (fail-closed on unexpected errors), so a guard bug can never take the MCP
 * server down.
 */
public final class IdePathGuard {

    private IdePathGuard() {}

    /** Outcome of a validation: ok + resolved path, or a refusal reason. */
    public static final class Result {
        public final boolean ok;
        public final String resolved;
        public final String reason;

        private Result(boolean ok, String resolved, String reason) {
            this.ok = ok;
            this.resolved = resolved;
            this.reason = reason;
        }

        static Result pass(String resolved) {
            return new Result(true, resolved, null);
        }

        static Result fail(String reason) {
            return new Result(false, null, reason);
        }
    }

    /**
     * Validate a tool-supplied path against the open workspace roots.
     *
     * @param rawPath        the path the agent passed to the tool
     * @param workspaceRoots project root directories (usually one)
     */
    public static Result validate(String rawPath, List<String> workspaceRoots) {
        try {
            if (rawPath == null || rawPath.trim().isEmpty()) {
                return Result.fail("path must be a non-empty string");
            }
            if (rawPath.indexOf('\0') >= 0) {
                return Result.fail("path contains a NUL byte");
            }
            if (isUncLike(rawPath)) {
                return Result.fail("UNC / device paths (\\\\host\\share) are not allowed");
            }

            List<String> roots = new ArrayList<String>();
            if (workspaceRoots != null) {
                for (String r : workspaceRoots) {
                    if (r != null && !r.trim().isEmpty()) roots.add(r);
                }
            }
            if (roots.isEmpty()) {
                return Result.fail("no workspace folder is open to contain this path");
            }

            Path first = Paths.get(roots.get(0)).toAbsolutePath().normalize();
            Path p = Paths.get(rawPath);
            Path resolved = (p.isAbsolute() ? p : first.resolve(p))
                    .toAbsolutePath().normalize();
            if (isUncLike(resolved.toString())) {
                return Result.fail("UNC / device paths (\\\\host\\share) are not allowed");
            }

            for (String r : roots) {
                Path root = Paths.get(r).toAbsolutePath().normalize();
                if (contains(root, resolved)) {
                    return Result.pass(resolved.toString());
                }
            }
            return Result.fail("path resolves outside every workspace folder: " + resolved);
        } catch (Exception e) {
            // Input weird enough to break path handling is exactly what we
            // want to refuse — fail-closed, never crash the server.
            return Result.fail("path validation error: " + e.getMessage());
        }
    }

    /** Leading double slash/backslash = UNC or device path (\\?\, \\.\, //host). */
    private static boolean isUncLike(String s) {
        if (s == null || s.length() < 2) return false;
        char a = s.charAt(0);
        char b = s.charAt(1);
        return (a == '\\' || a == '/') && (b == '\\' || b == '/');
    }

    /** target is root itself or nested inside it, after realpath-ing the existing part. */
    private static boolean contains(Path root, Path target) {
        Path realRoot = realizeExisting(root);
        Path realTarget = realizeExisting(target);
        return realTarget.startsWith(realRoot);
    }

    /**
     * toRealPath() on the deepest EXISTING ancestor (follows symlinks there),
     * then re-append the not-yet-existing tail. Falls back to the normalized
     * input when nothing on the path exists or realpath fails.
     */
    private static Path realizeExisting(Path p) {
        Path cur = p;
        Path tail = null;
        while (cur != null) {
            try {
                Path real = cur.toRealPath();
                return tail == null ? real : real.resolve(tail).normalize();
            } catch (Exception notYet) {
                Path name = cur.getFileName();
                Path parent = cur.getParent();
                if (parent == null) return p; // nothing on this path exists
                if (name != null) tail = (tail == null) ? name : name.resolve(tail);
                cur = parent;
            }
        }
        return p;
    }
}
