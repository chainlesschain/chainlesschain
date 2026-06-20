"use strict";

/**
 * ESLint rule: no-unguarded-stale-write
 *
 * Flags the stale-response/race shape that recurred across this codebase's Pinia
 * stores: inside an `async` action, an `await` (an IPC/network call) followed by
 * a write to context-scoped state (`this.current*` by default) with no guard
 * that the request is still the latest. If the user switches context (project,
 * conversation, chat, date, session…) during the await, the slower response
 * overwrites the newer one.
 *
 * The fix — and what this rule accepts as a guard — is either:
 *   (a) an early return/throw `if` between the await and the assignment, e.g.
 *         if (this.currentXId !== id) return;           // then assign
 *         if (seq !== _loadSeq) return;
 *   (b) a conditional assignment whose `if` test compares ids/tokens, e.g.
 *         if (seq === _loadSeq) this.currentX = result;
 *
 * Heuristic (favours low false positives — it is a `warn`, dismissible with a
 * reasoned eslint-disable):
 *   - Only `this.<prop>` writes where <prop> matches `propertyPattern`
 *     (default /^current/) count. List-state under other names can be added via
 *     options, e.g. { propertyPattern: "^(current|projectFiles|danmakuQueue)" }.
 *   - A write before any await is fine. A write after an await is flagged only
 *     when neither guard (a) nor (b) is present.
 */

const DEFAULT_PROP_PATTERN = "^current";

function isThisMember(node) {
  return (
    node &&
    node.type === "MemberExpression" &&
    node.object &&
    node.object.type === "ThisExpression"
  );
}

function memberPropName(member) {
  const p = member.property;
  if (!p) return null;
  if (member.computed) return p.type === "Literal" ? String(p.value) : null;
  return p.type === "Identifier" ? p.name : null;
}

function consequentHasExit(ifNode) {
  const c = ifNode.consequent;
  if (!c) return false;
  if (c.type === "ReturnStatement" || c.type === "ThrowStatement") return true;
  if (c.type === "BlockStatement") {
    return c.body.some(
      (s) => s.type === "ReturnStatement" || s.type === "ThrowStatement",
    );
  }
  return false;
}

function subtreeHasEqualityCompare(root) {
  let found = false;
  (function walk(node) {
    if (!node || found || typeof node.type !== "string") return;
    if (
      node.type === "BinaryExpression" &&
      (node.operator === "===" || node.operator === "!==")
    ) {
      found = true;
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const c of val) if (c && typeof c.type === "string") walk(c);
      } else if (val && typeof val.type === "string") {
        walk(val);
      }
    }
  })(root);
  return found;
}

function isFunctionNode(node) {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Guard writes to context-scoped state (this.current*) after an await against a context switch (stale-response race).",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: { propertyPattern: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      staleWrite:
        "`this.{{prop}}` is written after an `await` with no guard that the request is still current. A slower response can overwrite a newer one when the context switches mid-await. Re-check before assigning (e.g. `if (this.current*Id !== id) return;` or a monotonic token), or add an eslint-disable with a reason if it can't race.",
    },
  },

  create(context) {
    const opts = context.options[0] || {};
    const propRe = new RegExp(opts.propertyPattern || DEFAULT_PROP_PATTERN);

    function isGuardedByAncestorIf(assignNode, fnNode) {
      let n = assignNode.parent;
      while (n && n !== fnNode) {
        if (n.type === "IfStatement" && subtreeHasEqualityCompare(n.test)) {
          return true;
        }
        n = n.parent;
      }
      return false;
    }

    function analyze(fnNode) {
      if (!fnNode.async) return;
      const events = [];

      (function collect(node, root) {
        if (!node || typeof node.type !== "string") return;
        if (node !== root && isFunctionNode(node)) return; // skip nested fns

        if (node.type === "AwaitExpression") {
          events.push({ kind: "await", pos: node.range[0] });
        } else if (node.type === "IfStatement" && consequentHasExit(node)) {
          events.push({ kind: "guard", pos: node.range[0] });
        } else if (
          node.type === "AssignmentExpression" &&
          isThisMember(node.left)
        ) {
          const name = memberPropName(node.left);
          if (name && propRe.test(name)) {
            events.push({ kind: "assign", pos: node.range[0], node, name });
          }
        }

        for (const key of Object.keys(node)) {
          if (key === "parent") continue;
          const val = node[key];
          if (Array.isArray(val)) {
            for (const c of val)
              if (c && typeof c.type === "string") collect(c, root);
          } else if (val && typeof val.type === "string") {
            collect(val, root);
          }
        }
      })(fnNode.body, fnNode.body);

      if (!events.length) return;
      events.sort((a, b) => a.pos - b.pos);
      const firstAwait = events.find((e) => e.kind === "await");
      if (!firstAwait) return;

      for (const ev of events) {
        if (ev.kind !== "assign" || ev.pos <= firstAwait.pos) continue;
        const earlyReturnGuard = events.some(
          (g) =>
            g.kind === "guard" && g.pos > firstAwait.pos && g.pos < ev.pos,
        );
        if (earlyReturnGuard) continue;
        if (isGuardedByAncestorIf(ev.node, fnNode)) continue;
        context.report({
          node: ev.node,
          messageId: "staleWrite",
          data: { prop: ev.name },
        });
      }
    }

    return {
      "FunctionDeclaration:exit": analyze,
      "FunctionExpression:exit": analyze,
      "ArrowFunctionExpression:exit": analyze,
    };
  },
};
