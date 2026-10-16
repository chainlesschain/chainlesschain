export default {
  test: {
    environment: "node",
    globals: true,
    pool: "forks",
    maxWorkers: 1,
    include: [
      "src/main/ai-engine/cowork/__tests__/decision-knowledge-base.test.js",
      "src/main/ai-engine/cowork/__tests__/debate-review.test.js",
      "tests/ai-engine/llm-decision-engine.test.js",
      "tests/unit/evomap/evomap-asset-bridge.test.js",
      "tests/unit/evomap/evomap-gene-synthesizer.test.js",
    ],
  },
};
