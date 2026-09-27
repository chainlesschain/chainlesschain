package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.ElicitationSchema;
import com.chainlesschain.ide.MiniJson;
import com.chainlesschain.ide.QuestionDraftContract;
import com.chainlesschain.ide.QuestionDraftRegistry;
import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.text.JTextComponent;
import java.awt.BorderLayout;
import java.io.IOException;
import java.util.*;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** Native inline question form. Recovery restores fields only; the owning registry authorizes dispatch. */
final class QuestionFormView {
    private final QuestionDraftRegistry registry;
    private final QuestionDraftRegistry.Entry entry;
    private final Consumer<Map<String, Object>> dispatch;
    private final Supplier<Boolean> openUrl;
    private final JPanel root = new JPanel(new BorderLayout(0, 4));
    private final JPanel fieldsPanel = new JPanel();
    private final JTextArea status = new JTextArea(2, 24);
    private final JButton answer = new JButton("Answer"), cancel = new JButton("Cancel question");
    private final Map<String, Supplier<Object>> readers = new LinkedHashMap<>();
    private final Map<String, Consumer<Object>> writers = new LinkedHashMap<>();
    private final Map<String, Supplier<Object>> formReaders = new LinkedHashMap<>();
    private final List<JComponent> inputs = new ArrayList<>();
    private final javax.swing.Timer timer;
    private final ElicitationSchema.Model model;
    private final boolean elicitation, url;
    private JTextArea raw;
    private boolean restoring, edited, loaded, disposed, openingUrl;
    private String validationProblem;

