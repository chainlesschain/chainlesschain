package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ActivityLog;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import org.jetbrains.annotations.NotNull;

import javax.swing.JButton;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.text.SimpleDateFormat;
import java.util.Date;

/**
 * Tools-menu "Show Activity": a live-ish view of the IDE bridge's tool-call
 * stream + running totals (VS Code dashboard parity, dialog form — the VS side
 * uses a webview). The bridge records every {@code tools/call} into an
 * {@link ActivityLog} ring buffer; this renders the most recent calls with a
 * Refresh button. The pure formatting is in {@link ActivityLog#formatReport}.
 */
public final class ShowActivityAction extends AnAction {

    @Override
    public void actionPerformed(@NotNull AnActionEvent e) {
        final Project project = e.getProject();
        if (project == null) return;
        final IdeBridgeService svc = IdeBridgeService.getInstance(project);
        if (svc == null) return;
        showDialog(project, svc);
    }

    private static String render(IdeBridgeService svc) {
        ActivityLog log = svc.getActivity();
        final SimpleDateFormat hms = new SimpleDateFormat("HH:mm:ss");
        return log.formatReport(svc.getPort(), 60, ts -> hms.format(new Date(ts)));
    }

    private static void showDialog(Project project, IdeBridgeService svc) {
        JTextArea area = new JTextArea(render(svc));
        area.setEditable(false);
        area.setFont(new Font(Font.MONOSPACED, Font.PLAIN, area.getFont().getSize()));
        area.setCaretPosition(0);
        JScrollPane scroll = new JScrollPane(area);
        scroll.setPreferredSize(new Dimension(660, 460));

        JButton refresh = new JButton("Refresh");
        refresh.addActionListener(ev -> {
            area.setText(render(svc));
            area.setCaretPosition(0);
        });
        JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        top.add(refresh);

        JPanel panel = new JPanel(new BorderLayout(0, 6));
        panel.add(top, BorderLayout.NORTH);
        panel.add(scroll, BorderLayout.CENTER);

        DialogBuilder b = new DialogBuilder(project);
        b.setTitle("ChainlessChain IDE Bridge — Activity");
        b.setCenterPanel(panel);
        b.addOkAction();
        b.show();
    }
}
