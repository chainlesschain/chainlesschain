import "./index.js";

const api = globalThis.CcElicitationSchema;

if (!api) {
  throw new Error("Failed to initialize the elicitation schema core");
}

export const VOCABULARY_VERSION = api.VOCABULARY_VERSION;
export const compileElicitationSchema = api.compileElicitationSchema;
export const initialElicitationValues = api.initialElicitationValues;
export const coerceElicitationAnswer = api.coerceElicitationAnswer;
export const validateElicitationAnswer = api.validateElicitationAnswer;
export const prepareElicitationSubmission = api.prepareElicitationSubmission;

export default api;
