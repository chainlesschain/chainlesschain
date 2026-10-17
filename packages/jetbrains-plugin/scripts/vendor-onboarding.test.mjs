import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL(
  "../src/uiTest/java/com/chainlesschain/ide/uitest/VendorOnboarding.java", import.meta.url), "utf8");
const script = source.match(/return """\s*([\s\S]*?)\s*""";/)[1];

function fixture() {
  const windows = [];
  class Container {
    constructor(children = []) { this.children = children; this.showing = true; this.properties = new Map(); }
    isShowing() { return this.showing; }
    getComponents() { return this.children; }
    getRootPane() { return this; }
    getClientProperty(key) { return this.properties.get(key) ?? null; }
    putClientProperty(key, value) { this.properties.set(key, value); }
    getClass() { return { getName: () => "com.intellij.openapi.ui.impl.DialogWrapperPeerImpl$MyDialog" }; }
  }
  class Label extends Container {
    constructor(text) { super(); this.text = text; }
    getText() { return this.text; }
  }
  class Button extends Label {
    isEnabled() { return true; }
    doClick() { this.clicks = (this.clicks ?? 0) + 1; this.action?.(); }
  }
  const context = { javax: { swing: {
    SwingUtilities: { isEventDispatchThread: () => true }, JLabel: Label, AbstractButton: Button,
  } }, java: { awt: { Container, Window: { getWindows: () => windows } },
    lang: { System: { out: { println() {} } } } } };
  function dialog(heading = "Meet the Islands Theme", tour = true) {
    const skip = new Button("Skip");
    const window = new Container([new Label(heading), skip, ...(tour ? [new Button("Start Quick Tour")] : [])]);
    skip.action = () => { window.showing = false; };
    windows.push(window);
    return { window, skip };
  }
  return { run: () => vm.runInNewContext(script, context), dialog, windows, Button };
}

test("dismisses a vendor modal arriving after an earlier readiness probe", () => {
  const f = fixture();
  assert.equal(f.run(), false);
  const { window, skip } = f.dialog();
  assert.equal(f.run(), false);
  assert.equal(window.showing, false);
  assert.equal(skip.clicks, 1);
  assert.equal(f.run(), false);
  assert.equal(skip.clicks, 1);
});

test("leaves unrelated Skip controls and incomplete vendor surfaces untouched", () => {
  const f = fixture();
  const unrelated = f.dialog("Plugin confirmation");
  const incomplete = f.dialog("Meet the Islands Theme", false);
  assert.equal(f.run(), false);
  assert.equal(unrelated.skip.clicks, undefined);
  assert.equal(incomplete.skip.clicks, undefined);
});

test("ignores a vendor window before its root pane exists", () => {
  const f = fixture();
  const { window, skip } = f.dialog();
  window.getRootPane = () => null;
  assert.equal(f.run(), false);
  assert.equal(skip.clicks, undefined);
});

test("keeps closure pending without repeated clicks if Skip never closes the modal", () => {
  const f = fixture();
  const { skip } = f.dialog();
  skip.action = () => {};
  for (let probe = 0; probe < 10; probe++) assert.equal(f.run(), true);
  assert.equal(skip.clicks, 1);
});

test("observes asynchronous closure on a later probe without clicking again", () => {
  const f = fixture();
  const { window, skip } = f.dialog();
  skip.action = () => {};
  assert.equal(f.run(), true);
  assert.equal(f.run(), true);
  assert.equal(skip.clicks, 1);
  window.showing = false;
  assert.equal(f.run(), false);
  assert.equal(window.getClientProperty("cc.uiTest.vendorThemeSkip"), null);
  assert.equal(f.run(), false);
  assert.equal(skip.clicks, 1);
});

test("does not guess between ambiguous Skip actions", () => {
  const f = fixture();
  const { window, skip } = f.dialog();
  window.children.push(new f.Button("Skip"));
  assert.throws(f.run, /Ambiguous/);
  assert.equal(skip.clicks, undefined);
});
