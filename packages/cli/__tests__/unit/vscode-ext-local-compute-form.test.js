import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const { PROVIDER_PRESETS } = createRequire(import.meta.url)(
  "../../../vscode-extension/src/llm-config.js",
);
it("local-compute selection remains custom through form load, edit and submit; relay stays separate", () => {
  const nodes = new Map(),
    posts = [],
    listeners = {};
  const node = (id) => {
    if (!nodes.has(id))
      nodes.set(id, {
        value: "",
        children: [],
        addEventListener() {},
        replaceChildren() {
          this.children = [];
        },
        append(value) {
          this.children.push(value);
        },
      });
    return nodes.get(id);
  };
  const source = readFileSync(
    new URL("../../../vscode-extension/media/llm-config.js", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(source, {
    URL,
    acquireVsCodeApi: () => ({ postMessage: (m) => posts.push(m) }),
    document: { getElementById: node, createElement: () => ({}) },
    window: {
      addEventListener: (name, fn) => {
        listeners[name] = fn;
      },
    },
  });
  listeners.message({
    data: {
      type: "config",
      presets: PROVIDER_PRESETS,
      current: {
        provider: "custom",
        model: "glm5.3-flash-tensorfold",
        baseUrl: "http://192.168.31.79:8889/v1",
        visionModel: "",
        hasKey: false,
      },
    },
  });
  expect(node("preset").value).toBe("custom");
  expect(node("protocol-field").hidden).toBe(true);
  expect(node("key-hint").textContent).toContain("可留空");
  expect(node("http-field").hidden).toBe(false);
  node("allowHttp").checked = true;
  node("form").onsubmit({ preventDefault() {} });
  expect(posts.at(-1).answers).toMatchObject({
    provider: "custom",
    model: "glm5.3-flash-tensorfold",
    apiKey: "",
    baseUrl: "http://192.168.31.79:8889/v1",
    allowHttp: true,
  });
  node("preset").value = "relay";
  node("protocol").value = "anthropic";
  node("preset").onchange();
  expect(node("protocol-field").hidden).toBe(false);
  node("form").onsubmit({ preventDefault() {} });
  expect(posts.at(-1).answers.provider).toBe("anthropic");
});
