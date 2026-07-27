package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.MiniJson;
import com.chainlesschain.ide.PluginManager;
import com.chainlesschain.ide.PluginQuality;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;

import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Plugin / MCP manager dialog (Tools menu, P1 #7 + gap #11) — four tabs over
 * the CLI's --json surface: runtime plugins (trust/untrust · uninstall · add),
 * a read-only Quality board (per-plugin component counts + broken/lsp/unused
 * flags from `plugin validate` and `code-intel status`), MCP servers
 * (test-connect · remove) and a filterable read-only skills listing.
 * Every action shells out to the CLI off-EDT and re-lists, so the CLI store
 * stays the single source of truth. Pure cores: {@link PluginManager} +
 * {@link PluginQuality}. VS Code twin: {@code chainlesschain.plugins.manage}
 * (webview there).
 */
public final class PluginManagerAction extends AnAction {

    private static final long CLI_TIMEOUT_MS = 30000;
    private static final long SLOW_CLI_TIMEOUT_MS = 120000;

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        Project project = e.getProject();
        final File cwd = project != null && project.getBasePath() != null
                ? new File(project.getBasePath()) : null;

        final AtomicReference<List<Map<String, Object>>> plugins = new AtomicReference<>();
        final AtomicReference<List<Map<String, Object>>> mcp = new AtomicReference<>();
        final AtomicReference<List<Map<String, Object>>> skills = new AtomicReference<>();

        DefaultListModel<String> pluginModel = new DefaultListModel<>();
        DefaultListModel<String> mcpModel = new DefaultListModel<>();
        DefaultListModel<String> skillModel = new DefaultListModel<>();
        JList<String> pluginList = new JList<>(pluginModel);
        JList<String> mcpList = new JList<>(mcpModel);
        JList<String> skillList = new JList<>(skillModel);
        JLabel status = new JLabel(" ");
        JTextField skillFilter = new JTextField(18);

        // ---- quality tab widgets (gap #11) --------------------------------
        JTextArea qualityArea = new JTextArea(CcBundle.message("plugins.quality.loading"));
        qualityArea.setEditable(false);
        qualityArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN,
                qualityArea.getFont().getSize()));
        JLabel qualitySummary = new JLabel(" ");

        Runnable refresh = () -> {
            status.setText("loading…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String pluginsOut = AgentChatSession.runCapture(
                        PluginManager.buildPluginInstalledArgs(), cwd, CLI_TIMEOUT_MS);
                String mcpOut = AgentChatSession.runCapture(
                        PluginManager.buildMcpServersArgs(), cwd, CLI_TIMEOUT_MS);
                String skillsOut = AgentChatSession.runCapture(
                        PluginManager.buildSkillListArgs(), cwd, SLOW_CLI_TIMEOUT_MS);
                plugins.set(PluginManager.parsePluginInstalled(pluginsOut));
                mcp.set(PluginManager.parseMcpServers(mcpOut));
                skills.set(PluginManager.parseSkillList(skillsOut));
                ApplicationManager.getApplication().invokeLater(() -> {
                    fill(pluginModel, plugins.get(), PluginManager::formatPluginLine,
                            "no runtime plugins installed");
                    fill(mcpModel, mcp.get(), PluginManager::formatMcpLine,
                            "no MCP servers configured");
                    applySkillFilter(skillModel, skills.get(), skillFilter.getText());
                    status.setText(plugins.get() == null && mcp.get() == null
                            ? "could not read CLI output — is cc installed?" : " ");
                });
                // Quality board (gap #11): per-plugin `plugin validate` +
                // `code-intel status`. Runs after the lists so the tabs fill
                // first; every per-plugin validate failure is tolerated and an
                // unreadable status probe degrades the LSP flag to "unknown" —
                // one failing source never blanks the section.
                String lspOut = AgentChatSession.runCapture(
                        PluginQuality.buildCodeIntelStatusArgs(), cwd, SLOW_CLI_TIMEOUT_MS);
                List<PluginQuality.StatusServer> lspStatus =
                        PluginQuality.parseCodeIntelStatus(lspOut);
                Map<String, PluginQuality.Validation> validations =
                        new LinkedHashMap<String, PluginQuality.Validation>();
                List<Map<String, Object>> pluginRows = plugins.get();
                if (pluginRows != null) {
                    for (Map<String, Object> p : pluginRows) {
                        String name = String.valueOf(p.get("name"));
                        String dir = p.get("dir") == null ? "" : String.valueOf(p.get("dir"));
                        if (dir.isEmpty()) {
                            validations.put(name, PluginQuality.Validation.failure(
                                    "no install dir reported"));
                            continue;
                        }
                        String out = null;
                        try {
                            out = AgentChatSession.runCapture(
                                    PluginQuality.buildPluginValidateArgs(dir),
                                    cwd, CLI_TIMEOUT_MS);
                        } catch (Throwable ignored) {
                            // per-plugin tolerance — reported as failed below
                        }
                        PluginQuality.Validation v = PluginQuality.parsePluginValidate(out);
                        validations.put(name, v != null ? v
                                : PluginQuality.Validation.failure("validate produced no JSON"));
                    }
                }
                List<PluginQuality.Row> qualityRows = PluginQuality.buildQualityRows(
                        pluginRows, validations, lspStatus);
                final String boardText =
                        PluginQuality.describe(qualityRows, lspStatus != null);
                final String summaryText =
                        PluginQuality.summaryLine(qualityRows, lspStatus != null);
                ApplicationManager.getApplication().invokeLater(() -> {
                    qualityArea.setText(boardText);
                    qualityArea.setCaretPosition(0);
                    qualitySummary.setText(summaryText);
                });
            });
        };

        skillFilter.getDocument().addDocumentListener(
                new javax.swing.event.DocumentListener() {
                    private void changed() {
                        applySkillFilter(skillModel, skills.get(), skillFilter.getText());
                    }
                    @Override public void insertUpdate(javax.swing.event.DocumentEvent ev) { changed(); }
                    @Override public void removeUpdate(javax.swing.event.DocumentEvent ev) { changed(); }
                    @Override public void changedUpdate(javax.swing.event.DocumentEvent ev) { changed(); }
                });

        // ---- plugins tab -------------------------------------------------
        JButton trust = new JButton("Trust");
        JButton untrust = new JButton("Untrust");
        JButton lifecycle = new JButton("Enable / Disable");
        JButton upgrade = new JButton("Upgrade…");
        JButton versions = new JButton("Versions…");
        JButton capabilities = new JButton("Capabilities…");
        JButton details = new JButton("Supply-chain details…");
        JButton uninstall = new JButton("Uninstall…");
        JButton add = new JButton("Add…");
        // Thread the row's install scope through — CLI trust/untrust default to
        // scope project, and the panel's Add installs at user scope (B-drift fix).
        trust.addActionListener(ev -> withSelectedPlugin(project, pluginList, plugins.get(), p ->
                runThenRefreshAndReload(PluginManager.buildPluginTrustArgs(
                        String.valueOf(p.get("name")), true, scopeOf(p)),
                        cwd, refresh, status, project)));
        untrust.addActionListener(ev -> withSelectedPlugin(project, pluginList, plugins.get(), p ->
                runThenRefreshAndReload(PluginManager.buildPluginTrustArgs(
                        String.valueOf(p.get("name")), false, scopeOf(p)),
                        cwd, refresh, status, project)));
        lifecycle.addActionListener(ev ->
                withSelectedPlugin(project, pluginList, plugins.get(), p -> {
                    boolean enable = Boolean.FALSE.equals(p.get("enabled"));
                    if (!enable) {
                        int decision = Messages.showYesNoDialog(
                                project,
                                "Disable " + p.get("name") + " (" + scopeOf(p)
                                        + " scope)? Installed versions and configuration "
                                        + "are retained, but runtime components stop loading.",
                                "Disable Plugin", null);
                        if (decision != Messages.YES) return;
                    }
                    runThenRefreshAndReload(
                            PluginManager.buildPluginLifecycleArgs(
                                    String.valueOf(p.get("name")), enable, scopeOf(p)),
                            cwd, refresh, status, project);
                }));
        upgrade.addActionListener(ev ->
                withSelectedPlugin(project, pluginList, plugins.get(), p -> {
                    Map<?, ?> source = asMap(p.get("source"));
                    String registry = value(source, "registry");
                    String packageName = value(source, "package");
                    boolean useRegistry = !registry.isEmpty() && !packageName.isEmpty();
                    String target = useRegistry
                            ? packageName
                            : firstNonEmpty(
                                    value(source, "resolvedSource"),
                                    value(source, "source"));
                    if (target.isEmpty()) {
                        target = Messages.showInputDialog(
                                project,
                                "Upgrade source for " + p.get("name"),
                                "Upgrade Plugin", null);
                        if (target == null || target.trim().isEmpty()) return;
                        target = target.trim();
                        useRegistry = false;
                    }
                    int decision = Messages.showYesNoDialog(
                            project,
                            "Upgrade " + p.get("name")
                                    + " from its pinned source? The current immutable "
                                    + "version remains available for rollback.",
                            "Upgrade Plugin", null);
                    if (decision != Messages.YES) return;
                    runThenRefreshSlowAndReload(
                            PluginManager.buildPluginUpgradeArgs(
                                    target,
                                    scopeOf(p),
                                    useRegistry ? registry : null,
                                    useRegistry ? packageName : null),
                            cwd, refresh, status, project);
                }));
        versions.addActionListener(ev ->
                withSelectedPlugin(project, pluginList, plugins.get(), p -> {
                    List<String> choices = new ArrayList<String>();
                    Object rawVersions = p.get("versions");
                    String active = String.valueOf(p.get("version"));
                    if (rawVersions instanceof List) {
                        for (Object version : (List<?>) rawVersions) {
                            if (version instanceof String
                                    && !((String) version).isEmpty()
                                    && !active.equals(version)) {
                                choices.add((String) version);
                            }
                        }
                    }
                    if (choices.isEmpty()) {
                        Messages.showInfoMessage(project,
                                String.valueOf(p.get("name"))
                                        + " has no other installed version to activate.",
                                "Plugin Versions");
                        return;
                    }
                    String selected = ChoiceDialog.choose(
                            project,
                            "Switch " + p.get("name") + " from v" + active,
                            "Select an installed version. Existing sessions keep their "
                                    + "loaded bytes; new sessions use the selected version.",
                            choices,
                            choices.get(0));
                    if (selected == null) return;
                    runThenRefreshAndReload(PluginManager.buildPluginUseArgs(
                                    String.valueOf(p.get("name")), selected, scopeOf(p)),
                            cwd, refresh, status, project);
                }));
        capabilities.addActionListener(ev ->
                withSelectedPlugin(project, pluginList, plugins.get(), p ->
                        manageCapabilityConsent(project, p, cwd, refresh, status)));
        details.addActionListener(ev ->
                withSelectedPlugin(project, pluginList, plugins.get(), p ->
                        showPluginDetails(project, p)));
        uninstall.addActionListener(ev -> withSelectedPlugin(project, pluginList, plugins.get(), p -> {
            String name = String.valueOf(p.get("name"));
            String scope = String.valueOf(p.get("scope"));
            int r = Messages.showYesNoDialog(project,
                    "Uninstall plugin " + name + " (" + scope
                            + " scope)? Its installed files are removed.",
                    "Uninstall Plugin", null);
            if (r != Messages.YES) return;
            runThenRefresh(PluginManager.buildPluginUninstallArgs(name, scope),
                    cwd, refresh, status);
        }));
        add.addActionListener(ev -> {
            String source = Messages.showInputDialog(project,
                    "Plugin source — a local directory, or a name to fetch from a registry",
                    "Add Plugin", null);
            if (source == null || source.trim().isEmpty()) return;
            String registry = Messages.showInputDialog(project,
                    "Registry URL (leave empty to install the source as a local directory)",
                    "Add Plugin", null);
            if (registry == null) return;
            runThenRefreshSlow(PluginManager.buildPluginAddArgs(
                    source.trim(), registry.trim()), cwd, refresh, status);
        });
        JPanel pluginTab = tab(
                pluginList, lifecycle, upgrade, trust, untrust, versions,
                capabilities, details, uninstall, add);

        // ---- MCP tab -----------------------------------------------------
        JButton test = new JButton("Test connect");
        JButton remove = new JButton("Remove…");
        test.addActionListener(ev -> withSelectedPlugin(project, mcpList, mcp.get(), s -> {
            String name = String.valueOf(s.get("name"));
            status.setText("connecting " + name + "…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                String out = AgentChatSession.runCapture(
                        PluginManager.buildMcpConnectArgs(name), cwd, 60000);
                ApplicationManager.getApplication().invokeLater(() ->
                        status.setText("connect " + name + ": "
                                + (out == null || out.isEmpty()
                                        ? "no output (unreachable?)"
                                        : out.trim().length() > 160
                                                ? out.trim().substring(0, 160) + "…"
                                                : out.trim())));
            });
        }));
        remove.addActionListener(ev -> withSelectedPlugin(project, mcpList, mcp.get(), s -> {
            String name = String.valueOf(s.get("name"));
            int r = Messages.showYesNoDialog(project,
                    "Remove MCP server " + name + " from the configuration?",
                    "Remove MCP Server", null);
            if (r != Messages.YES) return;
            runThenRefresh(PluginManager.buildMcpRemoveArgs(name), cwd, refresh, status);
        }));
        JPanel mcpTab = tab(mcpList, test, remove);

        // ---- skills tab (read-only + filter) -----------------------------
        JPanel skillTop = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        skillTop.add(new JLabel("Filter:"));
        skillTop.add(skillFilter);
        JPanel skillTab = new JPanel(new BorderLayout(4, 4));
        skillTab.add(skillTop, BorderLayout.NORTH);
        skillTab.add(new JScrollPane(skillList), BorderLayout.CENTER);

        // ---- quality tab (gap #11, read-only board) -----------------------
        JPanel qualityTab = new JPanel(new BorderLayout(4, 4));
        JPanel qualityTop = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        qualityTop.add(qualitySummary);
        qualityTab.add(qualityTop, BorderLayout.NORTH);
        qualityTab.add(new JScrollPane(qualityArea), BorderLayout.CENTER);

        JTabbedPane tabs = new JTabbedPane();
        tabs.addTab("Plugins", pluginTab);
        tabs.addTab(CcBundle.message("plugins.quality.tab"), qualityTab);
        tabs.addTab("MCP servers", mcpTab);
        tabs.addTab("Skills", skillTab);

        JPanel root = new JPanel(new BorderLayout(6, 6));
        root.add(tabs, BorderLayout.CENTER);
        JPanel bottom = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        JButton refreshBtn = new JButton("Refresh");
        refreshBtn.addActionListener(ev -> refresh.run());
        JButton reloadBtn = new JButton("Reload live sessions");
        reloadBtn.addActionListener(ev -> {
            int count = ChatToolWindowFactory.reloadPluginRuntimes(project);
            status.setText(count > 0
                    ? "plugin reload requested in " + count + " live session(s)"
                    : "no live foreground session; new sessions already use current state");
        });
        bottom.add(refreshBtn);
        bottom.add(reloadBtn);
        bottom.add(status);
        root.add(bottom, BorderLayout.SOUTH);
        root.setPreferredSize(new Dimension(860, 480));

        refresh.run();
        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain — Plugins & MCP");
        b.setCenterPanel(root);
        b.addOkAction().setText("Close");
        b.show();
    }

    private static JPanel tab(JList<String> list, JButton... buttons) {
        JPanel panel = new JPanel(new BorderLayout(4, 4));
        panel.add(new JScrollPane(list), BorderLayout.CENTER);
        JPanel btns = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        for (JButton btn : buttons) btns.add(btn);
        panel.add(btns, BorderLayout.SOUTH);
        return panel;
    }

    /** The installed-list row's scope ("" when the parse had none). */
    private static String scopeOf(Map<String, Object> p) {
        Object scope = p.get("scope");
        return scope == null ? "" : String.valueOf(scope);
    }

    /** Run the selected-row action, or explain that a row must be selected. */
    private static void withSelectedPlugin(Project project, JList<String> list,
            List<Map<String, Object>> rows,
            java.util.function.Consumer<Map<String, Object>> action) {
        int idx = list.getSelectedIndex();
        if (rows == null || idx < 0 || idx >= rows.size()) {
            Messages.showInfoMessage(project, "Select a row first.", "Plugins & MCP");
            return;
        }
        action.accept(rows.get(idx));
    }

    private static void manageCapabilityConsent(
            Project project, Map<String, Object> plugin, File cwd,
            Runnable refresh, JLabel status) {
        String name = String.valueOf(plugin.get("name"));
        String scope = scopeOf(plugin);
        status.setText("reading capabilities for " + name + "…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            String out = AgentChatSession.runCapture(
                    PluginManager.buildPluginConsentArgs(name, "status", scope),
                    cwd, CLI_TIMEOUT_MS);
            Map<?, ?> details = null;
            try {
                Object parsed = MiniJson.parse(out == null ? "" : out.trim());
                if (parsed instanceof Map) details = (Map<?, ?>) parsed;
            } catch (RuntimeException ignored) {
                // Reported on the EDT below.
            }
            final Map<?, ?> result = details;
            ApplicationManager.getApplication().invokeLater(() -> {
                if (result == null) {
                    status.setText("could not read capability consent for " + name);
                    return;
                }
                boolean consented = Boolean.TRUE.equals(result.get("consented"));
                String action = consented ? "Revoke consent" : "Grant consent";
                StringBuilder message = new StringBuilder();
                message.append(name).append(" v")
                        .append(result.get("version") == null
                                ? String.valueOf(plugin.get("version"))
                                : String.valueOf(result.get("version")))
                        .append(" (").append(scope).append(" scope)\n\n");
                if (result.get("reason") != null) {
                    message.append(result.get("reason")).append("\n\n");
                }
                message.append("Declared capabilities:");
                Object declared = result.get("declared");
                if (declared instanceof List && !((List<?>) declared).isEmpty()) {
                    int shown = 0;
                    for (Object capability : (List<?>) declared) {
                        if (shown++ >= 32) {
                            message.append("\n• …");
                            break;
                        }
                        message.append("\n• ").append(String.valueOf(capability));
                    }
                } else {
                    message.append(" none");
                }
                Object added = result.get("added");
                if (added instanceof List && !((List<?>) added).isEmpty()) {
                    message.append("\n\nNew since last consent:");
                    for (Object capability : (List<?>) added) {
                        message.append("\n• ").append(String.valueOf(capability));
                    }
                }
                int decision = Messages.showYesNoDialog(
                        project, message.toString(), "Plugin Capabilities",
                        action, "Cancel", null);
                if (decision != Messages.YES) {
                    status.setText(" ");
                    return;
                }
                runThenRefreshAndReload(
                        PluginManager.buildPluginConsentArgs(
                                name, consented ? "revoke" : "grant", scope),
                        cwd, refresh, status, project);
            });
        });
    }

    private static void showPluginDetails(
            Project project, Map<String, Object> plugin) {
        Map<?, ?> source = asMap(plugin.get("source"));
        Map<?, ?> integrity = asMap(plugin.get("integrity"));
        Map<?, ?> signature =
                asMap(integrity == null ? null : integrity.get("signature"));
        Map<?, ?> sbom = asMap(integrity == null ? null : integrity.get("sbom"));
        Map<?, ?> policy = asMap(plugin.get("policy"));
        StringBuilder text = new StringBuilder();
        text.append(plugin.get("name")).append(" v")
                .append(plugin.get("version")).append(" (")
                .append(scopeOf(plugin)).append(" scope)\n");
        text.append("State: ")
                .append(Boolean.FALSE.equals(plugin.get("enabled"))
                        ? "disabled" : "enabled")
                .append('\n');
        text.append("Source: ")
                .append(value(source, "type").isEmpty()
                        ? "legacy/unknown" : value(source, "type"))
                .append(' ').append(value(source, "source")).append('\n');
        if (!value(source, "ref").isEmpty()) {
            text.append("Pin: ").append(value(source, "ref")).append('\n');
        }
        if (signature != null && Boolean.TRUE.equals(signature.get("verified"))) {
            text.append("Signature: verified (")
                    .append(firstNonEmpty(
                            value(signature, "publicKeySha256"),
                            "key fingerprint unavailable"))
                    .append(")\n");
        } else {
            text.append("Signature: unverified");
            if (!value(signature, "reason").isEmpty()) {
                text.append(" — ").append(value(signature, "reason"));
            }
            text.append('\n');
        }
        if (sbom != null && Boolean.TRUE.equals(sbom.get("present"))) {
            text.append("SBOM: ").append(value(sbom, "fileCount"))
                    .append(" files, ").append(value(sbom, "totalBytes"))
                    .append(" bytes, digest ")
                    .append(firstNonEmpty(value(sbom, "digest"), "unknown"))
                    .append('\n');
        } else {
            text.append("SBOM: unavailable\n");
        }
        if (policy != null && Boolean.TRUE.equals(policy.get("managed"))) {
            text.append("Managed policy: ")
                    .append(Boolean.FALSE.equals(policy.get("allowed"))
                            ? "blocked" : "allowed")
                    .append(" (")
                    .append(firstNonEmpty(value(policy, "source"), "source unavailable"))
                    .append(')');
            if (!value(policy, "reason").isEmpty()) {
                text.append(" — ").append(value(policy, "reason"));
            }
        } else {
            text.append("Managed policy: none");
        }
        Messages.showInfoMessage(project, text.toString(), "Plugin Supply Chain");
    }

    @SuppressWarnings("unchecked")
    private static Map<?, ?> asMap(Object value) {
        return value instanceof Map ? (Map<?, ?>) value : null;
    }

    private static String value(Map<?, ?> map, String key) {
        Object value = map == null ? null : map.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private static String firstNonEmpty(String first, String second) {
        return first == null || first.isEmpty() ? second : first;
    }

    private static void runThenRefresh(List<String> args, File cwd,
            Runnable refresh, JLabel status) {
        status.setText("working…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            AgentChatSession.runCapture(args, cwd, CLI_TIMEOUT_MS);
            ApplicationManager.getApplication().invokeLater(refresh::run);
        });
    }

    private static void runThenRefreshSlow(List<String> args, File cwd,
            Runnable refresh, JLabel status) {
        status.setText("working…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            AgentChatSession.runCapture(args, cwd, SLOW_CLI_TIMEOUT_MS);
            ApplicationManager.getApplication().invokeLater(refresh::run);
        });
    }

    private static void runThenRefreshAndReload(
            List<String> args, File cwd, Runnable refresh, JLabel status,
            Project project) {
        status.setText("working…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            AgentChatSession.runCapture(args, cwd, CLI_TIMEOUT_MS);
            ApplicationManager.getApplication().invokeLater(() -> {
                ChatToolWindowFactory.reloadPluginRuntimes(project);
                refresh.run();
            });
        });
    }

    private static void runThenRefreshSlowAndReload(
            List<String> args, File cwd, Runnable refresh, JLabel status,
            Project project) {
        status.setText("working…");
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            AgentChatSession.runCapture(args, cwd, SLOW_CLI_TIMEOUT_MS);
            ApplicationManager.getApplication().invokeLater(() -> {
                ChatToolWindowFactory.reloadPluginRuntimes(project);
                refresh.run();
            });
        });
    }

    private static void fill(DefaultListModel<String> model,
            List<Map<String, Object>> rows,
            java.util.function.Function<Map<String, Object>, String> fmt,
            String emptyText) {
        model.clear();
        if (rows == null) {
            model.addElement("(could not read CLI output)");
            return;
        }
        if (rows.isEmpty()) {
            model.addElement("(" + emptyText + ")");
            return;
        }
        for (Map<String, Object> r : rows) model.addElement(fmt.apply(r));
    }

    private static void applySkillFilter(DefaultListModel<String> model,
            List<Map<String, Object>> skills, String query) {
        model.clear();
        List<Map<String, Object>> filtered = PluginManager.filterSkills(skills, query);
        if (skills == null) {
            model.addElement("(could not read CLI output)");
            return;
        }
        int shown = 0;
        for (Map<String, Object> s : filtered) {
            if (shown++ >= 200) {
                model.addElement("… " + (filtered.size() - 200) + " more (narrow the filter)");
                break;
            }
            model.addElement(PluginManager.formatSkillLine(s));
        }
        if (shown == 0) model.addElement("(no skills match)");
    }
}
