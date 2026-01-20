import Foundation
import SwiftUI
import CoreCommon

/// Group Chat View Model - Manages group chat state and operations
@MainActor
class GroupChatViewModel: ObservableObject {
    // MARK: - Published Properties

    @Published var currentGroup: P2PConversationEntity?
    @Published var messages: [P2PViewModel.ChatMessage] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var memberNames: [String: String] = [:]
    @Published var onlineMembers: Set<String> = []
    @Published var availableContacts: [String] = []

    // MARK: - Private Properties

    private let p2pManager = P2PManager.shared
    private let messageRepository = P2PMessageRepository.shared
    private let contactRepository = P2PContactRepository.shared
    private let logger = Logger.shared
    private(set) var myDid: String = ""

    // MARK: - Initialization

    init() {
        myDid = UserDefaults.standard.string(forKey: "current_user_id") ?? UUID().uuidString
        loadAvailableContacts()
        setupNotificationObservers()
    }

    // MARK: - Group Management

    /// Load existing group
    func loadGroup(id: String) async {
        isLoading = true
        defer { isLoading = false }

        do {
            currentGroup = try messageRepository.getConversation(id: id)

            if let group = currentGroup {
                await loadMemberNames(dids: group.participantDidArray)
                await loadMessages()
            }
        } catch {
            errorMessage = error.localizedDescription
            logger.debug("[GroupChatViewModel] Error loading group: \(error)")
        }
    }

    /// Create new group
    func createGroup(title: String, memberDids: [String]) async {
        isLoading = true
        defer { isLoading = false }

        do {
            // Include self in members
            var allMembers = memberDids
            if !allMembers.contains(myDid) {
                allMembers.insert(myDid, at: 0)
            }

            currentGroup = try messageRepository.createGroupConversation(
                title: title,
                memberDids: allMembers,
                creatorDid: myDid
            )

            await loadMemberNames(dids: allMembers)

            // Send system message about group creation
            await sendSystemMessage("群组「\(title)」已创建")

            logger.debug("[GroupChatViewModel] Created group: \(currentGroup?.id ?? "unknown")")
        } catch {
            errorMessage = error.localizedDescription
            logger.debug("[GroupChatViewModel] Error creating group: \(error)")
        }
    }

