/**
 * IntentClassifier.calculateConfidence — keyword regex-escaping.
 *
 * Bug (latent): keywords were fed straight into `new RegExp(keyword, "g")`.
 * Intent keywords are literal terms, so a keyword containing a regex
 * metacharacter is misread — "node.js" lets "." wildcard-match "nodexjs", and
 * "c++" throws an uncaught SyntaxError ("Nothing to repeat") that crashes
 * classification. The current shipped keywords are plain Chinese words (safe),
 * but a coding assistant adding tech keywords (c++, node.js, .net, c#) would
 * trigger it. Fix escapes metacharacters so keywords match literally.
 */

import { describe, it, expect, beforeEach } from "vitest";

const IntentClassifier = require("../intent-classifier");

describe("IntentClassifier.calculateConfidence keyword escaping", () => {
  let c;
  let intent;

  beforeEach(() => {
    c = new IntentClassifier();
    intent = Object.keys(c.keywords)[0];
  });

  it("matches a special-char keyword literally without crashing (c++)", () => {
    c.keywords[intent] = ["c++"];
    // 旧实现 new RegExp("c++") 抛 SyntaxError 使分类崩溃
    const conf = c.calculateConfidence("用 c++ 写代码", intent);
    expect(conf).toBe(0.7); // 1 literal match
  });

  it("does not let a '.' in a keyword wildcard-match arbitrary chars", () => {
    c.keywords[intent] = ["node.js"];
    // 旧实现 "node.js" 的 . 通配 → 误匹配 "nodexjs"
    expect(c.calculateConfidence("nodexjs", intent)).toBe(0.5); // no match
    expect(c.calculateConfidence("用 node.js 写", intent)).toBe(0.7); // literal
  });

  it("still counts plain-word keywords (regression: normal path intact)", () => {
    c.keywords[intent] = ["创建", "新建"];
    expect(c.calculateConfidence("帮我创建并新建文件", intent)).toBe(0.9); // 2 matches
  });
});
