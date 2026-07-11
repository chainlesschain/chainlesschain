package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.AclEntry;
import java.nio.file.attribute.AclEntryPermission;
import java.nio.file.attribute.AclEntryType;
import java.nio.file.attribute.AclFileAttributeView;
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

    public LockfileWriter() {
        this(Paths.get(System.getProperty("user.home"), ".chainlesschain", "ide"));
    }

    /** Test seam: point the writer at an arbitrary directory. */
    public LockfileWriter(Path lockDir) {
        this(lockDir, LockfileWriter::defaultProcessAlive);
    }

    /** Test seam: arbitrary directory + a custom pid-liveness probe. */
    public LockfileWriter(Path lockDir, java.util.function.LongPredicate processAlive) {
        this.dir = lockDir;
        this.processAlive = processAlive;
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
        Files.createDirectories(dir);
        restrictToOwner(dir, EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE));

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

        Path file = dir.resolve(port + ".json");
        byte[] body = MiniJson.stringify(lock).getBytes(StandardCharsets.UTF_8);
        // Atomic publish: write a temp sibling then move into place, so the
        // CLI's discovery reader can never observe a half-written JSON file.
        Path tmp = dir.resolve(port + ".json.tmp-" + ProcessHandle.current().pid());
        try {
            Files.write(tmp, body);
            restrictToOwner(tmp, EnumSet.of(
                    PosixFilePermission.OWNER_READ,
                    PosixFilePermission.OWNER_WRITE));
            try {
                Files.move(tmp, file, java.nio.file.StandardCopyOption.ATOMIC_MOVE,
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException moveFailed) {
            // Fall back to the plain write rather than losing discovery entirely.
            Files.deleteIfExists(tmp);
            Files.write(file, body);
        }
        restrictToOwner(file, EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE));
        return file;
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
     * an explicit owner-only ACL. Both paths are strictly fail-open: a
     * permission failure must never block bridge startup.
     */
    private static void restrictToOwner(Path p, Set<PosixFilePermission> perms) {
        if (!tryChmod(p, perms)) {
            tightenOwnerOnlyAcl(p);
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
            // POSIX filesystem but chmod failed — best-effort, no-op (the ACL
            // view does not exist there either).
            return true;
        }
    }

    /**
     * Windows twin of the 0600/0700 chmod: replace the ACL with a single
     * entry granting the file's owner full control (pure JDK, no icacls
     * subprocess). Fail-open — returns false instead of throwing so ACL
     * problems can never block bridge startup.
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
