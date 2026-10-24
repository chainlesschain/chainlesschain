package com.chainlesschain.ide.uitest;

/** Scripts run on the IDE EDT, rooted in the stable frame rather than a popup fixture. */
final class PopupEnterScripts {
    private PopupEnterScripts() {}

    static String activate(String label, boolean prefix, String token, String owner) {
        return """
                (function(frame, expected, prefix, token, owner) {
                  if (!javax.swing.SwingUtilities.isEventDispatchThread()) throw new Error('Popup lookup requires EDT');
                  var root = frame.getRootPane();
                  if (String(java.lang.System.identityHashCode(root)) !== owner) throw new Error('Popup owner mismatch');
                  var key = 'cc.uiTest.popupEnter.'+token;
                  if (root.getClientProperty(key) != null) throw new Error('Duplicate popup receipt');
                  function ownerFrame(window) {
                    while (window != null && !(window instanceof java.awt.Frame)) window = window.getOwner();
                    return window;
                  }
                  // Remote Robot binds component as a raw Java object, whereas
                  // hierarchy calls return Rhino wrappers. Compare Java references.
                  function sameComponent(left, right) {
                    return left != null && right != null && left.equals(right);
                  }
                  function isPopupList(c) {
                    if (!(c instanceof javax.swing.JList)) return false;
                    for (var type = c.getClass(); type != null; type = type.getSuperclass()) {
                      if (String(type.getName()) === 'com.intellij.ui.components.JBList') return true;
                    }
                    return false;
                  }
                  function locate() {
                    var found = null, index = -1, matches = 0;
                    function visit(c) {
                      if (!c.isShowing()) return;
                      if (isPopupList(c)) {
                        var model = c.getModel();
                        for (var i = 0; i < model.getSize(); i++) {
                          var item = String(model.getElementAt(i));
                          if (prefix ? item.indexOf(expected) === 0 : item === expected) {
                            found = c; index = i; matches++;
                          }
                        }
                      }
                      if (c instanceof java.awt.Container) {
                        var children = c.getComponents();
                        for (var j = 0; j < children.length; j++) visit(children[j]);
                      }
                    }
                    // Swing lightweight popups live in the frame's popup layer.
                    // Do not search normal editor/tool-window lists in its content pane.
                    var layers = frame.getLayeredPane();
                    var lightweight = layers.getComponentsInLayer(javax.swing.JLayeredPane.POPUP_LAYER);
                    for (var p = 0; p < lightweight.length; p++) visit(lightweight[p]);
                    var windows = java.awt.Window.getWindows();
                    for (var w = 0; w < windows.length; w++) {
                      if (!sameComponent(windows[w], frame) && windows[w].isShowing() && sameComponent(ownerFrame(windows[w]), frame)) visit(windows[w]);
                    }
                    if (matches > 1) throw new Error('Ambiguous popup item: '+expected);
                    return {target:found, index:index};
                  }
                  var match = locate(), target = match.target;
                  if (target == null) return '';
                  var targetId = String(java.lang.System.identityHashCode(target));
                  var receipt = new java.util.Properties();
                  receipt.setProperty('token',token); receipt.setProperty('owner',owner);
                  receipt.setProperty('target',targetId); receipt.setProperty('label',expected);
                  receipt.setProperty('prefix',String(prefix)); root.putClientProperty(key,receipt);
                  function state(value) {
                    receipt.setProperty('stage',value);
                    receipt.setProperty('visibility',target.isShowing() ? 'visible' : 'hidden');
                    var focus = java.awt.KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusOwner();
                    var focusedWindow = java.awt.KeyboardFocusManager.getCurrentKeyboardFocusManager().getFocusedWindow();
                    java.lang.System.out.println('[ui-popup-enter] '+expected+' '+value
                      +' showing='+target.isShowing()+' focusOwner='+target.isFocusOwner()
                      +' selectedIndex='+target.getSelectedIndex()
                      +' selectedValue='+String(target.getSelectedValue()).substring(0,180)
                      +' focus='+(focus == null ? '<none>' : focus.getClass().getName())
                      +' focusedWindow='+(focusedWindow == null ? '<none>' : focusedWindow.getClass().getName())
                      +' focusedWindowShowing='+(focusedWindow != null && focusedWindow.isShowing()));
                  }
                  target.setSelectedIndex(match.index); target.ensureIndexIsVisible(match.index);
                  state('scheduled');
                  Packages.com.intellij.openapi.application.ApplicationManager.getApplication()
                    .invokeLater(new java.lang.Runnable({run:function() {
                      try {
                        state('entered');
                        if (!target.isShowing()) throw new Error('Popup cancelled before Enter dispatch');
                        if (!sameComponent(ownerFrame(javax.swing.SwingUtilities.getWindowAncestor(target)), frame)) throw new Error('Popup owner changed');
                        var current = locate();
                        if (!sameComponent(current.target, target)) throw new Error('Popup target changed before Enter dispatch');
                        target.setSelectedIndex(current.index); target.ensureIndexIsVisible(current.index);
                        var enter = javax.swing.KeyStroke.getKeyStroke(java.awt.event.KeyEvent.VK_ENTER, 0);
                        var action = target.getActionForKeyStroke(enter);
                        if (action == null) throw new Error('Popup Enter action unavailable');
                        state('validated');
                        action.actionPerformed(new java.awt.event.ActionEvent(target,
                          java.awt.event.ActionEvent.ACTION_PERFORMED, 'Enter'));
                        state('dispatch-returned');
                      } catch (failure) {
                        state('failed:'+String(failure));
                        java.lang.System.err.println('[ui-popup-enter] '+expected+' '+String(failure));
                      }
                    }}));
                  return targetId;
                })(component,%s,%s,%s,%s);
                """.formatted(quote(label), prefix, quote(token), quote(owner));
    }

