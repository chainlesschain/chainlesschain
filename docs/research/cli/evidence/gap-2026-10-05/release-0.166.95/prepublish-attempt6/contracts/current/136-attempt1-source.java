package com.chainlesschain.ide.intellij;

import java.awt.BorderLayout;
import java.awt.Container;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Panel;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JRootPane;
import javax.swing.JScrollPane;
import javax.swing.RepaintManager;
import javax.swing.SwingUtilities;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

final class ChatCardsLayoutTest {
    /**
     * Real Swing geometry in a windowless, displayable hierarchy. Swing excludes
     * such hierarchies from its normal Window/Applet validation queue, so only
     * validation scheduling is controlled here. Layout and clipping are real.
     */
    private static final class ValidationQueue extends RepaintManager {
        final List<JComponent> invalid = new ArrayList<>();
        @Override public void addInvalidComponent(JComponent component) {
            invalid.add(component);
            super.addInvalidComponent(component);
        }
        void clear() { invalid.clear(); }
        void flush() {
            List<JComponent> requested = new ArrayList<>(invalid);
            invalid.clear();
            for (JComponent component : requested) {
                Container root = component;
                while (root != null && !root.isValidateRoot()) root = root.getParent();
                if (root != null) root.validate();
            }
        }
    }

    private static final class Hierarchy implements AutoCloseable {
        final Panel host = new Panel(new BorderLayout());
        final JPanel cards = new JPanel();
        final JScrollPane scroll;
        final JPanel composer = new JPanel();
        Hierarchy() {
            cards.setLayout(new BoxLayout(cards, BoxLayout.Y_AXIS));
            scroll = new JScrollPane(cards) {
                @Override public Dimension getPreferredSize() {
                    Dimension size = super.getPreferredSize();
                    size.height = Math.min(320, size.height);
                    return size;
                }
            };
            scroll.setBorder(BorderFactory.createEmptyBorder());
            scroll.setHorizontalScrollBarPolicy(JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
            JPanel south = new JPanel(new BorderLayout(0, 2));
            south.add(scroll, BorderLayout.NORTH);
            composer.setPreferredSize(new Dimension(500, 100));
            south.add(composer, BorderLayout.CENTER);
            JPanel content = new JPanel(new BorderLayout());
            content.add(new JPanel(), BorderLayout.CENTER);
            content.add(south, BorderLayout.SOUTH);
            JRootPane root = new JRootPane();
            root.setContentPane(content);
            host.add(root);
            host.setSize(800, 600);
            host.addNotify();
            host.validate();
        }
        JButton addCard(AtomicInteger actions) {
            JPanel card = new JPanel(new BorderLayout(4, 4));
            JLabel detail = new JLabel("Allow this exact permission?");
            detail.setPreferredSize(new Dimension(400, 90));
            card.add(detail, BorderLayout.CENTER);
            JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT, 4, 2));
            JButton approve = new JButton("Approve Once");
            approve.addActionListener(event -> actions.incrementAndGet());
            buttons.add(approve); buttons.add(new JButton("Deny"));
            card.add(buttons, BorderLayout.SOUTH);
            cards.add(card);
            return approve;
        }
        @Override public void close() { host.removeNotify(); }
    }

    @Test void revealsAnApprovalAfterTheCardViewportWasEmpty() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            RepaintManager previous = RepaintManager.currentManager(new JPanel());
            ValidationQueue queue = new ValidationQueue();
            RepaintManager.setCurrentManager(queue);
            try (Hierarchy hierarchy = new Hierarchy()) {
                queue.clear();
                assertEquals(0, hierarchy.scroll.getHeight());
                AtomicInteger actions = new AtomicInteger();
                JButton approve = hierarchy.addCard(actions);
                // Preserve the regression witness: the old child-only operation
                // leaves the real viewport and clipped button at zero height.
                hierarchy.cards.revalidate();
                queue.flush();
                assertTrue(hierarchy.scroll.getPreferredSize().height > 0);
                assertEquals(0, hierarchy.scroll.getViewport().getHeight());
                assertEquals(0, approve.getVisibleRect().height);

                ChatCardsLayout.refresh(hierarchy.cards);
                queue.flush();
                assertTrue(hierarchy.scroll.getViewport().getHeight() > 0);
                assertTrue(approve.getVisibleRect().height > 0);
                approve.doClick();
                assertEquals(1, actions.get());

                hierarchy.cards.removeAll();
                ChatCardsLayout.refresh(hierarchy.cards);
                queue.flush();
                assertEquals(0, hierarchy.scroll.getHeight());
                assertTrue(hierarchy.composer.getVisibleRect().height > 0);
            } finally { RepaintManager.setCurrentManager(previous); }
        });
    }

    @Test void keepsTheComposerVisibleWithSeveralDeferredCards() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            RepaintManager previous = RepaintManager.currentManager(new JPanel());
            ValidationQueue queue = new ValidationQueue();
            RepaintManager.setCurrentManager(queue);
            try (Hierarchy hierarchy = new Hierarchy()) {
                queue.clear();
                for (int i = 0; i < 8; i++) hierarchy.addCard(new AtomicInteger());
                ChatCardsLayout.refresh(hierarchy.cards);
                queue.flush();
                assertEquals(320, hierarchy.scroll.getHeight());
                assertTrue(hierarchy.cards.getPreferredSize().height > 320);
                assertTrue(hierarchy.composer.getVisibleRect().height > 0);
            } finally { RepaintManager.setCurrentManager(previous); }
        });
    }
}
