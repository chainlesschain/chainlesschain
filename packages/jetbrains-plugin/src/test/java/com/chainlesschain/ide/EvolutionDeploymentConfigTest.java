package com.chainlesschain.ide;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class EvolutionDeploymentConfigTest {
    @Test
    void buildsOnlyFixedDeploymentCommands() {
        assertEquals(List.of("evolution", "deployment", "status", "--json"),
                EvolutionDeploymentConfig.statusArgs());
        assertEquals(List.of("evolution", "deployment", "configure", "--descriptor",
                        "C:\\managed\\deployment.json", "--trust-root",
                        "C:\\managed\\public.pem", "--json"),
                EvolutionDeploymentConfig.configureArgs(
                        "C:\\managed\\deployment.json", "C:\\managed\\public.pem"));
        assertEquals("enable", EvolutionDeploymentConfig.toggleArgs(true).get(2));
        assertEquals("disable", EvolutionDeploymentConfig.toggleArgs(false).get(2));
        assertEquals(List.of("evolution", "deployment", "init-test", "--module",
                        "C:\\dev\\host.mjs", "--json"),
                EvolutionDeploymentConfig.initTestArgs("C:\\dev\\host.mjs"));
        assertEquals("replace-test", EvolutionDeploymentConfig.replaceTestArgs(
                "C:\\managed\\deployment.json", "C:\\managed\\public.pem").get(2));
        assertThrows(IllegalArgumentException.class,
                () -> EvolutionDeploymentConfig.configureArgs("", "key.pem"));
        assertThrows(IllegalArgumentException.class,
                () -> EvolutionDeploymentConfig.initTestArgs(""));
    }

    @Test
    void parsesStatusWithoutTreatingHoldAsPromotion() {
        EvolutionDeploymentConfig.Status status = EvolutionDeploymentConfig.parseStatus("""
                {"source":"profile","effectiveEnabled":true,"profileEnabled":true,
                 "verified":true,"descriptorPath":"C:/deployment.json",
                 "trustRootPath":"C:/public.pem","profilePath":"C:/profile.json",
                 "deploymentMode":"test","modulePath":"C:/host.mjs",
                 "autoPromotion":"hold","commands":["evolution","learning"],"error":null}
                """);
        assertTrue(status.effectiveEnabled());
        assertTrue(status.profileEnabled());
        assertTrue(status.verified());
        assertEquals("test", status.deploymentMode());
        assertEquals("C:/host.mjs", status.modulePath());
        assertEquals(List.of("evolution", "learning"), status.commands());

        EvolutionDeploymentConfig.Status disabled = EvolutionDeploymentConfig.parseStatus(
                "{\"source\":\"none\",\"effectiveEnabled\":false,\"profileEnabled\":false,\"verified\":false}");
        assertFalse(disabled.effectiveEnabled());
        assertFalse(disabled.readiness().get("ask").known());
        assertFalse(status.readiness().get("agent").known());
    }

    @Test
    void displaysCommandAdmissionWithoutClaimingTaskReadiness() {
        EvolutionDeploymentConfig.Status status = EvolutionDeploymentConfig.parseStatus("""
                {"readiness":{
                  "ask":{"scope":"deployment-admission","state":"admitted","ready":true,
                    "requiredCommands":["ask"],"runtimeVerification":"not_checked","taskReady":null,
                    "detail":"<script>plain text</script>","remediation":null},
                  "agent":{"scope":"deployment-admission","state":"command_not_allowed","ready":false,
                    "requiredCommands":["agent"],"runtimeVerification":"not_checked","taskReady":false,
                    "detail":"agent is not admitted","remediation":"ask the deployment owner"}}}
                """);
        assertTrue(status.readiness().get("ask").admitted());
        assertEquals("<script>plain text</script>", status.readiness().get("ask").detail());
        assertTrue(status.readiness().get("agent").known());
        assertFalse(status.readiness().get("agent").admitted());
        assertEquals("ask the deployment owner", status.readiness().get("agent").remediation());
        assertFalse(EvolutionDeploymentConfig.parseStatus("{}").readiness().get("ask").known());
    }

    @Test
    void rejectsUnrecognizedOrMismatchedAdmissionClaims() {
        for (String projection : List.of(
                "{\"scope\":\"runtime\",\"state\":\"admitted\",\"ready\":true}",
                "{\"scope\":\"deployment-admission\",\"state\":\"admitted\",\"ready\":true,\"runtimeVerification\":\"not_checked\",\"taskReady\":true,\"requiredCommands\":[\"ask\"]}",
                "{\"scope\":\"deployment-admission\",\"state\":\"admitted\",\"ready\":true,\"runtimeVerification\":\"not_checked\",\"taskReady\":null,\"requiredCommands\":[\"agent\"]}")) {
            assertFalse(EvolutionDeploymentConfig.parseStatus("{\"readiness\":{\"ask\":" + projection + "}}")
                    .readiness().get("ask").known());
        }
    }
}
