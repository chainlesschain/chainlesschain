/**
 * Built-in Benchmark Suites
 *
 * Provides predefined test suites for evaluating LLM model performance
 * across latency, translation quality, reasoning, and code generation.
 *
 * @module benchmark/benchmark-suites
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");

/**
 * Built-in benchmark suites
 */
const BUILTIN_SUITES = {
  "latency-basic": {
    id: "latency-basic",
    name: "Basic Latency Test",
    description: "Measures response latency across varied prompt lengths",
    iterations: 3,
    prompts: [
      { input: 'Say "hello"', expected: null },
      { input: "What is 2+2?", expected: "4" },
      { input: "Write a haiku about programming", expected: null },
      { input: "Explain the concept of recursion in one sentence", expected: null },
      { input: "List 5 programming languages", expected: null },
      { input: "What is the capital of France?", expected: "Paris" },
      { input: 'Translate "hello world" to Spanish', expected: "hola mundo" },
      { input: "What is Big O notation?", expected: null },
      { input: "Name 3 sorting algorithms", expected: null },
      { input: "What is the meaning of life?", expected: null },
    ],
  },
  "quality-translation": {
    id: "quality-translation",
    name: "Translation Quality",
    description: "Evaluates translation quality using BLEU-like scoring",
    iterations: 1,
    prompts: [
      {
        input: 'Translate to French: "The cat sat on the mat"',
        expected: "Le chat était assis sur le tapis",
      },
      {
        input: 'Translate to Spanish: "Good morning, how are you?"',
        expected: "Buenos días, ¿cómo estás?",
      },
      {
        input: 'Translate to German: "I love programming"',
        expected: "Ich liebe Programmierung",
      },
      {
        input: 'Translate to Japanese: "Hello world"',
        expected: "こんにちは世界",
      },
      {
        input: 'Translate to Chinese: "Machine learning is fascinating"',
        expected: "机器学习很迷人",
      },
    ],
  },
  reasoning: {
    id: "reasoning",
    name: "Reasoning Ability",
    description: "Tests logical reasoning and problem solving",
    iterations: 1,
    prompts: [
      {
        input:
          "If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Answer yes or no and explain.",
        expected: null,
      },
      {
        input:
          "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost?",
        expected: "$0.05",
      },
      {
        input:
          "If it takes 5 machines 5 minutes to make 5 widgets, how long would it take 100 machines to make 100 widgets?",
        expected: "5 minutes",
      },
      {
        input: "Complete the sequence: 2, 6, 12, 20, 30, ?",
        expected: "42",
      },
      {
        input:
          'There are 3 boxes. One contains only apples, one contains only oranges, and one contains both. The boxes are labeled but all labels are wrong. You can pick one fruit from one box. Which box do you pick from to determine all labels?',
        expected: null,
      },
    ],
  },
  "code-generation": {
    id: "code-generation",
    name: "Code Generation",
    description: "Evaluates code generation ability",
    iterations: 1,
    prompts: [
      {
        input: "Write a JavaScript function that checks if a string is a palindrome",
        expected: null,
      },
      {
        input: "Write a Python function to find the fibonacci sequence up to n terms",
        expected: null,
      },
      {
        input: "Write a SQL query to find the second highest salary from an employees table",
        expected: null,
      },
      {
        input: "Write a JavaScript function to deep clone an object",
        expected: null,
      },
      {
        input: "Write a function to implement binary search in any language",
        expected: null,
      },
    ],
  },
};

/**
 * Get a benchmark suite by ID
 * @param {string} suiteId - Suite ID
 * @returns {Object|null} Suite definition or null if not found
 */
function getSuite(suiteId) {
  const suite = BUILTIN_SUITES[suiteId] || null;
  if (!suite) {
    logger.warn(`[BenchmarkSuites] Suite not found: ${suiteId}`);
  }
  return suite;
}

/**
 * List all available benchmark suites
 * @returns {Array<Object>} Array of suite summaries
 */
function listSuites() {
  return Object.values(BUILTIN_SUITES).map((suite) => ({
    id: suite.id,
    name: suite.name,
    description: suite.description,
    iterations: suite.iterations,
    promptCount: suite.prompts.length,
  }));
}

module.exports = { BUILTIN_SUITES, getSuite, listSuites };
