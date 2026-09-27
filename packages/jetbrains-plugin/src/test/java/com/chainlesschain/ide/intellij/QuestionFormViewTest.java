package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import javax.swing.*;
import java.awt.Component;
import java.awt.Container;
import java.io.IOException;
import java.nio.file.Path;
import java.util.*;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.Supplier;
import static org.junit.jupiter.api.Assertions.*;

class QuestionFormViewTest {
    @TempDir Path temp;
    private final List<Harness> opened = new ArrayList<>();
    private final String key = ChatDraftStore.newKey();
    private static Map<String, Object> request() {
        Map<String, Object> binding = new LinkedHashMap<>(Map.of("sessionId", "session", "turnId", "turn", "toolUseId", "tool", "sequence", 1));
        binding.put("backgroundAgentId", null);
        return new LinkedHashMap<>(Map.of("id", "q1", "question", "What next?", "binding", binding));
    }
    private static final class Harness {
        final QuestionDraftRegistry registry;
        final QuestionDraftRegistry.Entry entry;
        final QuestionFormView form;
        final List<Map<String, Object>> sent = new CopyOnWriteArrayList<>();
        Harness(ChatDraftStore store, String key, Map<String, Object> request, Supplier<Boolean> url) throws IOException {
            registry = new QuestionDraftRegistry(store, key); registry.bind(new Object(), new Object(), "session");
            entry = registry.open(request);
            form = new QuestionFormView(registry, entry, event -> { if (registry.claim(entry)) sent.add(event); }, url);
            registry.onChange(() -> SwingUtilities.invokeLater(form::refresh));
        }
        <T extends Component> T find(Class<T> type, String name) {
            return all(form.component()).stream().filter(type::isInstance).map(type::cast)
                    .filter(c -> name.equals(c.getAccessibleContext().getAccessibleName())
                            || c instanceof JButton button && name.equals(button.getText())).findFirst().orElseThrow();
        }
    }
    private static List<Component> all(Component component) {
        List<Component> result = new ArrayList<>(); result.add(component);
        if (component instanceof Container container) for (var child : container.getComponents()) result.addAll(all(child));
        return result;
    }
    private Harness create(ChatDraftStore store, Map<String, Object> request, Supplier<Boolean> url) throws Exception {
        AtomicReference<Harness> result = new AtomicReference<>();
        SwingUtilities.invokeAndWait(() -> {
            try { result.set(new Harness(store, key, request, url)); } catch (IOException e) { throw new RuntimeException(e); }
        });
        opened.add(result.get()); return result.get();
    }
    private static void drain() throws Exception {
        for (int i = 0; i < 3; i++) { ChatDraftTasks.submit(() -> null).get(5, TimeUnit.SECONDS); SwingUtilities.invokeAndWait(() -> {}); }
    }
    @AfterEach void close() throws Exception {
        SwingUtilities.invokeAndWait(() -> opened.forEach(h -> { h.registry.onChange(() -> {}); h.form.dispose(); h.registry.detach("test closed"); }));
        drain();
    }
    @Test void fieldsRecoverWithoutSendingAndDoubleClickDispatchesOnlyOnce() throws Exception {
        var store = new ChatDraftStore(temp); var first = create(store, request(), () -> false); drain();
        SwingUtilities.invokeAndWait(() -> { first.find(JTextField.class, "Answer").setText("草稿"); first.find(JButton.class, "Retry draft save").doClick(); }); drain();
        SwingUtilities.invokeAndWait(first.form::dispose); // Simulate lost UI without a terminal CLI event.
        var second = create(store, request(), () -> false); drain();
        SwingUtilities.invokeAndWait(() -> {
            assertEquals("草稿", second.find(JTextField.class, "Answer").getText()); assertTrue(second.sent.isEmpty());
            second.find(JButton.class, "Answer").doClick();
            assertFalse(second.find(JTextField.class, "Answer").isEditable());
            assertFalse(second.find(JButton.class, "Answer").isEnabled());
            second.find(JButton.class, "Answer").doClick();
        }); drain();
        assertEquals(1, second.sent.size()); assertEquals("草稿", second.sent.getFirst().get("answer"));
        assertEquals(request().get("binding"), second.sent.getFirst().get("binding"));
        assertEquals(QuestionDraftRegistry.State.AWAITING, second.registry.view(second.entry).state());
        assertEquals("archived", store.load(key).questions().getFirst().status());
    }
    @Test void structuredFormValidatesAndCoercesButNeverPersistsWriteOnlyValues() throws Exception {
        var request = request(); request.put("elicitation", true);
        request.put("requestedSchema", Map.of("type", "object", "required", List.of("count", "token"), "properties", Map.of(
                "count", Map.of("type", "integer", "minimum", 2), "token", Map.of("type", "string", "writeOnly", true),
                "name", Map.of("type", "string"), "enabled", Map.of("type", "boolean"))));
        var store = new ChatDraftStore(temp); var h = create(store, request, () -> false); drain();
        SwingUtilities.invokeAndWait(() -> {
            h.find(JTextField.class, "name").setText("Alice"); h.find(JPasswordField.class, "token *").setText("do-not-persist");
            h.find(JTextField.class, "count *").setText("1"); h.find(JButton.class, "Answer").doClick();
            assertTrue(h.sent.isEmpty()); assertTrue(h.find(JTextArea.class, "Question status").getText().contains("at least"));
            h.find(JTextField.class, "count *").setText("2"); h.find(JCheckBox.class, "enabled").setSelected(true);
            h.find(JButton.class, "Answer").doClick();
        }); drain();
        Map<?, ?> answer = (Map<?, ?>) h.sent.getFirst().get("answer");
        assertEquals(2L, answer.get("count")); assertEquals(true, answer.get("enabled")); assertEquals("do-not-persist", answer.get("token"));
        var saved = store.load(key).questions().getFirst();
        assertFalse(saved.text().contains("do-not-persist")); assertFalse(saved.fields().containsKey(QuestionDraftContract.fieldKey("token")));
        assertEquals("2", saved.fields().get(QuestionDraftContract.fieldKey("count")));
    }
    @Test void lateRestoreCannotReplaceUserTyping() throws Exception {
        var store = new ChatDraftStore(temp); var first = create(store, request(), () -> false); drain();
        SwingUtilities.invokeAndWait(() -> { first.find(JTextField.class, "Answer").setText("older"); first.find(JButton.class, "Retry draft save").doClick(); }); drain();
        SwingUtilities.invokeAndWait(first.form::dispose);
        CountDownLatch gate = new CountDownLatch(1), entered = new CountDownLatch(1); AtomicBoolean once = new AtomicBoolean();
        var slow = new ChatDraftStore(temp) {
            @Override public Draft load(String key) throws IOException {
                if (once.compareAndSet(false, true)) {
                    entered.countDown();
                    try { if (!gate.await(5, TimeUnit.SECONDS)) throw new IOException("timeout"); }
                    catch (InterruptedException e) { throw new IOException(e); }
                }
                return super.load(key);
            }
        };
        var h = create(slow, request(), () -> false);
        try { assertTrue(entered.await(5, TimeUnit.SECONDS)); SwingUtilities.invokeAndWait(() -> h.find(JTextField.class, "Answer").setText("newer")); }
        finally { gate.countDown(); }
        drain();
        SwingUtilities.invokeAndWait(() -> assertEquals("newer", h.find(JTextField.class, "Answer").getText()));
        assertEquals("newer", store.load(key).questions().getFirst().fields().get("answer"));
    }
    @Test void urlCallbackReturningAfterReplacementCannotAnswerTheNewAgent() throws Exception {
        var request = request(); request.put("elicitation", true); request.put("mode", "url"); request.put("url", "https://example.com");
        AtomicReference<Harness> reference = new AtomicReference<>(); AtomicInteger opened = new AtomicInteger();
        var h = create(new ChatDraftStore(temp), request, () -> {
            opened.incrementAndGet(); reference.get().registry.bind(new Object(), new Object(), "session"); return true;
        }); reference.set(h); drain();
        SwingUtilities.invokeAndWait(() -> { h.find(JButton.class, "Review secure page").doClick(); h.find(JButton.class, "Review secure page").doClick(); }); drain();
        assertEquals(1, opened.get()); assertTrue(h.sent.isEmpty()); assertFalse(h.registry.claim(h.entry));
    }
    @Test void unsupportedSchemaJsonIsSentOnlyExplicitlyAndIsNeverStored() throws Exception {
        var request = request(); request.put("elicitation", true); request.put("requestedSchema", Map.of("type", "object", "properties", Map.of("nested", Map.of("type", "object"))));
        var store = new ChatDraftStore(temp); var h = create(store, request, () -> false); drain();
        SwingUtilities.invokeAndWait(() -> {
            var raw = all(h.form.component()).stream().filter(c -> c instanceof JTextArea t && t.isEditable()).map(c -> (JTextArea) c).findFirst().orElseThrow();
            raw.setText("{\"nested\":{\"secret\":\"private\"}}"); h.find(JButton.class, "Answer").doClick();
        }); drain();
        assertEquals(1, h.sent.size());
        var saved = store.load(key).questions().getFirst(); assertTrue(saved.fields().isEmpty()); assertEquals("", saved.text());
    }
    @Test void oversizedEditKeepsVisibleErrorEvenWhenOlderSaveCompletes() throws Exception {
        var store = new ChatDraftStore(temp); var h = create(store, request(), () -> false); drain();
        SwingUtilities.invokeAndWait(() -> {
            h.find(JTextField.class, "Answer").setText("saved"); h.find(JButton.class, "Retry draft save").doClick();
            h.find(JTextField.class, "Answer").setText("x".repeat(32769)); h.find(JButton.class, "Answer").doClick();
        }); drain();
        SwingUtilities.invokeAndWait(() -> assertTrue(h.find(JTextArea.class, "Question status").getText().contains("32K")));
        assertTrue(h.sent.isEmpty()); assertEquals(QuestionDraftRegistry.State.DRAFT, h.registry.view(h.entry).state());
    }
    @Test void archivalSaveFailureRetainsTheReadableFormUntilItCanBeSaved() throws Exception {
        AtomicBoolean failing = new AtomicBoolean(true);
        var store = new ChatDraftStore(temp) {
            @Override public void saveQuestion(String key, Question question) throws IOException {
                if (failing.get()) throw new IOException("full disk"); super.saveQuestion(key, question);
            }
        };
        var h = create(store, request(), () -> false); drain();
        SwingUtilities.invokeAndWait(() -> { h.find(JTextField.class, "Answer").setText("keep this answer"); h.registry.detach("closed"); }); drain();
        SwingUtilities.invokeAndWait(() -> {
            assertFalse(h.form.safelyStored()); assertEquals("keep this answer", h.find(JTextField.class, "Answer").getText());
            assertFalse(h.find(JTextField.class, "Answer").isEditable()); assertTrue(h.find(JTextField.class, "Answer").isEnabled());
            assertTrue(h.find(JTextArea.class, "Question status").getText().contains("full disk"));
            failing.set(false); h.find(JButton.class, "Retry draft save").doClick();
        }); drain();
        assertTrue(h.form.safelyStored()); assertEquals("keep this answer", store.load(key).questions().getFirst().fields().get("answer"));
        assertEquals("archived", store.load(key).questions().getFirst().status());
    }
}
