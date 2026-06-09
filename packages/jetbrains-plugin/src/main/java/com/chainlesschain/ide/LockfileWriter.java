package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermission;
import java.security.SecureRandom;
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

    public LockfileWriter() {
        this(Paths.get(System.getProperty("user.home"), ".chainlesschain", "ide"));
    }

    /** Test seam: point the writer at an arbitrary directory. */
    public LockfileWriter(Path lockDir) {
        this.dir = lockDir;
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
        tryChmod(dir, EnumSet.of(
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
        Files.write(file, MiniJson.stringify(lock).getBytes(StandardCharsets.UTF_8));
        tryChmod(file, EnumSet.of(
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

    private static void tryChmod(Path p, Set<PosixFilePermission> perms) {
        try {
            Files.setPosixFilePermissions(p, perms);
        } catch (UnsupportedOperationException | IOException ignore) {
            // Windows / non-POSIX filesystem — best-effort, no-op.
        }
    }
}
