"use strict";

// Synthetic engineering driver only; installed by the owned Electron wrapper,
// never by the product entrypoint or a renderer/IPC method. Timers remain real.
function installGoalJourneyClock(initialIso, target = globalThis) {
  const NativeDate = target.Date;
  if (typeof NativeDate !== "function") throw new TypeError("Date is required");
  const initial = NativeDate.parse(initialIso);
  if (
    !Number.isSafeInteger(initial) ||
    new NativeDate(initial).toISOString() !== initialIso
  )
    throw new TypeError("A canonical UTC initial timestamp is required");
  const realNow = NativeDate.now.bind(NativeDate);
  let offset = initial - realNow();
  const now = () => realNow() + offset;
  const DateProxy = new Proxy(NativeDate, {
    construct(original, args, newTarget) {
      return Reflect.construct(
        original,
        args.length ? args : [now()],
        newTarget === DateProxy ? original : newTarget,
      );
    },
    apply() {
      return new NativeDate(now()).toString();
    },
    get(original, key, receiver) {
      return key === "now" ? now : Reflect.get(original, key, receiver);
    },
  });
  target.Date = DateProxy;
  return Object.freeze({
    synthetic: true,
    realTimers: true,
    now,
    advanceTo(iso) {
      const next = NativeDate.parse(iso);
      if (
        !Number.isSafeInteger(next) ||
        new NativeDate(next).toISOString() !== iso ||
        next < now() ||
        next - initial > 48 * 60 * 60 * 1000
      )
        throw new RangeError(
          "Clock advance must be forward and within 48 hours",
        );
      offset = next - realNow();
      return new NativeDate(now()).toISOString();
    },
  });
}

module.exports = { installGoalJourneyClock };
