# Token Incentive (Phase 66)

## Overview

Token-based incentive system for rewarding contributions to the decentralized AI ecosystem.

## Features

- Local token accounting (CCT currency)
- Reputation-weighted pricing
- Contribution tracking and quality scoring
- Reward calculation and distribution

## IPC Channels

| Channel                     | Description                     |
| --------------------------- | ------------------------------- |
| `token:get-balance`         | Get token balance               |
| `token:get-transactions`    | Get transaction history         |
| `token:submit-contribution` | Submit a contribution           |
| `token:get-pricing`         | Get reputation-weighted pricing |
| `token:get-rewards-summary` | Get rewards summary             |

## Database Tables

- `token_transactions` — Transaction ledger
- `contributions` — Contribution records

## Version

v3.1.0
