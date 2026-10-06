import fs from "node:fs";
import { openRrsiHistoryStore } from "./rrsi-history-store.js";

const [root, mode, inputFile] = process.argv.slice(2);
let nativeDispatchCrashArmed = false;
try {
  const input = inputFile
    ? JSON.parse(fs.readFileSync(inputFile, "utf8"))
    : null;
  const fixture = openRrsiHistoryStore(root, {
    crashHook: [
      "crash-reserve",
      "crash-preparation",
      "crash-native",
      "crash-native-dispatch",
    ].includes(mode)
      ? (phase) => {
          if (
            phase === "after-head" &&
            (mode !== "crash-native-dispatch" || nativeDispatchCrashArmed)
          )
            process.exit(71);
        }
      : null,
  });
  const work = () => {
    if (mode === "inspect") return fixture.adapter.inspect();
    if (["reserve", "crash-reserve", "race-reserve"].includes(mode))
      return fixture.adapter.reserve(input ?? fixture.request());
    if (
      [
        "reserve-native",
        "crash-native",
        "race-native",
        "recover-native",
        "crash-native-dispatch",
      ].includes(mode)
    ) {
      const response = fixture.adapter.reserveNativeBatch(input);
      if (mode === "crash-native-dispatch") {
        nativeDispatchCrashArmed = true;
        fixture.adapter.recordNativeDispatch(response.children[0]);
      }
      if (mode !== "recover-native") return response;
      try {
        fixture.adapter.recordNativeDispatch(response.children[0]);
        return { response, replayDenied: false };
      } catch (error) {
        return {
          response,
          replayDenied: error.code === "CC_RRSI_REPLAY_FORBIDDEN",
        };
      }
    }
    if (
      [
        "reserve-preparation",
        "crash-preparation",
        "race-preparation",
        "recover-preparation",
      ].includes(mode)
    ) {
      const response = fixture.adapter.reservePreparation(
        input ?? fixture.preparationRequest(),
      );
      if (mode !== "recover-preparation") return response;
      try {
        fixture.adapter.recordDispatch(response);
        return { response, replayDenied: false };
      } catch (error) {
        return {
          response,
          replayDenied: error.code === "CC_RRSI_REPLAY_FORBIDDEN",
        };
      }
    }
    throw new Error("unsupported test mode");
  };
  if (["race-reserve", "race-preparation", "race-native"].includes(mode)) {
    process.send({ ready: true });
    process.once("message", () => {
      try {
        process.send({ ok: true, result: work() });
      } catch (error) {
        process.send({ ok: false, code: error.code });
      }
      process.disconnect();
    });
  } else process.stdout.write(`${JSON.stringify(work())}\n`);
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, code: error.code ?? "TEST_HISTORY_FAILED" })}\n`,
  );
  process.exitCode = 1;
}
