# pkcs11-driver

**Source**: `src/main/ukey/pkcs11-driver.js`

**Generated**: 2026-02-16T22:06:51.413Z

---

## const

```javascript
const
```

* PKCS#11 U-Key Driver
 *
 * Cross-platform hardware token driver using PKCS#11 standard
 *
 * Supports:
 * - macOS: OpenSC, YubiKey, etc.
 * - Linux: OpenSC, SoftHSM, etc.
 * - Windows: OpenSC (as alternative to native drivers)
 *
 * PKCS#11 is the industry standard for cryptographic tokens
 * Supported by most hardware security tokens and smart cards
 *
 * Features:
 * - RSA and SM2 (Chinese national algorithm) support
 * - PIN retry counting and secure memory clearing
 * - Both pkcs11-js and CLI fallback modes

---

## findPKCS11Library()

```javascript
findPKCS11Library()
```

* Find PKCS#11 library on system

---

## async initialize()

```javascript
async initialize()
```

* Initialize driver

---

## async loadSupportedMechanisms()

```javascript
async loadSupportedMechanisms()
```

* Load supported mechanisms from token

---

## async detect()

```javascript
async detect()
```

* Detect available tokens (implements BaseUKeyDriver.detect)

---

## async detectWithPKCS11()

```javascript
async detectWithPKCS11()
```

* Detect using pkcs11-js

---

## async detectWithCLI()

```javascript
async detectWithCLI()
```

* Detect using CLI tools (fallback)

---

## async verifyPIN(pin)

```javascript
async verifyPIN(pin)
```

* Verify PIN (implements BaseUKeyDriver.verifyPIN)

---

## async verifyPINWithPKCS11(pin)

```javascript
async verifyPINWithPKCS11(pin)
```

* Verify PIN using pkcs11-js

---

## async verifyPINWithCLI(pin)

```javascript
async verifyPINWithCLI(pin)
```

* Verify PIN using CLI

---

## async findKeys()

```javascript
async findKeys()
```

* Find and cache key handles

---

## async exportPublicKey()

```javascript
async exportPublicKey()
```

* Export public key in PEM format

---

## rsaToPEM(modulus, exponent)

```javascript
rsaToPEM(modulus, exponent)
```

* Convert RSA modulus/exponent to PEM format

---

## asn1Length(len)

```javascript
asn1Length(len)
```

* ASN.1 length encoding

---

## ecToPEM(ecPoint, isSM2)

```javascript
ecToPEM(ecPoint, isSM2)
```

* Convert EC point to PEM format (simplified)

---

## async getPublicKey()

```javascript
async getPublicKey()
```

* Get public key (implements BaseUKeyDriver.getPublicKey)

---

## async getPublicKeyWithCLI()

```javascript
async getPublicKeyWithCLI()
```

* Get public key using CLI

---

## async disconnect()

```javascript
async disconnect()
```

* Disconnect from token

---

## clearSensitiveData()

```javascript
clearSensitiveData()
```

* Clear sensitive data from memory

---

## async getDeviceInfo()

```javascript
async getDeviceInfo()
```

* Get device information

---

## async sign(data)

```javascript
async sign(data)
```

* Sign data using token (implements BaseUKeyDriver.sign)

---

## async signWithPKCS11(data)

```javascript
async signWithPKCS11(data)
```

* Sign using pkcs11-js

---

## async signWithCLI(data)

```javascript
async signWithCLI(data)
```

* Sign using CLI

---

## async verifySignature(data, signature)

```javascript
async verifySignature(data, signature)
```

* Verify signature (implements BaseUKeyDriver.verifySignature)

---

## async verifySignatureWithPKCS11(data, signature)

```javascript
async verifySignatureWithPKCS11(data, signature)
```

* Verify using pkcs11-js

---

## async verifySignatureWithCrypto(data, signature)

```javascript
async verifySignatureWithCrypto(data, signature)
```

* Verify using Node.js crypto

---

## async encrypt(data)

```javascript
async encrypt(data)
```

* Encrypt data (implements BaseUKeyDriver.encrypt)

---

## async encryptWithPKCS11(data)

```javascript
async encryptWithPKCS11(data)
```

* Encrypt using pkcs11-js

---

## async encryptWithCLI(data)

```javascript
async encryptWithCLI(data)
```

* Encrypt using CLI tools (fallback)

---

## async decrypt(encryptedData)

```javascript
async decrypt(encryptedData)
```

* Decrypt data (implements BaseUKeyDriver.decrypt)

---

## async decryptWithPKCS11(encryptedData)

```javascript
async decryptWithPKCS11(encryptedData)
```

* Decrypt using pkcs11-js

---

## async decryptWithCLI(encryptedData)

```javascript
async decryptWithCLI(encryptedData)
```

* Decrypt using CLI tools (fallback)

---

## async changePin(oldPin, newPin)

```javascript
async changePin(oldPin, newPin)
```

* Change PIN

---

## lock()

```javascript
lock()
```

* Lock device (implements BaseUKeyDriver.lock)

---

## async close()

```javascript
async close()
```

* Close driver

---

## cleanupTempFile(filePath)

```javascript
cleanupTempFile(filePath)
```

* Cleanup temporary file

---

## getDriverName()

```javascript
getDriverName()
```

* Get driver name

---

## getDriverVersion()

```javascript
getDriverVersion()
```

* Get driver version

---

