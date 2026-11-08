# REPL accepted/settled post-wire crash evidence

This archive records the current `main` source at commit `a7a64b2eb238102a98f74513b1f7d8b4606dc32c` after JSONL REPL accepted/settled input wiring.

The run uses the real CLI, readline path, Evolution loop, JSONL session store, and a loopback HTTP transport. It hard-kills the original process while a request is held, resumes the same session, and submits a new prompt. No paid provider is used and the test terminal is an emulated `stdin.isTTY`, not an OS PTY.

Verified behavior:

- one original provider request is held and then killed with `SIGKILL`;
- the interrupted call remains unsettled with `billingComplete:false`;
- the old request is not replayed;
- exactly one new request is admitted after resume;
- the resumed public history contains the new settled prompt and excludes the interrupted prompt;
- the recovery notice tells the user to inspect and reconcile usage before explicitly resubmitting.

Run from `packages/cli`:

```text
npx vitest run --config vitest.e2e.config.js __tests__/e2e/repl-inflight-recovery-e2e.test.js
```

The archived receipt and raw logs are covered by `verify-evidence.mjs`:

```text
node docs/cli/evidence/repl-input-durability-post-wire-20261108/verify-evidence.mjs
```

This closes the post-wire CLI kill journey. Accepted/turn-binding atomicity under every provider path, settled-before-crash permutations, legacy/non-JSONL readers, IDE parity, and OS-PTY behavior remain separate acceptance boundaries.
