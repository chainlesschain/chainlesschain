---
name: file-compressor
display-name: File Compressor
description: 文件压缩解压（ZIP创建/解压、目录压缩、文件列表、大小分析）
version: 1.0.0
category: utility
user-invocable: true
tags: [zip, compress, decompress, archive, extract, file]
capabilities: [file_compress, file_decompress, file_list_archive, file_analyze]
tools:
  - file_compress
  - file_decompress
  - file_list_archive
instructions: |
  Use this skill to compress and decompress files. Supports ZIP format for
  creating archives, extracting files, listing archive contents, and analyzing
  compression ratios. Can compress single files, multiple files, or entire directories.
  Uses adm-zip and archiver libraries.
examples:
  - input: "/file-compressor --compress src/ --output project.zip"
    output: "Compressed directory to project.zip (45 files, 2.3 MB → 890 KB)"
  - input: "/file-compressor --extract archive.zip --to ./output/"
    output: "Extracted 32 files to ./output/"
  - input: "/file-compressor --list archive.zip"
    output: "Archive contents: 32 files, total 5.6 MB compressed"
  - input: "/file-compressor --compress file1.txt file2.txt --output bundle.zip"
    output: "Compressed 2 files to bundle.zip"
  - input: "/file-compressor --info archive.zip"
    output: "ZIP info: 32 entries, 5.6 MB compressed, 12.3 MB original (54% ratio)"
dependencies: []
os: [win32, darwin, linux]
author: ChainlessChain
handler: ./handler.js
---

# File Compressor

文件压缩解压技能，基于 adm-zip + archiver。

## 功能

| 操作 | 命令                                       | 说明           |
| ---- | ------------------------------------------ | -------------- |
| 压缩 | `--compress <path(s)> --output <file.zip>` | 压缩文件或目录 |
| 解压 | `--extract <file.zip> --to <dir>`          | 解压ZIP文件    |
| 列表 | `--list <file.zip>`                        | 列出压缩包内容 |
| 信息 | `--info <file.zip>`                        | 压缩包统计信息 |
