# IPC Security Guards — Operations Runbook

Three layered guards harden the Electron main-process IPC boundary. This runbook
is the operational reference: current modes, the **RBAC enforce-flip procedure**,
verification, and rollback. (Background + design: memory
`desktop_main_ipc_security_findings_2026_06_20`.)

## The three layers

| Layer | Module | Answers | Coverage | Default | Kill-switch |
|---|---|---|---|---|---|
| Sender-frame | `src/main/ipc/ipc-sender-guard.js` | Is the *frame* trusted? | every `ipcMain.handle/handleOnce/on/once` | **enforce** | `CC_IPC_SENDER_GUARD=0` |
| Actor identity | `src/main/permission/current-user-context.js` | *Who* is acting? | 12 actor-bearing perm handlers | **enforce** | `CC_IPC_ACTOR_GUARD=0` |
| RBAC authority | `src/main/permission/rbac-authority.js` | *May* they act? | grant · override · revoke · bulk-grant · delegate · team-add | **report** ← flip pending | `CC_IPC_RBAC_GUARD=0` |

Each env var accepts: `enforce`/`1` (block), `report`/`audit` (log only),
`0`/`off` (disabled). Unset = the layer's default above.

Why two are already enforced and RBAC isn't: sender-frame was **statically
verified** (every IPC-capable window loads file:/loopback) and actor-identity was
verified from the **renderer call sites** (every actor is the current user).
RBAC depends on **live org-membership data** that can't be verified statically —
so it ships report-only until report logs confirm legit owners/admins pass.

---

## RBAC enforce-flip procedure

### 1. Observe (report mode — the current default)
Run the app normally (dev or a packaged build) and exercise every permission-
management flow as a **legitimate org owner/admin**:

- grant a permission (`perm:grant-permission`)
- bulk-grant (`perm:bulk-grant`)
- revoke a grant (`perm:revoke-permission`)
- create an override (`permission:create-override`)
- delegate permissions you hold (`perm:delegate-permissions`)
- add a team member (`team:add-member`)

Then watch the main-process log for:

```
[rbac-guard] would-deny "<channel>": actor not authorized to manage org permissions (...)
[rbac-guard] would-deny "perm:delegate-permissions": delegator does not hold permission "..."
```

Log location: the app's main-process log (same sink as other `[ipc-sender-guard]`
/ `[actor-guard]` lines via `utils/logger.js`). Quick scan once you have a log
file: `grep "rbac-guard.*would-deny" <logfile>`.

### 2. Pass criteria
**Zero `would-deny` lines for legitimate owner/admin flows.** A would-deny that
corresponds to an *expected* denial (a plain member trying to grant) is fine and
confirms the guard works. Investigate any would-deny on a flow that *should*
succeed — it means the authority model or membership data is shaped unexpectedly
(do NOT flip until resolved).

### 3. Flip (one change)
In `src/main/permission/rbac-authority.js`, `resolveRbacMode()`:

```js
// before
  // Default (unset) → report ...
  return "report";
// after
  // Default (unset) → enforce ...
  return "enforce";
```

Keep the explicit `report`/`audit` branch (it becomes the opt-out). Update the
matching assertion in `__tests__/rbac-authority.test.js` (`resolveRbacMode`
"defaults to report" → "defaults to enforce"). Mirror the wording the
actor-identity flip used (commit `8f8c4ef46a`).

No test invokes these handlers through the real IPC path (verified), so flipping
the default won't break the test suite; `rbac-authority.test.js` drives modes
explicitly via `getMode`.

### 4. Verify
- `npx vitest run src/main/permission/__tests__/` — green except the unrelated
  parallel `permission-engine` cache test.
- Re-run the app; confirm legit owner/admin flows still succeed and a
  non-authorized actor is now **DENIED** (`[rbac-guard] DENIED …` + the op throws).

### 5. Rollback
Instant, no redeploy: set `CC_IPC_RBAC_GUARD=0` (disable) or `=report`
(detect-only). Same pattern for the other two layers if ever needed.

---

## Notes / scope
- Handlers already correctly authorized and intentionally *not* wrapped:
  `perm:approve-request` / `perm:reject-request` (validated by
  `approval-workflow-manager._isAuthorizedApprover`); `perm:accept-delegation`
  and `perm:revoke-delegation` (the manager enforces delegate/delegator identity,
  and actor-identity pins the caller).
- Authority model: org member role ∈ {owner, admin} or `organizations.owner_did`.
  Org creators are auto-`owner` members → no bootstrap lockout.
- Fail-open on a real db/authority-check error (a guard fault never bricks legit
  IPC); a clean "not authorized" denies under enforce.
- This layer gates the RBAC permission engine's ops, **not** every privileged
  channel, and is distinct from a full per-resource RBAC evaluation.
