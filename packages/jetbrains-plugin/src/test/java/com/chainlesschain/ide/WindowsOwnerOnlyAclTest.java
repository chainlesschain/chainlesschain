package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.File;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Cross-platform tests for the Windows ACL command plan. The injected runner
 * inspects the real production script without requiring Windows in CI.
 */
final class WindowsOwnerOnlyAclTest {

    @Test
    void commandProtectsAndReadsBackExactOwnerOnlyDacl(@TempDir Path tmp)
            throws Exception {
        Path target = tmp.resolve("bridge token's.json");
        AtomicReference<List<String>> captured = new AtomicReference<>();
        AtomicLong timeout = new AtomicLong();

        WindowsOwnerOnlyAcl.enforce(target, (command, timeoutSeconds) -> {
            captured.set(command);
            timeout.set(timeoutSeconds);
            return new WindowsOwnerOnlyAcl.Result(0, "");
        });

        List<String> command = captured.get();
        assertNotNull(command);
        assertEquals("powershell.exe", command.get(0));
        assertTrue(command.contains("-NoProfile"));
        assertTrue(command.contains("-NonInteractive"));
        assertEquals(30, timeout.get());

        String script = new String(Base64.getDecoder().decode(
                command.get(command.indexOf("-EncodedCommand") + 1)),
                StandardCharsets.UTF_16LE);
        assertTrue(script.contains("SetAccessRuleProtection($true, $false)"));
        assertTrue(script.contains("AreAccessRulesProtected"));
        assertTrue(script.contains("$rules.Count -eq 1"));
        assertTrue(script.contains("$actual.IsInherited"));
        assertTrue(script.contains("FileSystemRights]::FullControl"));
        assertTrue(script.contains("FileAttributes]::ReparsePoint"));
        assertTrue(script.endsWith(" '" + target.toAbsolutePath()
                .toString().replace("'", "''") + "'"));
    }

    @Test
    void creationCommandsSetOwnerAndDaclBeforeCreatingEmptyObjects(@TempDir Path tmp)
            throws Exception {
        AtomicReference<String> directoryScript = new AtomicReference<>();
        AtomicReference<String> fileScript = new AtomicReference<>();
        WindowsOwnerOnlyAcl.createDirectory(tmp.resolve("ide"),
                (command, timeoutSeconds) -> {
                    directoryScript.set(decode(command));
                    return new WindowsOwnerOnlyAcl.Result(0, "");
                });
        WindowsOwnerOnlyAcl.createEmptyFile(tmp.resolve("bridge.json"),
                (command, timeoutSeconds) -> {
                    fileScript.set(decode(command));
                    return new WindowsOwnerOnlyAcl.Result(0, "");
                });

        assertTrue(directoryScript.get().contains("$security.SetOwner($sid)"));
        assertTrue(directoryScript.get().contains("SetAccessRuleProtection($true, $false)"));
        assertTrue(directoryScript.get().contains("CreateDirectory($target, $security)"));
        assertTrue(fileScript.get().contains("$security.SetOwner($sid)"));
        assertTrue(fileScript.get().contains("SetAccessRuleProtection($true, $false)"));
        assertTrue(fileScript.get().contains("[System.IO.FileMode]::CreateNew"));
        assertTrue(fileScript.get().contains("[System.IO.FileShare]::None"));
        assertFalse(fileScript.get().contains("probe-token"));
    }

    private static String decode(List<String> command) {
        return new String(Base64.getDecoder().decode(
                command.get(command.indexOf("-EncodedCommand") + 1)),
                StandardCharsets.UTF_16LE);
    }

    @Test
    void nonzeroAclCommandFailsClosed(@TempDir Path tmp) {
        IOException failure = assertThrows(IOException.class,
                () -> WindowsOwnerOnlyAcl.enforce(
                        tmp.resolve("lock.json"),
                        (command, timeoutSeconds) ->
                                new WindowsOwnerOnlyAcl.Result(
                                        5, "final ACL is not owner-only")));
        assertTrue(failure.getMessage().contains("not owner-only"));
    }

