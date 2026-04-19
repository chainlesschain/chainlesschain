/**
 * `cc meminj` — Memory Injection V2 governance overlay (in-memory, atop lib/memory-injection.js).
 */
import {
  MINJ_RULE_MATURITY_V2, MINJ_INJECTION_LIFECYCLE_V2,
  setMaxActiveMinjRulesPerOwnerV2, getMaxActiveMinjRulesPerOwnerV2,
  setMaxPendingMinjInjectionsPerRuleV2, getMaxPendingMinjInjectionsPerRuleV2,
  setMinjRuleIdleMsV2, getMinjRuleIdleMsV2,
  setMinjInjectionStuckMsV2, getMinjInjectionStuckMsV2,
  registerMinjRuleV2, activateMinjRuleV2, pauseMinjRuleV2, archiveMinjRuleV2, touchMinjRuleV2, getMinjRuleV2, listMinjRulesV2,
  createMinjInjectionV2, injectingMinjInjectionV2, applyMinjInjectionV2, failMinjInjectionV2, cancelMinjInjectionV2, getMinjInjectionV2, listMinjInjectionsV2,
  autoPauseIdleMinjRulesV2, autoFailStuckMinjInjectionsV2, getMemoryInjectionGovStatsV2, _resetStateMemoryInjectionV2,
} from "../lib/memory-injection.js";

export function registerMeminjCommand(program) {
  const mi = program.command("meminj").description("Memory Injection V2 governance");
  mi.command("enums-v2").action(() => console.log(JSON.stringify({ ruleMaturity: MINJ_RULE_MATURITY_V2, injectionLifecycle: MINJ_INJECTION_LIFECYCLE_V2 }, null, 2)));
  mi.command("config-v2").action(() => console.log(JSON.stringify({ maxActiveMinjRulesPerOwner: getMaxActiveMinjRulesPerOwnerV2(), maxPendingMinjInjectionsPerRule: getMaxPendingMinjInjectionsPerRuleV2(), minjRuleIdleMs: getMinjRuleIdleMsV2(), minjInjectionStuckMs: getMinjInjectionStuckMsV2() }, null, 2)));
  mi.command("set-max-active-v2 <n>").action((n) => { setMaxActiveMinjRulesPerOwnerV2(Number(n)); console.log("ok"); });
  mi.command("set-max-pending-v2 <n>").action((n) => { setMaxPendingMinjInjectionsPerRuleV2(Number(n)); console.log("ok"); });
  mi.command("set-idle-ms-v2 <n>").action((n) => { setMinjRuleIdleMsV2(Number(n)); console.log("ok"); });
  mi.command("set-stuck-ms-v2 <n>").action((n) => { setMinjInjectionStuckMsV2(Number(n)); console.log("ok"); });
  mi.command("register-rule-v2 <id> <owner>").option("--scope <s>", "scope").action((id, owner, o) => console.log(JSON.stringify(registerMinjRuleV2({ id, owner, scope: o.scope }), null, 2)));
  mi.command("activate-rule-v2 <id>").action((id) => console.log(JSON.stringify(activateMinjRuleV2(id), null, 2)));
  mi.command("pause-rule-v2 <id>").action((id) => console.log(JSON.stringify(pauseMinjRuleV2(id), null, 2)));
  mi.command("archive-rule-v2 <id>").action((id) => console.log(JSON.stringify(archiveMinjRuleV2(id), null, 2)));
  mi.command("touch-rule-v2 <id>").action((id) => console.log(JSON.stringify(touchMinjRuleV2(id), null, 2)));
  mi.command("get-rule-v2 <id>").action((id) => console.log(JSON.stringify(getMinjRuleV2(id), null, 2)));
  mi.command("list-rules-v2").action(() => console.log(JSON.stringify(listMinjRulesV2(), null, 2)));
  mi.command("create-injection-v2 <id> <ruleId>").option("--payload <p>", "payload").action((id, ruleId, o) => console.log(JSON.stringify(createMinjInjectionV2({ id, ruleId, payload: o.payload }), null, 2)));
  mi.command("injecting-injection-v2 <id>").action((id) => console.log(JSON.stringify(injectingMinjInjectionV2(id), null, 2)));
  mi.command("apply-injection-v2 <id>").action((id) => console.log(JSON.stringify(applyMinjInjectionV2(id), null, 2)));
  mi.command("fail-injection-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(failMinjInjectionV2(id, reason), null, 2)));
  mi.command("cancel-injection-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(cancelMinjInjectionV2(id, reason), null, 2)));
  mi.command("get-injection-v2 <id>").action((id) => console.log(JSON.stringify(getMinjInjectionV2(id), null, 2)));
  mi.command("list-injections-v2").action(() => console.log(JSON.stringify(listMinjInjectionsV2(), null, 2)));
  mi.command("auto-pause-idle-v2").action(() => console.log(JSON.stringify(autoPauseIdleMinjRulesV2(), null, 2)));
  mi.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckMinjInjectionsV2(), null, 2)));
  mi.command("gov-stats-v2").action(() => console.log(JSON.stringify(getMemoryInjectionGovStatsV2(), null, 2)));
  mi.command("reset-state-v2").action(() => { _resetStateMemoryInjectionV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
