package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryFlag;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.UserPrincipal;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Writes/removes the IDE-bridge discovery lockfile that the CLI's Phase-0
 * reader (packages/cli/src/lib/ide-bridge.js) consumes:
 *   ~/.chainlesschain/ide/&lt;port&gt;.json   (file 0600, dir 0700)
 * Same protocol as the VS Code extension, only `ide` differs ("jetbrains").
 */
public final class LockfileWriter {

    private final Path dir;
    private final java.util.function.LongPredicate processAlive;
    private final PermissionEnforcer permissionEnforcer;
    private final SecurityPolicy securityPolicy;
    private static final java.util.concurrent.atomic.AtomicBoolean DEGRADE_WARNED =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    @FunctionalInterface
    interface PermissionEnforcer {
        void enforce(Path path, Set<PosixFilePermission> permissions) throws IOException;
    }

    @FunctionalInterface
    interface SecurityPolicy {
        boolean allowInsecurePermissions() throws IOException;
    }

    public LockfileWriter() {
        this(Paths.get(System.getProperty("user.home"), ".chainlesschain", "ide"),
                LockfileWriter::defaultProcessAlive,
                LockfileWriter::restrictToOwner,
                BridgeSecurityPolicy::allowInsecureLockfilePermissions);
    }

    /** Test seam: point the writer at an arbitrary directory. */
    public LockfileWriter(Path lockDir) {
        this(lockDir, LockfileWriter::defaultProcessAlive,
                LockfileWriter::restrictToOwner, () -> false);
    }

    /** Test seam: arbitrary directory + a custom pid-liveness probe. */
    public LockfileWriter(Path lockDir, java.util.function.LongPredicate processAlive) {
        this(lockDir, processAlive, LockfileWriter::restrictToOwner, () -> false);
    }

    /** Test seam for permission failure and managed-degrade behavior. */
    LockfileWriter(Path lockDir, java.util.function.LongPredicate processAlive,
                   PermissionEnforcer permissionEnforcer, SecurityPolicy securityPolicy) {
        this.dir = lockDir;
        this.processAlive = processAlive;
        this.permissionEnforcer = permissionEnforcer;
        this.securityPolicy = securityPolicy;
    }

