#!/usr/bin/env node

// Ensure UTF-8 encoding on Windows to prevent Chinese character garbling (乱码)
import { ensureUtf8 } from "../src/lib/ensure-utf8.js";
ensureUtf8();

import { createProgram } from "../src/index.js";

const program = createProgram();
program.parse(process.argv);
