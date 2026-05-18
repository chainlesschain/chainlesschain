import SwiftUI

struct SocialFeedView: View {
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 20) {
                    Image(systemName: "person.3.fill")
                        .resizable()
                        .frame(width: 80, height: 60)
                        .foregroundColor(.gray)

                    Text("社交功能")
                        .font(.title)
                        .fontWeight(.bold)

                    Text("去中心化社交网络")
                        .font(.subheadline)
                        .foregroundColor(.gray)

                    Text("即将推出")
                        .font(.headline)
                        .foregroundColor(.blue)
                        .padding()
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(12)
                }
                .padding()
            }
            .navigationTitle("社交")
        }
    }
}

#Preview {
    SocialFeedView()
}
