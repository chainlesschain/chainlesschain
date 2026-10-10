package com.chainlesschain.ide.intellij;

import java.awt.Container;
import javax.swing.JComponent;
import javax.swing.JScrollPane;
import javax.swing.SwingUtilities;

/** Revalidate the card viewport and the container that allocates its height. */
final class ChatCardsLayout {
    private ChatCardsLayout() {}

    static void refresh(JComponent cards) {
        cards.revalidate();
        // JScrollPane is a validate root. Revalidating its view stops there,
        // even though adding/removing a card changes the scroll pane's preferred
        // height. The surrounding BorderLayout must allocate that new height.
        Container scroll = SwingUtilities.getAncestorOfClass(JScrollPane.class, cards);
        if (scroll != null && scroll.getParent() instanceof JComponent layoutOwner) {
            layoutOwner.revalidate();
        }
        cards.repaint();
    }
}
