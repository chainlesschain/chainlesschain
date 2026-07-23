/**
 * advanced-features-ipc _sanitizeDays — input hardening for the renderer-supplied
 * `days` window that flows into a datetime('now', '-N days') SQL string and into
 * spawned `--days=` script args. Proves malicious / out-of-range input is coerced
 * to a safe bounded integer (defense against SQL injection + arg injection).
 *
 * _sanitizeDays is a pure method — invoked via prototype.call so no constructor /
 * mainWindow / electron is needed.
 */

const AdvancedFeaturesIPC = require("../advanced-features-ipc");
const { EventEmitter } = require("node:events");

const originalSpawn = AdvancedFeaturesIPC._deps.spawn;

afterEach(() => {
  AdvancedFeaturesIPC._deps.spawn = originalSpawn;
});

const sanitize = (d, fb) =>
  AdvancedFeaturesIPC.prototype._sanitizeDays.call({}, d, fb);

describe("advanced-features-ipc _sanitizeDays", () => {
  it("passes through valid positive integers", () => {
    expect(sanitize(7)).toBe(7);
    expect(sanitize(30)).toBe(30);
    expect(sanitize(1)).toBe(1);
  });

  it("parses leading-integer numeric strings", () => {
    expect(sanitize("14")).toBe(14);
  });

  it("neutralizes SQL-injection payloads to the fallback", () => {
    // The classic break-out attempt for `'-${days} days'`.
    expect(
      sanitize("1 days'); DROP TABLE knowledge_distillation_history; --"),
    ).toBe(1);
    expect(sanitize("'); DELETE FROM x; --")).toBe(7); // no leading int → fallback
    expect(sanitize("0 OR 1=1")).toBe(7); // parses 0 → <1 → fallback
  });

  it("rejects non-numeric / empty / nullish input via fallback", () => {
    expect(sanitize(undefined)).toBe(7);
    expect(sanitize(null)).toBe(7);
    expect(sanitize("")).toBe(7);
    expect(sanitize("abc")).toBe(7);
    expect(sanitize(NaN)).toBe(7);
  });

  it("rejects zero and negatives via fallback", () => {
    expect(sanitize(0)).toBe(7);
    expect(sanitize(-5)).toBe(7);
  });

  it("clamps absurdly large windows to the 3650-day ceiling", () => {
    expect(sanitize(99999999)).toBe(3650);
    expect(sanitize("100000")).toBe(3650);
  });

  it("honors a custom fallback (the days=30 handler)", () => {
    expect(sanitize("garbage", 30)).toBe(30);
    expect(sanitize(undefined, 30)).toBe(30);
  });

  it("always returns a finite integer (never NaN/float/string)", () => {
    for (const v of ["3.9", 3.9, "  5  ", true, {}, []]) {
      const r = sanitize(v);
      expect(Number.isInteger(r)).toBe(true);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(3650);
    }
  });
});

describe("advanced-features-ipc process contract", () => {
  it("routes scripts through the desktop broker facade", async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    AdvancedFeaturesIPC._deps.spawn = vi.fn(() => child);

    const pending = AdvancedFeaturesIPC.prototype.executeScript.call(
      {},
      "adaptive-threshold.js",
      ["simulate"],
    );
    child.stdout.emit("data", Buffer.from("ok"));
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({
      success: true,
      output: "ok",
      exitCode: 0,
    });
    expect(AdvancedFeaturesIPC._deps.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        expect.stringMatching(/adaptive-threshold\.js$/),
        "simulate",
      ]),
      expect.objectContaining({
        origin: "desktop:advanced-features-script",
      }),
    );
  });
});
