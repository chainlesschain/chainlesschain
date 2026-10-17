package com.chainlesschain.ide.uitest;

/** Only dismiss the identified vendor theme tour, including a late modal arrival. */
final class VendorOnboarding {
    private VendorOnboarding() {}

    static String dismissThemeTourScript() {
        return """
                (function() {
                  if (!javax.swing.SwingUtilities.isEventDispatchThread())
                    throw new Error('Vendor onboarding dismissal requires EDT');
                  function inspect(c, found) {
                    if (!c.isShowing()) return;
                    if (c instanceof javax.swing.JLabel && String(c.getText()) === 'Meet the Islands Theme')
                      found.heading = true;
                    if (c instanceof javax.swing.AbstractButton && c.isEnabled()) {
                      if (String(c.getText()) === 'Start Quick Tour') found.tour = true;
                      if (String(c.getText()) === 'Skip') found.skips.push(c);
                    }
                    if (c instanceof java.awt.Container) {
                      var children = c.getComponents();
                      for (var i = 0; i < children.length; i++) inspect(children[i], found);
                    }
                  }
                  var windows = java.awt.Window.getWindows(), pending = false;
                  var key = 'cc.uiTest.vendorThemeSkip';
                  for (var i = 0; i < windows.length; i++) {
                    var window = windows[i];
                    if (String(window.getClass().getName()) !==
                        'com.intellij.openapi.ui.impl.DialogWrapperPeerImpl$MyDialog') continue;
                    var root = window.getRootPane();
                    if (String(root.getClientProperty(key)) === 'clicked') {
                      if (window.isShowing()) pending = true;
                      else {
                        root.putClientProperty(key, null);
                        java.lang.System.out.println('[ui-smoke] vendor Islands theme tour closed');
                      }
                      continue;
                    }
                    if (!window.isShowing()) continue;
                    var found = {heading:false, tour:false, skips:[]};
                    inspect(window, found);
                    if (!found.heading || !found.tour) continue;
                    if (found.skips.length !== 1) throw new Error('Ambiguous vendor theme tour Skip control');
                    // Record before dispatch: closing may be deferred to a later EDT turn.
                    // Keep observing this window without clicking it again.
                    root.putClientProperty(key, 'clicked');
                    found.skips[0].doClick();
                    java.lang.System.out.println('[ui-smoke] clicked identified vendor Islands theme tour Skip');
                    if (window.isShowing()) pending = true;
                    else root.putClientProperty(key, null);
                  }
                  return pending;
                })();
                """;
    }
}
