package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.UserPrincipal;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Cross-platform owner-only lockfile enforcement. POSIX permissions are read
 * back exactly; Windows uses a protected owner-only DACL and verifies the final
 * descriptor before publication.
 *
 * <p>The real ACL effect is only assertable on Windows and the real mode effect
 * only on POSIX, so platform-specific assertions are guarded. Injected failure
 * tests cover the fail-closed and managed-policy branches everywhere.
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
        assertEquals(1, acl.size(), "ACL must contain exactly one owner ACE");
        for (AclEntry e : acl) {
            assertEquals(owner, e.principal(),
                    "every ACL entry must belong to the owner (no other principals)");
            assertEquals(AclEntryType.ALLOW, e.type());
            assertTrue(e.permissions().containsAll(
                    EnumSet.allOf(AclEntryPermission.class)));
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
        List<AclEntry> acl = view.getAcl();
        assertEquals(1, acl.size(), "directory ACL must contain one owner ACE");
        for (AclEntry e : acl) {
            assertEquals(owner, e.principal());
            assertEquals(AclEntryType.ALLOW, e.type());
            assertTrue(e.permissions().containsAll(
                    EnumSet.allOf(AclEntryPermission.class)));
        }
    }

    @Test
    void compatibilityProbeReportsMissingTargetAsUnsecured(@TempDir Path tmp) {
        boolean tightened = LockfileWriter.tightenOwnerOnlyAcl(tmp.resolve("nope.json"));
        assertFalse(tightened, "a missing target cannot be reported as secured");
    }

    @Test
    void compatibilityProbeDoesNotPretendWindowsAclExistsOnPosix(@TempDir Path tmp)
            throws Exception {
        assumeTrue(!WINDOWS, "POSIX-only: no AclFileAttributeView");
        Path f = Files.createFile(tmp.resolve("f.json"));
        assertFalse(LockfileWriter.tightenOwnerOnlyAcl(f));
    }

    @Test
    void posixModesAreExactForDirectoryAndPublishedFile(@TempDir Path tmp)
            throws Exception {
        Path ide = tmp.resolve("ide");
        assumeTrue(Files.getFileAttributeView(
                tmp, PosixFileAttributeView.class) != null,
                "POSIX attribute view required");
        LockfileWriter w = new LockfileWriter(ide);
        Path file = w.write(4325, "tok", Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4325/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid());

        Set<PosixFilePermission> expectedDir = EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE);
        Set<PosixFilePermission> expectedFile = EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE);
        assertEquals(expectedDir, Files.getPosixFilePermissions(ide));
        assertEquals(expectedFile, Files.getPosixFilePermissions(file));
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

    @Test
    void onlyExplicitManagedPolicyMayDowngradePermissionFailure(@TempDir Path tmp)
            throws Exception {
        LockfileWriter w = new LockfileWriter(tmp.resolve("ide"), pid -> false,
                (path, permissions) -> { throw new IOException("denied"); },
                () -> true);
        Path file = w.write(4326, "tok", Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4326/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid());
        assertTrue(Files.exists(file));
    }

    @Test
    void unreadableManagedPolicyFailsBeforePublication(@TempDir Path tmp) {
        LockfileWriter w = new LockfileWriter(tmp.resolve("ide"), pid -> false,
                (path, permissions) -> {},
                () -> { throw new IOException("malformed managed settings"); });
        assertThrows(IOException.class, () -> w.write(4327, "tok",
                Collections.singletonList(tmp.toString()),
                "http://127.0.0.1:4327/mcp", System.currentTimeMillis(),
                ProcessHandle.current().pid()));
        assertFalse(Files.exists(tmp.resolve("ide").resolve("4327.json")));
    }
}
