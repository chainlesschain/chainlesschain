package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.AgentChatSession;
import com.chainlesschain.ide.PluginManager;
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
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Plugin / MCP manager dialog (Tools menu, P1 #7) — three tabs over the CLI's
 * --json surface: runtime plugins (trust/untrust · uninstall · add), MCP
 * servers (test-connect · remove) and a filterable read-only skills listing.
 * Every action shells out to the CLI off-EDT and re-lists, so the CLI store
 * stays the single source of truth. Pure core: {@link PluginManager}.
 * VS Code twin: {@code chainlesschain.plugins.manage} (webview there).
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
        JButton uninstall = new JButton("Uninstall…");
        JButton add = new JButton("Add…");
        trust.addActionListener(ev -> withSelectedPlugin(project, pluginList, plugins.get(), p ->
                runThenRefresh(PluginManager.buildPluginTrustArgs(
                        String.valueOf(p.get("name")), true), cwd, refresh, status)));
        untrust.addActionListener(ev -> withSelectedPlugin(project, pluginList, plugins.get(), p ->
                runThenRefresh(PluginManager.buildPluginTrustArgs(
                        String.valueOf(p.get("name")), false), cwd, refresh, status)));
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
        JPanel pluginTab = tab(pluginList, trust, untrust, uninstall, add);

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

        JTabbedPane tabs = new JTabbedPane();
        tabs.addTab("Plugins", pluginTab);
        tabs.addTab("MCP servers", mcpTab);
        tabs.addTab("Skills", skillTab);

        JPanel root = new JPanel(new BorderLayout(6, 6));
        root.add(tabs, BorderLayout.CENTER);
        JPanel bottom = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        JButton refreshBtn = new JButton("Refresh");
        refreshBtn.addActionListener(ev -> refresh.run());
        bottom.add(refreshBtn);
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
