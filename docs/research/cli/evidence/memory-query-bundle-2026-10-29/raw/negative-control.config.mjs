import fs from "node:fs";
import { createHash } from "node:crypto";
import base from "../../packages/cli/vitest.config.js";

const needle = "  async _readQueryBundleIndexes(manifest, checkpoint) {";
const anchor = "    const indexes = new Map();";
const shortcut = `    if (plan.frames.every(({ bucket }) => this._queryIndexes.has(bucket))) {
      return new Map(plan.frames.map(({ bucket }) => [bucket, this._queryIndexes.get(bucket).index]));
    }
`;
export default {
  ...base,
  plugins: [{
    name: "memory-bundle-unsafe-warm-cache-control",
    enforce: "pre",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").split("?")[0].endsWith("/src/lib/context-memory-kernel/segmented-memory-port.js")) return null;
      const start = code.indexOf(needle);
      const offset = code.indexOf(anchor, start);
      if (start < 0 || offset < 0) throw new Error("Negative control anchor missing");
      const transformed = code.slice(0, offset) + shortcut + code.slice(offset);
      const sha = (text) => createHash("sha256").update(text).digest("hex");
      fs.writeFileSync(new URL("./negative-control-transform.json", import.meta.url), JSON.stringify({
        id, originalSha256: sha(code), transformedSha256: sha(transformed),
        mutation: "Return decoded indexes without validating any active bundle bytes on a warm query",
      }, null, 2) + "\n");
      return { code: transformed, map: null };
    },
  }],
};
