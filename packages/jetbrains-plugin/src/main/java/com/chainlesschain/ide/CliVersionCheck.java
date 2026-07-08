package com.chainlesschain.ide;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure cc-CLI version-compare + update-notice logic (mirrors the VS Code
 * extension's {@code version-check.js} latestUpdateNotice). The plugin and the
 * {@code chainlesschain} CLI ship on independent tracks (JetBrains Marketplace
 * vs npm), so a working-but-old {@code cc} silently misses newer panel features
 * unless the user is told. SDK-free / Java 8 / locally testable — the host glue
 * (run {@code cc --version}, fetch the npm {@code latest} tag, show the hint)
 * lives in ConversationView.
 */
public final class CliVersionCheck {
    private CliVersionCheck() {}

    /** The shell command that upgrades the global CLI to the latest npm. */
    public static final String UPGRADE_COMMAND = "npm i -g chainlesschain@latest";

    private static final Pattern SEMVER = Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)");

    /** Extract {@code x.y.z} (prerelease suffix ignored) from version output, or null. */
    public static String parseVersion(String s) {
        if (s == null) return null;
        Matcher m = SEMVER.matcher(s);
        return m.find() ? m.group(0) : null;
    }

    /** Compare two {@code x.y.z} versions (prerelease ignored): -1 / 0 / 1. */
    public static int compare(String a, String b) {
        String[] pa = String.valueOf(a).split("-")[0].split("\\.");
        String[] pb = String.valueOf(b).split("-")[0].split("\\.");
        for (int i = 0; i < 3; i++) {
            int da = i < pa.length ? intOr0(pa[i]) : 0;
            int db = i < pb.length ? intOr0(pb[i]) : 0;
            if (da != db) return da < db ? -1 : 1;
        }
        return 0;
    }

    private static int intOr0(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /**
     * The "a newer cc is available" hint line, or null when up to date / ahead /
     * unknown. Both inputs are raw strings (parsed here).
     */
    public static String updateNotice(String installedRaw, String latestRaw) {
        String installed = parseVersion(installedRaw);
        String latest = parseVersion(latestRaw);
        if (installed == null || latest == null) return null;
        if (compare(installed, latest) >= 0) return null; // up to date or ahead
        return "A newer cc " + latest + " is available (you have " + installed + ") — run `"
                + UPGRADE_COMMAND + "` to get the latest features.";
    }

    /** Pull the {@code "version":"x.y.z"} out of a npm registry JSON body, or null. */
    public static String parseNpmLatest(String json) {
        if (json == null) return null;
        Matcher m = Pattern.compile("\"version\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }
}