    @Test
    void runnerFailureIsNotConvertedToSuccess(@TempDir Path tmp) {
        IOException failure = assertThrows(IOException.class,
                () -> WindowsOwnerOnlyAcl.enforce(
                        tmp.resolve("lock.json"),
                        (command, timeoutSeconds) -> {
                            throw new IOException("ACL process unavailable");
                        }));
        assertEquals("ACL process unavailable", failure.getMessage());
    }

    @Test
    void closesUnusedStdinBeforeWaiting(@TempDir Path tmp) throws Exception {
        assertLifecycle("stdin-case", tmp);
    }

    @Test
    void drainsMergedOutputBeyondCaptureLimit(@TempDir Path tmp) throws Exception {
        assertLifecycle("flood-case", tmp);
    }

    @Test
    void incompleteInheritedPipeFailsWithinSharedCleanupBudget(@TempDir Path tmp)
            throws Exception {
        assertLifecycle("held-pipe-case", tmp);
    }

    @Test
    void timeoutReapsOnlyOwnedProcess(@TempDir Path tmp) throws Exception {
        assertLifecycle("timeout-case", tmp);
    }

    @Test
    void interruptionRestoresFlagAndReapsOwnedProcess(@TempDir Path tmp)
            throws Exception {
        assertLifecycle("interrupt-case", tmp);
    }

