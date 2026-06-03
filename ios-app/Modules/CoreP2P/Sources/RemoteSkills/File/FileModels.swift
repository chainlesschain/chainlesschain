import Foundation

/// 文件 / 目录条目 — Phase 3.4。
///
/// 与桌面 `desktop-app-vue/.../handlers/file-handler.js` 字段对齐
/// （`file.listDirectory` 返 entries 数组）。size / modified 桌面端可能缺省。
public struct FileEntry: Codable, Sendable, Equatable, Identifiable {
    public let name: String
    public let path: String        // 完整 path（桌面端返绝对路径）
    public let isDirectory: Bool
    public let size: Int64?        // 字节，目录通常 nil 或 0
    public let modified: Int64?    // epoch ms

    public var id: String { path }

    public init(name: String, path: String, isDirectory: Bool, size: Int64? = nil, modified: Int64? = nil) {
        self.name = name
        self.path = path
        self.isDirectory = isDirectory
        self.size = size
        self.modified = modified
    }

    /// 文件 extension（小写，无 dot）。目录返 nil。
    public var fileExtension: String? {
        guard !isDirectory else { return nil }
        let parts = name.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        return String(parts.last!).lowercased()
    }

    /// v0.1 是否能 read text。常见 text-like extension。
    public var isLikelyTextFile: Bool {
        guard let ext = fileExtension else { return false }
        let textExts: Set<String> = [
            "txt", "md", "json", "xml", "yml", "yaml", "toml", "ini", "cfg",
            "log", "csv", "tsv", "html", "htm", "css", "js", "ts", "tsx", "jsx",
            "swift", "kt", "java", "py", "rb", "rs", "go", "c", "cpp", "h",
            "sh", "bash", "zsh", "ps1", "bat", "sql", "gradle", "properties",
            "gitignore", "dockerignore", "editorconfig",
        ]
        return textExts.contains(ext)
    }
}

/// `file.listDirectory` 响应。
public struct FileListResponse: Sendable, Equatable {
    public let entries: [FileEntry]
    public let path: String        // 实际查询的目录（桌面解 ~ / %USERPROFILE% 后的绝对路径）

    public init(entries: [FileEntry], path: String) {
        self.entries = entries
        self.path = path
    }

    public static func decode(_ json: String) throws -> FileListResponse {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("file.listDirectory: invalid JSON")
        }
        let resolvedPath = (dict["path"] as? String) ?? ""
        let rawEntries = (dict["entries"] as? [[String: Any]]) ?? []
        let entries: [FileEntry] = rawEntries.compactMap { obj in
            guard let name = obj["name"] as? String,
                  let path = obj["path"] as? String else { return nil }
            let isDir = (obj["isDirectory"] as? Bool) ?? false
            let size = (obj["size"] as? Int64) ?? Int64(obj["size"] as? Int ?? 0)
            let modified = (obj["modified"] as? Int64) ?? Int64(obj["modified"] as? Int ?? 0)
            return FileEntry(
                name: name, path: path, isDirectory: isDir,
                size: size > 0 ? size : nil,
                modified: modified > 0 ? modified : nil
            )
        }
        return FileListResponse(entries: entries, path: resolvedPath)
    }
}

/// `file.readFile` 响应。
public struct FileReadResponse: Sendable, Equatable {
    public let content: String     // 按 encoding 解释；utf-8 是原文，base64/hex 是编码后串
    public let encoding: String    // "utf-8" / "base64" / "hex"
    public let size: Int64?        // 文件实际大小

    public init(content: String, encoding: String, size: Int64? = nil) {
        self.content = content
        self.encoding = encoding
        self.size = size
    }

    public static func decode(_ json: String) throws -> FileReadResponse {
        guard let data = json.data(using: .utf8),
              let dict = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteSkillError.malformedResult("file.readFile: invalid JSON")
        }
        let content = (dict["content"] as? String) ?? ""
        let encoding = (dict["encoding"] as? String) ?? "utf-8"
        let size = (dict["size"] as? Int64) ?? Int64(dict["size"] as? Int ?? 0)
        return FileReadResponse(content: content, encoding: encoding, size: size > 0 ? size : nil)
    }
}

/// 跨平台 path 工具 — Phase 3.4 §7.5 trap 修法。
///
/// 桌面 platform 决定 separator："win32" → `\`（容忍 `/`），其它 → `/`。
/// 面包屑显示 / 路径拼接时按平台选 separator。
public enum PathUtility {

    /// 默认 separator by platform（"win32" → "\\"，其它 → "/"）。
    public static func separator(forPlatform platform: String) -> String {
        platform.lowercased() == "win32" ? "\\" : "/"
    }

    /// 拆 path 为段。Windows 容忍 mixed `/` 和 `\\`；Unix 只用 `/`。
    public static func split(path: String, platform: String) -> [String] {
        let isWin = platform.lowercased() == "win32"
        let raw: [String]
        if isWin {
            // Win 容忍 mixed
            raw = path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).map(String.init)
        } else {
            raw = path.split(separator: "/").map(String.init)
        }
        return raw.filter { !$0.isEmpty }
    }

    /// 合并段为 path（含 platform-correct separator）。
    /// Windows segments[0] 为 "C:" 时保留 drive prefix；Unix 加 leading `/`。
    public static func join(segments: [String], platform: String) -> String {
        let sep = separator(forPlatform: platform)
        if platform.lowercased() == "win32" {
            // 第一个段如果是 "C:" / "D:" 等保留为 drive，否则正常拼
            return segments.joined(separator: sep)
        } else {
            return "/" + segments.joined(separator: sep)
        }
    }

    /// 拼一个父 path（去掉最后一段）。空 array 返"" / "/"。
    public static func parent(of path: String, platform: String) -> String {
        var segs = split(path: path, platform: platform)
        if !segs.isEmpty { segs.removeLast() }
        if segs.isEmpty {
            return platform.lowercased() == "win32" ? "" : "/"
        }
        return join(segments: segs, platform: platform)
    }

    /// 子 path（追加一段）。
    public static func child(of parentPath: String, name: String, platform: String) -> String {
        var segs = split(path: parentPath, platform: platform)
        segs.append(name)
        return join(segments: segs, platform: platform)
    }
}
