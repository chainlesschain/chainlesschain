import SwiftUI

/// 通过 DID 添加好友（与 Android `AddFriendScreen` 对齐）
struct AddFriendView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: FriendsViewModel

    @State private var did = ""
    @State private var name = ""

    private var canSubmit: Bool {
        !did.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("好友 DID")) {
                    TextField("did:key:… 或 did:chainlesschain:…", text: $did)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(true)
                        .font(.system(.body, design: .monospaced))
                }

                Section(header: Text("备注名（可选）")) {
                    TextField("好友昵称", text: $name)
                }

                Section {
                    Button(action: submit) {
                        Text("添加好友")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(!canSubmit)
                }

                Section {
                    Text("好友身份基于去中心化 DID，无需手机号或账号。对方可在「我的二维码」中分享自己的 DID。")
                        .font(.caption)
                        .foregroundColor(.gray)
                }
            }
            .navigationTitle("添加好友")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
            }
        }
    }

    private func submit() {
        if viewModel.addFriend(did: did, name: name) {
            dismiss()
        }
    }
}
