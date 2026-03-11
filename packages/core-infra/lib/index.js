/**
 * @chainlesschain/core-infra
 * DI container, event bus, and bootstrap infrastructure
 */

const { ServiceContainer, getServiceContainer } = require("./service-container.js");
const { EventBus, getEventBus } = require("./event-bus.js");
const { getLogger, setLogger } = require("./logger-adapter.js");

module.exports = {
  ServiceContainer,
  getServiceContainer,
  EventBus,
  getEventBus,
  getLogger,
  setLogger,
};
