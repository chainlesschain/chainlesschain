package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

final class BridgeSecurityPolicyTest {

    @Test
    void missingManagedSettingsKeepsStrictDefault(@TempDir Path tmp)
            throws Exception {
        assertFalse(BridgeSecurityPolicy.allowInsecureLockfilePermissions(
                tmp.resolve("missing.json")));
    }

    @Test
    void exactManagedIdeBridgeBooleanEnablesDowngrade(@TempDir Path tmp)
            throws Exception {
        Path policy = write(tmp,
                "{\"ideBridge\":{\"allowInsecureLockfilePermissions\":true}}");
        assertTrue(BridgeSecurityPolicy.allowInsecureLockfilePermissions(policy));
    }

    @Test
    void lookalikeRootOrNonBooleanValuesCannotEnableDowngrade(@TempDir Path tmp)
            throws Exception {
        Path rootKey = write(tmp,
                "{\"allowInsecureLockfilePermissions\":true}");
        assertFalse(BridgeSecurityPolicy.allowInsecureLockfilePermissions(rootKey));

        Path stringValue = tmp.resolve("managed-string.json");
        Files.writeString(stringValue,
                "{\"ideBridge\":{\"allowInsecureLockfilePermissions\":\"true\"}}");
        assertFalse(BridgeSecurityPolicy.allowInsecureLockfilePermissions(
                stringValue));
    }

    @Test
    void malformedManagedSettingsFailClosed(@TempDir Path tmp) throws Exception {
        Path policy = write(tmp, "{\"ideBridge\":");
        IOException failure = assertThrows(IOException.class,
                () -> BridgeSecurityPolicy.allowInsecureLockfilePermissions(policy));
        assertTrue(failure.getMessage().contains("unreadable or malformed"));
    }

    private static Path write(Path tmp, String body) throws IOException {
        Path policy = tmp.resolve("managed-settings.json");
        Files.writeString(policy, body);
        return policy;
    }
}
