---
name: zkp-toolkit
display-name: ZKP Toolkit
description: Zero-Knowledge Proof utilities - proof generation, verification, selective disclosure, ZK-Rollup batching, and benchmarking across ZK systems
version: 1.0.0
category: security
user-invocable: true
tags: [zkp, zero-knowledge, privacy, snark, stark, proof, verify, rollup]
capabilities:
  [prove, verify, keygen, age-proof, balance-proof, rollup, benchmark]
tools:
  - zkp_prove
  - zkp_verify
  - zkp_keygen
  - zkp_age_proof
  - zkp_balance_proof
  - zkp_rollup
  - zkp_benchmark
instructions: |
  Use this skill when the user needs zero-knowledge proof operations: generating ZK proofs,
  verifying proofs, creating selective disclosure proofs (age, balance), batching transactions
  into ZK-Rollups, or benchmarking different ZK proof systems (Groth16, PLONK, STARKs,
  Bulletproofs). All operations use simulated ZK circuits via Node.js crypto module.
examples:
  - input: '/zkp-toolkit --prove "I own this DID" --witness "did:cc:abc123"'
    output: "ZK Proof generated: proofId=abc123, size=256 bytes, time=45ms"
  - input: "/zkp-toolkit --verify proof-id-123"
    output: "Proof verified: valid=true, type=zk-snark, time=12ms"
  - input: "/zkp-toolkit --age-proof 1990-01-15 18"
    output: "Age proof: claim='age >= 18' verified=true"
  - input: "/zkp-toolkit --balance-proof 5000 1000"
    output: "Balance proof: claim='balance >= 1000' verified=true"
  - input: "/zkp-toolkit --benchmark"
    output: "Benchmark results: SNARK 45ms prove/12ms verify, STARK 120ms/8ms..."
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# ZKP Toolkit

Zero-Knowledge Proof utilities powered by simulated ZK circuits.

## Features

| Operation     | Command                                       | Description                    |
| ------------- | --------------------------------------------- | ------------------------------ |
| Prove         | `--prove <statement> --witness <secret>`      | Generate ZK-SNARK proof        |
| Verify        | `--verify <proofId>`                          | Verify an existing proof       |
| Key Gen       | `--keygen <scope> [--permissions read,write]` | Generate ZK audit key pair     |
| Age Proof     | `--age-proof <birthDate> <minAge>`            | Prove age >= minimum           |
| Balance Proof | `--balance-proof <balance> <minBalance>`      | Prove balance >= minimum       |
| Rollup        | `--rollup <txCount>`                          | Create ZK-Rollup batch         |
| Benchmark     | `--benchmark`                                 | Compare ZK systems performance |
