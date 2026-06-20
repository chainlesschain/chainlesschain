import Foundation
import SwiftUI
import CoreCommon
import CoreDID

/// 好友（去中心化联系人）管理 ViewModel。
/// 复用已有的 `P2PContactRepository`（`p2p_contacts` 表），补齐 Android
/// `FriendListScreen` / `AddFriendScreen` / `BlockedUsersScreen` 对应的 UI 层。
@MainActor
class FriendsViewModel: ObservableObject {
    @Published var friends: [P2PContactEntity] = []
    @Published var blocked: [P2PContactEntity] = []
    @Published var searchText = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let repository = P2PContactRepository.shared
    private let messageRepository = P2PMessageRepository.shared
    private let logger = Logger.shared

    var myDID: String { DIDManager.shared.currentDID?.did ?? "" }

    var filteredFriends: [P2PContactEntity] {
        guard !searchText.isEmpty else { return friends }
        return friends.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.did.localizedCaseInsensitiveContains(searchText)
        }
    }

    // MARK: - Loading

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            friends = try repository.getAllContacts(includeBlocked: false)
        } catch {
            logger.error("Failed to load friends", error: error, category: "Social")
            errorMessage = error.localizedDescription
        }
    }

    func loadBlocked() async {
        do {
            blocked = try repository.getAllContacts(includeBlocked: true).filter { $0.isBlocked }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    // MARK: - Add by DID

    /// 通过 DID 添加好友，返回是否成功。
    @discardableResult
    func addFriend(did rawDid: String, name rawName: String) -> Bool {
        let did = rawDid.trimmingCharacters(in: .whitespacesAndNewlines)

        guard did.hasPrefix("did:") else {
            errorMessage = "请输入有效的 DID（以 did: 开头）"
            return false
        }
        guard did != myDID else {
            errorMessage = "不能添加自己为好友"
            return false
        }

        do {
            if let existing = try repository.getContactByDid(did: did) {
                errorMessage = "「\(existing.displayName)」已在你的好友列表中"
                return false
            }
            let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
            let display = name.isEmpty ? (String(did.prefix(16)) + "…") : name
            let contact = P2PContactEntity(did: did, name: display)
            try repository.addContact(contact)
            friends.insert(contact, at: 0)
            logger.info("Added friend by DID", category: "Social")
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    // MARK: - Mutations

    func setVerified(_ contact: P2PContactEntity, verified: Bool) {
        do {
            try repository.setVerified(id: contact.id, verified: verified)
            if let idx = friends.firstIndex(where: { $0.id == contact.id }) {
                friends[idx].isVerified = verified
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setBlocked(_ contact: P2PContactEntity, blocked: Bool) async {
        do {
            try repository.setBlocked(id: contact.id, blocked: blocked)
            await load()
            await loadBlocked()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func deleteFriend(_ contact: P2PContactEntity) {
        do {
            try repository.deleteContact(id: contact.id)
            friends.removeAll { $0.id == contact.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func rename(_ contact: P2PContactEntity, to newName: String) {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            try repository.updateContactName(id: contact.id, name: name)
            if let idx = friends.firstIndex(where: { $0.id == contact.id }) {
                friends[idx].name = name
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// 创建/获取与该好友的会话（之后会出现在「消息」列表），返回是否成功。
    @discardableResult
    func startChat(with contact: P2PContactEntity) -> Bool {
        do {
            _ = try messageRepository.getOrCreateConversation(with: contact.did, myDid: myDID)
            return true
        } catch {
            logger.error("Failed to start chat from friend detail", error: error, category: "Social")
            errorMessage = error.localizedDescription
            return false
        }
    }
}
