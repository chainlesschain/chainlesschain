import SwiftUI

/// Group Chat View - Multi-party encrypted P2P messaging
struct GroupChatView: View {
    @StateObject private var viewModel = GroupChatViewModel()
    @Environment(\.colorScheme) var colorScheme
    @Environment(\.dismiss) var dismiss

    // Group info
    let groupId: String?
    let initialTitle: String?
    let initialMembers: [String]?

    // State
    @State private var messageText = ""
    @State private var showingImagePicker = false
    @State private var selectedImages: [UIImage] = []
    @State private var showingGroupSettings = false
    @State private var showingAddMember = false
    @State private var showToast = false
    @State private var toastMessage = ""
    @State private var toastType: ToastView.ToastType = .info

    init(groupId: String? = nil, title: String? = nil, members: [String]? = nil) {
        self.groupId = groupId
        self.initialTitle = title
        self.initialMembers = members
    }

    var body: some View {
        NavigationView {
            ZStack {
                if viewModel.isLoading {
                    loadingView
                } else if viewModel.currentGroup == nil && groupId == nil {
                    createGroupView
                } else {
                    chatView
                }
            }
            .navigationTitle(viewModel.currentGroup?.title ?? initialTitle ?? "新建群组")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("关闭") {
                        dismiss()
                    }
                }

                if viewModel.currentGroup != nil {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        Menu {
                            Button(action: { showingAddMember = true }) {
                                Label("添加成员", systemImage: "person.badge.plus")
                            }

                            Button(action: { showingGroupSettings = true }) {
                                Label("群组设置", systemImage: "gearshape")
                            }

                            Divider()

                            Button(action: { viewModel.muteGroup() }) {
                                Label(viewModel.currentGroup?.isMuted == true ? "取消静音" : "静音",
                                      systemImage: viewModel.currentGroup?.isMuted == true ? "bell" : "bell.slash")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(isPresented: $showingGroupSettings) {
                GroupSettingsView(
                    viewModel: viewModel,
                    onDismiss: { showingGroupSettings = false }
                )
            }
            .sheet(isPresented: $showingAddMember) {
                AddMemberView(
                    viewModel: viewModel,
                    onDismiss: { showingAddMember = false }
                )
            }
            .sheet(isPresented: $showingImagePicker) {
                ImagePickerView(
                    selectedImages: $selectedImages,
                    isPresented: $showingImagePicker,
                    maxSelection: 9
                ) { images in
                    sendImages(images)
                }
            }
            .toast(isPresented: $showToast, message: toastMessage, type: toastType)
        }
        .task {
            if let gid = groupId {
                await viewModel.loadGroup(id: gid)
            } else if let members = initialMembers, let title = initialTitle {
                await viewModel.createGroup(title: title, memberDids: members)
            }
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .scaleEffect(1.5)
            Text("加载中...")
                .foregroundColor(.secondary)
        }
    }

    // MARK: - Create Group View

    private var createGroupView: some View {
        CreateGroupView(viewModel: viewModel)
    }

    // MARK: - Chat View

    private var chatView: some View {
        VStack(spacing: 0) {
            // Member avatars bar
            memberAvatarsBar

            Divider()

            // Messages
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(viewModel.messages) { message in
                            GroupMessageBubble(
                                message: message,
                                colorScheme: colorScheme,
                                memberNames: viewModel.memberNames,
                                myDid: viewModel.myDid
                            )
                            .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _ in
                    if let lastMessage = viewModel.messages.last {
                        withAnimation {
                            proxy.scrollTo(lastMessage.id, anchor: .bottom)
                        }
                    }
                }
            }

            // Input bar
            inputBar
        }
    }

    // MARK: - Member Avatars Bar

    private var memberAvatarsBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(viewModel.currentGroup?.participantDidArray ?? [], id: \.self) { did in
                    VStack(spacing: 4) {
                        Circle()
                            .fill(Color.blue.opacity(0.3))
                            .frame(width: 40, height: 40)
                            .overlay(
                                Text(String(viewModel.memberNames[did]?.prefix(1) ?? did.prefix(1)).uppercased())
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.blue)
                            )
                            .overlay(
                                Circle()
                                    .stroke(viewModel.onlineMembers.contains(did) ? Color.green : Color.clear, lineWidth: 2)
                            )

                        Text(viewModel.memberNames[did] ?? String(did.prefix(8)))
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .frame(width: 50)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        VStack(spacing: 0) {
            // Selected images preview
            if !selectedImages.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(selectedImages.enumerated()), id: \.offset) { index, image in
                            ZStack(alignment: .topTrailing) {
                                Image(uiImage: image)
                                    .resizable()
                                    .scaledToFill()
                                    .frame(width: 60, height: 60)
                                    .clipShape(RoundedRectangle(cornerRadius: 8))

                                Button(action: {
                                    withAnimation {
                                        selectedImages.remove(at: index)
                                    }
                                }) {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundColor(.white)
                                        .background(Color.black.opacity(0.5))
                                        .clipShape(Circle())
                                        .font(.caption)
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)
                }
            }

            HStack(spacing: 12) {
                // Image picker button
                Button(action: { showingImagePicker = true }) {
                    Image(systemName: "photo")
                        .foregroundColor(.blue)
                        .font(.title3)
                }

                // Text input
                TextField("输入消息...", text: $messageText)
                    .textFieldStyle(.roundedBorder)
                    .submitLabel(.send)
                    .onSubmit {
                        sendMessage()
                    }

                // Send button
                Button(action: sendMessage) {
                    Image(systemName: "paperplane.fill")
                        .foregroundColor(.white)
                        .padding(10)
                        .background(messageText.isEmpty && selectedImages.isEmpty ? Color.gray : Color.blue)
                        .clipShape(Circle())
                }
                .disabled(messageText.isEmpty && selectedImages.isEmpty)
            }
            .padding()
            .background(
                colorScheme == .dark
                    ? Color(.systemGray6)
                    : Color(.systemGroupedBackground)
            )
        }
    }

