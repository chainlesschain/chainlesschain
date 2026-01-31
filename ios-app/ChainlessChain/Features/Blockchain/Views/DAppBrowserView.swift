import SwiftUI
import WebKit

/// DAppBrowserView - Main DApp browser with WKWebView
/// Phase 2.0: DApp Browser
struct DAppBrowserView: View {
    let initialUrl: String?

    @StateObject private var browserManager = DAppBrowserManager.shared
    @StateObject private var walletConnectManager = WalletConnectManager.shared
    @StateObject private var walletManager = WalletManager.shared
    @State private var webView: WKWebView?
    @State private var urlString = ""
    @State private var pageTitle = ""
    @State private var canGoBack = false
    @State private var canGoForward = false
    @State private var isLoading = false
    @State private var loadingProgress: Double = 0
    @State private var showingMenu = false
    @State private var showingWalletConnectRequest = false
    @State private var currentRequest: WalletConnectRequest?
    @State private var errorMessage: String?

    private var currentWallet: Wallet? {
        walletManager.selectedWallet
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // URL Bar
                urlBarView

                // Progress Bar
                if isLoading {
                    ProgressView(value: loadingProgress)
                        .progressViewStyle(.linear)
                }

                // WebView
                WebViewContainer(
                    webView: $webView,
                    urlString: $urlString,
                    pageTitle: $pageTitle,
                    canGoBack: $canGoBack,
                    canGoForward: $canGoForward,
                    isLoading: $isLoading,
                    loadingProgress: $loadingProgress,
                    onWalletConnectRequest: handleWalletConnectRequest
                )

                // Navigation Bar
                navigationBarView
            }
            .navigationTitle("DApp 浏览器")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { showingMenu = true }) {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showingWalletConnectRequest) {
                if let request = currentRequest {
                    WalletConnectRequestView(request: request)
                }
            }
            .actionSheet(isPresented: $showingMenu) {
                ActionSheet(
                    title: Text("浏览器选项"),
                    buttons: [
                        .default(Text("刷新")) {
                            webView?.reload()
                        },
                        .default(Text("添加到收藏")) {
                            Task { await addToFavorites() }
                        },
                        .default(Text("分享")) {
                            shareCurrentPage()
                        },
                        .default(Text("清除缓存")) {
                            clearCache()
                        },
                        .cancel()
                    ]
                )
            }
            .alert("错误", isPresented: .constant(errorMessage != nil)) {
                Button("确定") { errorMessage = nil }
            } message: {
                if let error = errorMessage {
                    Text(error)
                }
            }
            .task {
                await initialize()
            }
        }
    }

    private var urlBarView: some View {
        HStack(spacing: 8) {
            // Security Icon
            Image(systemName: urlString.hasPrefix("https://") ? "lock.fill" : "lock.open.fill")
                .foregroundColor(urlString.hasPrefix("https://") ? .green : .orange)
                .font(.caption)

            // URL TextField
            TextField("输入网址或搜索", text: $urlString, onCommit: {
                loadUrl(urlString)
            })
            .textFieldStyle(.roundedBorder)
            .autocapitalization(.none)
            .keyboardType(.URL)

            // Refresh/Stop Button
            Button(action: {
                if isLoading {
                    webView?.stopLoading()
                } else {
                    webView?.reload()
                }
            }) {
                Image(systemName: isLoading ? "xmark" : "arrow.clockwise")
                    .foregroundColor(.blue)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(UIColor.systemBackground))
    }

    private var navigationBarView: some View {
        HStack(spacing: 0) {
            // Back
            Button(action: { webView?.goBack() }) {
                Image(systemName: "chevron.left")
                    .frame(maxWidth: .infinity)
            }
            .disabled(!canGoBack)

            Divider()

            // Forward
            Button(action: { webView?.goForward() }) {
                Image(systemName: "chevron.right")
                    .frame(maxWidth: .infinity)
            }
            .disabled(!canGoForward)

            Divider()

            // Home
            Button(action: {
                urlString = ""
                webView?.load(URLRequest(url: URL(string: "about:blank")!))
            }) {
                Image(systemName: "house")
                    .frame(maxWidth: .infinity)
            }

            Divider()

            // Tabs
            Button(action: {
                // TODO: Implement tabs
            }) {
                Image(systemName: "square.on.square")
                    .frame(maxWidth: .infinity)
            }

            Divider()

            // WalletConnect Sessions
            NavigationLink(destination: WalletConnectSessionsView()) {
                Image(systemName: "link.circle")
                    .frame(maxWidth: .infinity)
            }
        }
        .font(.title3)
        .foregroundColor(.blue)
        .frame(height: 50)
        .background(Color(UIColor.secondarySystemBackground))
    }

    // MARK: - Actions

    @MainActor
    private func initialize() async {
        // Initialize WalletConnect
        if !walletConnectManager.isInitialized {
            do {
                try await walletConnectManager.initialize()
            } catch {
                errorMessage = "WalletConnect 初始化失败: \(error.localizedDescription)"
            }
        }

        // Load initial URL if provided
        if let url = initialUrl {
            urlString = url
            loadUrl(url)
        }
    }

    private func loadUrl(_ urlOrQuery: String) {
        var finalUrl = urlOrQuery

        // Check if it's a URL or search query
        if !urlOrQuery.hasPrefix("http://") && !urlOrQuery.hasPrefix("https://") {
            if urlOrQuery.contains(".") {
                // Looks like a domain, add https://
                finalUrl = "https://\(urlOrQuery)"
            } else {
                // Search query
                let encoded = urlOrQuery.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                finalUrl = "https://www.google.com/search?q=\(encoded)"
            }
        }

        guard let url = URL(string: finalUrl) else {
            errorMessage = "无效的网址"
            return
        }

        webView?.load(URLRequest(url: url))
    }

    @MainActor
    private func addToFavorites() async {
        guard !urlString.isEmpty, !pageTitle.isEmpty else { return }

        let dapp = DApp(
            name: pageTitle,
            url: urlString,
            category: .other,
            isFavorite: true
        )

        do {
            try await browserManager.addDApp(dapp)
        } catch {
            errorMessage = "添加收藏失败: \(error.localizedDescription)"
        }
    }

    private func shareCurrentPage() {
        guard let url = URL(string: urlString) else { return }

        let activityVC = UIActivityViewController(
            activityItems: [url],
            applicationActivities: nil
        )

        if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = windowScene.windows.first,
           let rootVC = window.rootViewController {
            rootVC.present(activityVC, animated: true)
        }
    }

    private func clearCache() {
        let dataStore = WKWebsiteDataStore.default()
        dataStore.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { records in
            dataStore.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: records) {
                webView?.reload()
            }
        }
    }

    private func handleWalletConnectRequest(_ request: WalletConnectRequest) {
        currentRequest = request
        showingWalletConnectRequest = true
    }
}

