/**
 * ESM facade for the shared CommonJS trace-context implementation.
 *
 * ProcessExecutionBroker is also consumed through CommonJS on supported Node
 * versions. Keeping the singleton in trace-context.cjs avoids require(ESM)
 * warnings while preserving one AsyncLocalStorage across both module systems.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const traceContextModule = require("./trace-context.cjs");

export const { TraceContext, traceContext } = traceContextModule;
export default traceContext;
