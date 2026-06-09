package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.Project;
import org.jetbrains.plugins.terminal.LocalTerminalCustomizer;

import java.util.Map;

/**
 * Injects CHAINLESSCHAIN_IDE_PORT / _TOKEN into integrated-terminal sessions so
 * `cc` locks onto exactly this project's bridge (env fast-path), mirroring the
 * VS Code extension's environmentVariableCollection. SDK-bound.
 *
 * Note: the LocalTerminalCustomizer signature has varied across platform
 * versions; this targets the 4-arg form. If building against an older SDK,
 * adapt to the (Project, String[], Map) overload.
 */
public final class IdeBridgeTerminalCustomizer extends LocalTerminalCustomizer {
    @Override
    public String[] customizeCommandAndEnvironment(Project project,
                                                   String workingDirectory,
                                                   String[] command,
                                                   Map<String, String> envs) {
        if (project != null) {
            IdeBridgeService svc = IdeBridgeService.getInstance(project);
            if (svc != null && svc.getPort() > 0 && svc.getToken() != null) {
                envs.put("CHAINLESSCHAIN_IDE_PORT", String.valueOf(svc.getPort()));
                envs.put("CHAINLESSCHAIN_IDE_TOKEN", svc.getToken());
            }
        }
        return command;
    }
}
