# 非 UTF-8 文本编辑保护

原源码会先以替换解码读取文件，再把整个内容写回 UTF-8。新增 27 项真实临时文件与 IDE proposal 回归，修复前 20 失败/7 通过：12 项非法字节编辑拒绝场景、8 项失真预览场景未获保护；合法 Unicode/BOM/CRLF/U+FFFD 对照保留。修后这 27 项均通过；初步七文件 115/115，最终与 Haiku 集成的 Windows22.22.2 / Linux22.12.0 各 400/400，另证据合同各 9/9，见[合并验证](../haiku-runtime/README.md)。

实际文件内容编辑使用同一次 Buffer 读取的 UTF-8 有效性检查，非法字节返回 CC_EDIT_INVALID_UTF8 并保持目标字节、mtime 与零目标写入；两种 IDE 文本编辑预览保持相同拒绝规则。修改范围为 literal/hash/notebook 的内容编辑，不扩大其它工具权限。原失败报告、测试原件与源码见 [manifest.json](./manifest.json)，源码提交为 fdead28689393bdf6881c9f806927f9f09333194。

Linux 最初缺少匹配的 Rollup native addon，启动错误保留；复用隔离的同版本 Linux Rollup4.62.2/esbuild0.28.1 后进入正常回归，没有修改仓库依赖或放宽测试。没有实际 provider 调用或正式样本。
