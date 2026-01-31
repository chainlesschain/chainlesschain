import Foundation
import Combine

/// DAppBrowserManager - DApp Discovery and Management
/// Phase 2.0: DApp Browser
/// Handles DApp favorites, history, and discovery

public class DAppBrowserManager: ObservableObject {
    public static let shared = DAppBrowserManager()

    // MARK: - Published Properties

    @Published public var favorites: [DApp] = []
    @Published public var history: [BrowserHistory] = []
    @Published public var featuredDApps: [DApp] = []

    // MARK: - Event Publishers

    public let dappAdded = PassthroughSubject<DApp, Never>()
    public let dappRemoved = PassthroughSubject<String, Never>()
    public let favoriteToggled = PassthroughSubject<DApp, Never>()

    // MARK: - Dependencies

    private let database: Database

    // MARK: - Private Properties

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private init() {
        self.database = Database.shared
    }

    // MARK: - DApp Management

    /// Load all DApps
    @MainActor
    public func loadDApps() async throws {
        try await loadFavorites()
        try await loadHistory()
        loadFeaturedDApps()
    }

    /// Add DApp to collection
    @MainActor
    public func addDApp(_ dapp: DApp) async throws {
        let sql = """
        INSERT OR REPLACE INTO dapps (
            id, name, url, description, icon_url, category,
            chain_ids, is_favorite, last_visited, visit_count, added_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """

        try database.execute(sql,
            dapp.id,
            dapp.name,
            dapp.url,
            dapp.description,
            dapp.iconUrl,
            dapp.category.rawValue,
            dapp.chainIds.map(String.init).joined(separator: ","),
            dapp.isFavorite ? 1 : 0,
            dapp.lastVisited.map { Int64($0.timeIntervalSince1970) },
            dapp.visitCount,
            Int64(dapp.addedAt.timeIntervalSince1970)
        )

        if dapp.isFavorite && !favorites.contains(where: { $0.id == dapp.id }) {
            favorites.append(dapp)
        }

        dappAdded.send(dapp)
    }

    /// Remove DApp
    @MainActor
    public func removeDApp(id: String) async throws {
        let sql = "DELETE FROM dapps WHERE id = ?"
        try database.execute(sql, id)

        favorites.removeAll { $0.id == id }

        dappRemoved.send(id)
    }

    /// Toggle favorite status
    @MainActor
    public func toggleFavorite(dappId: String) async throws {
        let sql = """
        UPDATE dapps
        SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END
        WHERE id = ?
        """

        try database.execute(sql, dappId)

        // Update in-memory list
        if let index = favorites.firstIndex(where: { $0.id == dappId }) {
            var dapp = favorites[index]
            dapp.isFavorite = !dapp.isFavorite
            if dapp.isFavorite {
                favorites[index] = dapp
            } else {
                favorites.remove(at: index)
            }
            favoriteToggled.send(dapp)
        } else {
            // Load from database if not in favorites
            if let dapp = try? await getDApp(id: dappId) {
                var updatedDapp = dapp
                updatedDapp.isFavorite = true
                favorites.append(updatedDapp)
                favoriteToggled.send(updatedDapp)
            }
        }
    }

    /// Get DApp by ID
    @MainActor
    public func getDApp(id: String) async throws -> DApp? {
        let sql = "SELECT * FROM dapps WHERE id = ?"

        let dapps: [DApp] = try database.query(sql, id) { stmt in
            parseDApp(from: stmt)
        }

        return dapps.first
    }

    /// Get DApps by category
    @MainActor
    public func getDAppsByCategory(_ category: DAppCategory) async throws -> [DApp] {
        let sql = """
        SELECT * FROM dapps
        WHERE category = ?
        ORDER BY visit_count DESC, name ASC
        """

        return try database.query(sql, category.rawValue) { stmt in
            parseDApp(from: stmt)
        }
    }

    /// Search DApps
    @MainActor
    public func searchDApps(query: String) async throws -> [DApp] {
        let sql = """
        SELECT * FROM dapps
        WHERE name LIKE ? OR description LIKE ? OR url LIKE ?
        ORDER BY visit_count DESC
        LIMIT 20
        """

        let pattern = "%\(query)%"
        return try database.query(sql, pattern, pattern, pattern) { stmt in
            parseDApp(from: stmt)
        }
    }

