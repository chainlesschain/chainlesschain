import { withFileLockAsync } from "../../src/lib/with-file-lock.js";

try {
  await withFileLockAsync(
    process.argv[2],
    async (context) => {
      context.assertOwnership();
      process.send({ kind: "held" });
      await new Promise((resolve) => {
        process.once("message", resolve);
      });
      context.assertOwnership();
    },
    { failIfUnavailable: true },
  );
  process.disconnect();
} catch (error) {
  process.send?.({ kind: "failed", message: error.message });
  process.exitCode = 1;
  process.disconnect?.();
}
