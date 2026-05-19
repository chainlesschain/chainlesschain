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
};
