package com.chainlesschain.ide;

import java.awt.BorderLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.util.Arrays;
import java.util.function.Function;
import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

/** Native, headless-testable connection form. Saved credentials never enter it. */
public final class LlmConnectionPanel extends JPanel {
    private final Function<String, String> text;
    private final JComboBox<String> provider = new JComboBox<>();
    private final JComboBox<String> protocol = new JComboBox<>(new String[]{
            "OpenAI / Chat Completions", "Anthropic / Messages", "Gemini / Generate Content", "Ollama"});
    private final String[] protocols = {"openai", "anthropic", "gemini", "ollama"};
    private final JTextField baseUrl = new JTextField(42), model = new JTextField(42), vision = new JTextField(42);
    private final JPasswordField key = new JPasswordField(42);
    private final JCheckBox allowHttp = new JCheckBox();
    private final JLabel keyHint = new JLabel(), status = new JLabel(), protocolLabel = new JLabel();
    private final JButton save = new JButton(), test = new JButton(), reload = new JButton();
    private LlmConfig.Connection current;
    private boolean busy, dirty, filling;

    public LlmConnectionPanel(Function<String, String> text) {
        super(new BorderLayout(0, 16));
        this.text = text;
        setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
        JLabel introduction = new JLabel(text.apply("llm.form.intro"));
        add(introduction, BorderLayout.NORTH);
        JPanel fields = new JPanel(new GridBagLayout());
        for (LlmConfig.Preset preset : LlmConfig.PRESETS) provider.addItem(preset.label);
        provider.addItem(text.apply("llm.form.custom"));
        row(fields, 0, new JLabel(text.apply("llm.form.provider")), provider);
        protocolLabel.setText(text.apply("llm.form.protocol"));
        row(fields, 1, protocolLabel, protocol);
        row(fields, 2, new JLabel(text.apply("llm.form.baseUrl")), baseUrl);
        row(fields, 3, new JLabel(text.apply("llm.form.model")), model);
        row(fields, 4, new JLabel(text.apply("llm.form.vision")), vision);
        row(fields, 5, new JLabel("API Key"), key);
        row(fields, 6, new JLabel(), keyHint);
        allowHttp.setText(text.apply("llm.form.allowHttp"));
        row(fields, 7, new JLabel(), allowHttp);
        JPanel body = new JPanel(new BorderLayout());
        body.add(fields, BorderLayout.NORTH);
        add(body, BorderLayout.CENTER);
        JPanel footer = new JPanel(new BorderLayout(0, 12));
        status.setText(text.apply("llm.form.loading"));
        status.setName("llm.connection.status");
        footer.add(status, BorderLayout.NORTH);
        JPanel buttons = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 8, 0));
        reload.setText(text.apply("llm.form.reload"));
        save.setText(text.apply("llm.form.save"));
        test.setText(text.apply("llm.form.test"));
        buttons.add(reload); buttons.add(save); buttons.add(test);
        footer.add(buttons, BorderLayout.SOUTH);
        add(footer, BorderLayout.SOUTH);
        provider.setName("llm.provider"); protocol.setName("llm.protocol"); baseUrl.setName("llm.baseUrl");
        model.setName("llm.model"); vision.setName("llm.visionModel"); key.setName("llm.apiKey");
        save.setName("llm.save"); test.setName("llm.test"); reload.setName("llm.reload");
        DocumentListener changed = new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { changed(); }
            public void removeUpdate(DocumentEvent e) { changed(); }
            public void changedUpdate(DocumentEvent e) { changed(); }
        };
        for (JTextField field : new JTextField[]{baseUrl, model, vision, key}) field.getDocument().addDocumentListener(changed);
        provider.addActionListener(e -> {
            if (filling) return;
            filling = true;
            int index = provider.getSelectedIndex();
            if (index >= 0 && index < LlmConfig.PRESETS.length) {
                LlmConfig.Preset preset = LlmConfig.PRESETS[index];
                baseUrl.setText(preset.baseUrl); model.setText(preset.defaultModel);
                vision.setText(LlmConfig.suggestVisionModel(preset.id));
            }
            key.setText(""); allowHttp.setSelected(false);
            filling = false;
            changed();
        });
        protocol.addActionListener(e -> { if (!filling) { key.setText(""); changed(); } });
        allowHttp.addActionListener(e -> changed());
        update();
    }

    private static void row(JPanel panel, int row, JLabel label, JComponent input) {
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridy = row; constraints.gridx = 0; constraints.anchor = GridBagConstraints.WEST;
        constraints.insets = new Insets(6, 0, 6, 16);
        label.setLabelFor(input); panel.add(label, constraints);
        constraints.gridx = 1; constraints.weightx = 1; constraints.fill = GridBagConstraints.HORIZONTAL;
        constraints.insets = new Insets(6, 0, 6, 0);
        panel.add(input, constraints);
    }

    private String providerId() {
        int index = provider.getSelectedIndex();
        return index >= 0 && index < LlmConfig.PRESETS.length ? LlmConfig.PRESETS[index].id : protocols[protocol.getSelectedIndex()];
    }

    private void changed() {
        if (filling) return;
        dirty = true;
        status.setText(text.apply("llm.form.unsaved"));
        update();
    }

    private void update() {
        boolean custom = provider.getSelectedIndex() == LlmConfig.PRESETS.length;
        protocol.setVisible(custom); protocolLabel.setVisible(custom);
        boolean same = current != null && providerId().equals(current.provider)
                && LlmConfig.normalizedBaseUrl(baseUrl.getText()).equals(LlmConfig.normalizedBaseUrl(current.baseUrl));
        keyHint.setText(text.apply("ollama".equals(providerId()) ? "llm.form.keyless"
                : same && current.hasKey ? "llm.form.keepKey" : "llm.form.newKey"));
        boolean remoteHttp = false;
        try {
            java.net.URI uri = new java.net.URI(baseUrl.getText().trim());
            String host = uri.getHost();
            remoteHttp = "http".equalsIgnoreCase(uri.getScheme()) && host != null
                    && !"localhost".equalsIgnoreCase(host) && !"127.0.0.1".equals(host) && !"[::1]".equals(host);
        } catch (Exception ignored) { }
        allowHttp.setVisible(remoteHttp);
        for (JComponent field : new JComponent[]{provider, protocol, baseUrl, model, vision, allowHttp}) field.setEnabled(!busy);
        key.setEnabled(!busy && !"ollama".equals(providerId()));
        save.setEnabled(!busy && current != null && dirty);
        test.setEnabled(!busy && current != null && !dirty && !current.model.isEmpty());
        reload.setEnabled(!busy);
        revalidate();
    }

    public void load(LlmConfig.Connection value) {
        filling = true;
        current = value;
        int index = LlmConfig.PRESETS.length;
        for (int i = 0; i < LlmConfig.PRESETS.length; i++) if (LlmConfig.PRESETS[i].id.equals(value.provider)) index = i;
        provider.setSelectedIndex(index);
        for (int i = 0; i < protocols.length; i++) if (protocols[i].equals(value.provider)) protocol.setSelectedIndex(i);
        baseUrl.setText(value.baseUrl); model.setText(value.model); vision.setText(value.visionModel);
        key.setText(""); allowHttp.setSelected(false);
        dirty = false; filling = false;
        status.setText(text.apply("llm.form.loaded"));
        update();
    }

    public LlmConfig.Connection connection() { return new LlmConfig.Connection(providerId(), model.getText().trim(), baseUrl.getText().trim(), vision.getText().trim(), false); }
    public String apiKey() { char[] value = key.getPassword(); try { return new String(value).trim(); } finally { Arrays.fill(value, '\0'); } }
    public boolean allowHttp() { return allowHttp.isSelected(); }
    public boolean needsNewKey() { return !"ollama".equals(providerId()) && apiKey().isEmpty()
            && !(current != null && current.hasKey && providerId().equals(current.provider)
            && LlmConfig.normalizedBaseUrl(baseUrl.getText()).equals(LlmConfig.normalizedBaseUrl(current.baseUrl))); }
    public void setBusy(boolean value) { busy = value; update(); }
    public void notice(String value) {
        String bounded = value == null ? "" : value.substring(0, Math.min(700, value.length()));
        status.setText("<html><div style='width:580px'>" + bounded.replace("&", "&amp;")
                .replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>") + "</div></html>");
        status.getAccessibleContext().setAccessibleDescription(bounded);
    }
    public void onSave(Runnable action) { save.addActionListener(e -> action.run()); }
    public void onTest(Runnable action) { test.addActionListener(e -> action.run()); }
    public void onReload(Runnable action) { reload.addActionListener(e -> action.run()); }
    public void clearSecret() { filling = true; key.setText(""); filling = false; }
}
