import Foundation

/// 文件 typed RPC wrapper — Phase 3.4 v0.1。
///
/// **v0.1 范围**：list (browse) + read text。write / delete / 分块上传 留 v0.2。
///
/// **wire 协议**（与桌面 `desktop-app-vue/.../handlers/file-handler.js` 对齐）：
/// - `file.listDirectory` params: `{path, showHidden, recursive, maxDepth}` →
///   `{entries: [{name, path, isDirectory, size, modified}], path}`
/// - `file.readFile` params: `{path, encoding, offset, length?}` →
///   `{content, encoding, size}`
public actor FileCommands {

    private let client: RemoteCommandClient

    public init(client: RemoteCommandClient) {
        self.client = client
    }

    /// 列出目录内容。空 path → 桌面 home dir（`~` 或 `%USERPROFILE%`，由桌面端
    /// file-handler.js 解析）。
    public func list(
        pcPeerId: String,
        path: String = "",
        showHidden: Bool = false,
        mobileDid: String? = nil
    ) async throws -> FileListResponse {
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "file.listDirectory",
            params: [
                "path": path,
                "showHidden": showHidden,
                "recursive": false,
                "maxDepth": 1
            ],
            mobileDid: mobileDid
        )
        switch response {
        case .success(_, let resultJson):
            return try FileListResponse.decode(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }

    /// 读文件（v0.1 仅 utf-8 text）。文件大于阈值时桌面端按 length 截断。
    public func readText(
        pcPeerId: String,
        path: String,
        maxLengthBytes: Int64 = 1_048_576,  // 1 MB
        mobileDid: String? = nil
    ) async throws -> FileReadResponse {
        guard !path.isEmpty else {
            throw RemoteSkillError.invalidArgument("file.readFile path is empty")
        }
        let response = try await client.invoke(
            pcPeerId: pcPeerId,
            method: "file.readFile",
            params: [
                "path": path,
                "encoding": "utf-8",
                "offset": 0,
                "length": maxLengthBytes
            ],
            mobileDid: mobileDid
        )
        switch response {
        case .success(_, let resultJson):
            return try FileReadResponse.decode(resultJson)
        case .failure(let reqId, let msg):
            throw RemoteSkillError.remoteError(reqId: reqId, message: msg)
        }
    }
}
