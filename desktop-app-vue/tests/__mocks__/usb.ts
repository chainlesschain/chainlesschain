/**
 * Mock for 'usb' package (not installed in test environment)
 * Used by src/main/ukey/usb-transport.js
 */
export function getDeviceList() { return []; }
export function findByIds() { return null; }
export default { getDeviceList, findByIds };
