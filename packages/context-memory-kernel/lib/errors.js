"use strict";

const { CONTEXT_ERROR_CODES } = require("./constants.js");

class ContextMemoryKernelError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ContextMemoryKernelError";
    this.code = code;
    this.details = details;
  }
}

function kernelError(code, message, details = {}) {
  return new ContextMemoryKernelError(code, message, details);
}

function invalidArgument(message, details = {}) {
  return kernelError(CONTEXT_ERROR_CODES.INVALID_ARGUMENT, message, details);
}

module.exports = {
  ContextMemoryKernelError,
  kernelError,
  invalidArgument,
};
