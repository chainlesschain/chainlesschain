---
name: color-picker
display-name: Color Picker
description: Color conversion, palette generation, contrast checking, and design utilities for HEX, RGB, and HSL formats
version: 1.0.0
category: design
user-invocable: true
tags: [color, palette, design, hex, rgb, hsl, contrast, wcag, accessibility]
capabilities:
  [
    color_convert,
    color_palette,
    color_contrast,
    color_lighten,
    color_darken,
    color_mix,
    color_random,
    color_named,
  ]
tools:
  - color_convert
  - color_palette
  - color_contrast
  - color_manipulate
  - color_lookup
instructions: |
  Use this skill for color conversion, palette generation, and accessibility checks.
  Supports HEX (#ff5733), RGB (rgb(255,87,51)), and HSL (hsl(11,100%,60%)) formats.
  Can generate color harmonies (complementary, analogous, triadic, split-complementary,
  tetradic), calculate WCAG contrast ratios, lighten/darken/mix colors, generate random
  palettes, and look up CSS named colors. All operations are pure JavaScript with no
  external dependencies.
examples:
  - input: "/color-picker --convert #ff5733"
    output: "HEX: #ff5733 | RGB: rgb(255, 87, 51) | HSL: hsl(11, 100%, 60%)"
  - input: "/color-picker --palette #3498db --type triadic"
    output: "Generated triadic palette: #3498db, #98db34, #db3498"
  - input: "/color-picker --contrast #ffffff #000000"
    output: "Contrast ratio: 21:1 — WCAG AA: Pass, AAA: Pass"
  - input: "/color-picker --lighten #3498db --amount 30"
    output: "Lightened by 30%: #3498db -> #85c1e9"
  - input: "/color-picker --named coral"
    output: "coral: HEX #ff7f50 | RGB rgb(255, 127, 80) | HSL hsl(16, 100%, 66%)"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# Color Picker

Color conversion, palette generation, and WCAG accessibility utilities.

## Features

| Action   | Command                                     | Description                                      |
| -------- | ------------------------------------------- | ------------------------------------------------ |
| Convert  | `--convert <color>`                         | Convert between HEX, RGB, and HSL formats        |
| Palette  | `--palette <color> [--type <harmony>]`      | Generate color harmonies (default complementary) |
| Contrast | `--contrast <color1> <color2>`              | WCAG contrast ratio with AA/AAA pass/fail        |
| Lighten  | `--lighten <color> [--amount <percent>]`    | Lighten color by percentage (default 20%)        |
| Darken   | `--darken <color> [--amount <percent>]`     | Darken color by percentage (default 20%)         |
| Mix      | `--mix <color1> <color2> [--ratio <0-100>]` | Mix two colors (default 50%)                     |
| Random   | `--random [--count <n>]`                    | Generate random colors (default 1)               |
| Named    | `--named <name>`                            | Look up from 140 CSS named colors                |

## Palette Types

| Type          | Description                       | Colors |
| ------------- | --------------------------------- | ------ |
| complementary | Opposite on color wheel           | 2      |
| analogous     | Adjacent hues (30 degrees apart)  | 3      |
| triadic       | Evenly spaced (120 degrees apart) | 3      |
| split         | Split-complementary               | 3      |
| tetradic      | Four evenly spaced (90 degrees)   | 4      |
