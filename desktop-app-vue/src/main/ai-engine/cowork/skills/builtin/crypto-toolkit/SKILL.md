---
name: crypto-toolkit
display-name: Crypto Toolkit
description: Cryptographic utilities - hashing, HMAC, AES-256-GCM encryption/decryption, encoding/decoding, UUID generation, and secure random bytes
version: 1.0.0
category: security
user-invocable: true
tags: [crypto, hash, encrypt, decrypt, encode, decode, hmac, uuid]
capabilities:
  [hash, hmac, encrypt, decrypt, encode, decode, uuid, random, compare]
tools:
  - crypto_hash
  - crypto_hmac
  - crypto_encrypt
  - crypto_decrypt
  - crypto_encode
  - crypto_decode
  - crypto_uuid
  - crypto_random
  - crypto_compare
instructions: |
  Use this skill when the user needs cryptographic operations: hashing text or files
  (MD5/SHA1/SHA256/SHA512), HMAC signatures, AES-256-GCM encryption/decryption,
  Base64/Hex/URL encoding/decoding, UUID v4 generation, secure random byte generation,
  or timing-safe hash comparison. All operations use Node.js built-in crypto module.
examples:
  - input: '/crypto-toolkit --hash "hello world"'
    output: "SHA-256: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
  - input: "/crypto-toolkit --hash-file package.json --algo sha512"
    output: "SHA-512 hash of package.json: a1b2c3..."
  - input: '/crypto-toolkit --encrypt "secret data" --key mypassword'
    output: "AES-256-GCM encrypted (base64): iv:authTag:ciphertext"
  - input: '/crypto-toolkit --encode "hello world" --format base64'
    output: "Base64: aGVsbG8gd29ybGQ="
  - input: "/crypto-toolkit --uuid"
    output: "UUID v4: 550e8400-e29b-41d4-a716-446655440000"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Crypto Toolkit

Cryptographic utilities powered by Node.js built-in `crypto` module.

## Features

| Operation | Command                                            | Description                  |
| --------- | -------------------------------------------------- | ---------------------------- |
| Hash      | `--hash <text> [--algo md5\|sha1\|sha256\|sha512]` | Hash text (default: sha256)  |
| Hash File | `--hash-file <file> [--algo sha256]`               | Hash file contents           |
| HMAC      | `--hmac <text> --key <secret> [--algo sha256]`     | HMAC signature               |
| Encrypt   | `--encrypt <text> --key <password>`                | AES-256-GCM encrypt (base64) |
| Decrypt   | `--decrypt <encrypted> --key <password>`           | AES-256-GCM decrypt          |
| Encode    | `--encode <text> --format base64\|hex\|url`        | Encode text                  |
| Decode    | `--decode <text> --format base64\|hex\|url`        | Decode text                  |
| UUID      | `--uuid`                                           | Generate UUID v4             |
| Random    | `--random <length>`                                | Generate random bytes (hex)  |
| Compare   | `--compare <hash1> <hash2>`                        | Timing-safe hash comparison  |