    /** True if a process with {@code pid} is currently alive (Java 9+). */
    static boolean defaultProcessAlive(long pid) {
        if (pid <= 0) return false;
        try {
            return ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false);
        } catch (Exception e) {
            return false;
        }
    }

    public Path lockDir() {
        return dir;
    }

    /** A fresh 256-bit hex bearer token. */
    public static String generateToken() {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(String.format("%02x", x & 0xff));
        return sb.toString();
    }

    /**
     * Write (or overwrite) the lockfile for a running server.
     * @return the lockfile path
     */
    public Path write(int port, String token, List<String> workspaceFolders,
                      String url, long startedAt, long pid) throws IOException {
        final Set<PosixFilePermission> dirPermissions = EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE);
        final Set<PosixFilePermission> filePermissions = EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE);
        Path file = dir.resolve(port + ".json");
        Path tmp = dir.resolve(port + ".json.tmp-" + ProcessHandle.current().pid()
                + "-" + randomSuffix());
        boolean dirExisted = Files.exists(dir, LinkOption.NOFOLLOW_LINKS);
        boolean allowInsecure = securityPolicy.allowInsecurePermissions();
        try {
            if (Files.isSymbolicLink(dir)) {
                throw new IOException("IDE lock directory must not be a symbolic link: " + dir);
            }
            Files.createDirectories(dir);
            enforceOwnerOnly(dir, dirPermissions, allowInsecure);

            Map<String, Object> lock = new LinkedHashMap<>();
            lock.put("ide", "jetbrains");
            lock.put("version", 1L);
            lock.put("transport", "http");
            lock.put("url", url);
            lock.put("port", (long) port);
            lock.put("workspaceFolders", workspaceFolders);
            lock.put("token", token);
            lock.put("pid", pid);
            lock.put("started_at", startedAt);
            byte[] body = MiniJson.stringify(lock).getBytes(StandardCharsets.UTF_8);

            // The directory is already owner-only. CREATE_NEW avoids following
            // or truncating a planted temp path; permission verification occurs
            // before the atomic rename makes the token discoverable.
            Files.write(tmp, body, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            enforceOwnerOnly(tmp, filePermissions, allowInsecure);
            Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            enforceOwnerOnly(file, filePermissions, allowInsecure);
            return file;
        } catch (Exception failure) {
            deleteQuietly(tmp);
            deleteQuietly(file);
            if (!dirExisted) {
                try {
                    Files.deleteIfExists(dir);
                } catch (IOException ignore) {
                    // Preserve a directory another bridge populated concurrently.
                }
            }
            if (failure instanceof IOException) throw (IOException) failure;
            throw new IOException("failed to publish secure IDE bridge lockfile", failure);
        }
    }

    private static String randomSuffix() {
        byte[] bytes = new byte[8];
        new SecureRandom().nextBytes(bytes);
        StringBuilder out = new StringBuilder(16);
        for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }

    private static void deleteQuietly(Path path) {
        if (path == null) return;
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignore) {
            // Best-effort rollback; the original security error remains primary.
        }
    }

    private void enforceOwnerOnly(Path path, Set<PosixFilePermission> permissions,
                                  boolean allowInsecure) throws IOException {
        try {
            permissionEnforcer.enforce(path, permissions);
        } catch (Exception failure) {
            if (!allowInsecure) {
                if (failure instanceof IOException) throw (IOException) failure;
                throw new IOException("owner-only permission enforcement failed for " + path,
                        failure);
            }
            if (DEGRADE_WARNED.compareAndSet(false, true)) {
                System.err.println("[chainlesschain-ide] managed policy permits an insecure "
                        + "IDE bridge lockfile after permission verification failed: "
                        + path + " (" + failure.getMessage() + ")");
            }
        }
    }

    /** Remove the lockfile for a port. Returns true if a file was deleted. */
    public boolean remove(int port) {
        try {
            return Files.deleteIfExists(dir.resolve(port + ".json"));
        } catch (IOException e) {
            return false;
        }
    }

    /**
     * Remove lockfiles left by crashed / force-killed instances. Normal shutdown
     * calls remove(), but a crash leaves the file — and because each run binds an
     * ephemeral port, these orphans accumulate forever. A lock is stale when its
     * owning process is gone (or its file is unparseable). Best-effort; returns
     * the count removed. Never removes a lock whose pid is still alive (so a live
     * sibling IDE's bridge is preserved). Mirrors the VS Code pruneStaleLocks.
     */
    public int pruneStale() {
        if (!Files.isDirectory(dir)) return 0;
        List<Path> files;
        try (java.util.stream.Stream<Path> s = Files.list(dir)) {
            files = s.filter(p -> {
                String n = p.getFileName().toString();
                // Also sweep atomic-write temps (`<port>.json.tmp-<pid>`) — a
                // crash between write and move leaves them, and they never end
                // with ".json" so the old filter never cleaned them up.
                return n.endsWith(".json") || n.contains(".json.tmp-");
            }).collect(java.util.stream.Collectors.toList());
        } catch (IOException e) {
            return 0;
        }
        int removed = 0;
        for (Path file : files) {
            Long pid = pidFor(file);
            if (pid != null && processAlive.test(pid)) continue; // owner alive → keep
            try {
                if (Files.deleteIfExists(file)) removed++;
            } catch (IOException ignore) {
                // best-effort
            }
        }
        return removed;
    }

    /** The owning pid — from the JSON for a lockfile, or the trailing pid in a
     *  `.json.tmp-<pid>` temp name. null (→ stale) when missing/unparseable. */
    private static Long pidFor(Path file) {
        String name = file.getFileName().toString();
        int tmp = name.indexOf(".json.tmp-");
        if (tmp >= 0) {
            try {
                return Long.parseLong(name.substring(tmp + ".json.tmp-".length()));
            } catch (NumberFormatException e) {
                return null; // odd temp name → treat as stale
            }
        }
        return readPid(file);
    }

    /** The pid from a lockfile, or null if missing / unparseable (→ stale). */
    private static Long readPid(Path file) {
        try {
            String content = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
            Map<String, Object> lock = MiniJson.parseObject(content);
            Object pid = lock == null ? null : lock.get("pid");
            return (pid instanceof Number) ? ((Number) pid).longValue() : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Owner-only permissions: POSIX chmod where supported, otherwise (Windows /
     * NTFS, where chmod is unsupported and the 0600/0700 intent would silently
     * become a no-op — leaving the bearer token readable by other local users)
     * an explicit owner-only ACL. The default path is fail-closed; only the
     * organization-managed downgrade may allow startup after verification fails.
     */
    private static void restrictToOwner(Path p, Set<PosixFilePermission> perms)
            throws IOException {
        if (!tryChmod(p, perms)) {
            if (!tightenOwnerOnlyAcl(p)) {
                throw new IOException("owner-only ACL could not be verified for " + p);
            }
        }
    }

    /** @return true when POSIX permissions were applied (POSIX filesystem). */
    private static boolean tryChmod(Path p, Set<PosixFilePermission> perms) {
        try {
            Files.setPosixFilePermissions(p, perms);
            return true;
        } catch (UnsupportedOperationException nonPosix) {
            return false; // Windows / non-POSIX filesystem → try the ACL route
        } catch (IOException ignore) {
            // POSIX filesystem but chmod failed. Do not claim the lock is
            // protected; enforceOwnerOnly will fail closed unless an
            // organization-managed downgrade is explicitly enabled.
            return false;
        }
    }

    /**
     * Windows twin of the 0600/0700 chmod: replace the ACL with a single
     * entry granting the file's owner full control (pure JDK, no icacls
     * subprocess). Returns false when the ACL cannot be applied or verified;
     * the caller decides whether a managed downgrade is allowed.
     */
    static boolean tightenOwnerOnlyAcl(Path p) {
        try {
            AclFileAttributeView view =
                    Files.getFileAttributeView(p, AclFileAttributeView.class);
            if (view == null) return false; // POSIX fs → chmod already handled it
            UserPrincipal owner = Files.getOwner(p);
            AclEntry ownerAll = AclEntry.newBuilder()
                    .setType(AclEntryType.ALLOW)
                    .setPrincipal(owner)
                    .setPermissions(EnumSet.allOf(AclEntryPermission.class))
                    .build();
            view.setAcl(Collections.singletonList(ownerAll));
            return true;
        } catch (Exception ignore) {
            return false; // fail-open: never block bridge startup
        }
    }
}
