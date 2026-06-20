import { RuleTester } from "eslint";
import rule from "../../../eslint-rules/no-unguarded-stale-write.js";

// ESLint 8.x RuleTester uses eslintrc-style parserOptions. RuleTester.run()
// detects vitest's global describe/it and registers the cases itself, so it is
// called at the top level (wrapping it in our own it() is disallowed).
const ruleTester = new RuleTester({
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-unguarded-stale-write", rule, {
  valid: [
    // early-return guard (style a)
    {
      code: `const o = { async load(id) {
        const r = await api(id);
        if (this.currentXId !== id) return;
        this.currentX = r;
      } };`,
    },
    // conditional-assignment guard with === token (style b)
    {
      code: `const o = { async load(id) {
        const seq = ++_seq;
        const r = await api(id);
        if (r && seq === _seq) { this.currentX = r; }
      } };`,
    },
    // assignment BEFORE the await — fine
    {
      code: `const o = { async load(id) {
        this.currentX = null;
        await api(id);
      } };`,
    },
    // non-current property is not matched by the default pattern
    {
      code: `const o = { async load(id) {
        const r = await api(id);
        this.items = r;
      } };`,
    },
    // not async — no await race
    {
      code: `const o = { load(id) { this.currentX = id; } };`,
    },
    // guarded early-return inside a try/catch (matches real fixes)
    {
      code: `const o = { async load(id) {
        try {
          const r = await api(id);
          if (this.currentSession?.id !== id) return;
          this.currentMessages = r;
        } catch (e) {}
      } };`,
    },
  ],
  invalid: [
    // bare write after await — the bug
    {
      code: `const o = { async load(id) {
        const r = await api(id);
        this.currentX = r;
      } };`,
      errors: [{ messageId: "staleWrite", data: { prop: "currentX" } }],
    },
    // inside try, no guard
    {
      code: `const o = { async load(id) {
        try {
          const r = await api(id);
          this.currentSession = r;
        } catch (e) {}
      } };`,
      errors: [{ messageId: "staleWrite" }],
    },
    // configurable property pattern catches non-current list state
    {
      code: `const o = { async load(id) {
        const r = await api(id);
        this.projectFiles = r;
      } };`,
      options: [{ propertyPattern: "^(current|projectFiles)" }],
      errors: [{ messageId: "staleWrite", data: { prop: "projectFiles" } }],
    },
  ],
});