    private static void assertLifecycle(String scenario, Path tmp) throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(
                System.getProperty("os.name").startsWith("Windows"));
        List<String> command = AclLifecycleFixture.child(scenario,
                tmp.resolve(scenario + ".pid").toString());
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        process.getOutputStream().close();
        try {
            assertTrue(process.waitFor(15, TimeUnit.SECONDS), "fixture must finish");
            String output = new String(process.getInputStream().readAllBytes(),
                    StandardCharsets.UTF_8);
            assertEquals(0, process.exitValue(), output);
            assertTrue(output.contains("\"passed\":true"), output);
            Matcher elapsed = Pattern.compile("\"elapsedMs\":([0-9]+)").matcher(output);
            assertTrue(elapsed.find(), output);
            long elapsedMs = Long.parseLong(elapsed.group(1));
            assertTrue(elapsedMs < 6500, "shared operation/drain cleanup bound: " + output);
            if (scenario.equals("held-pipe-case")) {
                assertTrue(elapsedMs >= 4800, "exercise five-second drain deadline");
            }
            if (scenario.equals("interrupt-case")) {
                assertTrue(output.contains("\"interruptRestored\":true"), output);
            }
            if (scenario.equals("timeout-case") || scenario.equals("interrupt-case")) {
                assertTrue(output.contains("\"ownedProcessExited\":true"), output);
            }
        } finally {
            if (process.isAlive()) process.destroyForcibly();
            process.getInputStream().close();
            process.getErrorStream().close();
        }
    }

    public static final class AclLifecycleFixture {
        private static Path classLocation(Class<?> type) throws Exception {
            String resource = type.getName().replace('.', '/') + ".class";
            URL location = type.getResource("/" + resource);
            if (location == null) throw new IOException("fixture class resource missing");
            if (location.getProtocol().equals("jar")) {
                String external = location.toExternalForm();
                return Path.of(URI.create(external.substring(4, external.indexOf("!/"))));
            }
            Path root = Path.of(location.toURI());
            for (String ignored : resource.split("/")) root = root.getParent();
            return root;
        }

        static String lifecycleClasspath() {
            try {
                return classLocation(AclLifecycleFixture.class) + File.pathSeparator
                        + classLocation(WindowsOwnerOnlyAcl.class);
            } catch (Exception error) {
                throw new IllegalStateException(error);
            }
        }

        static List<String> child(String mode, String... extra) {
            List<String> args = new ArrayList<>(List.of(
                Path.of(System.getProperty("java.home"), "bin", "java.exe").toString(),
                "-cp", lifecycleClasspath(), AclLifecycleFixture.class.getName(), mode));
            args.addAll(Arrays.asList(extra)); return args;
        }
        static WindowsOwnerOnlyAcl.Result run(List<String> args, long seconds) throws Exception {
            Method method = WindowsOwnerOnlyAcl.class.getDeclaredMethod("runProcess", List.class, long.class);
            method.setAccessible(true);
            try { return (WindowsOwnerOnlyAcl.Result) method.invoke(null, args, seconds); }
            catch (InvocationTargetException error) {
                if (error.getCause() instanceof Exception) throw (Exception) error.getCause();
                throw error;
            }
        }
        public static void main(String[] args) throws Exception {
            switch (args[0]) {
                case "stdin": while (System.in.read() != -1) { } System.out.print("EOF"); return;
                case "hold": Thread.sleep(8000); System.out.print("LATE"); return;
                case "fork": new ProcessBuilder(child("hold")).inheritIO().start(); return;
                case "flood":
                    byte[] bytes = new byte[4096]; Arrays.fill(bytes, (byte)'x');
                    for (int i = 0; i < 64; i++) { System.out.write(bytes); System.err.write(bytes); }
                    return;
                case "sleep":
                    Files.writeString(Path.of(args[1]), Long.toString(ProcessHandle.current().pid()));
                    Thread.sleep(10000); return;
                default: break;
            }
            long start = System.nanoTime();
            boolean passed = false, interrupted = false, ownedExited = true;
            String scenario = args[0];
            if (scenario.equals("stdin-case")) {
                WindowsOwnerOnlyAcl.Result result = run(child("stdin"), 3);
                passed = result.exitCode == 0 && result.output.equals("EOF");
            } else if (scenario.equals("flood-case")) {
                WindowsOwnerOnlyAcl.Result result = run(child("flood"), 3);
                passed = result.exitCode == 0 && result.output.length() == 65536;
            } else if (scenario.equals("held-pipe-case")) {
                try { run(child("fork"), 3); }
                catch (IOException error) { passed = error.getMessage().contains("did not drain"); }
            } else {
                Path pidFile = Path.of(args[1]);
                if (scenario.equals("timeout-case")) {
                    try { run(child("sleep", pidFile.toString()), 1); }
                    catch (IOException error) { passed = error.getMessage().contains("timed out"); }
                } else {
                    AtomicBoolean failed = new AtomicBoolean(), restored = new AtomicBoolean();
                    Thread worker = new Thread(() -> {
                        try { run(child("sleep", pidFile.toString()), 30); }
                        catch (Exception error) {
                            failed.set(error instanceof IOException && error.getMessage().contains("interrupted"));
                            restored.set(Thread.currentThread().isInterrupted());
                        }
                    });
                    worker.setDaemon(true); worker.start();
                    long until = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
                    while ((!Files.exists(pidFile) || Files.size(pidFile) == 0)
                            && System.nanoTime() < until) Thread.sleep(10);
                    if (!Files.exists(pidFile) || Files.size(pidFile) == 0) {
                        throw new IOException("owned child did not start");
                    }
                    worker.interrupt(); worker.join(6000);
                    passed = !worker.isAlive() && failed.get(); interrupted = restored.get();
                }
                if (Files.exists(pidFile)) {
                    long pid = Long.parseLong(Files.readString(pidFile));
                    ownedExited = ProcessHandle.of(pid).map(p -> !p.isAlive()).orElse(true);
                } else { ownedExited = false; }
            }
            long elapsedMs = (System.nanoTime() - start) / 1000000;
            System.out.println("{\"passed\":" + passed + ",\"elapsedMs\":" + elapsedMs
                + ",\"interruptRestored\":" + interrupted + ",\"ownedProcessExited\":" + ownedExited + "}");
        }
    }
}
