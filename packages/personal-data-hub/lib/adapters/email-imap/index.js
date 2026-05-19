"use strict";

const { EmailAdapter, parseWatermark, formatWatermark, NAME, VERSION } = require("./email-adapter");
const { PROVIDERS, resolveProvider } = require("./providers");
const {
  ImapSession,
  ImapAuthFailedError,
  ImapConnectionFailedError,
  ImapMailboxNotFoundError,
} = require("./imap-session");
const { parseRawEmail } = require("./email-parser");
const {
  CATEGORIES,
  ALL_CATEGORIES,
  LAYER1_RULES,
  classifyLayer1,
  classifyLayer2,
  classifyEmail,
  LAYER2_SYSTEM_PROMPT,
} = require("./classifier");

module.exports = {
  EmailAdapter,
  EMAIL_ADAPTER_NAME: NAME,
  EMAIL_ADAPTER_VERSION: VERSION,
  parseWatermark,
  formatWatermark,
  EMAIL_PROVIDERS: PROVIDERS,
  resolveEmailProvider: resolveProvider,
  ImapSession,
  ImapAuthFailedError,
  ImapConnectionFailedError,
  ImapMailboxNotFoundError,
  parseRawEmail,
  // Phase 5.3 classifier
  EMAIL_CATEGORIES: CATEGORIES,
  EMAIL_ALL_CATEGORIES: ALL_CATEGORIES,
  EMAIL_LAYER1_RULES: LAYER1_RULES,
  classifyEmailLayer1: classifyLayer1,
  classifyEmailLayer2: classifyLayer2,
  classifyEmail,
  EMAIL_LAYER2_SYSTEM_PROMPT: LAYER2_SYSTEM_PROMPT,
};
