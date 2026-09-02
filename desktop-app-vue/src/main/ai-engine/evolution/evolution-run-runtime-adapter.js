"use strict";

const evolutionRun = require("@chainlesschain/session-core/evolution-run");

function projectDesktopEvolutionRun(events, options) {
  return evolutionRun.projectEvolutionRun(events, options);
}

module.exports = { projectDesktopEvolutionRun };
