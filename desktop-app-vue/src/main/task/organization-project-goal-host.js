"use strict";

const {
  OrganizationProjectAuthority,
} = require("@chainlesschain/session-core/organization-project-authority");
const {
  OrganizationProjectGoalMonitoringEngine,
} = require("@chainlesschain/session-core/organization-project-goal-monitoring");
const {
  createProjectGoalMonitoringController,
} = require("./project-goal-monitoring-host");

/** Reuse protected native scheduler storage and lifecycle, with no background
 * loop or renderer-selected identity/path. Only explicit manual checks run. */
function createOrganizationProjectGoalController(dependencies = {}) {
  return createProjectGoalMonitoringController({
    ...dependencies,
    storageDirectory: "organization-goal-monitoring",
    autoStart: false,
    engineFactory: ({ db, getActor, clock, store }) => {
      const authority = new OrganizationProjectAuthority({
        db,
        getActor,
        now: clock,
        confirm: () => false,
      });
      const engine = new OrganizationProjectGoalMonitoringEngine({
        db,
        getActor,
        authority,
        clock,
        store,
      });
      const closeCore = engine.close.bind(engine);
      let closing;
      engine.close = () =>
        closing ||
        (closing = (async () => {
          try {
            await closeCore();
          } finally {
            store.close();
          }
        })());
      return engine;
    },
  });
}
module.exports = { createOrganizationProjectGoalController };