// MARK: - WebView Container

struct WebViewContainer: UIViewRepresentable {
    @Binding var webView: WKWebView?
    @Binding var urlString: String
    @Binding var pageTitle: String
    @Binding var canGoBack: Bool
    @Binding var canGoForward: Bool
    @Binding var isLoading: Bool
    @Binding var loadingProgress: Double
    let onWalletConnectRequest: (WalletConnectRequest) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptEnabled = true

        // Inject Web3 provider
        let web3Script = createWeb3Script()
        let userScript = WKUserScript(
            source: web3Script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        config.userContentController.addUserScript(userScript)
        config.userContentController.add(context.coordinator, name: "walletConnect")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true

        DispatchQueue.main.async {
            self.webView = webView
        }

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Update bindings from webView
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
        isLoading = webView.isLoading
        loadingProgress = webView.estimatedProgress
        if let url = webView.url?.absoluteString {
            urlString = url
        }
        if let title = webView.title {
            pageTitle = title
        }
    }

    private func createWeb3Script() -> String {
        """
        // Ethereum Provider for DApps
        (function() {
            const ethereum = {
                isMetaMask: false,
                isChainlessChain: true,
                chainId: '0x1',
                selectedAddress: null,

                request: async function(request) {
                    return new Promise((resolve, reject) => {
                        window.webkit.messageHandlers.walletConnect.postMessage({
                            method: request.method,
                            params: request.params
                        });
                    });
                },

                enable: async function() {
                    return this.request({ method: 'eth_requestAccounts', params: [] });
                },

                send: function(method, params) {
                    return this.request({ method, params });
                }
            };

            window.ethereum = ethereum;
            window.web3 = { currentProvider: ethereum };
        })();
        """
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: WebViewContainer

        init(_ parent: WebViewContainer) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.isLoading = false
            parent.canGoBack = webView.canGoBack
            parent.canGoForward = webView.canGoForward

            if let url = webView.url?.absoluteString {
                parent.urlString = url
            }
            if let title = webView.title {
                parent.pageTitle = title
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "walletConnect", let body = message.body as? [String: Any] {
                handleWeb3Request(body)
            }
        }

        private func handleWeb3Request(_ request: [String: Any]) {
            guard let method = request["method"] as? String else { return }

            // Create WalletConnect request
            // TODO: Parse params and create proper request
            print("Web3 request: \(method)")
        }
    }
}

struct DAppBrowserView_Previews: PreviewProvider {
    static var previews: some View {
        DAppBrowserView(initialUrl: "https://uniswap.org")
    }
}
