package com.chainlesschain.ide;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Single user-facing verdict for the CLI + IDE bridge runtime combination.
 *
 * <p>Java twin of the VS Code runtime-compatibility.js pure core. Both sides
 * are pinned to the same JSON fixture.
 */
public final class RuntimeCompatibility {
    public static final String MIN_CLI_VERSION = "0.162.47";
    public static final String STATUS_READY = "ready";
    public static final String STATUS_DEGRADED = "degraded";
    public static final String STATUS_REPAIR = "repair";

    private RuntimeCompatibility() {}

    public static final class Result {
        public final String status;
        public final String label;
        public final String summary;
        public final String cliVersion;
        public final String minimumCliVersion;
        public final List<String> reasons;

        private Result(String status, String label, String summary,
                String cliVersion, String minimumCliVersion,
                List<String> reasons) {
            this.status = status;
            this.label = label;
            this.summary = summary;
            this.cliVersion = cliVersion;
            this.minimumCliVersion = minimumCliVersion;
            this.reasons = Collections.unmodifiableList(
                    new ArrayList<String>(reasons));
        }
    }

    public static Result evaluate(String cliVersionText,
            String minimumCliVersion, int bridgePort,
            Boolean workspaceTrusted) {
        String minimum = minimumCliVersion == null
                || minimumCliVersion.trim().isEmpty()
                ? MIN_CLI_VERSION : minimumCliVersion;
        String raw = cliVersionText == null ? "" : cliVersionText;
        List<String> reasons = new ArrayList<String>();
        String cliVersion = null;
        boolean cliRequiresRepair = false;

        if (raw.trim().isEmpty()) {
            reasons.add("cc CLI is missing");
            cliRequiresRepair = true;
        } else if (!looksLikeCcVersion(raw)) {
            reasons.add("resolved command is not the chainlesschain CLI");
            cliRequiresRepair = true;
        } else {
            cliVersion = CliVersionCheck.parseVersion(raw);
            if (cliVersion == null) {
                reasons.add("cc CLI version is unrecognized");
                cliRequiresRepair = true;
            } else if (CliVersionCheck.compare(cliVersion, minimum) < 0) {
                reasons.add("cc CLI " + cliVersion
                        + " is older than required " + minimum);
                cliRequiresRepair = true;
            }
        }

        if (bridgePort <= 0) {
            reasons.add("IDE bridge is stopped");
        }
        if (Boolean.FALSE.equals(workspaceTrusted)) {
            reasons.add("workspace trust is restricted");
        }

        String status = cliRequiresRepair
                ? STATUS_REPAIR
                : reasons.isEmpty() ? STATUS_READY : STATUS_DEGRADED;
        String label = label(status);
        String detail = reasons.isEmpty()
                ? "CLI and bridge are compatible"
                : String.join("; ", reasons);
        return new Result(status, label, label + " — " + detail,
                cliVersion, minimum, reasons);
    }

    private static String label(String status) {
        if (STATUS_READY.equals(status)) return "READY (可运行)";
        if (STATUS_DEGRADED.equals(status)) {
            return "DEGRADED (可降级运行)";
        }
        return "NEEDS REPAIR (需要修复)";
    }

    private static boolean looksLikeCcVersion(String output) {
        for (String line : output.split("\\r?\\n")) {
            String trimmed = line.trim();
            if (trimmed.isEmpty()) continue;
            return trimmed.matches("^v?\\d+\\.\\d+\\.\\d+.*");
        }
        return false;
    }
}
