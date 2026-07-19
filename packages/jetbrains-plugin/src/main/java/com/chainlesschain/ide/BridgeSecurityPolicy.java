package com.chainlesschain.ide;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Map;

/**
 * Organization-managed security policy for the IDE bridge.
 *
 * <p>The default path matches the CLI managed-settings layer. There is
 * deliberately no ordinary IDE/user/workspace setting for this downgrade:
 *
 * <pre>
 * {
 *   "ideBridge": {
 *     "allowInsecureLockfilePermissions": true
 *   }
 * }
 * </pre>
 */
public final class BridgeSecurityPolicy {

    public static final String ALLOW_INSECURE_LOCKFILE_PERMISSIONS =
            "allowInsecureLockfilePermissions";

    private BridgeSecurityPolicy() {}

    /** Canonical organization-controlled settings path. */
    public static Path managedSettingsPath() {
        if (isWindows()) {
            String base = System.getenv("ProgramData");
            if (base == null || base.trim().isEmpty()) {
                base = System.getenv("PROGRAMDATA");
            }
            if (base == null || base.trim().isEmpty()) {
                base = "C:\\ProgramData";
            }
            return Paths.get(base, "ChainlessChain", "managed-settings.json");
        }
        return Paths.get("/etc/chainlesschain/managed-settings.json");
    }

    /**
     * Load the canonical managed policy. Missing means strict/default false;
     * malformed or unreadable policy throws so bridge startup fails closed.
     */
    public static boolean allowInsecureLockfilePermissions() throws IOException {
        return allowInsecureLockfilePermissions(managedSettingsPath());
    }

    /** Test/admin seam for parsing an explicit managed-settings file. */
    static boolean allowInsecureLockfilePermissions(Path file) throws IOException {
        if (!Files.exists(file)) return false;
        final Map<String, Object> root;
        try {
            String body = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
            root = MiniJson.parseObject(body);
        } catch (Exception e) {
            throw new IOException(
                    "managed settings are unreadable or malformed: " + file, e);
        }
        if (root == null) return false;
        Object rawBridge = root.get("ideBridge");
        if (!(rawBridge instanceof Map)) return false;
        Object raw = ((Map<?, ?>) rawBridge).get(
                ALLOW_INSECURE_LOCKFILE_PERMISSIONS);
        return Boolean.TRUE.equals(raw);
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "")
                .toLowerCase(java.util.Locale.ROOT)
                .contains("win");
    }
}
