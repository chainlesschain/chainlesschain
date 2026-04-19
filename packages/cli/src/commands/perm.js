/**
 * `cc perm` — Permission Engine V2 governance overlay.
 *
 * In-memory governance for permission rules + check lifecycle, layered atop
 * `lib/permission-engine.js`. Independent of legacy permission helpers.
 */

import {
  PERM_RULE_MATURITY_V2,
  PERM_CHECK_LIFECYCLE_V2,
  setMaxActivePermRulesPerOwnerV2,
  getMaxActivePermRulesPerOwnerV2,
  setMaxPendingPermChecksPerRuleV2,
  getMaxPendingPermChecksPerRuleV2,
  setPermRuleIdleMsV2,
  getPermRuleIdleMsV2,
  setPermCheckStuckMsV2,
  getPermCheckStuckMsV2,
  registerPermRuleV2,
  activatePermRuleV2,
  disablePermRuleV2,
  retirePermRuleV2,
  touchPermRuleV2,
  getPermRuleV2,
  listPermRulesV2,
  createPermCheckV2,
  evaluatePermCheckV2,
  allowPermCheckV2,
  denyPermCheckV2,
  cancelPermCheckV2,
  getPermCheckV2,
  listPermChecksV2,
  autoDisableIdlePermRulesV2,
  autoDenyStuckPermChecksV2,
  getPermissionEngineGovStatsV2,
  _resetStatePermissionEngineV2,
} from "../lib/permission-engine.js";

export function registerPermCommand(program) {
  const pe = program
    .command("perm")
    .description("Permission Engine V2 governance");
  pe.command("enums-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          ruleMaturity: PERM_RULE_MATURITY_V2,
          checkLifecycle: PERM_CHECK_LIFECYCLE_V2,
        },
        null,
        2,
      ),
    ),
  );
  pe.command("config-v2").action(() =>
    console.log(
      JSON.stringify(
        {
          maxActivePermRulesPerOwner: getMaxActivePermRulesPerOwnerV2(),
          maxPendingPermChecksPerRule: getMaxPendingPermChecksPerRuleV2(),
          permRuleIdleMs: getPermRuleIdleMsV2(),
          permCheckStuckMs: getPermCheckStuckMsV2(),
        },
        null,
        2,
      ),
    ),
  );
  pe.command("set-max-active-v2 <n>").action((n) => {
    setMaxActivePermRulesPerOwnerV2(Number(n));
    console.log("ok");
  });
  pe.command("set-max-pending-v2 <n>").action((n) => {
    setMaxPendingPermChecksPerRuleV2(Number(n));
    console.log("ok");
  });
  pe.command("set-idle-ms-v2 <n>").action((n) => {
    setPermRuleIdleMsV2(Number(n));
    console.log("ok");
  });
  pe.command("set-stuck-ms-v2 <n>").action((n) => {
    setPermCheckStuckMsV2(Number(n));
    console.log("ok");
  });
  pe.command("register-rule-v2 <id> <owner>")
    .option("--scope <s>", "scope")
    .action((id, owner, o) =>
      console.log(
        JSON.stringify(
          registerPermRuleV2({ id, owner, scope: o.scope }),
          null,
          2,
        ),
      ),
    );
  pe.command("activate-rule-v2 <id>").action((id) =>
    console.log(JSON.stringify(activatePermRuleV2(id), null, 2)),
  );
  pe.command("disable-rule-v2 <id>").action((id) =>
    console.log(JSON.stringify(disablePermRuleV2(id), null, 2)),
  );
  pe.command("retire-rule-v2 <id>").action((id) =>
    console.log(JSON.stringify(retirePermRuleV2(id), null, 2)),
  );
  pe.command("touch-rule-v2 <id>").action((id) =>
    console.log(JSON.stringify(touchPermRuleV2(id), null, 2)),
  );
  pe.command("get-rule-v2 <id>").action((id) =>
    console.log(JSON.stringify(getPermRuleV2(id), null, 2)),
  );
  pe.command("list-rules-v2").action(() =>
    console.log(JSON.stringify(listPermRulesV2(), null, 2)),
  );
  pe.command("create-check-v2 <id> <ruleId>")
    .option("--subject <s>", "subject")
    .action((id, ruleId, o) =>
      console.log(
        JSON.stringify(
          createPermCheckV2({ id, ruleId, subject: o.subject }),
          null,
          2,
        ),
      ),
    );
  pe.command("evaluate-check-v2 <id>").action((id) =>
    console.log(JSON.stringify(evaluatePermCheckV2(id), null, 2)),
  );
  pe.command("allow-check-v2 <id>").action((id) =>
    console.log(JSON.stringify(allowPermCheckV2(id), null, 2)),
  );
  pe.command("deny-check-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(denyPermCheckV2(id, reason), null, 2)),
  );
  pe.command("cancel-check-v2 <id> [reason]").action((id, reason) =>
    console.log(JSON.stringify(cancelPermCheckV2(id, reason), null, 2)),
  );
  pe.command("get-check-v2 <id>").action((id) =>
    console.log(JSON.stringify(getPermCheckV2(id), null, 2)),
  );
  pe.command("list-checks-v2").action(() =>
    console.log(JSON.stringify(listPermChecksV2(), null, 2)),
  );
  pe.command("auto-disable-idle-v2").action(() =>
    console.log(JSON.stringify(autoDisableIdlePermRulesV2(), null, 2)),
  );
  pe.command("auto-deny-stuck-v2").action(() =>
    console.log(JSON.stringify(autoDenyStuckPermChecksV2(), null, 2)),
  );
  pe.command("gov-stats-v2").action(() =>
    console.log(JSON.stringify(getPermissionEngineGovStatsV2(), null, 2)),
  );
  pe.command("reset-state-v2").action(() => {
    _resetStatePermissionEngineV2();
    console.log(JSON.stringify({ ok: true }, null, 2));
  });
}
