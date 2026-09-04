let input = "";
for await (const chunk of process.stdin) {
  input += chunk.toString("utf8");
  if (Buffer.byteLength(input) > 1024 * 1024)
    throw new Error("evaluation process input exceeds 1 MiB");
}
const request = JSON.parse(input);
const moduleUrl = new URL(request.moduleUrl);
const implementation = await import(moduleUrl.href);
const handler = implementation[request.exportName];
if (typeof handler !== "function")
  throw new Error("evaluation process export is unavailable");
const value = await handler(request.payload);
process.stdout.write(`${JSON.stringify({ ok: true, value })}\n`);
