const readline = require("node:readline");
const reader = readline.createInterface({ input: process.stdin });
let previous;
reader.on("line", (line) => {
  const { id, request } = JSON.parse(line);
  const target = request.targets[0];
  if (target === "hang") {
    for (;;) {}
  }
  if (target === "exit") return process.exit(7);
  if (target === "stderr") return process.stderr.write("sensitive diagnostic");
  if (target === "overflow")
    return process.stdout.write("x".repeat(9 * 1024 * 1024));
  const response = {
    id,
    status: target === "native-failure" ? 4 : 0,
    stderr: "",
    stdout: JSON.stringify({
      target,
      pid: process.pid,
      nodeOptions: process.env.NODE_OPTIONS || null,
    }),
  };
  if (target === "stale") response.id = previous;
  previous = id;
  process.stdout.write(
    `${JSON.stringify(response)}\n${target === "trailing" ? "unexpected" : ""}`,
  );
});
reader.on("close", () => process.exit(0));
