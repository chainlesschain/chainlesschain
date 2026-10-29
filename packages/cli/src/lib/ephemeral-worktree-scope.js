import { AsyncLocalStorage } from "node:async_hooks";

const scopes = new AsyncLocalStorage();

/**
 * An ephemeral checkout belongs to its awaited callback. This host scope is a
 * capability restriction, not a process lease: tools that return before their
 * consumers settle must refuse dispatch until they can transfer that ownership.
 * Async descendants retain the restriction even after the callback returns.
 */
export function withEphemeralWorktreeScope(worktreePath, callback) {
  return scopes.run(Object.freeze({ worktreePath }), callback);
}

export function ephemeralWorktreeConsumerRefusal(operation) {
  const scope = scopes.getStore();
  if (!scope) return null;
  return {
    error: `${operation} cannot outlive an ephemeral worktree. Run this work in the foreground, or launch it from a persistent checkout with its own lifecycle owner.`,
    code: "CC_EPHEMERAL_WORKTREE_CONSUMER_UNOWNED",
    worktreePath: scope.worktreePath,
    policy: { decision: "deny", via: "ephemeral-worktree-lifetime" },
  };
}