    QuestionFormView(QuestionDraftRegistry registry, QuestionDraftRegistry.Entry entry,
                     Consumer<Map<String, Object>> dispatch, Supplier<Boolean> openUrl) {
        this(registry, entry, dispatch, openUrl, ignored -> {}, () -> {});
    }
    QuestionFormView(QuestionDraftRegistry registry, QuestionDraftRegistry.Entry entry,
                     Consumer<Map<String, Object>> dispatch, Supplier<Boolean> openUrl,
                     Consumer<String> copyText, Runnable dismiss) {
        this.registry = registry; this.entry = entry; this.dispatch = dispatch; this.openUrl = openUrl;
        Map<String, Object> request = entry.request();
        elicitation = Boolean.TRUE.equals(request.get("elicitation"));
        url = elicitation && "url".equals(request.get("mode"));
        model = elicitation && !url ? ElicitationSchema.compile(request.get("requestedSchema")) : null;
        timer = new javax.swing.Timer(250, event -> registry.save(entry)); timer.setRepeats(false);
        root.setBorder(BorderFactory.createCompoundBorder(BorderFactory.createEtchedBorder(), BorderFactory.createEmptyBorder(5, 5, 5, 5)));
        root.getAccessibleContext().setAccessibleName("Agent question");
        JTextArea title = new JTextArea(Objects.toString(request.get("question"), "Question"));
        title.setEditable(false); title.setLineWrap(true); title.setWrapStyleWord(true); title.setOpaque(false);
        root.add(title, BorderLayout.NORTH);
        fieldsPanel.setLayout(new BoxLayout(fieldsPanel, BoxLayout.Y_AXIS));
        if (url) {
            fieldsPanel.add(label("Review and open the secure page when ready. No URL action is restored automatically."));
            answer.setText("Review secure page");
        } else if (elicitation && !model.supported) {
            fieldsPanel.add(label("Unsupported schema: enter a JSON object. This input is not saved."));
            raw = new JTextArea(4, 30); inputs.add(raw); fieldsPanel.add(new JScrollPane(raw));
        } else if (elicitation) buildForm(request);
        else buildQuestion(request);
        JScrollPane fieldsScroll = new JScrollPane(fieldsPanel);
        fieldsScroll.setPreferredSize(new java.awt.Dimension(300, Math.min(220, 50 + inputs.size() * 30)));
        root.add(fieldsScroll, BorderLayout.CENTER);
        JPanel footer = new JPanel(new BorderLayout());
        JPanel actions = new JPanel(new java.awt.GridLayout(0, 2, 4, 2));
        actions.add(answer); actions.add(cancel);
        JButton retry = new JButton("Retry draft save"); actions.add(retry);
        retry.addActionListener(e -> {
            if (registry.editable(entry)) { if (capture()) registry.retry(entry); }
            else registry.save(entry);
        });
        JButton copy = new JButton("Copy fields"); copy.setToolTipText("Copy non-sensitive fields into an empty composer for editing"); actions.add(copy);
        copy.addActionListener(e -> {
            String question = Objects.toString(entry.request().get("question"), "Question");
            copyText.accept(question.substring(0, Math.min(1024, question.length())) + "\n" + QuestionDraftContract.text(entry.fields(), values()));
        });
        JButton close = new JButton("Dismiss"); actions.add(close);
        close.addActionListener(e -> {
            var state = registry.view(entry).state();
            if (state == QuestionDraftRegistry.State.ARCHIVED || state == QuestionDraftRegistry.State.RESOLVED) dismiss.run();
        });
        status.setEditable(false); status.setLineWrap(true); status.setWrapStyleWord(true); status.setOpaque(false);
        status.getAccessibleContext().setAccessibleName("Question status");
        footer.add(status, BorderLayout.NORTH); footer.add(actions, BorderLayout.SOUTH); root.add(footer, BorderLayout.SOUTH);
        answer.addActionListener(e -> submit(false)); cancel.addActionListener(e -> submit(true));
        refresh();
    }
    JComponent component() { return root; }
    boolean safelyStored() { return validationProblem == null && registry.view(entry).saved(); }
    private static JLabel label(String text) {
        JLabel label = new JLabel(text); label.putClientProperty("html.disable", Boolean.TRUE); return label;
    }
    private void addInput(String caption, String key, JComponent component, Supplier<Object> reader, Consumer<Object> writer) {
        component.getAccessibleContext().setAccessibleName(caption);
        JPanel row = new JPanel(new BorderLayout(4, 0));
        JLabel name = label(caption); name.setLabelFor(component);
        row.add(name, BorderLayout.WEST); row.add(component, BorderLayout.CENTER); fieldsPanel.add(row);
        readers.put(key, reader); writers.put(key, writer); inputs.add(component);
        if (component instanceof JTextComponent text) text.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { changed(); }
            public void removeUpdate(DocumentEvent e) { changed(); }
            public void changedUpdate(DocumentEvent e) { changed(); }
        });
        else if (component instanceof AbstractButton button) button.addItemListener(e -> changed());
        else if (component instanceof JComboBox<?> combo) combo.addActionListener(e -> changed());
    }
    private void addText(String caption, String key, Object initial, boolean secret) {
        JTextField text = secret ? new JPasswordField() : new JTextField();
        text.setText(initial == null ? "" : String.valueOf(initial));
        addInput(caption, key, text, () -> text instanceof JPasswordField password ? new String(password.getPassword()) : text.getText(),
                value -> text.setText(String.valueOf(value)));
    }
    private void addBoolean(String caption, String key, Object initial) {
        JCheckBox box = new JCheckBox(); box.setSelected(Boolean.TRUE.equals(initial));
        addInput(caption, key, box, box::isSelected, value -> box.setSelected(Boolean.TRUE.equals(value)));
    }
    private void addSelect(String caption, String key, List<ElicitationSchema.Option> choices, Object initial) {
        JComboBox<ElicitationSchema.Option> combo = new JComboBox<>();
        combo.addItem(new ElicitationSchema.Option("", "—"));
        for (var option : choices) { combo.addItem(option); if (option.value.equals(initial)) combo.setSelectedItem(option); }
        addInput(caption, key, combo, () -> ((ElicitationSchema.Option) combo.getSelectedItem()).value, value -> {
            for (int i = 0; i < combo.getItemCount(); i++) if (combo.getItemAt(i).value.equals(value)) combo.setSelectedIndex(i);
        });
    }
    private void buildQuestion(Map<String, Object> request) {
        List<String> options = QuestionDraftContract.optionLabels(request);
        if (options.isEmpty()) addText("Answer", "answer", null, false);
        else if (Boolean.TRUE.equals(request.get("multiSelect"))) {
            for (int i = 0; i < options.size(); i++) addBoolean(options.get(i), "option-" + i, false);
        } else addSelect("Answer", "answer", options.stream().map(v -> new ElicitationSchema.Option(v, v)).toList(), null);
    }
    private void buildForm(Map<String, Object> request) {
        Map<String, Object> defaults = ElicitationSchema.initialValues(model);
        Map<?, ?> schema = (Map<?, ?>) request.get("requestedSchema");
        Map<?, ?> properties = schema.get("properties") instanceof Map<?, ?> p ? p : Map.of();
        for (var field : model.fields) {
            String key = QuestionDraftContract.fieldKey(field.name), title = field.title + (field.required ? " *" : "");
            if (!field.description.isEmpty()) fieldsPanel.add(label(field.description));
            Object initial = defaults.get(field.name);
            if (field.kind == ElicitationSchema.Kind.MULTI_SELECT) {
                for (var option : field.options) addBoolean(title + ": " + option.label, QuestionDraftContract.optionKey(field.name, option.value),
                        initial instanceof List<?> list && list.contains(option.value));
                formReaders.put(field.name, () -> field.options.stream()
                        .filter(o -> Boolean.TRUE.equals(readers.get(QuestionDraftContract.optionKey(field.name, o.value)).get())).map(o -> o.value).toList());
            } else {
                if (field.kind == ElicitationSchema.Kind.SINGLE_SELECT) addSelect(title, key, field.options, initial);
                else if (field.kind == ElicitationSchema.Kind.BOOLEAN) addBoolean(title, key, initial);
                else addText(title, key, initial, properties.get(field.name) instanceof Map<?, ?> spec
                            && (Boolean.TRUE.equals(spec.get("writeOnly")) || "password".equals(spec.get("format"))));
                formReaders.put(field.name, readers.get(key));
            }
        }
    }
    private Map<String, Object> values() {
        Map<String, Object> values = new LinkedHashMap<>();
        // Do not even read password/writeOnly inputs for persistence.
        for (var field : entry.fields()) if (readers.containsKey(field.key())) values.put(field.key(), readers.get(field.key()).get());
        return values;
    }
    private boolean capture() {
        if (disposed) return false;
        if (!registry.editable(entry)) {
            validationProblem = "Question is no longer editable; copy any newer text before dismissing it";
            status.setText(validationProblem); return false;
        }
        try { registry.edit(entry, values()); validationProblem = null; return true; }
        catch (IOException error) { timer.stop(); validationProblem = error.getMessage(); status.setText(validationProblem); return false; }
    }
    private void changed() {
        if (restoring || disposed) return;
        edited = true;
        if (capture()) timer.restart();
    }
    void refresh() {
        if (disposed) return;
        var view = registry.view(entry);
        if (!loaded && view.loaded()) {
            loaded = true;
            if (!edited) {
                restoring = true;
                try { view.values().forEach((key, value) -> { if (writers.containsKey(key)) writers.get(key).accept(value); }); }
                finally { restoring = false; }
            }
        }
        boolean enabled = registry.editable(entry);
        for (var input : inputs) {
            if (input instanceof JTextComponent text) text.setEditable(enabled);
            else input.setEnabled(enabled);
        }
        answer.setEnabled(enabled && view.loaded()); cancel.setEnabled(enabled && view.loaded());
        status.setText(validationProblem == null ? view.message() : validationProblem); status.setToolTipText(status.getText());
    }
    private Object answerValue() throws IOException {
        if (elicitation) {
            if (!model.supported) {
                if (raw.getText().length() > 65536) throw new IOException("JSON answer exceeds 64K characters");
                try {
                    Object parsed = MiniJson.parse(raw.getText());
                    if (parsed instanceof Map) return parsed;
                } catch (IllegalArgumentException ignored) { }
                throw new IOException("Enter a valid JSON object");
            }
            Map<String, Object> values = new LinkedHashMap<>(); formReaders.forEach((name, read) -> values.put(name, read.get()));
            var result = ElicitationSchema.prepare(model, values);
            if (!result.valid) throw new IOException(result.errors.stream().map(e -> e.message).reduce((a, b) -> a + "; " + b).orElse("Invalid answer"));
            return result.value;
        }
        List<String> options = QuestionDraftContract.optionLabels(entry.request());
        if (Boolean.TRUE.equals(entry.request().get("multiSelect")) && !options.isEmpty()) {
            List<String> selected = new ArrayList<>();
            for (int i = 0; i < options.size(); i++) if (Boolean.TRUE.equals(readers.get("option-" + i).get())) selected.add(options.get(i));
            return selected;
        }
        String answer = String.valueOf(readers.get("answer").get());
        if (!options.isEmpty() && answer.isEmpty()) throw new IOException("Choose an answer");
        return answer;
    }
    private void submit(boolean cancelled) {
        if (openingUrl || !registry.editable(entry) || !registry.view(entry).loaded()) return;
        try {
            Object value;
            if (cancelled) value = null;
            else if (url) {
                openingUrl = true;
                try { if (!openUrl.get()) return; }
                finally { openingUrl = false; }
                if (!registry.editable(entry)) return;
                value = Map.of();
            } else value = answerValue();
            if (!capture()) return;
            timer.stop();
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("type", "answer"); event.put("id", entry.request().get("id")); event.put("answer", value);
            if (entry.request().get("binding") instanceof Map) event.put("binding", entry.request().get("binding"));
            registry.reserve(entry).thenAccept(ready -> { if (ready) dispatch.accept(event); });
            refresh(); // Disable fields synchronously; the I/O callback refresh may arrive later.
        } catch (IOException error) { validationProblem = error.getMessage(); status.setText(validationProblem); }
    }
    void dispose() { timer.stop(); disposed = true; }
}