    /// Update group title
    func updateGroupTitle(_ title: String) async {
        guard let groupId = currentGroup?.id else { return }

        do {
            try messageRepository.updateGroupTitle(conversationId: groupId, title: title)
            currentGroup?.title = title

            // Send system message
            await sendSystemMessage("群名已更改为「\(title)」")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Add member to group
    func addMember(did: String) async {
        guard let groupId = currentGroup?.id else { return }

        do {
            try messageRepository.addGroupMember(conversationId: groupId, memberDid: did)

            // Reload group
            await loadGroup(id: groupId)

            // Send system message
            let name = memberNames[did] ?? String(did.prefix(8))
            await sendSystemMessage("\(name) 已加入群组")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Remove member from group
    func removeMember(did: String) async {
        guard let groupId = currentGroup?.id else { return }

        do {
            try messageRepository.removeGroupMember(conversationId: groupId, memberDid: did)

            // Reload group
            await loadGroup(id: groupId)

            // Send system message
            let name = memberNames[did] ?? String(did.prefix(8))
            await sendSystemMessage("\(name) 已被移出群组")
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Leave group
    func leaveGroup() async {
        guard let groupId = currentGroup?.id else { return }

        do {
            try messageRepository.removeGroupMember(conversationId: groupId, memberDid: myDid)

            // Send system message before leaving
            await sendSystemMessage("\(memberNames[myDid] ?? "我") 已退出群组")

            currentGroup = nil
            messages = []
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Mute/unmute group
    func muteGroup() {
        guard let group = currentGroup else { return }

        // Toggle mute status (would need to add this to repository)
        logger.debug("[GroupChatViewModel] Toggle mute for group: \(group.id)")
    }

    // MARK: - Messaging

    /// Send text message
    func sendMessage(content: String, type: MessageManager.Message.MessageType = .text) async {
        guard let group = currentGroup else { return }

        do {
            let messageId = UUID().uuidString
            let timestamp = Date()

            // Create local message
            let message = P2PViewModel.ChatMessage(
                id: messageId,
                peerId: myDid,  // In group chat, peerId is the sender
                content: content,
                type: type,
                timestamp: timestamp,
                isOutgoing: true,
                status: .sending
            )

            messages.append(message)

            // Save to database
            let messageEntity = P2PMessageEntity(
                id: messageId,
                conversationId: group.id,
                senderDid: myDid,
                contentEncrypted: content,
                contentType: type.rawValue,
                status: "sending",
                replyToId: nil,
                metadata: nil,
                createdAt: timestamp,
                updatedAt: timestamp
            )

            try messageRepository.saveMessage(messageEntity)

            // Send to all group members via P2P
            for memberDid in group.participantDidArray where memberDid != myDid {
                do {
                    _ = try await p2pManager.sendMessage(
                        to: memberDid,
                        content: content,
                        type: type,
                        priority: .normal
                    )
                } catch {
                    logger.debug("[GroupChatViewModel] Failed to send to \(memberDid): \(error)")
                }
            }

            // Update message status
            if let index = messages.firstIndex(where: { $0.id == messageId }) {
                messages[index].status = .sent
            }
            try? messageRepository.updateMessageStatus(id: messageId, status: "sent")

        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Send image messages
    func sendImageMessages(images: [UIImage]) async {
        for image in images {
            await sendImageMessage(image: image)
        }
    }

    /// Send single image message
    func sendImageMessage(image: UIImage) async {
        guard let group = currentGroup else { return }

        // Compress image
        guard let imageData = image.jpegData(compressionQuality: 0.7) else { return }
        let base64Content = "data:image/jpeg;base64,\(imageData.base64EncodedString())"

        await sendMessage(content: base64Content, type: .image)
    }

    /// Send system message
    func sendSystemMessage(_ content: String) async {
        guard let group = currentGroup else { return }

        let messageId = UUID().uuidString
        let timestamp = Date()

        // Create local message
        let message = P2PViewModel.ChatMessage(
            id: messageId,
            peerId: "system",
            content: content,
            type: .system,
            timestamp: timestamp,
            isOutgoing: false,
            status: .delivered
        )

        messages.append(message)

        // Save to database
        let messageEntity = P2PMessageEntity(
            id: messageId,
            conversationId: group.id,
            senderDid: "system",
            contentEncrypted: content,
            contentType: "system",
            status: "delivered",
            replyToId: nil,
            metadata: nil,
            createdAt: timestamp,
            updatedAt: timestamp
        )

        try? messageRepository.saveMessage(messageEntity)
    }

    // MARK: - Private Methods

    private func loadMessages() async {
        guard let group = currentGroup else { return }

        do {
            let messageEntities = try messageRepository.getRecentMessages(
                conversationId: group.id,
                limit: 100
            )

            messages = messageEntities.map { entity in
                P2PViewModel.ChatMessage(
                    id: entity.id,
                    peerId: entity.senderDid,
                    content: entity.contentEncrypted,
                    type: MessageManager.Message.MessageType(rawValue: entity.contentType) ?? .text,
                    timestamp: entity.createdAt,
                    isOutgoing: entity.senderDid == myDid,
                    status: mapMessageStatus(entity.status)
                )
            }
        } catch {
            logger.debug("[GroupChatViewModel] Error loading messages: \(error)")
        }
    }

    private func loadMemberNames(dids: [String]) async {
        for did in dids {
            if let contact = try? contactRepository.getContact(did: did) {
                memberNames[did] = contact.displayName ?? contact.nickname ?? String(did.prefix(8))
            } else {
                memberNames[did] = String(did.prefix(8))
            }
        }

        // Add self
        memberNames[myDid] = "我"
    }

    private func loadAvailableContacts() {
        do {
            let contacts = try contactRepository.getAllContacts()
            availableContacts = contacts.map { $0.did }

            for contact in contacts {
                memberNames[contact.did] = contact.displayName ?? contact.nickname ?? String(contact.did.prefix(8))
            }
        } catch {
            logger.debug("[GroupChatViewModel] Error loading contacts: \(error)")
        }
    }

    private func mapMessageStatus(_ status: String) -> P2PViewModel.ChatMessage.MessageStatus {
        switch status {
        case "sending": return .sending
        case "sent": return .sent
        case "delivered": return .delivered
        case "read": return .read
        case "failed": return .failed
        default: return .sent
        }
    }

    // MARK: - Notification Observers

    private func setupNotificationObservers() {
        // Peer connected - update online status
        NotificationCenter.default.addObserver(
            forName: .p2pPeerConnected,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String else { return }

            Task { @MainActor in
                self?.onlineMembers.insert(peerId)
            }
        }

        // Peer disconnected
        NotificationCenter.default.addObserver(
            forName: .p2pPeerDisconnected,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let peerId = notification.userInfo?["peerId"] as? String else { return }

            Task { @MainActor in
                self?.onlineMembers.remove(peerId)
            }
        }

        // Message received
        NotificationCenter.default.addObserver(
            forName: .p2pMessageReceived,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self = self,
                  let peerId = notification.userInfo?["peerId"] as? String,
                  let messageId = notification.userInfo?["messageId"] as? String,
                  let content = notification.userInfo?["content"] as? String,
                  let typeString = notification.userInfo?["type"] as? String,
                  let timestamp = notification.userInfo?["timestamp"] as? Date else {
                return
            }

            Task { @MainActor in
                // Check if this message is for our group
                guard let group = self.currentGroup,
                      group.participantDidArray.contains(peerId) else {
                    return
                }

                let message = P2PViewModel.ChatMessage(
                    id: messageId,
                    peerId: peerId,
                    content: content,
                    type: MessageManager.Message.MessageType(rawValue: typeString) ?? .text,
                    timestamp: timestamp,
                    isOutgoing: false,
                    status: .delivered
                )

                self.messages.append(message)

                // Save to database
                let messageEntity = P2PMessageEntity(
                    id: messageId,
                    conversationId: group.id,
                    senderDid: peerId,
                    contentEncrypted: content,
                    contentType: typeString,
                    status: "delivered",
                    replyToId: nil,
                    metadata: nil,
                    createdAt: timestamp,
                    updatedAt: timestamp
                )

                try? self.messageRepository.saveMessage(messageEntity)
            }
        }
    }

    // MARK: - Cleanup

    func cleanup() {
        currentGroup = nil
        messages = []
        memberNames = [:]
        onlineMembers = []
    }
}
