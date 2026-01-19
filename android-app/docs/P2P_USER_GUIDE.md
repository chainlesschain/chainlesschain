# ChainlessChain P2P Feature User Guide

**Version**: 1.0.0
**Last Updated**: 2026-01-19

---

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Device Discovery](#device-discovery)
4. [Device Pairing](#device-pairing)
5. [Safety Numbers Verification](#safety-numbers-verification)
6. [Sending Messages](#sending-messages)
7. [DID Management](#did-management)
8. [Troubleshooting](#troubleshooting)
9. [FAQ](#faq)
10. [Privacy & Security](#privacy--security)

---

## Introduction

The ChainlessChain P2P (Peer-to-Peer) feature allows you to connect with other users directly for secure, encrypted communication without relying on central servers.

### Key Features

- **🔍 Device Discovery**: Find nearby devices automatically
- **🔐 End-to-End Encryption**: All messages encrypted with Signal Protocol
- **✅ Safety Numbers**: Verify connections are secure
- **🆔 DID Identity**: Decentralized identity management
- **📱 Multi-Device**: Connect multiple devices
- **🔒 Offline Messaging**: Queue messages when offline

---

## Getting Started

### Requirements

- Android 8.0 or higher (API 26+)
- Network connection (Wi-Fi or mobile data)
- Camera permission (for QR code scanning)

### First Time Setup

1. **Install the App**
   - Download from Google Play Store
   - Grant required permissions

2. **Create Your Identity**
   - The app automatically creates a DID (Decentralized Identifier)
   - Your identity keys are generated and stored securely

3. **Enable Permissions**
   - **Network**: Required for P2P connections
   - **Camera**: Optional, for QR code scanning

---

## Device Discovery

### Starting Device Discovery

1. Open the app and navigate to **P2P Devices**
2. Tap the **Search icon** (🔍) in the top right
3. Wait for nearby devices to appear

### Understanding Device States

| Icon | Status     | Description                             |
| ---- | ---------- | --------------------------------------- |
| 📱   | Discovered | Device found but not connected          |
| ✅   | Connected  | Active P2P connection established       |
| 🔒   | Verified   | Connection verified with Safety Numbers |

### Connecting to a Device

1. Find the device in the "Nearby Devices" list
2. Tap on the device
3. Wait for the pairing process to complete

> **Note**: Both devices must be on the same network or have direct connectivity.

---

## Device Pairing

The pairing process establishes a secure encrypted connection between two devices.

### Pairing Steps

#### Step 1: Initializing

- The app prepares for the connection
- Duration: ~1 second

#### Step 2: Exchanging Keys

- Devices exchange encryption keys using X3DH protocol
- Progress shown as percentage (0-100%)
- Duration: ~3-5 seconds

#### Step 3: Verifying Identity

- You're prompted to verify the connection
- **Recommended**: Verify Safety Numbers before proceeding
- **Skip**: You can skip and verify later

#### Step 4: Completed

- Connection established successfully
- You can now send encrypted messages

### Pairing Failed?

If pairing fails, possible reasons:

- **Network issues**: Check your connection
- **Device out of range**: Move closer
- **Timeout**: Try again
- **Rejected**: The other device declined

**Solution**: Tap "Retry" to attempt pairing again.

---

## Safety Numbers Verification

Safety Numbers ensure your connection hasn't been compromised by a "man-in-the-middle" attack.

### What Are Safety Numbers?

Safety Numbers are 60-digit codes generated from both devices' encryption keys. Both devices will show the **exact same** Safety Number if the connection is secure.

**Example**:

```
123456789012
234567890123
345678901234
456789012345
567890123456
```

### How to Verify

#### Method 1: Visual Comparison (In Person)

1. Open the device details page
2. Tap **"Verify Safety Numbers"**
3. Meet with the other person face-to-face
4. Compare the 60-digit code on both screens
5. If they match, tap **"Confirm Verification"**

#### Method 2: QR Code Scanning (Remote)

1. On Device A: Display the QR code
2. On Device B: Tap **"Scan QR Code"**
3. Grant camera permission if prompted
4. Scan Device A's QR code
5. Automatic verification if codes match

#### Method 3: Trusted Channel (Phone Call)

1. Call the other person on a trusted phone line
2. Read out the Safety Numbers digit by digit
3. If they match, both tap **"Confirm Verification"**

### Verification Status

- **✅ Verified**: Connection confirmed secure
- **❌ Unverified**: Not yet verified
- **⚠️ Mismatch**: **WARNING! DO NOT TRUST THIS CONNECTION**

> **Security Warning**: If Safety Numbers don't match, **DO NOT** proceed. Your connection may be compromised. Disconnect immediately and contact the other person through a trusted channel.

---

## Sending Messages

### Compose a Message

1. Open a connected device
2. Type your message in the text field
3. Tap **Send**

### Message States

- **⏳ Pending**: Waiting to be sent
- **📤 Sending**: Currently encrypting and sending
- **✅ Sent**: Delivered successfully
- **❌ Failed**: Send failed (tap to retry)

### Message Queue

View pending messages:

1. Open the device details
2. Tap **"Message Queue"**
3. See all pending outgoing and incoming messages

**Actions**:

- **Retry**: Resend failed messages
- **Cancel**: Remove message from queue
- **Clear Completed**: Remove successfully sent messages

---

## DID Management

### What is DID?

DID (Decentralized Identifier) is your unique identity in the decentralized network. It looks like:

```
did:chainlesschain:1234567890abcdef...
```

### View Your DID

1. Navigate to **Settings** → **DID Management**
2. View your DID identifier
3. See your identity key fingerprint

### Export Your DID

1. Open **DID Management**
2. Tap **"Export DID"**
3. DID document saved to:
   ```
   /storage/emulated/0/Android/data/com.chainlesschain/files/did_export/
   ```

### Share Your DID

1. Open **DID Management**
2. Tap the **Share icon** (↗️)
3. Choose how to share (messaging app, email, etc.)

### Backup Your Keys

**IMPORTANT**: Back up your encryption keys to prevent data loss!

1. Open **DID Management**
2. Tap **"Backup Keys"**
3. Enter a strong passphrase
4. Keys saved to:
   ```
   /storage/emulated/0/Android/data/com.chainlesschain/files/key_backup/
   ```

> **Security Tip**: Store your backup file and passphrase securely. Anyone with both can decrypt your messages.

---

## Troubleshooting

### Problem: Can't Find Devices

**Solutions**:

- ✅ Check you're on the same network
- ✅ Restart device discovery
- ✅ Check network permissions
- ✅ Disable VPN if active
- ✅ Move closer to other device

### Problem: Pairing Keeps Failing

**Solutions**:

- ✅ Check internet connection
- ✅ Restart both devices
- ✅ Clear app cache: Settings → Apps → ChainlessChain → Clear Cache
- ✅ Reinstall the app (last resort)

### Problem: Messages Not Sending

**Solutions**:

- ✅ Check connection status (must be "Connected")
- ✅ View Message Queue for errors
- ✅ Retry failed messages
- ✅ Verify session hasn't expired

### Problem: QR Scanner Not Working

**Solutions**:

- ✅ Grant camera permission: Settings → Apps → ChainlessChain → Permissions
- ✅ Check camera in good lighting
- ✅ Clean camera lens
- ✅ Ensure QR code is fully visible

### Problem: High Battery Drain

**Solutions**:

- ✅ Stop device discovery when not needed
- ✅ Disconnect inactive sessions
- ✅ Check background app settings
- ✅ Update to latest version

---

## FAQ

### Q: Is my communication really private?

**A**: Yes! All messages are encrypted end-to-end using the Signal Protocol, the same encryption used by Signal and WhatsApp. Only you and the recipient can decrypt messages.

### Q: Can ChainlessChain see my messages?

**A**: No. Messages are encrypted on your device and only the recipient can decrypt them. ChainlessChain has no access to your message content.

### Q: What happens if I lose my device?

**A**: Your encryption keys are stored on your device. If you lose it:

- Your sessions will expire
- You'll need to re-pair with other devices
- **Backup your keys regularly** to prevent data loss

### Q: Can I use P2P without internet?

**A**: You need network connectivity (Wi-Fi or mobile data) to discover and connect to devices. Once connected, some operations work offline with message queuing.

### Q: How many devices can I connect to?

**A**: There's no hard limit, but performance may degrade with many simultaneous connections. Recommended: < 10 active connections.

### Q: Are messages stored on servers?

**A**: No. P2P messages are sent directly between devices. There are no central servers storing your messages.

### Q: What is the message size limit?

**A**: Maximum message size is 10MB. Large files should be split or compressed.

### Q: How long do sessions last?

**A**: Sessions remain active as long as both devices are connected. Sessions can be restored after app restarts if saved.

### Q: Can I delete a session?

**A**: Yes. Open device details → Tap "Disconnect" → Confirm. This deletes the session and all associated data.

---

## Privacy & Security

### Data We Store

**On Your Device**:

- DID identifier and documents
- Encryption keys (in Android Keystore)
- Session data
- Message queue

**Not Stored Anywhere**:

- Message content (encrypted only temporarily)
- Your conversations
- Contact information

### Security Best Practices

1. **✅ Verify Safety Numbers** for important connections
2. **✅ Backup Your Keys** with a strong passphrase
3. **✅ Use Strong Device Lock** (PIN, pattern, or biometric)
4. **✅ Keep App Updated** for latest security patches
5. **✅ Don't Share Your Passphrase** with anyone
6. **✅ Be Cautious** of unverified connections

### Permissions Explained

| Permission    | Why Needed            | Required?     |
| ------------- | --------------------- | ------------- |
| Internet      | P2P communication     | Yes           |
| Network State | Check connectivity    | Yes           |
| Wi-Fi State   | Device discovery      | Yes           |
| Camera        | QR code scanning      | No (Optional) |
| Vibrate       | Notification feedback | No (Optional) |

### Reporting Security Issues

If you discover a security vulnerability:

- **Email**: security@chainlesschain.com
- **GitHub**: https://github.com/chainlesschain/android-app/security
- **Do NOT** post publicly until fixed

---

## Getting Help

### Support Channels

- **In-App**: Settings → Help & Support
- **Email**: support@chainlesschain.com
- **Community**: https://community.chainlesschain.com
- **Documentation**: https://docs.chainlesschain.com

### Before Contacting Support

1. Check this guide's Troubleshooting section
2. Check the FAQ
3. Try restarting the app
4. Check for app updates

### When Reporting Issues

Please include:

- Android version
- Device model
- App version
- Steps to reproduce
- Screenshots (if applicable)

---

## Glossary

**DID**: Decentralized Identifier - Your unique identity
**E2EE**: End-to-End Encryption - Only sender and receiver can read
**P2P**: Peer-to-Peer - Direct device-to-device communication
**Safety Numbers**: 60-digit verification code
**Session**: Encrypted connection between two devices
**X3DH**: Extended Triple Diffie-Hellman - Key exchange protocol
**Double Ratchet**: Encryption protocol for forward secrecy

---

**Document Version**: 1.0.0
**Last Updated**: 2026-01-19
**Feedback**: docs@chainlesschain.com
