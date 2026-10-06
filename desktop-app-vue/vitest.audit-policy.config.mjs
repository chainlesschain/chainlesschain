// Audit persistence uses real SQLite and does not need a renderer environment.
export default {
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 1,
    include: ["tests/unit/remote/remote-command-audit-redaction.test.js"],
  },
};
