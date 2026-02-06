/**
 * Browser Advanced Features - Entry Point
 *
 * @module browser/advanced
 * @author ChainlessChain Team
 * @since v0.30.0
 */

const { ShadowDOMScanner } = require('./shadow-dom-scanner');
const { IframeScanner } = require('./iframe-scanner');
const { SPAObserver, ChangeType } = require('./spa-observer');

module.exports = {
  ShadowDOMScanner,
  IframeScanner,
  SPAObserver,
  ChangeType
};
