package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.TeamMonitor;
import com.intellij.ide.util.PropertiesComponent;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.fileChooser.FileChooser;
import com.intellij.openapi.fileChooser.FileChooserDescriptor;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import com.intellij.openapi.vfs.LocalFileSystem;
import com.intellij.openapi.vfs.VirtualFile;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

/**
 * Read-only "cc team" monitor (Tools menu): pick the {@code cc team run
 * --state <file>} snapshot (remembered per project) and show the parsed task
 * graph — status counts, lease holders, dependencies — in a dialog with a
 * Refresh button that re-reads the file. The CLI runs the team; this window
 * watches. VS Code chainlesschain.team.monitor parity (dialog form; the VS
 * side auto-refreshes via a webview). Pure core is {@link TeamMonitor}.
 */
public final class TeamMonitorAction extends AnAction {

    private static final String KEY = "cc.team.lastStatePath";

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        if (project == null) return;

        FileChooserDescriptor descriptor =
                new FileChooserDescriptor(true, false, false, false, false, false)
                        .withTitle("Select a cc team run --state <file> snapshot")
                        .withDescription("The JSON state file you passed to `cc team run --state`");
        PropertiesComponent props = PropertiesComponent.getInstance(project);
        VirtualFile toSelect = null;
        String last = props.getValue(KEY);
        if (last != null) toSelect = LocalFileSystem.getInstance().findFileByPath(last);

        VirtualFile chosen = FileChooser.chooseFile(descriptor, project, toSelect);
        if (chosen == null) return;
        final String path = chosen.getPath();
        props.setValue(KEY, path);
        showDialog(project, path);
    }

    /** Read + render the state file into a text report (never throws). */
    private static String render(String path) {
        String json;
        try {
            json = new String(Files.readAllBytes(Paths.get(path)), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return "cc team monitor\n\ncannot read " + path + ": " + ex.getMessage() + "\n";
        }
        // No injectable clock in the glue — the real wall clock is correct here
        // (stale-lease detection against the persisted expiresAt).
        return TeamMonitor.formatReport(TeamMonitor.parse(json), System.currentTimeMillis());
    }

    private static void showDialog(Project project, String path) {
        JTextArea area = new JTextArea(render(path));
        area.setEditable(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(680, 460));

        JButton refresh = new JButton("Refresh");
        refresh.addActionListener(ev -> {
            area.setText(render(path));
            area.setCaretPosition(0);
        });
        JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        top.add(refresh);

        JPanel panel = new JPanel(new BorderLayout(0, 6));
        panel.add(top, BorderLayout.NORTH);
        panel.add(scroll, BorderLayout.CENTER);

        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain · Team Monitor");
        b.setCenterPanel(panel);
        b.addOkAction();
        b.show();
    }
}
