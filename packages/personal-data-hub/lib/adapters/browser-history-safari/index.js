"use strict";

const adapter = require("./adapter");
const reader = require("./safari-reader");

module.exports = {
  ...adapter,
  ...reader,
};
