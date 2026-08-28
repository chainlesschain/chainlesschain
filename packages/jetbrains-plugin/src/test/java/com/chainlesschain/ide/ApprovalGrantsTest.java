package com.chainlesschain.ide;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ApprovalGrantsTest {
    private static final String ID = "grant_" + "a".repeat(64);

    @Test
    void parsesBoundedListAndRevocationProjection() {
        Map<String, Object> grant = grant();
        Map<String, Object> list = new LinkedHashMap<>();
        list.put("schema", ApprovalGrants.SCHEMA);
        list.put("action", "list");
        list.put("grants", List.of(grant));

        ApprovalGrants.Projection listed = ApprovalGrants.parse(MiniJson.stringify(list));
        assertEquals("list", listed.action);
        assertEquals(1, listed.grants.size());
        assertEquals("tool:run_shell", listed.grants.get(0).capability);
        assertEquals("Current session", listed.grants.get(0).lifetimeLabel());

        list.put("action", "revoke");
        list.put("revoked", grant);
        list.put("grants", List.of());
        ApprovalGrants.Projection revoked = ApprovalGrants.parse(MiniJson.stringify(list));
        assertEquals(ID, revoked.revoked.grantId);
        assertEquals(0, revoked.grants.size());
    }

    @Test
    @SuppressWarnings("unchecked")
    void rejectsMalformedOrUnboundedAuthorityOutput() {
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("schema", ApprovalGrants.SCHEMA);
        root.put("action", "list");
        root.put("grants", List.of(grant(), grant()));
        assertThrows(IllegalArgumentException.class,
                () -> ApprovalGrants.parse(MiniJson.stringify(root)),
                "duplicate ids must not render as two revocation targets");

        Map<String, Object> badGrant = grant();
        ((Map<String, Object>) badGrant.get("permission"))
                .put("scope", "x".repeat(1025));
        root.put("grants", List.of(badGrant));
        assertThrows(IllegalArgumentException.class,
                () -> ApprovalGrants.parse(MiniJson.stringify(root)));

        root.put("action", "revoke");
        root.put("grants", List.of());
        root.remove("revoked");
        assertThrows(IllegalArgumentException.class,
                () -> ApprovalGrants.parse(MiniJson.stringify(root)));
    }

    private static Map<String, Object> grant() {
        Map<String, Object> permission = new LinkedHashMap<>();
        permission.put("capability", "tool:run_shell");
        permission.put("scope", "{\"args\":{\"command\":\"npm test\"}}");
        Map<String, Object> grant = new LinkedHashMap<>();
        grant.put("grantId", ID);
        grant.put("lifetime", "session");
        grant.put("permission", permission);
        grant.put("binding", "sha256:exact-call");
        grant.put("grantedAt", "2026-08-28T08:00:00.000Z");
        return grant;
    }
}
