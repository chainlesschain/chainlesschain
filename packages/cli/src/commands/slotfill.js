/**
 * `cc slotfill` — Slot Filler V2 governance overlay (in-memory, atop lib/slot-filler.js).
 */
import {
  SLOTF_PROFILE_MATURITY_V2, SLOTF_FILL_LIFECYCLE_V2,
  setMaxActiveSlotfTemplatesPerOwnerV2, getMaxActiveSlotfTemplatesPerOwnerV2,
  setMaxPendingSlotfFillsPerTemplateV2, getMaxPendingSlotfFillsPerTemplateV2,
  setSlotfTemplateIdleMsV2, getSlotfTemplateIdleMsV2,
  setSlotfFillStuckMsV2, getSlotfFillStuckMsV2,
  registerSlotfTemplateV2, activateSlotfTemplateV2, staleSlotfTemplateV2, archiveSlotfTemplateV2, touchSlotfTemplateV2, getSlotfTemplateV2, listSlotfTemplatesV2,
  createSlotfFillV2, fillingSlotfFillV2, fillSlotfFillV2, failSlotfFillV2, cancelSlotfFillV2, getSlotfFillV2, listSlotfFillsV2,
  autoStaleIdleSlotfTemplatesV2, autoFailStuckSlotfFillsV2, getSlotFillerGovStatsV2, _resetStateSlotFillerV2,
} from "../lib/slot-filler.js";

export function registerSlotfillCommand(program) {
  const sf = program.command("slotfill").description("Slot Filler V2 governance");
  sf.command("enums-v2").action(() => console.log(JSON.stringify({ profileMaturity: SLOTF_PROFILE_MATURITY_V2, fillLifecycle: SLOTF_FILL_LIFECYCLE_V2 }, null, 2)));
  sf.command("config-v2").action(() => console.log(JSON.stringify({ maxActiveSlotfTemplatesPerOwner: getMaxActiveSlotfTemplatesPerOwnerV2(), maxPendingSlotfFillsPerTemplate: getMaxPendingSlotfFillsPerTemplateV2(), slotfTemplateIdleMs: getSlotfTemplateIdleMsV2(), slotfFillStuckMs: getSlotfFillStuckMsV2() }, null, 2)));
  sf.command("set-max-active-v2 <n>").action((n) => { setMaxActiveSlotfTemplatesPerOwnerV2(Number(n)); console.log("ok"); });
  sf.command("set-max-pending-v2 <n>").action((n) => { setMaxPendingSlotfFillsPerTemplateV2(Number(n)); console.log("ok"); });
  sf.command("set-idle-ms-v2 <n>").action((n) => { setSlotfTemplateIdleMsV2(Number(n)); console.log("ok"); });
  sf.command("set-stuck-ms-v2 <n>").action((n) => { setSlotfFillStuckMsV2(Number(n)); console.log("ok"); });
  sf.command("register-template-v2 <id> <owner>").option("--schema <s>", "schema").action((id, owner, o) => console.log(JSON.stringify(registerSlotfTemplateV2({ id, owner, schema: o.schema }), null, 2)));
  sf.command("activate-template-v2 <id>").action((id) => console.log(JSON.stringify(activateSlotfTemplateV2(id), null, 2)));
  sf.command("stale-template-v2 <id>").action((id) => console.log(JSON.stringify(staleSlotfTemplateV2(id), null, 2)));
  sf.command("archive-template-v2 <id>").action((id) => console.log(JSON.stringify(archiveSlotfTemplateV2(id), null, 2)));
  sf.command("touch-template-v2 <id>").action((id) => console.log(JSON.stringify(touchSlotfTemplateV2(id), null, 2)));
  sf.command("get-template-v2 <id>").action((id) => console.log(JSON.stringify(getSlotfTemplateV2(id), null, 2)));
  sf.command("list-templates-v2").action(() => console.log(JSON.stringify(listSlotfTemplatesV2(), null, 2)));
  sf.command("create-fill-v2 <id> <templateId>").option("--input <s>", "input").action((id, templateId, o) => console.log(JSON.stringify(createSlotfFillV2({ id, templateId, input: o.input }), null, 2)));
  sf.command("filling-fill-v2 <id>").action((id) => console.log(JSON.stringify(fillingSlotfFillV2(id), null, 2)));
  sf.command("fill-fill-v2 <id>").action((id) => console.log(JSON.stringify(fillSlotfFillV2(id), null, 2)));
  sf.command("fail-fill-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(failSlotfFillV2(id, reason), null, 2)));
  sf.command("cancel-fill-v2 <id> [reason]").action((id, reason) => console.log(JSON.stringify(cancelSlotfFillV2(id, reason), null, 2)));
  sf.command("get-fill-v2 <id>").action((id) => console.log(JSON.stringify(getSlotfFillV2(id), null, 2)));
  sf.command("list-fills-v2").action(() => console.log(JSON.stringify(listSlotfFillsV2(), null, 2)));
  sf.command("auto-stale-idle-v2").action(() => console.log(JSON.stringify(autoStaleIdleSlotfTemplatesV2(), null, 2)));
  sf.command("auto-fail-stuck-v2").action(() => console.log(JSON.stringify(autoFailStuckSlotfFillsV2(), null, 2)));
  sf.command("gov-stats-v2").action(() => console.log(JSON.stringify(getSlotFillerGovStatsV2(), null, 2)));
  sf.command("reset-state-v2").action(() => { _resetStateSlotFillerV2(); console.log(JSON.stringify({ ok: true }, null, 2)); });
}
