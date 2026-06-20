import SwiftUI
import CoreCommon

/// 查看某位好友的动态（复用社交广场的帖子模型）
struct UserPostsView: View {
    let authorDID: String
    let title: String
    @StateObject private var model: UserPostsModel

    init(authorDID: String, title: String) {
        self.authorDID = authorDID
        self.title = title
        _model = StateObject(wrappedValue: UserPostsModel(authorDID: authorDID))
    }

    var body: some View {
        ZStack {
            if model.isLoading && model.posts.isEmpty {
                ProgressView()
            } else if model.posts.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.largeTitle)
                        .foregroundColor(.gray)
                    Text("TA 还没有发布动态")
                        .foregroundColor(.gray)
                }
            } else {
                List {
                    ForEach(model.posts) { post in
                        ZStack {
                            PostRow(post: post, onLike: {})
                            NavigationLink(destination: PostDetailView(post: post)) {
                                EmptyView()
                            }
                            .opacity(0)
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    }
                }
                .listStyle(.plain)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await model.load()
        }
    }
}

@MainActor
final class UserPostsModel: ObservableObject {
    @Published var posts: [SocialPost] = []
    @Published var isLoading = false

    let authorDID: String
    private let repository = SocialRepository.shared

    private var currentDID: String { AppState.shared.currentDID ?? "" }

    init(authorDID: String) {
        self.authorDID = authorDID
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            posts = try repository.getUserPosts(authorDID: authorDID, currentDID: currentDID)
        } catch {
            posts = []
        }
    }
}
