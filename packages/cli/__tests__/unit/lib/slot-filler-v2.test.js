import { describe, test, expect, beforeEach } from "vitest";
import {
  SLOTF_PROFILE_MATURITY_V2, SLOTF_FILL_LIFECYCLE_V2,
  setMaxActiveSlotfTemplatesPerOwnerV2, getMaxActiveSlotfTemplatesPerOwnerV2,
  setMaxPendingSlotfFillsPerTemplateV2, getMaxPendingSlotfFillsPerTemplateV2,
  setSlotfTemplateIdleMsV2, getSlotfTemplateIdleMsV2,
  setSlotfFillStuckMsV2, getSlotfFillStuckMsV2,
  _resetStateSlotFillerV2,
  registerSlotfTemplateV2, activateSlotfTemplateV2, staleSlotfTemplateV2, archiveSlotfTemplateV2, touchSlotfTemplateV2, getSlotfTemplateV2, listSlotfTemplatesV2,
  createSlotfFillV2, fillingSlotfFillV2, fillSlotfFillV2, failSlotfFillV2, cancelSlotfFillV2, getSlotfFillV2, listSlotfFillsV2,
  autoStaleIdleSlotfTemplatesV2, autoFailStuckSlotfFillsV2,
  getSlotFillerGovStatsV2,
} from "../../../src/lib/slot-filler.js";

beforeEach(() => { _resetStateSlotFillerV2(); });

describe("SlotFiller V2 enums", () => {
  test("profile maturity", () => { expect(SLOTF_PROFILE_MATURITY_V2.PENDING).toBe("pending"); expect(SLOTF_PROFILE_MATURITY_V2.ACTIVE).toBe("active"); expect(SLOTF_PROFILE_MATURITY_V2.STALE).toBe("stale"); expect(SLOTF_PROFILE_MATURITY_V2.ARCHIVED).toBe("archived"); });
  test("fill lifecycle", () => { expect(SLOTF_FILL_LIFECYCLE_V2.QUEUED).toBe("queued"); expect(SLOTF_FILL_LIFECYCLE_V2.FILLING).toBe("filling"); expect(SLOTF_FILL_LIFECYCLE_V2.FILLED).toBe("filled"); expect(SLOTF_FILL_LIFECYCLE_V2.FAILED).toBe("failed"); expect(SLOTF_FILL_LIFECYCLE_V2.CANCELLED).toBe("cancelled"); });
  test("frozen", () => { expect(Object.isFrozen(SLOTF_PROFILE_MATURITY_V2)).toBe(true); expect(Object.isFrozen(SLOTF_FILL_LIFECYCLE_V2)).toBe(true); });
});

describe("SlotFiller V2 config", () => {
  test("defaults", () => { expect(getMaxActiveSlotfTemplatesPerOwnerV2()).toBe(10); expect(getMaxPendingSlotfFillsPerTemplateV2()).toBe(20); expect(getSlotfTemplateIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000); expect(getSlotfFillStuckMsV2()).toBe(30 * 1000); });
  test("set max active", () => { setMaxActiveSlotfTemplatesPerOwnerV2(3); expect(getMaxActiveSlotfTemplatesPerOwnerV2()).toBe(3); });
  test("set max pending", () => { setMaxPendingSlotfFillsPerTemplateV2(4); expect(getMaxPendingSlotfFillsPerTemplateV2()).toBe(4); });
  test("set idle/stuck ms", () => { setSlotfTemplateIdleMsV2(100); expect(getSlotfTemplateIdleMsV2()).toBe(100); setSlotfFillStuckMsV2(50); expect(getSlotfFillStuckMsV2()).toBe(50); });
  test("reject non-positive", () => { expect(() => setMaxActiveSlotfTemplatesPerOwnerV2(0)).toThrow(); expect(() => setMaxActiveSlotfTemplatesPerOwnerV2(-1)).toThrow(); });
  test("floor fractional", () => { setMaxActiveSlotfTemplatesPerOwnerV2(5.9); expect(getMaxActiveSlotfTemplatesPerOwnerV2()).toBe(5); });
});

