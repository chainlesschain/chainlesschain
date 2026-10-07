import {
  openObservedTextFixture,
  openObservedTextIndex,
} from "./rrsi-observed-text.js";
const [root, digest] = process.argv.slice(2);
try {
  const fixture = openObservedTextFixture(root);
  const index = openObservedTextIndex(fixture);
  process.stdout.write(
    JSON.stringify({
      text: index.readObservedText(digest),
      restrictions: index.inspectRestrictions(digest),
    }),
  );
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      code: error.code,
      message: error.message,
      cause: error.cause?.message ?? null,
    }),
  );
  process.exitCode = 2;
}
