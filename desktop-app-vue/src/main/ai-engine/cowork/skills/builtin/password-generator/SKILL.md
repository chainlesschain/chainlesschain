---
name: password-generator
display-name: Password Generator
description: Secure password and token generation - random passwords, passphrases, PINs, API tokens, UUIDs, and strength checking
version: 1.0.0
category: security
user-invocable: true
tags: [password, security, token, secret, generate, random, passphrase]
capabilities:
  [
    password-generation,
    passphrase-generation,
    pin-generation,
    token-generation,
    uuid-generation,
    strength-check,
    batch-generation,
  ]
tools:
  - crypto_random
  - password_analyzer
handler: ./handler.js
instructions: |
  Use this skill when the user asks to generate passwords, passphrases, PINs,
  API tokens, UUIDs, or to check password strength. All generation uses
  cryptographically secure randomness via Node.js crypto module. Never log
  or persist generated secrets. Output results directly to the user.
examples:
  - input: "/password-generator --generate --length 24 --count 5"
    output: "5 random passwords of 24 characters with uppercase, lowercase, digits, and symbols"
  - input: "/password-generator --passphrase --words 5 --separator -"
    output: "Memorable passphrase like 'correct-horse-battery-staple-orbit'"
  - input: "/password-generator --token --length 64 --format base64"
    output: "Cryptographically secure 64-byte Base64-encoded API token"
  - input: '/password-generator --check "MyP@ssw0rd!"'
    output: "Strength report: length 11, 4 charsets, 72.4 bits entropy, rating: good"
  - input: "/password-generator --pin --length 8 --count 3"
    output: "3 numeric PINs of 8 digits each"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
---

# Password Generator

## Description

Cryptographically secure password, passphrase, PIN, token, and UUID generation using Node.js `crypto` module. Includes password strength analysis with entropy calculation and crack-time estimation.

## Usage

```
/password-generator [action] [options]
```

## Actions & Options

| Action         | Options                                                                     | Description                              |
| -------------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| `--generate`   | `--length <n>` `--count <n>` `--no-symbols` `--no-numbers` `--no-uppercase` | Random passwords (default: 16 chars)     |
| `--passphrase` | `--words <n>` `--separator <char>` `--count <n>`                            | Memorable passphrases (default: 4 words) |
| `--pin`        | `--length <n>` `--count <n>`                                                | Numeric PINs (default: 6 digits)         |
| `--token`      | `--length <n>` `--format hex\|base64\|urlsafe`                              | API tokens / secrets                     |
| `--uuid`       | `--count <n>`                                                               | UUID v4 generation                       |
| `--check`      | `"<password>"`                                                              | Password strength analysis               |
| `--batch`      | `--type password\|passphrase\|pin\|token` `--count <n>`                     | Batch generation                         |
| _(no input)_   |                                                                             | Generate one strong 16-char password     |

## Strength Rating

| Rating    | Entropy Bits | Estimated Crack Time   |
| --------- | ------------ | ---------------------- |
| Weak      | < 28         | Seconds to minutes     |
| Fair      | 28 - 47      | Hours to days          |
| Good      | 48 - 65      | Months to years        |
| Strong    | 66 - 99      | Centuries              |
| Excellent | >= 100       | Heat death of universe |

## Examples

Generate 3 passwords of 20 characters without symbols:

```
/password-generator --generate --length 20 --count 3 --no-symbols
```

Check password strength:

```
/password-generator --check "Tr0ub4dor&3"
```

Generate a 6-word passphrase:

```
/password-generator --passphrase --words 6
```
