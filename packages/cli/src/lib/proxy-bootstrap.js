/**
 * Proxy bootstrap stub for unit tests
 */
let _proxyEnabled = false;

export function enableProxy() {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
    _proxyEnabled = true;
  }
  return _proxyEnabled;
}

export function proxyEnabled() {
  return _proxyEnabled;
}

export function isLazy() {
  return false;
}
