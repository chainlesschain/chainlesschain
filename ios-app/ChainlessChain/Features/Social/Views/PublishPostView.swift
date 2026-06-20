import SwiftUI

/// 发布动态（与 Android `PublishPostScreen` 对齐）
struct PublishPostView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var content = ""
    @State private var visibility: PostVisibility = .publicAll

    /// (内容, 可见性)
    let onPublish: (String, PostVisibility) -> Void

    private var canPublish: Bool {
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 16) {
                ZStack(alignment: .topLeading) {
                    TextEditor(text: $content)
                        .frame(minHeight: 160)

                    if content.isEmpty {
                        Text("分享你的想法…")
                            .foregroundColor(.gray)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }

                Picker("可见性", selection: $visibility) {
                    ForEach(PostVisibility.allCases) { vis in
                        Text(vis.displayName).tag(vis)
                    }
                }
                .pickerStyle(.segmented)

                HStack(spacing: 6) {
                    Image(systemName: visibility.systemImage)
                    Text(visibilityHint)
                }
                .font(.caption)
                .foregroundColor(.gray)

                Spacer()
            }
            .padding()
            .navigationTitle("发布动态")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("发布") {
                        onPublish(content, visibility)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                    .disabled(!canPublish)
                }
            }
        }
    }

    private var visibilityHint: String {
        switch visibility {
        case .publicAll: return "所有人都能看到这条动态"
        case .friends: return "只有你的好友能看到"
        case .privateOnly: return "只有你自己能看到"
        }
    }
}
