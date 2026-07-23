import statusLine from "./status-line.cjs";
import executionBroker from "./process-execution-broker/index.js";

const brokerRunner = executionBroker.spawnSync.bind(executionBroker);

export function renderStatusLine(config, context, options = {}) {
  return statusLine.renderStatusLine(config, context, {
    ...options,
    runProcess:
      options.runProcess || statusLine._deps.runProcess || brokerRunner,
  });
}

export function getStatusLine(options = {}) {
  return statusLine.getStatusLine({
    ...options,
    runProcess:
      options.runProcess || statusLine._deps.runProcess || brokerRunner,
  });
}

export const {
  loadStatusLineConfig,
  buildContext,
  formatTokens,
  shortenPath,
  renderDefaultStatusLine,
  isStatusLineDisabled,
  terminalSize,
  _deps,
} = statusLine;

export default { ...statusLine, renderStatusLine, getStatusLine };
