package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.UserPrincipal;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Windows lockfile ACL tightening (IDE gap P1) — the JB twin of the VS Code
 * icacls hardening. On NTFS the POSIX 0600/0700 chmod is a no-op, leaving the
 * bearer token readable by other local users; LockfileWriter replaces the ACL
 * with an owner-only entry via AclFileAttributeView (pure JDK, fail-open).
 *
 * The real ACL effect is only assertable on Windows (AclFileAttributeView is
 * absent on POSIX filesystems), so those assertions are guarded with
 * assumeTrue; the fail-open contract is checked cross-platform.
 */
final class LockfileAclTest {

    private static final boolean WINDOWS =
            System.getProperty("os.name", "").toLowerCase().contains("win");

    @Test
    void writeSucceedsAndFileCarriesTokenOnEveryPlatform(@TempDir Path tmp) throws Exception {
        LockfileWriter w = new LockfileWriter(tmp.resolve("ide"));
        Path file = w.write(4321, "secret-token", Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4321/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid());
        assertTrue(Files.exists(file));
        String body = new String(Files.readAllBytes(file));
        assertTrue(body.contains("secret-token"), body);
    }

    @Test
    void windowsAclLeavesOwnerOnlyEntries(@TempDir Path tmp) throws Exception {
        assumeTrue(WINDOWS, "AclFileAttributeView only present on Windows/NTFS");
        LockfileWriter w = new LockfileWriter(tmp.resolve("ide"));
        Path file = w.write(4322, "tok", Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4322/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid());

        AclFileAttributeView view =
                Files.getFileAttributeView(file, AclFileAttributeView.class);
        assertNotNull(view, "expected an ACL view on Windows");
        UserPrincipal owner = Files.getOwner(file);
        List<AclEntry> acl = view.getAcl();
        assertFalse(acl.isEmpty(), "ACL must not be empty");
        for (AclEntry e : acl) {
            assertEquals(owner, e.principal(),
                    "every ACL entry must belong to the owner (no other principals)");
        }
    }

    @Test
    void directoryAlsoGetsOwnerOnlyAclOnWindows(@TempDir Path tmp) throws Exception {
        assumeTrue(WINDOWS, "AclFileAttributeView only present on Windows/NTFS");
        Path ide = tmp.resolve("ide");
        LockfileWriter w = new LockfileWriter(ide);
        w.write(4323, "tok", Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4323/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid());

        AclFileAttributeView view =
                Files.getFileAttributeView(ide, AclFileAttributeView.class);
        assertNotNull(view);
        UserPrincipal owner = Files.getOwner(ide);
        for (AclEntry e : view.getAcl()) {
            assertEquals(owner, e.principal());
        }
    }

    @Test
    void tightenOwnerOnlyAclIsFailOpenOnMissingFile(@TempDir Path tmp) {
        // A non-existent path must not throw — fail-open contract (returns
        // false, never propagates). Verified on every platform.
        boolean tightened = LockfileWriter.tightenOwnerOnlyAcl(tmp.resolve("nope.json"));
        assertFalse(tightened, "missing file → no ACL applied, but no throw");
    }

    @Test
    void tightenOwnerOnlyAclReturnsFalseOnPosix(@TempDir Path tmp) throws Exception {
        assumeTrue(!WINDOWS, "POSIX-only: no AclFileAttributeView");
        Path f = Files.createFile(tmp.resolve("f.json"));
        // On POSIX there is no ACL view → helper reports "not applied" but never
        // throws; chmod already handled permissions on that filesystem.
        assertFalse(LockfileWriter.tightenOwnerOnlyAcl(f));
    }

    @Test
    void permissionFailureBlocksPublicationByDefault(@TempDir Path tmp) {
        LockfileWriter w = new LockfileWriter(tmp.resolve("ide"), pid -> false,
                (path, permissions) -> { throw new IOException("denied"); },
                () -> false);
        assertThrows(IOException.class, () -> w.write(4324, "tok",
                Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4324/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid()));
        assertFalse(Files.exists(tmp.resolve("ide").resolve("4324.json")));
    }
}
