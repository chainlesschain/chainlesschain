/**
 * Browser Actions - Extended action handlers
 *
 * @module browser/actions
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { ScrollAction, ScrollDirection, ScrollBehavior } = require('./scroll-action');
const { KeyboardAction, ModifierKey, ShortcutPresets } = require('./keyboard-action');
const { UploadAction, UploadMethod } = require('./upload-action');
const { MultiTabAction, TabAction } = require('./multi-tab-action');

module.exports = {
  // Scroll
  ScrollAction,
  ScrollDirection,
  ScrollBehavior,

  // Keyboard
  KeyboardAction,
  ModifierKey,
  ShortcutPresets,

  // Upload
  UploadAction,
  UploadMethod,

  // Multi-tab
  MultiTabAction,
  TabAction
};