    /// Record visit
    @MainActor
    public func recordVisit(dappId: String, url: String, title: String?) async throws {
        // Update DApp visit count and last visited
        let updateSql = """
        UPDATE dapps
        SET visit_count = visit_count + 1, last_visited = ?
        WHERE id = ?
        """

        try database.execute(updateSql, Int64(Date().timeIntervalSince1970), dappId)

        // Add to history
        let historyEntry = BrowserHistory(url: url, title: title)
        try await addToHistory(historyEntry)

        // Update in-memory favorites
        if let index = favorites.firstIndex(where: { $0.id == dappId }) {
            favorites[index].visitCount += 1
            favorites[index].lastVisited = Date()
        }
    }

    // MARK: - History Management

    /// Add to browser history
    @MainActor
    public func addToHistory(_ entry: BrowserHistory) async throws {
        let sql = """
        INSERT INTO browser_history (
            id, url, title, timestamp
        ) VALUES (?, ?, ?, ?)
        """

        try database.execute(sql,
            entry.id,
            entry.url,
            entry.title,
            Int64(entry.timestamp.timeIntervalSince1970)
        )

        history.insert(entry, at: 0)

        // Keep only last 100 entries
        if history.count > 100 {
            history = Array(history.prefix(100))
        }
    }

    /// Clear history
    @MainActor
    public func clearHistory() async throws {
        let sql = "DELETE FROM browser_history"
        try database.execute(sql)

        history.removeAll()
    }

    /// Get recent history
    @MainActor
    public func getRecentHistory(limit: Int = 20) async throws -> [BrowserHistory] {
        let sql = """
        SELECT * FROM browser_history
        ORDER BY timestamp DESC
        LIMIT ?
        """

        return try database.query(sql, limit) { stmt in
            BrowserHistory(
                id: stmt.string(at: 1) ?? "",
                url: stmt.string(at: 2) ?? "",
                title: stmt.string(at: 3),
                timestamp: Date(timeIntervalSince1970: TimeInterval(stmt.int64(at: 4)))
            )
        }
    }

    // MARK: - Private Methods

    @MainActor
    private func loadFavorites() async throws {
        let sql = """
        SELECT * FROM dapps
        WHERE is_favorite = 1
        ORDER BY visit_count DESC, name ASC
        """

        favorites = try database.query(sql) { stmt in
            parseDApp(from: stmt)
        }
    }

    @MainActor
    private func loadHistory() async throws {
        history = try await getRecentHistory(limit: 100)
    }

    private func loadFeaturedDApps() {
        featuredDApps = DApp.featured
    }

    private func parseDApp(from stmt: Statement) -> DApp {
        DApp(
            id: stmt.string(at: 1) ?? "",
            name: stmt.string(at: 2) ?? "",
            url: stmt.string(at: 3) ?? "",
            description: stmt.string(at: 4),
            iconUrl: stmt.string(at: 5),
            category: DAppCategory(rawValue: stmt.string(at: 6) ?? "") ?? .other,
            chainIds: (stmt.string(at: 7) ?? "").split(separator: ",").compactMap { Int($0) },
            isFavorite: stmt.int64(at: 8) == 1,
            lastVisited: stmt.int64(at: 9) > 0 ? Date(timeIntervalSince1970: TimeInterval(stmt.int64(at: 9))) : nil,
            visitCount: Int(stmt.int64(at: 10)),
            addedAt: Date(timeIntervalSince1970: TimeInterval(stmt.int64(at: 11)))
        )
    }
}

// MARK: - DApp Browser Error

public enum DAppBrowserError: LocalizedError {
    case invalidUrl
    case dappNotFound
    case databaseError(String)

    public var errorDescription: String? {
        switch self {
        case .invalidUrl:
            return "Invalid URL"
        case .dappNotFound:
            return "DApp not found"
        case .databaseError(let message):
            return "Database error: \(message)"
        }
    }
}
