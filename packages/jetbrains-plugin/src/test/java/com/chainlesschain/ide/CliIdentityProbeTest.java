package com.chainlesschain.ide;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

/** Real subprocesses: changing both configuration and bytes at the same path. */
class CliIdentityProbeTest {
    @TempDir Path root;

    @AfterEach void reset() {
        AgentChatSession.setConfiguredBinary(null);
        AgentChatSession.setManagedCliSupplier(null);
    }

    private Path shim(String name, String output) throws Exception {
        boolean windows = java.io.File.separatorChar == '\\';
        Path file = root.resolve(name + (windows ? ".cmd" : ".sh"));
        Files.writeString(file, windows ? "@echo off\r\necho " + output + "\r\n"
                : "#!/bin/sh\nprintf '%s\\n' '" + output + "'\n");
        if (!windows) assertTrue(file.toFile().setExecutable(true));
        return file;
    }

    @Test void validThenBadExplicitNeverUsesOldVersionOrManagedFallback() throws Exception {
        Path good = shim("good", "0.166.89");
        AgentChatSession.setConfiguredBinary(good.toString());
        var initial = AgentChatSession.probeCliIdentity(root.toFile(), 5000);
        assertEquals("0.166.89", initial.version);
        AgentChatSession.setManagedCliSupplier(() -> good.toString());
        Path missing = root.resolve("not-installed.cmd");
        AgentChatSession.setConfiguredBinary(missing.toString());
        assertFalse(initial.isCurrent());
        var bad = AgentChatSession.probeCliIdentity(root.toFile(), 5000);
        assertEquals(missing.toString(), bad.command);
        assertNull(bad.version);
        AgentChatSession.setConfiguredBinary(good.toString());
        assertEquals("0.166.89", AgentChatSession.probeCliIdentity(root.toFile(), 5000).version);
    }

    @Test void samePathReplacementIsReprobedAndRepairNeedsNoRestart() throws Exception {
        Path cli = shim("replaceable", "0.166.89");
        AgentChatSession.setConfiguredBinary(cli.toString());
        assertEquals("0.166.89", AgentChatSession.probeCliIdentity(root.toFile(), 5000).version);
        shim("replaceable", "gcc 12.2.0");
        assertNull(AgentChatSession.probeCliIdentity(root.toFile(), 5000).version);
        shim("replaceable", "0.166.90");
        assertEquals("0.166.90", AgentChatSession.probeCliIdentity(root.toFile(), 5000).version);
    }
}
