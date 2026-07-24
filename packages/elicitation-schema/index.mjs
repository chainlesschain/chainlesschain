import "./index.js";

const core = globalThis.CcElicitationSchema;

if (!core) {
  throw new Error("Failed to initialize the elicitation schema core");
}

export const {
  VOCABULARY_VERSION,
  compileElicitationSchema,
  initialElicitationValues,
  coerceElicitationAnswer,
  validateElicitationAnswer,
  prepareElicitationSubmission,
} = core;

export default core;
