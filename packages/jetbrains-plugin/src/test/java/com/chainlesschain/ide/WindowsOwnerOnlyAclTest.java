package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Cross-platform tests for the Windows ACL command plan. The injected runner
 * inspects the real production script without requiring Windows in CI.
 */
final class WindowsOwnerOnlyAclTest {

    @Test
    void commandProtectsAndReadsBackExactOwnerOnlyDacl(@TempDir Path tmp)
            throws Exception {
        Path target = tmp.resolve("bridge token.json");
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
        assertEquals(target.toAbsolutePath().toString(),
                command.get(command.size() - 1));

        String script = command.get(command.indexOf("-Command") + 1);
        assertTrue(script.contains("SetAccessRuleProtection($true, $false)"));
        assertTrue(script.contains("AreAccessRulesProtected"));
        assertTrue(script.contains("$rules.Count -eq 1"));
        assertTrue(script.contains("$actual.IsInherited"));
        assertTrue(script.contains("FileSystemRights]::FullControl"));
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
}
