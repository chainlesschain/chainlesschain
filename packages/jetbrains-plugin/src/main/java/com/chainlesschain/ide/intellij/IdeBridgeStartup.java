package com.chainlesschain.ide.intellij;

import com.intellij.openapi.project.Project;
import com.intellij.openapi.startup.StartupActivity;
import org.jetbrains.annotations.NotNull;

/**
 * Starts the IDE bridge when a project finishes opening (registered as a
 * postStartupActivity in plugin.xml). The matching teardown is the
 * {@link IdeBridgeService} disposing with the project. SDK-bound.
 */
public final class IdeBridgeStartup implements StartupActivity.DumbAware {
    @Override
    public void runActivity(@NotNull Project project) {
        IdeBridgeService.getInstance(project).start();
    }
}