    static String receipt(String label, boolean prefix, String token, String owner, String target) {
        return """
                (function(root, expected, prefix, token, owner, target) {
                  if (String(java.lang.System.identityHashCode(root)) !== owner) throw new Error('Popup receipt owner mismatch');
                  var receipt = root.getClientProperty('cc.uiTest.popupEnter.'+token);
                  if (receipt == null) throw new Error('Popup receipt missing');
                  if (String(receipt.getProperty('token')) !== token
                    || String(receipt.getProperty('owner')) !== owner
                    || String(receipt.getProperty('target')) !== target
                    || String(receipt.getProperty('label')) !== expected
                    || String(receipt.getProperty('prefix')) !== String(prefix)) throw new Error('Popup receipt binding mismatch');
                  return String(receipt.getProperty('stage'))+'|'+String(receipt.getProperty('visibility'));
                })(component.getRootPane(),%s,%s,%s,%s,%s);
                """.formatted(quote(label), prefix, quote(token), quote(owner), quote(target));
    }

    static String cleanup(String token, String owner) {
        return """
                (function(root, token, owner) {
                  if (String(java.lang.System.identityHashCode(root)) !== owner) throw new Error('Popup cleanup owner mismatch');
                  var key = 'cc.uiTest.popupEnter.'+token, receipt = root.getClientProperty(key);
                  if (receipt != null && String(receipt.getProperty('token')) !== token) throw new Error('Popup cleanup binding mismatch');
                  root.putClientProperty(key,null);
                })(component.getRootPane(),%s,%s);
                """.formatted(quote(token), quote(owner));
    }

    private static String quote(String value) {
        StringBuilder result = new StringBuilder("\"");
        for (char ch : value.toCharArray()) {
            if (ch == '"' || ch == '\\') result.append('\\').append(ch);
            else if (ch < 32 || ch == '\u2028' || ch == '\u2029') result.append(String.format("\\u%04x", (int) ch));
            else result.append(ch);
        }
        return result.append('"').toString();
    }
}
