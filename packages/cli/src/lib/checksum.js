import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function verifySha256(filePath, expectedHash) {
  return computeSha256(filePath).then((actual) => ({
    valid: actual === expectedHash.toLowerCase(),
    actual,
    expected: expectedHash.toLowerCase(),
  }));
}
