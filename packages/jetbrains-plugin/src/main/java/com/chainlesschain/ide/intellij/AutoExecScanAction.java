package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AutoExecGuard;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/**
 * Auto-exec config guard action (Tools menu, P2 #13) — scans the open project
 * for files that can run code without an explicit action (MCP configs, git/husky
 * hooks, shell profiles, VS Code tasks/launch, JetBrains run configs) and lets
 * the user trust the workspace. The trust flag is persisted per project path in
 * {@link PropertiesComponent}. Pure core: {@link AutoExecGuard}. VS Code twin:
 * {@code chainlesschain.workspace.scanAutoExec} + activation advisory.
 */
public final class AutoExecScanAction extends AnAction {

    private static final String ACK_PREFIX = "chainlesschain.autoExecAck:";

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        String base = project != null ? project.getBasePath() : null;
        if (base == null) {
            Messages.showInfoMessage(project, "Open a project first.", "Auto-Exec Config");
            return;
        }
        List<AutoExecGuard.Finding> findings = scan(base);
        if (findings.isEmpty()) {
            Messages.showInfoMessage(project,
                    "No auto-executable config found in this workspace.", "Auto-Exec Config");
            return;
        }
        PropertiesComponent props = PropertiesComponent.getInstance();
        String key = ACK_PREFIX + base;
        boolean trusted = props.getBoolean(key, false);
        String msg = AutoExecGuard.summarize(findings)
                + (trusted ? "\n\n(This workspace is currently trusted.)" : "");
        String[] options = trusted
                ? new String[] {"Untrust", "Close"}
                : new String[] {"Trust workspace", "Close"};
        int choice = Messages.showDialog(project, msg, "Auto-Exec Config",
                options, 0, Messages.getWarningIcon());
        if (choice == 0) {
            if (trusted) props.unsetValue(key);
            else props.setValue(key, true);
        }
    }

    /**
     * Scan the project root + the dirs where auto-exec config hides one level
     * deep, returning classified findings. Static so a project-open advisory can
     * reuse it. Never throws (missing dirs skipped).
     */
    static List<AutoExecGuard.Finding> scan(String basePath) {
        List<String> rels = new ArrayList<>();
        File base = new File(basePath);
        listInto(rels, base, "");
        for (String d : new String[] {
                ".vscode", ".idea", ".idea/runConfigurations", ".git/hooks", ".husky"}) {
            listInto(rels, new File(base, d), d);
        }
        return AutoExecGuard.scan(rels);
    }

    private static void listInto(List<String> out, File dir, String relPrefix) {
        String[] names = dir.list();
        if (names == null) return;
        for (String name : names) {
            out.add(relPrefix.isEmpty() ? name : relPrefix + "/" + name);
        }
    }

    static boolean isTrusted(String basePath) {
        return basePath != null
                && PropertiesComponent.getInstance().getBoolean(ACK_PREFIX + basePath, false);
    }
}