    // MARK: - Actions

    private func sendMessage() {
        guard !messageText.isEmpty else { return }

        Task {
            await viewModel.sendMessage(content: messageText, type: .text)
            messageText = ""
        }
    }

    private func sendImages(_ images: [UIImage]) {
        guard !images.isEmpty else { return }

        showToast(message: "正在发送 \(images.count) 张图片...", type: .info)
        selectedImages = []

        Task {
            await viewModel.sendImageMessages(images: images)
            showToast(message: "图片发送完成", type: .success)
        }
    }

    private func showToast(message: String, type: ToastView.ToastType) {
        toastMessage = message
        toastType = type
        withAnimation {
            showToast = true
        }
    }
}

// MARK: - Group Message Bubble

struct GroupMessageBubble: View {
    let message: P2PViewModel.ChatMessage
    let colorScheme: ColorScheme
    let memberNames: [String: String]
    let myDid: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.isOutgoing {
                Spacer(minLength: 60)
            } else {
                // Sender avatar
                Circle()
                    .fill(Color.blue.opacity(0.3))
                    .frame(width: 32, height: 32)
                    .overlay(
                        Text(senderInitial)
                            .font(.caption2)
                            .fontWeight(.bold)
                            .foregroundColor(.blue)
                    )
            }

            VStack(alignment: message.isOutgoing ? .trailing : .leading, spacing: 2) {
                // Sender name (for incoming messages)
                if !message.isOutgoing {
                    Text(senderName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                // Message content
                if message.isImageMessage {
                    ImageMessageView(
                        message: message,
                        isOutgoing: message.isOutgoing,
                        onTap: nil
                    )
                } else {
                    Text(message.content)
                        .padding(12)
                        .background(bubbleColor)
                        .foregroundColor(textColor)
                        .cornerRadius(16)
                }

                // Timestamp and status
                HStack(spacing: 4) {
                    Text(message.timestamp, style: .time)
                        .font(.caption2)
                        .foregroundColor(.gray)

                    if message.isOutgoing {
                        AnimatedMessageStatus(status: mapStatus(message.status))
                    }
                }
            }

            if !message.isOutgoing {
                Spacer(minLength: 60)
            }
        }
    }

    private var senderName: String {
        memberNames[message.peerId] ?? String(message.peerId.prefix(8))
    }

    private var senderInitial: String {
        String(senderName.prefix(1)).uppercased()
    }

    private var bubbleColor: Color {
        AdaptiveColor.messageBubble(isOutgoing: message.isOutgoing, colorScheme: colorScheme)
    }

    private var textColor: Color {
        AdaptiveColor.textColor(isOutgoing: message.isOutgoing, colorScheme: colorScheme)
    }

    private func mapStatus(_ status: P2PViewModel.ChatMessage.MessageStatus) -> AnimatedMessageStatus.MessageStatusType {
        switch status {
        case .sending: return .sending
        case .sent: return .sent
        case .delivered: return .delivered
        case .read: return .read
        case .failed: return .failed
        default: return .sent
        }
    }
}

// MARK: - Create Group View

struct CreateGroupView: View {
    @ObservedObject var viewModel: GroupChatViewModel
    @State private var groupName = ""
    @State private var selectedMembers: Set<String> = []

    var body: some View {
        Form {
            Section("群组名称") {
                TextField("输入群组名称", text: $groupName)
            }

            Section("选择成员") {
                ForEach(viewModel.availableContacts, id: \.self) { contact in
                    HStack {
                        Circle()
                            .fill(Color.blue.opacity(0.3))
                            .frame(width: 36, height: 36)
                            .overlay(
                                Text(String(contact.prefix(1)).uppercased())
                                    .font(.caption)
                                    .fontWeight(.bold)
                                    .foregroundColor(.blue)
                            )

                        Text(viewModel.memberNames[contact] ?? String(contact.prefix(8)))

                        Spacer()

                        if selectedMembers.contains(contact) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.blue)
                        }
                    }
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if selectedMembers.contains(contact) {
                            selectedMembers.remove(contact)
                        } else {
                            selectedMembers.insert(contact)
                        }
                    }
                }

