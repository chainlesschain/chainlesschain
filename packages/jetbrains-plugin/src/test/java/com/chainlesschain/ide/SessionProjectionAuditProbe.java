package com.chainlesschain.ide;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Dependency-free exact-head probe used by the cross-session reliability
 * producer.  It compiles the real JetBrains projection parser (not a mirror or
 * fixture parser) and emits only bounded counters for the audit fragment.
 */
public final class SessionProjectionAuditProbe {
    private SessionProjectionAuditProbe() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("projection JSON path required");
        }
        String json = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
        SessionProjection.Snapshot snapshot = SessionProjection.parse(json);
        if (!snapshot.connected || snapshot.sessions.size() != 1) {
            throw new IllegalStateException("JetBrains rejected canonical projection");
        }
        SessionProjection.MessagingSummary messaging = snapshot.sessions.get(0).messaging;
        if (messaging == null
                || !messaging.registered
                || messaging.endpoints.size() != 1
                || messaging.unread != 1L
                || messaging.held != 1L) {
            throw new IllegalStateException("JetBrains lost cross-session messaging state");
        }
        System.out.print("{\"connected\":true,\"sessions\":1,"
                + "\"endpoints\":" + messaging.endpoints.size() + ","
                + "\"unread\":" + messaging.unread + ","
                + "\"held\":" + messaging.held + "}");
    }
}
