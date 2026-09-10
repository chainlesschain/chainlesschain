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
        assertThrows(IllegalArgumentException.class,
                () -> EvolutionDeploymentConfig.configureArgs("", "key.pem"));
    }

    @Test
    void parsesStatusWithoutTreatingHoldAsPromotion() {
        EvolutionDeploymentConfig.Status status = EvolutionDeploymentConfig.parseStatus("""
                {"source":"profile","effectiveEnabled":true,"profileEnabled":true,
                 "verified":true,"descriptorPath":"C:/deployment.json",
                 "trustRootPath":"C:/public.pem","profilePath":"C:/profile.json",
                 "autoPromotion":"hold","commands":["evolution","learning"],"error":null}
                """);
        assertTrue(status.effectiveEnabled());
        assertTrue(status.profileEnabled());
        assertTrue(status.verified());
        assertEquals(List.of("evolution", "learning"), status.commands());

        EvolutionDeploymentConfig.Status disabled = EvolutionDeploymentConfig.parseStatus(
                "{\"source\":\"none\",\"effectiveEnabled\":false,\"profileEnabled\":false,\"verified\":false}");
        assertFalse(disabled.effectiveEnabled());
    }
}
