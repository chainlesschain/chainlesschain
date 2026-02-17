---
name: text-transformer
display-name: Text Transformer
description: Text encoding, decoding, and transformation utilities - Base64, URL, HTML, hashing, case conversion, and string manipulation
version: 1.0.0
category: utility
user-invocable: true
tags: [text, encode, decode, base64, url, hash, transform, case, convert]
capabilities:
  [base64, url-encode, html-encode, hash, case-convert, string-transform]
tools:
  - text_encode
  - text_decode
  - text_hash
  - text_transform
  - text_case
instructions: |
  Use this skill when the user needs text encoding/decoding (Base64, URL, HTML entities),
  hashing (MD5, SHA1, SHA256, SHA512), case conversion (upper, lower, title, camelCase,
  snake_case, kebab-case), or string manipulation (reverse, trim, count, slug). All
  operations use Node.js built-in modules (Buffer, crypto, string methods) with zero
  external dependencies. Handle quoted text arguments properly.
examples:
  - input: '/text-transformer --base64-encode "hello world"'
    output: "Base64 encoded: aGVsbG8gd29ybGQ="
  - input: '/text-transformer --url-encode "foo bar&baz=1"'
    output: "URL encoded: foo%20bar%26baz%3D1"
  - input: '/text-transformer --hash "hello" --algo sha256'
    output: "SHA-256: 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
  - input: '/text-transformer --camel "hello world example"'
    output: "camelCase: helloWorldExample"
  - input: '/text-transformer --slug "Hello World! This is a Test"'
    output: "Slug: hello-world-this-is-a-test"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Text Transformer

Text encoding, decoding, and transformation utilities powered by Node.js built-in modules.

## Features

| Operation     | Command                                              | Description                            |
| ------------- | ---------------------------------------------------- | -------------------------------------- |
| Base64 Encode | `--base64-encode "<text>"`                           | Base64 encode text                     |
| Base64 Decode | `--base64-decode "<text>"`                           | Base64 decode text                     |
| URL Encode    | `--url-encode "<text>"`                              | URL encode (encodeURIComponent)        |
| URL Decode    | `--url-decode "<text>"`                              | URL decode (decodeURIComponent)        |
| HTML Encode   | `--html-encode "<text>"`                             | HTML entity encode                     |
| HTML Decode   | `--html-decode "<text>"`                             | HTML entity decode                     |
| Hash          | `--hash "<text>" [--algo md5\|sha1\|sha256\|sha512]` | Hash text (default: sha256)            |
| Uppercase     | `--upper "<text>"`                                   | Convert to UPPERCASE                   |
| Lowercase     | `--lower "<text>"`                                   | Convert to lowercase                   |
| Title Case    | `--title "<text>"`                                   | Convert to Title Case                  |
| camelCase     | `--camel "<text>"`                                   | Convert to camelCase                   |
| snake_case    | `--snake "<text>"`                                   | Convert to snake_case                  |
| kebab-case    | `--kebab "<text>"`                                   | Convert to kebab-case                  |
| Reverse       | `--reverse "<text>"`                                 | Reverse the string                     |
| Count         | `--count "<text>"`                                   | Character, word, and line count        |
| Trim          | `--trim "<text>"`                                    | Trim leading/trailing whitespace       |
| Slug          | `--slug "<text>"`                                    | URL-friendly slug (lowercase, hyphens) |