describe("SlotFiller V2 template lifecycle", () => {
  test("register", () => { const p = registerSlotfTemplateV2({ id: "p1", owner: "u1" }); expect(p.status).toBe("pending"); expect(p.schema).toBe("{}"); });
  test("register with schema", () => { const p = registerSlotfTemplateV2({ id: "p1", owner: "u1", schema: "{a:string}" }); expect(p.schema).toBe("{a:string}"); });
  test("register reject duplicate/missing", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); expect(() => registerSlotfTemplateV2({ id: "p1", owner: "u1" })).toThrow(); expect(() => registerSlotfTemplateV2({ owner: "u1" })).toThrow(); expect(() => registerSlotfTemplateV2({ id: "p1" })).toThrow(); });
  test("activate pending → active", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); const p = activateSlotfTemplateV2("p1"); expect(p.status).toBe("active"); expect(p.activatedAt).toBeTruthy(); });
  test("stale active → stale", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); activateSlotfTemplateV2("p1"); const p = staleSlotfTemplateV2("p1"); expect(p.status).toBe("stale"); });
  test("activate stale → active (recovery)", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); const before = activateSlotfTemplateV2("p1").activatedAt; staleSlotfTemplateV2("p1"); const p = activateSlotfTemplateV2("p1"); expect(p.activatedAt).toBe(before); });
  test("archive from any non-terminal", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); const p = archiveSlotfTemplateV2("p1"); expect(p.status).toBe("archived"); expect(p.archivedAt).toBeTruthy(); });
  test("terminal no transitions", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); archiveSlotfTemplateV2("p1"); expect(() => activateSlotfTemplateV2("p1")).toThrow(); expect(() => touchSlotfTemplateV2("p1")).toThrow(); });
  test("touch updates", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); activateSlotfTemplateV2("p1"); const p = touchSlotfTemplateV2("p1"); expect(p.lastTouchedAt).toBeTruthy(); });
  test("get / list", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); expect(getSlotfTemplateV2("p1").id).toBe("p1"); expect(getSlotfTemplateV2("nope")).toBeNull(); expect(listSlotfTemplatesV2().length).toBe(1); });
});

describe("SlotFiller V2 active cap", () => {
  test("enforce on initial", () => {
    setMaxActiveSlotfTemplatesPerOwnerV2(2);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" }); registerSlotfTemplateV2({ id: "p2", owner: "u1" }); registerSlotfTemplateV2({ id: "p3", owner: "u1" });
    activateSlotfTemplateV2("p1"); activateSlotfTemplateV2("p2");
    expect(() => activateSlotfTemplateV2("p3")).toThrow(/max active/);
  });
  test("recovery exempt", () => {
    setMaxActiveSlotfTemplatesPerOwnerV2(2);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" }); registerSlotfTemplateV2({ id: "p2", owner: "u1" });
    activateSlotfTemplateV2("p1"); activateSlotfTemplateV2("p2"); staleSlotfTemplateV2("p1");
    const p = activateSlotfTemplateV2("p1"); expect(p.status).toBe("active");
  });
  test("per-owner scope", () => {
    setMaxActiveSlotfTemplatesPerOwnerV2(1);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" }); registerSlotfTemplateV2({ id: "p2", owner: "u2" });
    activateSlotfTemplateV2("p1"); activateSlotfTemplateV2("p2");
  });
});

