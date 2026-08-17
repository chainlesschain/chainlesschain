import { parentPort, workerData } from "node:worker_threads";
import { getQuickJS } from "@tootallnate/quickjs-emscripten";
import { createPacResolver } from "pac-resolver";

try {
  const quickJs = await getQuickJS();
  const resolver = createPacResolver(quickJs, workerData.script);
  const result = await resolver(workerData.url);
  parentPort.postMessage({ ok: true, result });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: String(error?.message || error).slice(0, 2048),
  });
}
