package com.chainlesschain.ide;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Bounded parser for the live CLI approval-grant review projection. */
public final class ApprovalGrants {
    public static final String SCHEMA = "chainlesschain.approval-grants/v1";
    private static final Pattern GRANT_ID = Pattern.compile("grant_[0-9a-f]{64}");
    private static final int MAX_GRANTS = 128;

    private ApprovalGrants() {}

    public static final class Grant {
        public final String grantId;
        public final String lifetime;
        public final String capability;
        public final String scope;
        public final String expiresAt;
        public final String grantedAt;
        public final String turnId;

        private Grant(String grantId, String lifetime, String capability,
                      String scope, String expiresAt, String grantedAt,
                      String turnId) {
            this.grantId = grantId;
            this.lifetime = lifetime;
            this.capability = capability;
            this.scope = scope;
            this.expiresAt = expiresAt;
            this.grantedAt = grantedAt;
            this.turnId = turnId;
        }

        public String lifetimeLabel() {
            return "session".equals(lifetime) ? "Current session" : "Current turn";
        }

        @Override
        public String toString() {
            return lifetimeLabel() + " · " + capability;
        }
    }

    public static final class Projection {
        public final String action;
        public final List<Grant> grants;
        public final Grant revoked;

        private Projection(String action, List<Grant> grants, Grant revoked) {
            this.action = action;
            this.grants = Collections.unmodifiableList(grants);
            this.revoked = revoked;
        }
    }

    /** Parse only the exact, bounded projection emitted by {@code /permissions grants}. */
    public static Projection parse(String text) {
        Map<String, Object> root = MiniJson.parseObject(text == null ? "" : text.trim());
        if (!SCHEMA.equals(root.get("schema"))) {
            throw new IllegalArgumentException("unexpected approval grant schema");
        }
        String action = requiredString(root.get("action"), "action", 16);
        if (!"list".equals(action) && !"revoke".equals(action)) {
            throw new IllegalArgumentException("unsupported approval grant action");
        }
        if (!(root.get("grants") instanceof List)) {
            throw new IllegalArgumentException("approval grants must be an array");
        }
        List<?> raw = (List<?>) root.get("grants");
        if (raw.size() > MAX_GRANTS) {
            throw new IllegalArgumentException("too many approval grants");
        }
        List<Grant> grants = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Object value : raw) {
            Grant grant = parseGrant(value);
            if (!ids.add(grant.grantId)) {
                throw new IllegalArgumentException("duplicate approval grant id");
            }
            grants.add(grant);
        }
        Grant revoked = root.get("revoked") == null ? null : parseGrant(root.get("revoked"));
        if ("revoke".equals(action) && revoked == null) {
            throw new IllegalArgumentException("revoke result is missing revoked grant");
        }
        return new Projection(action, grants, revoked);
    }

    @SuppressWarnings("unchecked")
    private static Grant parseGrant(Object raw) {
        if (!(raw instanceof Map)) {
            throw new IllegalArgumentException("approval grant must be an object");
        }
        Map<String, Object> value = (Map<String, Object>) raw;
        String grantId = requiredString(value.get("grantId"), "grantId", 80);
        if (!GRANT_ID.matcher(grantId).matches()) {
            throw new IllegalArgumentException("invalid approval grant id");
        }
        String lifetime = requiredString(value.get("lifetime"), "lifetime", 16);
        if (!"turn".equals(lifetime) && !"session".equals(lifetime)) {
            throw new IllegalArgumentException("invalid approval grant lifetime");
        }
        if (!(value.get("permission") instanceof Map)) {
            throw new IllegalArgumentException("approval grant permission must be an object");
        }
        Map<String, Object> permission = (Map<String, Object>) value.get("permission");
        String capability = requiredString(
                permission.get("capability"), "permission.capability", 128);
        String scope = requiredString(permission.get("scope"), "permission.scope", 1024);
        String expiresAt = optionalInstant(permission.get("expiresAt"), "permission.expiresAt");
        String grantedAt = requiredString(value.get("grantedAt"), "grantedAt", 64);
        requireInstant(grantedAt, "grantedAt");
        String turnId = optionalString(value.get("turnId"), "turnId", 160);
        return new Grant(grantId, lifetime, capability, scope, expiresAt, grantedAt, turnId);
    }

    private static String requiredString(Object raw, String field, int max) {
        if (!(raw instanceof String) || ((String) raw).isEmpty()
                || ((String) raw).length() > max) {
            throw new IllegalArgumentException("invalid " + field);
        }
        return (String) raw;
    }

    private static String optionalString(Object raw, String field, int max) {
        if (raw == null) return null;
        if (!(raw instanceof String) || ((String) raw).isEmpty()
                || ((String) raw).length() > max) {
            throw new IllegalArgumentException("invalid " + field);
        }
        return (String) raw;
    }

    private static String optionalInstant(Object raw, String field) {
        String value = optionalString(raw, field, 64);
        if (value != null) requireInstant(value, field);
        return value;
    }

    private static void requireInstant(String value, String field) {
        try {
            Instant.parse(value);
        } catch (DateTimeParseException error) {
            throw new IllegalArgumentException("invalid " + field, error);
        }
    }
}