describe("SlotFiller V2 fill lifecycle", () => {
  test("create", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); const f = createSlotfFillV2({ id: "f1", templateId: "p1" }); expect(f.status).toBe("queued"); expect(f.input).toBe(""); });
  test("create with input", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); const f = createSlotfFillV2({ id: "f1", templateId: "p1", input: "x" }); expect(f.input).toBe("x"); });
  test("create rejects unknown template/duplicate", () => { expect(() => createSlotfFillV2({ id: "f1", templateId: "nope" })).toThrow(); registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); expect(() => createSlotfFillV2({ id: "f1", templateId: "p1" })).toThrow(); });
  test("filling queued → filling", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); const f = fillingSlotfFillV2("f1"); expect(f.status).toBe("filling"); expect(f.startedAt).toBeTruthy(); });
  test("fill filling → filled", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); fillingSlotfFillV2("f1"); const f = fillSlotfFillV2("f1"); expect(f.status).toBe("filled"); expect(f.settledAt).toBeTruthy(); });
  test("fail filling → failed", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); fillingSlotfFillV2("f1"); const f = failSlotfFillV2("f1", "err"); expect(f.status).toBe("failed"); expect(f.metadata.failReason).toBe("err"); });
  test("cancel queued/filling → cancelled", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); cancelSlotfFillV2("f1", "abort"); createSlotfFillV2({ id: "f2", templateId: "p1" }); fillingSlotfFillV2("f2"); const f = cancelSlotfFillV2("f2"); expect(f.status).toBe("cancelled"); });
  test("terminal no transitions", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); fillingSlotfFillV2("f1"); fillSlotfFillV2("f1"); expect(() => failSlotfFillV2("f1")).toThrow(); });
  test("get / list", () => { registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); expect(getSlotfFillV2("f1").id).toBe("f1"); expect(getSlotfFillV2("nope")).toBeNull(); expect(listSlotfFillsV2().length).toBe(1); });
});

describe("SlotFiller V2 pending cap", () => {
  test("enforce at create", () => {
    setMaxPendingSlotfFillsPerTemplateV2(2);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" });
    createSlotfFillV2({ id: "f1", templateId: "p1" }); createSlotfFillV2({ id: "f2", templateId: "p1" });
    expect(() => createSlotfFillV2({ id: "f3", templateId: "p1" })).toThrow(/max pending/);
  });
  test("terminal frees slot", () => {
    setMaxPendingSlotfFillsPerTemplateV2(2);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" });
    createSlotfFillV2({ id: "f1", templateId: "p1" }); createSlotfFillV2({ id: "f2", templateId: "p1" });
    fillingSlotfFillV2("f1"); fillSlotfFillV2("f1");
    createSlotfFillV2({ id: "f3", templateId: "p1" });
  });
});

describe("SlotFiller V2 auto flips", () => {
  test("autoStaleIdleSlotfTemplatesV2", () => {
    setSlotfTemplateIdleMsV2(100);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" }); activateSlotfTemplateV2("p1");
    const { count } = autoStaleIdleSlotfTemplatesV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getSlotfTemplateV2("p1").status).toBe("stale");
  });
  test("autoFailStuckSlotfFillsV2", () => {
    setSlotfFillStuckMsV2(100);
    registerSlotfTemplateV2({ id: "p1", owner: "u1" }); createSlotfFillV2({ id: "f1", templateId: "p1" }); fillingSlotfFillV2("f1");
    const { count } = autoFailStuckSlotfFillsV2({ now: Date.now() + 10000 });
    expect(count).toBe(1); expect(getSlotfFillV2("f1").status).toBe("failed"); expect(getSlotfFillV2("f1").metadata.failReason).toBe("auto-fail-stuck");
  });
});

describe("SlotFiller V2 stats", () => {
  test("empty defaults", () => {
    const s = getSlotFillerGovStatsV2();
    expect(s.totalSlotfTemplatesV2).toBe(0); expect(s.totalSlotfFillsV2).toBe(0);
    for (const k of ["pending", "active", "stale", "archived"]) expect(s.templatesByStatus[k]).toBe(0);
    for (const k of ["queued", "filling", "filled", "failed", "cancelled"]) expect(s.fillsByStatus[k]).toBe(0);
  });
  test("populated counts", () => {
    registerSlotfTemplateV2({ id: "p1", owner: "u1" }); activateSlotfTemplateV2("p1");
    createSlotfFillV2({ id: "f1", templateId: "p1" }); fillingSlotfFillV2("f1");
    const s = getSlotFillerGovStatsV2();
    expect(s.templatesByStatus.active).toBe(1); expect(s.fillsByStatus.filling).toBe(1);
  });
});