                if viewModel.availableContacts.isEmpty {
                    Text("没有可用的联系人")
                        .foregroundColor(.secondary)
                }
            }

            Section {
                Button(action: createGroup) {
                    HStack {
                        Spacer()
                        Text("创建群组")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                }
                .disabled(groupName.isEmpty || selectedMembers.isEmpty)
            }
        }
    }

    private func createGroup() {
        Task {
            await viewModel.createGroup(title: groupName, memberDids: Array(selectedMembers))
        }
    }
}

// MARK: - Group Settings View

struct GroupSettingsView: View {
    @ObservedObject var viewModel: GroupChatViewModel
    let onDismiss: () -> Void

    @State private var editedTitle: String = ""
    @State private var showingLeaveConfirm = false

    var body: some View {
        NavigationView {
            Form {
                Section("群组信息") {
                    HStack {
                        Text("群组名称")
                        Spacer()
                        TextField("群组名称", text: $editedTitle)
                            .multilineTextAlignment(.trailing)
                    }

                    HStack {
                        Text("成员数量")
                        Spacer()
                        Text("\(viewModel.currentGroup?.participantDidArray.count ?? 0)")
                            .foregroundColor(.secondary)
                    }

                    HStack {
                        Text("创建时间")
                        Spacer()
                        if let createdAt = viewModel.currentGroup?.createdAt {
                            Text(createdAt, style: .date)
                                .foregroundColor(.secondary)
                        }
                    }
                }

                Section("成员列表") {
                    ForEach(viewModel.currentGroup?.participantDidArray ?? [], id: \.self) { did in
                        HStack {
                            Circle()
                                .fill(Color.blue.opacity(0.3))
                                .frame(width: 32, height: 32)
                                .overlay(
                                    Text(String(viewModel.memberNames[did]?.prefix(1) ?? did.prefix(1)).uppercased())
                                        .font(.caption2)
                                        .fontWeight(.bold)
                                        .foregroundColor(.blue)
                                )

                            Text(viewModel.memberNames[did] ?? String(did.prefix(8)))

                            if did == viewModel.myDid {
                                Text("(我)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }

                            Spacer()

                            if viewModel.onlineMembers.contains(did) {
                                Circle()
                                    .fill(Color.green)
                                    .frame(width: 8, height: 8)
                            }
                        }
                    }
                }

                Section {
                    Button(action: {
                        Task {
                            await viewModel.updateGroupTitle(editedTitle)
                            onDismiss()
                        }
                    }) {
                        Text("保存更改")
                    }
                    .disabled(editedTitle == viewModel.currentGroup?.title)

                    Button(role: .destructive, action: { showingLeaveConfirm = true }) {
                        Text("退出群组")
                    }
                }
            }
            .navigationTitle("群组设置")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("完成") {
                        onDismiss()
                    }
                }
            }
            .onAppear {
                editedTitle = viewModel.currentGroup?.title ?? ""
            }
            .alert("确认退出", isPresented: $showingLeaveConfirm) {
                Button("取消", role: .cancel) {}
                Button("退出", role: .destructive) {
                    Task {
                        await viewModel.leaveGroup()
                        onDismiss()
                    }
                }
            } message: {
                Text("退出后将不再接收此群组的消息")
            }
        }
    }
}

// MARK: - Add Member View

struct AddMemberView: View {
    @ObservedObject var viewModel: GroupChatViewModel
    let onDismiss: () -> Void

    @State private var selectedMembers: Set<String> = []

    private var availableToAdd: [String] {
        let currentMembers = Set(viewModel.currentGroup?.participantDidArray ?? [])
        return viewModel.availableContacts.filter { !currentMembers.contains($0) }
    }

    var body: some View {
        NavigationView {
            List {
                if availableToAdd.isEmpty {
                    Text("没有可添加的联系人")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(availableToAdd, id: \.self) { contact in
                        HStack {
                            Circle()
                                .fill(Color.blue.opacity(0.3))
                                .frame(width: 36, height: 36)
                                .overlay(
                                    Text(String(contact.prefix(1)).uppercased())
                                        .font(.caption)
                                        .fontWeight(.bold)
                                        .foregroundColor(.blue)
                                )

                            Text(viewModel.memberNames[contact] ?? String(contact.prefix(8)))

                            Spacer()

                            if selectedMembers.contains(contact) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.blue)
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture {
                            if selectedMembers.contains(contact) {
                                selectedMembers.remove(contact)
                            } else {
                                selectedMembers.insert(contact)
                            }
                        }
                    }
                }
            }
            .navigationTitle("添加成员")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") {
                        onDismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("添加") {
                        Task {
                            for member in selectedMembers {
                                await viewModel.addMember(did: member)
                            }
                            onDismiss()
                        }
                    }
                    .disabled(selectedMembers.isEmpty)
                }
            }
        }
    }
}

#Preview {
    GroupChatView()
}
