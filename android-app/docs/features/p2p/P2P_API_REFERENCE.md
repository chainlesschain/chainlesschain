# ChainlessChain P2P API Reference

**Version**: 1.0.0
**Last Updated**: 2026-01-19

---

## Table of Contents

1. [Overview](#overview)
2. [Core Modules](#core-modules)
3. [E2EE Module](#e2ee-module)
4. [P2P Module](#p2p-module)
5. [DID Module](#did-module)
6. [Feature Module](#feature-module)
7. [Data Models](#data-models)
8. [Error Handling](#error-handling)

---

## Overview

This document provides technical API reference for the ChainlessChain Android P2P feature.

### Architecture

```
feature-p2p/                 # UI Layer
    ├── ui/                  # Compose UI components
    ├── viewmodel/           # ViewModels
    └── navigation/          # Navigation

core-p2p/                    # P2P Core Layer
    ├── discovery/           # Device discovery
    ├── connection/          # Connection management
    └── models/              # Data models

core-e2ee/                   # E2EE Core Layer
    ├── identity/            # Identity key management
    ├── session/             # Session management
    ├── ratchet/             # Double Ratchet
    ├── x3dh/                # X3DH key exchange
    ├── verification/        # Safety Numbers
    ├── messaging/           # Message queue
    └── backup/              # Key backup

core-did/                    # DID Core Layer
    ├── models/              # DID data models
    └── manager/             # DID operations
```

---

## Core Modules

### Dependencies

```kotlin
dependencies {
    // Core modules
    implementation(project(":core-p2p"))
    implementation(project(":core-e2ee"))
    implementation(project(":core-did"))

    // Feature module
    implementation(project(":feature-p2p"))
}
```

---

## E2EE Module

### IdentityKeyManager

Manages identity keys and pre-keys for E2EE.

#### Interface

```kotlin
interface IdentityKeyManager {
    /**
     * Get or generate identity key pair
     */
    suspend fun getIdentityKeyPair(): X25519KeyPair

    /**
     * Generate complete pre-key bundle
     */
    suspend fun generatePreKeyBundle(): PreKeyBundle

    /**
     * Get signed pre-key pair
     */
    suspend fun getSignedPreKey(): X25519KeyPair

    /**
     * Get all one-time pre-keys
     */
    suspend fun getOneTimePreKeys(): Map<String, X25519KeyPair>

    /**
     * Generate new identity key pair
     */
    suspend fun generateIdentityKeyPair(): X25519KeyPair
}
```

#### Usage Example

```kotlin
@Inject
lateinit var identityKeyManager: IdentityKeyManager

// Get identity key
val identityKey = identityKeyManager.getIdentityKeyPair()

// Generate pre-key bundle for pairing
val preKeyBundle = identityKeyManager.generatePreKeyBundle()
```

### PersistentSessionManager

Manages E2EE sessions with persistence.

#### Interface

```kotlin
interface SessionManager {
    /**
     * Initialize session manager
     */
    suspend fun initialize(
        autoRestore: Boolean = true,
        enableRotation: Boolean = true
    )

    /**
     * Create new session
     */
    suspend fun createSession(
        peerId: String,
        sharedSecret: ByteArray,
        isInitiator: Boolean
    )

    /**
     * Encrypt message
     */
    suspend fun encryptMessage(
        peerId: String,
        plaintext: ByteArray
    ): RatchetMessage

    /**
     * Decrypt message
     */
    suspend fun decryptMessage(
        peerId: String,
        encryptedMessage: RatchetMessage
    ): ByteArray

    /**
     * Get session info
     */
    suspend fun getSessionInfo(peerId: String): SessionInfo?

    /**
     * Delete session
     */
    suspend fun deleteSession(peerId: String)

    /**
     * Active sessions flow
     */
    val activeSessions: StateFlow<List<SessionInfo>>
}
```

#### Usage Example

```kotlin
@Inject
lateinit var sessionManager: PersistentSessionManager

// Initialize
sessionManager.initialize(
    autoRestore = true,
    enableRotation = true
)

// Create session after X3DH
sessionManager.createSession(
    peerId = "bob",
    sharedSecret = x3dhOutput,
    isInitiator = true
)

// Encrypt message
val encrypted = sessionManager.encryptMessage(
    peerId = "bob",
    plaintext = "Hello Bob!".toByteArray()
)

// Decrypt message
val decrypted = sessionManager.decryptMessage(
    peerId = "bob",
    encryptedMessage = encrypted
)
```

### X3DHKeyExchange

Implements X3DH key agreement protocol.

#### Interface

```kotlin
interface X3DHKeyExchange {
    /**
     * Initiate X3DH session as Alice
     */
    suspend fun initiateSession(
        remoteIdentityKey: X25519PublicKey,
        remoteSignedPreKey: X25519PublicKey,
        remoteOneTimePreKey: X25519PublicKey?,
        remoteSignature: ByteArray
    ): ByteArray

    /**
     * Respond to X3DH session as Bob
     */
    suspend fun respondToSession(
        remoteIdentityKey: X25519PublicKey,
        remoteEphemeralKey: X25519PublicKey,
        usedOneTimePreKeyId: String?
    ): ByteArray
}
```

#### Usage Example

```kotlin
@Inject
lateinit var keyExchange: X3DHKeyExchange

// Alice initiates
val sharedSecret = keyExchange.initiateSession(
    remoteIdentityKey = bobPreKeyBundle.identityKey,
    remoteSignedPreKey = bobPreKeyBundle.signedPreKey,
    remoteOneTimePreKey = bobPreKeyBundle.oneTimePreKey,
    remoteSignature = bobPreKeyBundle.signature
)

// Bob responds
val sharedSecret = keyExchange.respondToSession(
    remoteIdentityKey = aliceIdentityKey,
    remoteEphemeralKey = aliceEphemeralKey,
    usedOneTimePreKeyId = "prekey_123"
)
```

### VerificationManager

Manages Safety Numbers and session verification.

#### Interface

```kotlin
interface VerificationManager {
    /**
     * Generate Safety Numbers
     */
    fun generateSafetyNumbers(
        localIdentifier: String,
        localPublicKey: ByteArray,
        remoteIdentifier: String,
        remotePublicKey: ByteArray
    ): String

    /**
     * Generate session fingerprint
     */
    fun generateSessionFingerprint(
        localPublicKey: ByteArray,
        remotePublicKey: ByteArray,
        associatedData: ByteArray
    ): String

    /**
     * Mark peer as verified
     */
    suspend fun markAsVerified(peerId: String)

    /**
     * Check if peer is verified
     */
    suspend fun isVerified(peerId: String): Boolean

    /**
     * Clear verification
     */
    suspend fun clearVerification(peerId: String)
}
```

#### Usage Example

```kotlin
@Inject
lateinit var verificationManager: VerificationManager

// Generate Safety Numbers
val safetyNumber = verificationManager.generateSafetyNumbers(
    localIdentifier = "alice",
    localPublicKey = aliceKey,
    remoteIdentifier = "bob",
    remotePublicKey = bobKey
)
// Result: "123456789012 234567890123 345678901234 456789012345 567890123456"

// Generate fingerprint
val fingerprint = verificationManager.generateSessionFingerprint(
    localPublicKey = aliceKey,
    remotePublicKey = bobKey,
    associatedData = sessionId.toByteArray()
)

// Mark as verified
verificationManager.markAsVerified("bob")

// Check verification status
val isVerified = verificationManager.isVerified("bob")
```

### MessageQueueManager

Manages message queues for offline/delayed sending.

#### Interface

```kotlin
interface MessageQueueManager {
    /**
     * Enqueue outgoing message
     */
    suspend fun enqueueOutgoing(
        peerId: String,
        message: RatchetMessage,
        priority: Int = NORMAL
    ): String

    /**
     * Enqueue incoming message
     */
    suspend fun enqueueIncoming(
        peerId: String,
        message: RatchetMessage
    ): String

    /**
     * Remove message
     */
    suspend fun removeOutgoingMessage(peerId: String, messageId: String)

    /**
     * Retry message
     */
    suspend fun retryMessage(peerId: String, messageId: String)

    /**
     * Outgoing queue flow
     */
    val outgoingQueue: StateFlow<Map<String, List<QueuedOutgoingMessage>>>

    /**
     * Incoming queue flow
     */
    val incomingQueue: StateFlow<Map<String, List<QueuedIncomingMessage>>>
}
```

#### Usage Example

```kotlin
@Inject
lateinit var messageQueueManager: PersistentMessageQueueManager

// Enqueue message
val messageId = messageQueueManager.enqueueOutgoing(
    peerId = "bob",
    message = encryptedMessage,
    priority = MessagePriority.HIGH
)

// Monitor queue
messageQueueManager.outgoingQueue.collect { queue ->
    val bobMessages = queue["bob"] ?: emptyList()
    println("Bob has ${bobMessages.size} queued messages")
}

// Retry failed message
messageQueueManager.retryMessage("bob", messageId)
```

### KeyBackupManager

Manages encrypted key backups.

#### Interface

```kotlin
interface KeyBackupManager {
    /**
     * Create encrypted backup
     */
    fun createBackup(
        identityKeyPair: X25519KeyPair,
        signedPreKeyPair: X25519KeyPair,
        oneTimePreKeys: Map<String, X25519KeyPair>,
        passphrase: String
    ): EncryptedBackup

    /**
     * Restore from backup
     */
    fun restoreBackup(
        backup: EncryptedBackup,
        passphrase: String
    ): RestoredKeys
}
```

#### Usage Example

```kotlin
@Inject
lateinit var keyBackupManager: KeyBackupManager

// Create backup
val backup = keyBackupManager.createBackup(
    identityKeyPair = identityKey,
    signedPreKeyPair = signedPreKey,
    oneTimePreKeys = oneTimePreKeys,
    passphrase = "my_secure_passphrase"
)

// Save to file
File("backup.dat").writeBytes(backup.encryptedData)

// Restore backup
val restored = keyBackupManager.restoreBackup(
    backup = backup,
    passphrase = "my_secure_passphrase"
)
```

---

## P2P Module

### NSDDeviceDiscovery

Network Service Discovery for finding nearby devices.

#### Interface

```kotlin
interface DeviceDiscovery {
    /**
     * Start device discovery
     */
    suspend fun startDiscovery()

    /**
     * Stop device discovery
     */
    suspend fun stopDiscovery()

    /**
     * Discovered devices flow
     */
    val discoveredDevices: StateFlow<List<P2PDevice>>
}
```

#### Usage Example

```kotlin
@Inject
lateinit var deviceDiscovery: NSDDeviceDiscovery

// Start discovery
deviceDiscovery.startDiscovery()

// Monitor discovered devices
deviceDiscovery.discoveredDevices.collect { devices ->
    devices.forEach { device ->
        println("Found: ${device.deviceName} at ${device.ipAddress}")
    }
}

// Stop discovery
deviceDiscovery.stopDiscovery()
```

### P2PConnectionManager

Manages P2P connections between devices.

#### Interface

```kotlin
interface P2PConnectionManager {
    /**
     * Connect to device
     */
    suspend fun connect(device: P2PDevice)

    /**
     * Disconnect from device
     */
    suspend fun disconnect(deviceId: String)

    /**
     * Request pre-key bundle
     */
    suspend fun requestPreKeyBundle(deviceId: String): PreKeyBundle

    /**
     * Send initial message
     */
    suspend fun sendInitialMessage(
        deviceId: String,
        ephemeralKey: ByteArray,
        initialMessage: ByteArray
    )

    /**
     * Send encrypted message
     */
    suspend fun sendMessage(
        deviceId: String,
        message: RatchetMessage
    )
}
```

---

## DID Module

### DIDManager

Manages Decentralized Identifiers.

#### Interface

```kotlin
interface DIDManager {
    /**
     * Get local DID
     */
    suspend fun getLocalDID(): String?

    /**
     * Create new DID
     */
    suspend fun createDID(): String

    /**
     * Resolve DID document
     */
    suspend fun resolveDID(did: String): DIDDocument?

    /**
     * Update DID document
     */
    suspend fun updateDIDDocument(document: DIDDocument)
}
```

#### Usage Example

```kotlin
@Inject
lateinit var didManager: DIDManager

// Get or create DID
val did = didManager.getLocalDID() ?: didManager.createDID()

// Resolve document
val document = didManager.resolveDID(did)

println("DID: ${document?.id}")
println("Controller: ${document?.controller}")
```

---

## Feature Module

### ViewModels

#### P2PDeviceViewModel

```kotlin
@HiltViewModel
class P2PDeviceViewModel @Inject constructor(
    private val deviceDiscovery: NSDDeviceDiscovery,
    private val sessionManager: PersistentSessionManager,
    private val verificationManager: VerificationManager
) : ViewModel() {

    val discoveredDevices: StateFlow<List<P2PDevice>>
    val connectedDevices: StateFlow<List<DeviceWithSession>>
    val uiState: StateFlow<DeviceUiState>
    val isScanning: StateFlow<Boolean>

    fun startScanning()
    fun stopScanning()
    fun connectDevice(device: P2PDevice)
    fun disconnectDevice(peerId: String)
    suspend fun isDeviceVerified(peerId: String): Boolean
}
```

#### PairingViewModel

```kotlin
@HiltViewModel
class PairingViewModel @Inject constructor(
    private val sessionManager: PersistentSessionManager,
    private val connectionManager: P2PConnectionManager,
    private val keyExchange: X3DHKeyExchange
) : ViewModel() {

    val pairingState: StateFlow<PairingState>
    val device: StateFlow<P2PDevice?>

    fun startPairing(deviceId: String)
    fun cancelPairing()
    fun retryPairing()
}
```

#### MessageQueueViewModel

```kotlin
@HiltViewModel
class MessageQueueViewModel @Inject constructor(
    private val queueManager: PersistentMessageQueueManager
) : ViewModel() {

    val outgoingMessages: StateFlow<List<QueuedMessage>>
    val incomingMessages: StateFlow<List<QueuedMessage>>

    fun retryMessage(messageId: String)
    fun cancelMessage(messageId: String)
    fun clearCompleted()
    fun getQueueStats(): QueueStats
}
```

#### DIDViewModel

```kotlin
@HiltViewModel
class DIDViewModel @Inject constructor(
    private val didManager: DIDManager,
    private val identityKeyManager: IdentityKeyManager,
    private val keyBackupManager: KeyBackupManager
) : ViewModel() {

    val didDocument: StateFlow<DIDDocument?>
    val identityKeyFingerprint: StateFlow<String?>
    val deviceCount: StateFlow<Int>

    fun exportDID()
    fun shareDID()
    fun backupKeys()
}
```

---

## Data Models

### P2PDevice

```kotlin
data class P2PDevice(
    val deviceId: String,
    val deviceName: String,
    val ipAddress: String,
    val port: Int
)
```

### SessionInfo

```kotlin
data class SessionInfo(
    val peerId: String,
    val sendMessageNumber: Int,
    val receiveMessageNumber: Int,
    val createdAt: Long
)
```

### RatchetMessage

```kotlin
data class RatchetMessage(
    val header: ByteArray,
    val ciphertext: ByteArray
)
```

### DIDDocument

```kotlin
data class DIDDocument(
    val context: List<String>,
    val id: String,
    val controller: String?,
    val verificationMethod: List<VerificationMethod>,
    val authentication: List<String>,
    val keyAgreement: List<String>?,
    val service: List<Service>?
)
```

### CompleteVerificationInfo

```kotlin
data class CompleteVerificationInfo(
    val safetyNumber: String,
    val qrCodeData: String,
    val remoteIdentifier: String,
    val isVerified: Boolean
)
```

---

## Error Handling

### Common Exceptions

```kotlin
// E2EE Exceptions
class SessionNotFoundException(peerId: String)
class DecryptionException(message: String)
class InvalidPreKeyBundleException(message: String)

// P2P Exceptions
class DeviceNotFoundException(deviceId: String)
class ConnectionFailedException(message: String)
class PairingTimeoutException(message: String)

// DID Exceptions
class DIDNotFoundException(did: String)
class InvalidDIDException(message: String)
```

### Error Handling Pattern

```kotlin
try {
    val encrypted = sessionManager.encryptMessage(peerId, plaintext)
} catch (e: SessionNotFoundException) {
    // Handle missing session
    println("Session not found for $peerId")
} catch (e: Exception) {
    // Handle general error
    println("Encryption failed: ${e.message}")
}
```

---

## Best Practices

### 1. Dependency Injection

Always use Hilt for dependency injection:

```kotlin
@HiltViewModel
class MyViewModel @Inject constructor(
    private val sessionManager: PersistentSessionManager
) : ViewModel()
```

### 2. Coroutine Scopes

Use ViewModel scope for long-running operations:

```kotlin
fun connectDevice(device: P2PDevice) {
    viewModelScope.launch {
        try {
            sessionManager.createSession(...)
        } catch (e: Exception) {
            // Handle error
        }
    }
}
```

### 3. StateFlow Collection

Collect StateFlows safely in Compose:

```kotlin
@Composable
fun MyScreen(viewModel: P2PDeviceViewModel = hiltViewModel()) {
    val devices by viewModel.discoveredDevices.collectAsState()

    LazyColumn {
        items(devices) { device ->
            DeviceItem(device)
        }
    }
}
```

### 4. Error Handling

Always handle errors gracefully:

```kotlin
sealed class DeviceUiState {
    object Idle : DeviceUiState()
    object Loading : DeviceUiState()
    data class Success(val devices: List<P2PDevice>) : DeviceUiState()
    data class Error(val message: String) : DeviceUiState()
}
```

### 5. Resource Cleanup

Clean up resources in ViewModel:

```kotlin
override fun onCleared() {
    super.onCleared()
    viewModelScope.launch {
        deviceDiscovery.stopDiscovery()
    }
}
```

---

## Testing

### Unit Testing

```kotlin
@Test
fun `encrypt message should return encrypted data`() = runTest {
    // Given
    val peerId = "test_peer"
    val plaintext = "Hello".toByteArray()

    sessionManager.createSession(peerId, sharedSecret, true)

    // When
    val encrypted = sessionManager.encryptMessage(peerId, plaintext)

    // Then
    assertNotNull(encrypted)
    assertTrue(encrypted.ciphertext.isNotEmpty())
}
```

### Integration Testing

```kotlin
@Test
fun testCompleteE2EEWorkflow() = runBlocking {
    // Create sessions
    val aliceSession = sessionManager.createSession("bob", secret, true)
    val bobSession = sessionManager.createSession("alice", secret, false)

    // Encrypt message
    val encrypted = sessionManager.encryptMessage("bob", plaintext)

    // Decrypt message
    val decrypted = sessionManager.decryptMessage("alice", encrypted)

    assertEquals(plaintext, decrypted)
}
```

---

## Version History

| Version | Date       | Changes         |
| ------- | ---------- | --------------- |
| 1.0.0   | 2026-01-19 | Initial release |

---

## Support

- **Documentation**: https://docs.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/android-app
- **Email**: dev@chainlesschain.com

---

**Document Version**: 1.0.0
**API Version**: 1.0.0
**Last Updated**: 2026-01-19
