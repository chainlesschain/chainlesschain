package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * IDE MCP tool path-boundary guard (IDE gap P0#2), JetBrains twin of the VS
 * Code extension's ide-path-guard.js:
 *   1. pure rules — traversal, UNC, outside-workspace absolutes, prefix
 *      confusion, relative-vs-first-root, CJK/space paths, symlink escape
 *   2. wiring — IdeTools.build(..., roots) enforces the guard on openDiff /
 *      openMultiDiff / getDiagnostics; null roots keeps legacy behavior.
 */
final class IdePathGuardTest {

    private static final boolean WINDOWS =
            System.getProperty("os.name", "").toLowerCase().contains("win");

    // ---------------------------------------------------------------- rules

    @Test
    void rejectsTraversalEscapingTheWorkspace(@TempDir Path tmp) throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        IdePathGuard.Result r = IdePathGuard.validate(
                "../outside.txt", Collections.singletonList(proj.toString()));
        assertFalse(r.ok);
        assertTrue(r.reason.contains("outside every workspace folder"), r.reason);
    }

    @Test
    void allowsTraversalThatStaysInsideAndFoldsIt(@TempDir Path tmp) throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Files.createDirectories(proj.resolve("sub"));
        IdePathGuard.Result r = IdePathGuard.validate(
                "sub/../a.txt", Collections.singletonList(proj.toString()));
        assertTrue(r.ok, r.reason);
        assertEquals(proj.toAbsolutePath().normalize().resolve("a.txt").toString(), r.resolved);
    }

    @Test
    void rejectsUncAndDevicePathsOutright(@TempDir Path tmp) {
        List<String> roots = Collections.singletonList(tmp.toString());
        for (String p : new String[] {
                "\\\\evil\\share\\x.txt",
                "//evil/share/x.txt",
                "\\\\?\\C:\\x\\a.txt",
                "\\\\wsl.localhost\\Ubuntu\\home\\x" }) {
            IdePathGuard.Result r = IdePathGuard.validate(p, roots);
            assertFalse(r.ok, p);
            assertTrue(r.reason.contains("UNC / device paths"), r.reason);
        }
    }

    @Test
    void rejectsAbsolutePathsOutsideTheWorkspace(@TempDir Path tmp) throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path other = Files.createDirectories(tmp.resolve("other"));
        IdePathGuard.Result r = IdePathGuard.validate(
                other.resolve("evil.txt").toString(),
                Collections.singletonList(proj.toString()));
        assertFalse(r.ok);
    }

    @Test
    void notFooledByPrefixConfusion(@TempDir Path tmp) throws Exception {
        Path work = Files.createDirectories(tmp.resolve("work"));
        Path work2 = Files.createDirectories(tmp.resolve("work2"));
        assertFalse(IdePathGuard.validate(
                work2.resolve("f.txt").toString(),
                Collections.singletonList(work.toString())).ok);
        assertTrue(IdePathGuard.validate(
                work.resolve("f.txt").toString(),
                Collections.singletonList(work.toString())).ok);
    }

    @Test
    void relativePathsResolveAgainstTheFirstRoot(@TempDir Path tmp) throws Exception {
        Path a = Files.createDirectories(tmp.resolve("a"));
        Path b = Files.createDirectories(tmp.resolve("b"));
        IdePathGuard.Result r = IdePathGuard.validate(
                "src/x.java", Arrays.asList(a.toString(), b.toString()));
        assertTrue(r.ok, r.reason);
        assertEquals(a.toAbsolutePath().normalize().resolve("src").resolve("x.java").toString(), r.resolved);
    }

    @Test
    void absolutePathInsideAnyRootPasses(@TempDir Path tmp) throws Exception {
        Path a = Files.createDirectories(tmp.resolve("a"));
        Path b = Files.createDirectories(tmp.resolve("b"));
        IdePathGuard.Result r = IdePathGuard.validate(
                b.resolve("lib/y.java").toString(),
                Arrays.asList(a.toString(), b.toString()));
        assertTrue(r.ok, r.reason);
    }

    @Test
    void handlesCjkAndSpacePaths(@TempDir Path tmp) throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("我的 项目"));
        IdePathGuard.Result ok = IdePathGuard.validate(
                "子 目录/文件 名.txt", Collections.singletonList(proj.toString()));
        assertTrue(ok.ok, ok.reason);
        assertTrue(ok.resolved.contains("我的 项目"));
        assertFalse(IdePathGuard.validate(
                "../外面/x.txt", Collections.singletonList(proj.toString())).ok);
    }

    @Test
    void caseInsensitiveOnWindows(@TempDir Path tmp) throws Exception {
        assumeTrue(WINDOWS, "Windows-only ACL/case semantics");
        Path proj = Files.createDirectories(tmp.resolve("CaseDir"));
        String upper = proj.toString().toUpperCase();
        IdePathGuard.Result r = IdePathGuard.validate(
                upper + "\\a.txt", Collections.singletonList(proj.toString()));
        assertTrue(r.ok, r.reason);
    }

    @Test
    void symlinkEscapeIsCaught(@TempDir Path tmp) throws Exception {
        assumeTrue(!WINDOWS, "symlink creation needs no privilege only on POSIX");
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path outside = Files.createDirectories(tmp.resolve("outside"));
        Path link = proj.resolve("link");
        try {
            Files.createSymbolicLink(link, outside);
        } catch (Exception unsupported) {
            assumeTrue(false, "filesystem does not support symlinks");
        }
        IdePathGuard.Result r = IdePathGuard.validate(
                link.resolve("secret.txt").toString(),
                Collections.singletonList(proj.toString()));
        assertFalse(r.ok, "symlinked escape must be refused");
    }

    @Test
    void failsClosedOnBadInputs(@TempDir Path tmp) {
        List<String> roots = Collections.singletonList(tmp.toString());
        assertFalse(IdePathGuard.validate(null, roots).ok);
        assertFalse(IdePathGuard.validate("", roots).ok);
        assertFalse(IdePathGuard.validate("  ", roots).ok);
        assertFalse(IdePathGuard.validate("a\0b", roots).ok);
        IdePathGuard.Result noRoots = IdePathGuard.validate("a.txt", new ArrayList<>());
        assertFalse(noRoots.ok);
        assertTrue(noRoots.reason.contains("no workspace folder"), noRoots.reason);
        assertFalse(IdePathGuard.validate("a.txt", null).ok);
    }

    // --------------------------------------------------------------- wiring

    /** Facade recording the paths it was actually asked to touch. */
    private static final class RecordingFacade implements EditorFacade {
        String diffPath;
        String diffOperation;
        String diffTargetPath;
        String diagPath = "UNSET";
        final List<String> multiPaths = new ArrayList<>();
        final List<MultiDiff.FileChange> multiChanges = new ArrayList<>();

        @Override public Map<String, Object> getSelection() { return null; }
        @Override public List<Map<String, Object>> getDiagnostics(String path) {
            diagPath = path;
            return new ArrayList<>();
        }
        @Override public List<Map<String, Object>> getOpenEditors() {
            return new ArrayList<>();
        }
        @Override public Map<String, Object> openDiff(
                String path, String modifiedText, String originalText, String title) {
            diffPath = path;
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("outcome", "accepted");
            out.put("path", path);
            out.put("_auditBaselineText", "old");
            return out;
        }
        @Override public Map<String, Object> openDiff(
                String path,
                String modifiedText,
                String originalText,
                String title,
                String operation,
                String targetPath) {
            diffOperation = operation;
            diffTargetPath = targetPath;
            Map<String, Object> out =
                    openDiff(path, modifiedText, originalText, title);
            out.put("operation", operation);
            out.put("targetPath", targetPath);
            return out;
        }
        @Override public Map<String, Object> openMultiDiff(
                List<MultiDiff.FileChange> files, String title) {
            for (MultiDiff.FileChange f : files) {
                multiPaths.add(f.path);
                multiChanges.add(f);
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("outcome", "accepted");
            out.put("count", files.size());
            return out;
        }
    }

    private static Tool find(List<Tool> tools, String name) {
        for (Tool t : tools) if (name.equals(t.name())) return t;
        return null;
    }

    private static Map<String, Object> args(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void openDiffRefusesOutOfWorkspaceTargetWithoutTouchingTheFacade(@TempDir Path tmp)
            throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path other = Files.createDirectories(tmp.resolve("other"));
        RecordingFacade facade = new RecordingFacade();
        Tool openDiff = find(IdeTools.build(facade, null,
                Collections.singletonList(proj.toString())), "openDiff");

        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> openDiff.call(args(
                        "path", other.resolve("evil.txt").toString(),
                        "modifiedText", "x")));
        assertTrue(e.getMessage().contains("openDiff: unsafe write target rejected"),
                e.getMessage());
        assertNull(facade.diffPath, "facade must not be called for a refused path");
    }

    @Test
    void openDiffForwardsTheResolvedInWorkspacePath(@TempDir Path tmp) throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Files.createDirectories(proj.resolve("src"));
        RecordingFacade facade = new RecordingFacade();
        Tool openDiff = find(IdeTools.build(facade, null,
                Collections.singletonList(proj.toString())), "openDiff");

        Object result = openDiff.call(args(
                "path", proj.resolve("src/../src/App.java").toString(),
                "modifiedText", "x",
                "reviewContext", args(
                        "sessionId", "sess-1",
                        "turnId", "run-1:t2",
                        "toolUseId", "call-7")));
        assertEquals(proj.toAbsolutePath().normalize().resolve("src").resolve("App.java").toString(),
                facade.diffPath);
        assertTrue(result instanceof Map);
        Object auditValue = ((Map<?, ?>) result).get("audit");
        assertTrue(auditValue instanceof Map);
        Map<?, ?> audit = (Map<?, ?>) auditValue;
        assertEquals(DiffReviewAudit.SCHEMA, audit.get("schema"));
        assertEquals("jetbrains", audit.get("host"));
        assertEquals("accepted", audit.get("outcome"));
        assertEquals(true, audit.get("written"));
        assertEquals("sess-1", audit.get("sessionId"));
        assertEquals("run-1:t2", audit.get("turnId"));
        assertEquals("call-7", audit.get("toolUseId"));
        assertEquals(3, ((Map<?, ?>) audit.get("baseline")).get("chars"));
        assertFalse(((Map<?, ?>) result).containsKey("_auditBaselineText"));
    }

    @Test
    void openDiffValidatesAndResolvesRenameTarget(@TempDir Path tmp) throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path other = Files.createDirectories(tmp.resolve("other"));
        Path source = proj.resolve("old.txt");
        RecordingFacade facade = new RecordingFacade();
        Tool openDiff = find(IdeTools.build(facade, null,
                Collections.singletonList(proj.toString())), "openDiff");

        IllegalArgumentException refused = assertThrows(
                IllegalArgumentException.class,
                () -> openDiff.call(args(
                        "path", source.toString(),
                        "modifiedText", "x",
                        "operation", "rename",
                        "targetPath", other.resolve("new.txt").toString())));
        assertTrue(refused.getMessage().contains("openDiff targetPath"));
        assertNull(facade.diffPath);

        Path target = proj.resolve("nested/../new.txt");
        Object result = openDiff.call(args(
                "path", source.toString(),
                "modifiedText", "x",
                "operation", "rename",
                "targetPath", target.toString()));
        assertEquals("rename", facade.diffOperation);
        assertEquals(proj.resolve("new.txt").toAbsolutePath().normalize().toString(),
                facade.diffTargetPath);
        assertEquals("rename", ((Map<?, ?>) result).get("operation"));
        assertEquals(facade.diffTargetPath, ((Map<?, ?>) result).get("targetPath"));
    }

    @Test
    void openMultiDiffRejectsTheWholeBatchWhenOneFileEscapes(@TempDir Path tmp)
            throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path other = Files.createDirectories(tmp.resolve("other"));
        RecordingFacade facade = new RecordingFacade();
        Tool multi = find(IdeTools.build(facade, null,
                Collections.singletonList(proj.toString())), "openMultiDiff");

        List<Object> files = new ArrayList<>();
        files.add(args("path", proj.resolve("ok.txt").toString(), "modifiedText", "a"));
        files.add(args("path", other.resolve("evil.txt").toString(), "modifiedText", "b"));

        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> multi.call(args("files", files)));
        assertTrue(e.getMessage().contains("openMultiDiff: unsafe write target rejected"),
                e.getMessage());
        assertTrue(facade.multiPaths.isEmpty(), "facade must not see a refused batch");
    }

    @Test
    void openMultiDiffValidatesAndResolvesRenameTargets(@TempDir Path tmp)
            throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path other = Files.createDirectories(tmp.resolve("other"));
        RecordingFacade facade = new RecordingFacade();
        Tool multi = find(IdeTools.build(facade, null,
                Collections.singletonList(proj.toString())), "openMultiDiff");

        List<Object> refusedFiles = Collections.singletonList(args(
                "path", proj.resolve("old.txt").toString(),
                "modifiedText", "same",
                "originalText", "same",
                "operation", "rename",
                "targetPath", other.resolve("new.txt").toString()));
        IllegalArgumentException refused = assertThrows(
                IllegalArgumentException.class,
                () -> multi.call(args("files", refusedFiles)));
        assertTrue(refused.getMessage().contains("openMultiDiff targetPath"));
        assertTrue(facade.multiChanges.isEmpty());

        List<Object> acceptedFiles = Collections.singletonList(args(
                "path", proj.resolve("old.txt").toString(),
                "modifiedText", "same",
                "originalText", "same",
                "operation", "rename",
                "targetPath", proj.resolve("nested/../new.txt").toString()));
        multi.call(args("files", acceptedFiles));
        assertEquals(1, facade.multiChanges.size());
        MultiDiff.FileChange change = facade.multiChanges.get(0);
        assertEquals("rename", change.operation);
        assertEquals(
                proj.resolve("new.txt").toAbsolutePath().normalize().toString(),
                change.targetPath);
    }

    @Test
    void openMultiDiffSchemaAdvertisesLifecycleMetadata(@TempDir Path tmp) {
        RecordingFacade facade = new RecordingFacade();
        Tool multi = find(IdeTools.build(facade, null,
                Collections.singletonList(tmp.toString())), "openMultiDiff");
        Map<?, ?> properties = (Map<?, ?>) multi.inputSchema().get("properties");
        Map<?, ?> files = (Map<?, ?>) properties.get("files");
        Map<?, ?> item = (Map<?, ?>) files.get("items");
        Map<?, ?> fileProperties = (Map<?, ?>) item.get("properties");
        Map<?, ?> operation = (Map<?, ?>) fileProperties.get("operation");
        assertEquals(
                Arrays.asList("modify", "create", "delete", "rename", "mode-change"),
                operation.get("enum"));
        assertTrue(fileProperties.containsKey("targetPath"));
        assertTrue(fileProperties.containsKey("oldMode"));
        assertTrue(fileProperties.containsKey("newMode"));
    }

    @Test
    void getDiagnosticsRefusesOutOfWorkspaceScopeWithReadWording(@TempDir Path tmp)
            throws Exception {
        Path proj = Files.createDirectories(tmp.resolve("proj"));
        Path other = Files.createDirectories(tmp.resolve("other"));
        RecordingFacade facade = new RecordingFacade();
        Tool diags = find(IdeTools.build(facade, null,
                Collections.singletonList(proj.toString())), "getDiagnostics");

        IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                () -> diags.call(args("path", other.resolve("f.txt").toString())));
        assertTrue(e.getMessage().contains("getDiagnostics: unsafe read path rejected"),
                e.getMessage());
        assertEquals("UNSET", facade.diagPath);

        // No scope path → untouched whole-workspace scan.
        diags.call(args());
        assertNull(facade.diagPath);
    }

    @Test
    void legacyBuildWithoutRootsKeepsUnguardedBehavior(@TempDir Path tmp) throws Exception {
        Path other = Files.createDirectories(tmp.resolve("other"));
        RecordingFacade facade = new RecordingFacade();
        Tool openDiff = find(IdeTools.build(facade), "openDiff");
        String outside = other.resolve("free.txt").toString();
        openDiff.call(args("path", outside, "modifiedText", "x"));
        assertEquals(outside, facade.diffPath);
    }
}
