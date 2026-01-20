import Foundation

// MARK: - String Localization Extension

extension String {
    /// 获取本地化字符串
    var localized: String {
        return NSLocalizedString(self, comment: "")
    }

    /// 获取带参数的本地化字符串
    func localized(with arguments: CVarArg...) -> String {
        return String(format: self.localized, arguments: arguments)
    }
}

// MARK: - Localization Keys

/// 本地化字符串键
/// 使用方式: L10n.common.ok.localized
enum L10n {

    // MARK: - Common

    enum Common {
        static let ok = "common.ok"
        static let cancel = "common.cancel"
        static let save = "common.save"
        static let delete = "common.delete"
        static let edit = "common.edit"
        static let done = "common.done"
        static let loading = "common.loading"
        static let error = "common.error"
        static let success = "common.success"
        static let retry = "common.retry"
        static let close = "common.close"
        static let search = "common.search"
        static let settings = "common.settings"
        static let back = "common.back"
        static let next = "common.next"
        static let confirm = "common.confirm"
        static let share = "common.share"
        static let copy = "common.copy"
    }

    // MARK: - Auth

    enum Auth {
        static let title = "auth.title"
        static let subtitle = "auth.subtitle"
        static let enterPin = "auth.enter_pin"
        static let createPin = "auth.create_pin"
        static let confirmPin = "auth.confirm_pin"
        static let pinMismatch = "auth.pin_mismatch"
        static let biometricPrompt = "auth.biometric_prompt"
        static let biometricReason = "auth.biometric_reason"
        static let pinIncorrect = "auth.pin_incorrect"
        static let pinHint = "auth.pin_hint"
    }

    // MARK: - Home

    enum Home {
        static let knowledge = "home.knowledge"
        static let aiChat = "home.ai_chat"
        static let social = "home.social"
        static let settings = "home.settings"
    }

    // MARK: - Knowledge

    enum Knowledge {
        static let title = "knowledge.title"
        static let empty = "knowledge.empty"
        static let add = "knowledge.add"
        static let searchPlaceholder = "knowledge.search_placeholder"
        static let all = "knowledge.all"
        static let favorites = "knowledge.favorites"
        static let recent = "knowledge.recent"
        static let tags = "knowledge.tags"
        static let categories = "knowledge.categories"
        static let newEntry = "knowledge.new_entry"
        static let editEntry = "knowledge.edit_entry"
        static let deleteConfirm = "knowledge.delete_confirm"
        static let titlePlaceholder = "knowledge.title_placeholder"
        static let contentPlaceholder = "knowledge.content_placeholder"
        static let addTag = "knowledge.add_tag"
        static let selectCategory = "knowledge.select_category"
        static let views = "knowledge.views"
        static let created = "knowledge.created"
        static let updated = "knowledge.updated"
        static let loadMore = "knowledge.load_more"
        static let noMore = "knowledge.no_more"
    }

    // MARK: - AI

    enum AI {
        static let title = "ai.title"
        static let newChat = "ai.new_chat"
        static let empty = "ai.empty"
        static let startChat = "ai.start_chat"
        static let selectModel = "ai.select_model"
        static let inputPlaceholder = "ai.input_placeholder"
        static let send = "ai.send"
        static let thinking = "ai.thinking"
        static let copyMessage = "ai.copy_message"
        static let deleteChat = "ai.delete_chat"
        static let deleteConfirm = "ai.delete_confirm"
        static let tokens = "ai.tokens"
        static let messages = "ai.messages"
        static let model = "ai.model"
    }

    // MARK: - P2P

    enum P2P {
        static let title = "p2p.title"
        static let contacts = "p2p.contacts"
        static let groups = "p2p.groups"
        static let newChat = "p2p.new_chat"
        static let newGroup = "p2p.new_group"
        static let addContact = "p2p.add_contact"
        static let scanQR = "p2p.scan_qr"
        static let myQR = "p2p.my_qr"
        static let empty = "p2p.empty"
        static let inputPlaceholder = "p2p.input_placeholder"
        static let send = "p2p.send"
        static let sending = "p2p.sending"
        static let sent = "p2p.sent"
        static let delivered = "p2p.delivered"
        static let read = "p2p.read"
        static let failed = "p2p.failed"
        static let typing = "p2p.typing"
        static let online = "p2p.online"
        static let offline = "p2p.offline"
        static let connecting = "p2p.connecting"
        static let connected = "p2p.connected"
        static let disconnected = "p2p.disconnected"
        static let image = "p2p.image"
        static let file = "p2p.file"
        static let voice = "p2p.voice"
    }

    // MARK: - Group

    enum Group {
        static let title = "group.title"
        static let create = "group.create"
        static let name = "group.name"
        static let members = "group.members"
        static let addMember = "group.add_member"
        static let removeMember = "group.remove_member"
        static let leave = "group.leave"
        static let leaveConfirm = "group.leave_confirm"
        static let mute = "group.mute"
        static let unmute = "group.unmute"
        static let settings = "group.settings"
        static let created = "group.created"
        static let joined = "group.joined"
        static let left = "group.left"
    }

    // MARK: - Settings

    enum Settings {
        static let title = "settings.title"
        static let account = "settings.account"
        static let security = "settings.security"
        static let notifications = "settings.notifications"
        static let appearance = "settings.appearance"
        static let language = "settings.language"
        static let about = "settings.about"
        static let version = "settings.version"
        static let clearData = "settings.clear_data"
        static let clearDataConfirm = "settings.clear_data_confirm"
        static let logout = "settings.logout"
        static let changePin = "settings.change_pin"
        static let currentPin = "settings.current_pin"
        static let newPin = "settings.new_pin"
        static let confirmNewPin = "settings.confirm_new_pin"
        static let pinChanged = "settings.pin_changed"
        static let biometric = "settings.biometric"
        static let enableBiometric = "settings.enable_biometric"
        static let llmSettings = "settings.llm_settings"
        static let provider = "settings.provider"
        static let apiKey = "settings.api_key"
        static let model = "settings.model"
        static let baseUrl = "settings.base_url"
        static let sync = "settings.sync"
        static let manualSync = "settings.manual_sync"
        static let syncing = "settings.syncing"
        static let syncComplete = "settings.sync_complete"
        static let backup = "settings.backup"
        static let export = "settings.export"
        static let importData = "settings.import"
    }

    // MARK: - Notification

    enum Notification {
        static let title = "notification.title"
        static let messages = "notification.messages"
        static let groupMessages = "notification.group_messages"
        static let sound = "notification.sound"
        static let badge = "notification.badge"
        static let preview = "notification.preview"
        static let quietHours = "notification.quiet_hours"
        static let quietStart = "notification.quiet_start"
        static let quietEnd = "notification.quiet_end"
    }

    // MARK: - Error

    enum Error {
        static let network = "error.network"
        static let server = "error.server"
        static let timeout = "error.timeout"
        static let unknown = "error.unknown"
        static let authFailed = "error.auth_failed"
        static let dataLoad = "error.data_load"
        static let dataSave = "error.data_save"
        static let encryption = "error.encryption"
        static let decryption = "error.decryption"
        static let connection = "error.connection"
    }

    // MARK: - Empty

    enum Empty {
        static let knowledge = "empty.knowledge"
        static let chat = "empty.chat"
        static let message = "empty.message"
        static let contact = "empty.contact"
        static let group = "empty.group"
        static let search = "empty.search"
    }
}
