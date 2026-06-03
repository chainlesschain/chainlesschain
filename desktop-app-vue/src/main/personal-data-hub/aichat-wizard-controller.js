/**
 * Re-export shim — wizard-controller now lives in the hub package itself
 * (so cli / web-shell can share it). Kept here so existing requires in
 * desktop main continue to resolve.
 *
 * Reference: docs/design/Personal_Data_Hub_Phase_10_3_AIChat_WebView_Wizard.md §2
 */

"use strict";

module.exports = require("@chainlesschain/personal-data-hub/adapters/ai-chat-history/wizard-controller");
