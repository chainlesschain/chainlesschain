import Foundation

/// 文件浏览 SwiftUI ViewModel — Phase 3.4 (OQ-1: CoreP2P placement)。
///
/// **行为**：
/// - 进入 view onAppear 时 list home dir (`""` → desktop file-handler 解 ~ / %USERPROFILE%)
/// - tap folder → push to breadcrumb，refresh entries
/// - tap text file → invoke file.readFile → 显示 modal sheet
/// - tap binary → 显示 "v0.1 不支持二进制内容" 提示
///
/// **path 处理**（design doc §7.5 trap）：通过 `platform` 参数选 separator
/// （Windows `\\` 或 `/`，*nix `/`）。breadcrumbs 显示 split 后的段。
@MainActor
public final class FileBrowserViewModel: ObservableObject {

    @Published public private(set) var currentPath: String = ""    // 空 = home dir
    @Published public private(set) var resolvedPath: String = ""   // desktop 端返的实际绝对路径
    @Published public private(set) var entries: [FileEntry] = []
    @Published public private(set) var busy: Bool = false
    @Published public private(set) var lastError: String?
    @Published public private(set) var openedTextContent: FileReadResponse?
    @Published public private(set) var openedFilePath: String?

    public let pcPeerId: String
    public let platform: String   // "win32" / "darwin" / "linux"

    private let file: FileCommands
    private let currentDIDProvider: () -> String?

    public init(
        pcPeerId: String,
        platform: String,
        file: FileCommands,
        currentDIDProvider: @escaping () -> String?
    ) {
        self.pcPeerId = pcPeerId
        self.platform = platform
        self.file = file
        self.currentDIDProvider = currentDIDProvider
    }

    /// View onAppear 调一次。idempotent — 已有 entries 时仍 refresh（用户回 view）。
    public func onAppear() async {
        await refresh()
    }

    /// 重新拉当前 path 内容。
    public func refresh() async {
        busy = true
        defer { busy = false }
        do {
            let resp = try await file.list(
                pcPeerId: pcPeerId,
                path: currentPath,
                mobileDid: currentDIDProvider()
            )
            entries = sortEntries(resp.entries)
            resolvedPath = resp.path
            lastError = nil
        } catch {
            lastError = formatError(error)
        }
    }

    /// tap folder 进入子目录。
    public func navigate(to entry: FileEntry) async {
        guard entry.isDirectory else { return }
        currentPath = entry.path
        await refresh()
    }

    /// 直接跳到面包屑某段。`segmentIndex` < 0 → 跳 home。
    public func navigateToSegment(_ segmentIndex: Int) async {
        let segments = breadcrumbSegments()
        if segmentIndex < 0 {
            currentPath = ""
        } else if segmentIndex < segments.count {
            let kept = Array(segments[0...segmentIndex])
            currentPath = PathUtility.join(segments: kept, platform: platform)
        }
        await refresh()
    }

    /// 父目录。
    public func navigateUp() async {
        let parent = PathUtility.parent(of: resolvedPath, platform: platform)
        currentPath = parent
        await refresh()
    }

    /// tap file → 读 text (若 likely text)，否则报 v0.1 不支持。
    public func openFile(_ entry: FileEntry) async {
        guard !entry.isDirectory else { return }
        guard entry.isLikelyTextFile else {
            lastError = "v0.1 仅支持 text 文件预览（\(entry.fileExtension ?? "无后缀") 视为二进制）"
            return
        }
        busy = true
        defer { busy = false }
        do {
            let resp = try await file.readText(
                pcPeerId: pcPeerId,
                path: entry.path,
                mobileDid: currentDIDProvider()
            )
            openedTextContent = resp
            openedFilePath = entry.path
            lastError = nil
        } catch {
            lastError = formatError(error)
        }
    }

    public func closeOpenedFile() {
        openedTextContent = nil
        openedFilePath = nil
    }

    public func clearError() {
        lastError = nil
    }

    /// 当前 resolved path 拆 segments — 给 UI 渲染面包屑。
    public func breadcrumbSegments() -> [String] {
        PathUtility.split(path: resolvedPath, platform: platform)
    }

    // MARK: - Private

    private func sortEntries(_ list: [FileEntry]) -> [FileEntry] {
        // 目录在前，按名 asc；同 type 内按名 asc
        list.sorted { (a, b) in
            if a.isDirectory != b.isDirectory {
                return a.isDirectory && !b.isDirectory
            }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }

    private func formatError(_ error: Error) -> String {
        switch error {
        case RemoteSkillError.remoteError(_, let msg):
            return "桌面端错误：\(msg)"
        case RemoteSkillError.malformedResult(let detail):
            return "响应解析失败：\(detail)"
        case RemoteSkillError.invalidArgument(let detail):
            return "参数错误：\(detail)"
        default:
            return (error as NSError).localizedDescription
        }
    }
}
