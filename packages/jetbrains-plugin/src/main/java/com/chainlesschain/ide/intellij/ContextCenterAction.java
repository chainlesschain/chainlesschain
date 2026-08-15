package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ContextCenter;
import com.chainlesschain.ide.MiniJson;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.project.DumbAware;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogBuilder;
import org.jetbrains.annotations.NotNull;

import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextArea;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Interactive chip list over the project-scoped Context Center projection. */
public final class ContextCenterAction extends AnAction implements DumbAware {
    @Override
    public void actionPerformed(@NotNull AnActionEvent event) {
        Project project = event.getProject();
        if (project == null) return;
        IdeBridgeService service = IdeBridgeService.getInstance(project);
        IntellijEditorFacade facade = service.getFacade();
        if (facade == null) facade = new IntellijEditorFacade(project);
        final IntellijEditorFacade editor = facade;

        DefaultListModel<String> model = new DefaultListModel<>();
        JList<String> chips = new JList<>(model);
        chips.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        chips.setName("chainlesschain.contextCenter.chips");
        chips.getAccessibleContext().setAccessibleName("Context Center chips");
        JTextArea detail = new JTextArea(22, 70);
        detail.setEditable(false);
        detail.setFont(new Font(Font.MONOSPACED, Font.PLAIN,
                detail.getFont().getSize()));
        detail.setName("chainlesschain.contextCenter.detail");
        detail.getAccessibleContext().setAccessibleName(
                "Selected context chip details");
        JLabel status = new JLabel(" ");
        JTextField budget = new JTextField(6);
        JButton refresh = new JButton("Refresh");
        JButton pin = new JButton("Pin / Unpin");
        JButton remove = new JButton("Remove / Restore");
        JButton applyBudget = new JButton("Apply budget");
        JButton reset = new JButton("Reset preferences");
        List<Map<String, Object>> rows = new ArrayList<>();

        Runnable showSelected = () -> {
            int index = chips.getSelectedIndex();
            if (index < 0 || index >= rows.size()) {
                detail.setText("");
                return;
            }
            detail.setText(MiniJson.stringify(rows.get(index)));
            detail.setCaretPosition(0);
        };
        chips.addListSelectionListener(change -> {
            if (!change.getValueIsAdjusting()) showSelected.run();
        });

        final Runnable[] reload = new Runnable[1];
        reload[0] = () -> {
            refresh.setEnabled(false);
            status.setText("Refreshing live IDE context…");
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                Map<String, Object> preferences =
                        ContextCenterPersistence.load(project);
                Map<String, Object> metadata = editor.getContextMetadata(
                        null, "getContextCenter");
                Map<String, Object> projection = ContextCenter.build(
                        metadata == null ? null
                                : String.valueOf(metadata.get("workspaceId")),
                        editor.getContextCandidates(),
                        ((Number) preferences.get("tokenBudget")).intValue(),
                        strings(preferences.get("pinnedIds")),
                        strings(preferences.get("removedIds")),
                        Collections.emptyList());
                ApplicationManager.getApplication().invokeLater(() -> {
                    rows.clear();
                    model.clear();
                    Object rawChips = projection.get("chips");
                    if (rawChips instanceof List) {
                        for (Object raw : (List<?>) rawChips) {
                            if (!(raw instanceof Map)) continue;
                            @SuppressWarnings("unchecked")
                            Map<String, Object> chip = (Map<String, Object>) raw;
                            rows.add(chip);
                            model.addElement(rowLabel(chip));
                        }
                    }
                    Map<?, ?> totals = (Map<?, ?>) projection.get("budget");
                    budget.setText(String.valueOf(totals.get("limitTokens")));
                    status.setText(totals.get("allocatedTokens") + "/"
                            + totals.get("limitTokens") + " tokens · "
                            + rows.size() + " chips");
                    refresh.setEnabled(true);
                    if (!rows.isEmpty()) chips.setSelectedIndex(0);
                });
            });
        };

        pin.addActionListener(click -> mutateSelected(
                project, chips, rows, true, reload[0]));
        remove.addActionListener(click -> mutateSelected(
                project, chips, rows, false, reload[0]));
        refresh.addActionListener(click -> reload[0].run());
        applyBudget.addActionListener(click -> {
            try {
                int value = Integer.parseInt(budget.getText().trim());
                if (value < 0 || value > ContextCenter.MAX_TOKEN_BUDGET) {
                    throw new NumberFormatException();
                }
                ContextCenterPersistence.save(project,
                        ContextCenter.updatePreferences(
                                ContextCenterPersistence.load(project),
                                "budget", Integer.valueOf(value)));
                reload[0].run();
            } catch (NumberFormatException invalid) {
                status.setText("Budget must be an integer from 0 to 32768.");
            }
        });
        reset.addActionListener(click -> {
            ContextCenterPersistence.save(project,
                    ContextCenter.updatePreferences(
                            ContextCenterPersistence.load(project),
                            "reset", null));
            reload[0].run();
        });

        JPanel controls = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 0));
        controls.add(refresh);
        controls.add(pin);
        controls.add(remove);
        controls.add(new JLabel("Token budget:"));
        controls.add(budget);
        controls.add(applyBudget);
        controls.add(reset);

        JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT,
                new JScrollPane(chips), new JScrollPane(detail));
        split.setResizeWeight(0.38);
        split.setPreferredSize(new Dimension(1000, 540));
        JPanel root = new JPanel(new BorderLayout(8, 8));
        root.add(controls, BorderLayout.NORTH);
        root.add(split, BorderLayout.CENTER);
        root.add(status, BorderLayout.SOUTH);

        reload[0].run();
        DialogBuilder dialog = new DialogBuilder(project);
        dialog.setTitle("ChainlessChain — Context Center");
        dialog.setCenterPanel(root);
        dialog.addCloseButton();
        dialog.show();
    }

    private static void mutateSelected(Project project, JList<String> list,
            List<Map<String, Object>> rows, boolean pin, Runnable reload) {
        int index = list.getSelectedIndex();
        if (index < 0 || index >= rows.size()) return;
        Map<String, Object> chip = rows.get(index);
        String action = pin
                ? Boolean.TRUE.equals(chip.get("pinned")) ? "unpin" : "pin"
                : "removed".equals(chip.get("status")) ? "restore" : "remove";
        ContextCenterPersistence.save(project,
                ContextCenter.updatePreferences(
                        ContextCenterPersistence.load(project),
                        action, chip.get("id")));
        reload.run();
    }

    private static String rowLabel(Map<String, Object> chip) {
        return (Boolean.TRUE.equals(chip.get("pinned")) ? "[pinned] " : "")
                + String.valueOf(chip.get("label"))
                + " · " + String.valueOf(chip.get("status"))
                + " · " + chip.get("allocatedTokens") + "/"
                + chip.get("estimatedTokens") + " tokens"
                + " · " + chip.get("source")
                + " · " + chip.get("scope")
                + " · " + ((Map<?, ?>) chip.get("freshness")).get("state")
                + " · " + chip.get("reason");
    }

    private static List<String> strings(Object value) {
        List<String> out = new ArrayList<>();
        if (!(value instanceof List)) return out;
        for (Object item : (List<?>) value) out.add(String.valueOf(item));
        return out;
    }
}
