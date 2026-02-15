# cross-platform-adapter

**Source**: `src/main/ukey/cross-platform-adapter.js`

**Generated**: 2026-02-15T10:10:53.361Z

---

## const

```javascript
const
```

* Cross-Platform U-Key Adapter
 *
 * Provides unified U-Key interface across Windows, macOS, and Linux
 *
 * Platform Support:
 * - Windows: Native DLL drivers (XinJinKe, FeiTian, etc.)
 * - macOS/Linux: PKCS#11 standard interface + Simulated fallback
 *
 * Architecture:
 * - Detects platform and available hardware
 * - Automatically selects best available driver
 * - Falls back to simulation mode if no hardware detected

---

## const Platforms =

```javascript
const Platforms =
```

* Platform types

---

## const PlatformDrivers =

```javascript
const PlatformDrivers =
```

* Driver availability by platform

---

## class CrossPlatformAdapter extends EventEmitter

```javascript
class CrossPlatformAdapter extends EventEmitter
```

* Cross-Platform U-Key Adapter

---

## getDefaultDriverPreference()

```javascript
getDefaultDriverPreference()
```

* Get default driver preference based on platform

---

## async initialize()

```javascript
async initialize()
```

* Initialize adapter

---

## async detectAvailableDrivers()

```javascript
async detectAvailableDrivers()
```

* Detect available drivers on current platform

---

## async checkDriverAvailability(driverType)

```javascript
async checkDriverAvailability(driverType)
```

* Check if a specific driver is available

---

## checkWindowsDriverDLL(driverType)

```javascript
checkWindowsDriverDLL(driverType)
```

* Check if Windows driver DLL exists

---

## checkPKCS11Library()

```javascript
checkPKCS11Library()
```

* Check if PKCS#11 library is available

---

## async selectBestDriver()

```javascript
async selectBestDriver()
```

* Select best available driver based on preference

---

## async createDriver(driverType)

```javascript
async createDriver(driverType)
```

* Create driver instance

---

## getPlatformInfo()

```javascript
getPlatformInfo()
```

* Get platform information

---

## async switchDriver(driverType)

```javascript
async switchDriver(driverType)
```

* Switch to different driver

---

## async connect(pin)

```javascript
async connect(pin)
```

* Proxy all driver methods to current driver

---

