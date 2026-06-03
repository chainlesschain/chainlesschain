//
//  ComputerUseBrowserView.swift
//  ChainlessChain
//
//  Computer Use v0.33.0 - WKWebView wrapper for Computer Use
//  Pattern reference: DAppBrowserView.swift
//

import SwiftUI
import WebKit

// MARK: - ComputerUseBrowserView

/// Browser view wrapping WKWebView for Computer Use operations
struct ComputerUseBrowserView: View {
    @StateObject private var viewModel = ComputerUseViewModel.shared
    @State private var urlText: String = ""
    @State private var canGoBack: Bool = false
    @State private var canGoForward: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            // URL Bar
            HStack(spacing: 8) {
                Image(systemName: viewModel.currentURL.hasPrefix("https://") ? "lock.fill" : "globe")
                    .foregroundColor(viewModel.currentURL.hasPrefix("https://") ? .green : .secondary)
                    .font(.caption)

                TextField("Enter URL or search", text: $urlText, onCommit: {
                    Task { await viewModel.navigateTo(urlText) }
                })
                .textFieldStyle(.roundedBorder)
                .autocapitalization(.none)
                .keyboardType(.URL)
                .font(.subheadline)

                if viewModel.isLoading {
                    ProgressView()
                        .scaleEffect(0.7)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(UIColor.systemBackground))

            // Loading progress
            if viewModel.isLoading {
                ProgressView(value: 0.5)
                    .progressViewStyle(.linear)
            }

            // WebView
            CUWebViewContainer(
                webView: $viewModel.webView,
                currentURL: $viewModel.currentURL,
                pageTitle: $viewModel.pageTitle,
                isLoading: $viewModel.isLoading,
                canGoBack: $canGoBack,
                canGoForward: $canGoForward
            )

            // Navigation bar
            HStack(spacing: 0) {
                Button(action: { viewModel.webView?.goBack() }) {
                    Image(systemName: "chevron.left")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canGoBack)

                Divider()

                Button(action: { viewModel.webView?.goForward() }) {
                    Image(systemName: "chevron.right")
                        .frame(maxWidth: .infinity)
                }
                .disabled(!canGoForward)

                Divider()

                Button(action: { viewModel.webView?.reload() }) {
                    Image(systemName: "arrow.clockwise")
                        .frame(maxWidth: .infinity)
                }

                Divider()

                Button(action: {
                    Task { await viewModel.takeScreenshot() }
                }) {
                    Image(systemName: "camera")
                        .frame(maxWidth: .infinity)
                }

                Divider()

                Button(action: {
                    Task { await viewModel.analyzePage() }
                }) {
                    Image(systemName: "eye")
                        .frame(maxWidth: .infinity)
                }
            }
            .font(.title3)
            .foregroundColor(.blue)
            .frame(height: 44)
            .background(Color(UIColor.secondarySystemBackground))
        }
        .onChange(of: viewModel.currentURL) { newURL in
            urlText = newURL
        }
    }
}

// MARK: - WKWebView Container

/// UIViewRepresentable wrapper for WKWebView
struct CUWebViewContainer: UIViewRepresentable {
    @Binding var webView: WKWebView?
    @Binding var currentURL: String
    @Binding var pageTitle: String
    @Binding var isLoading: Bool
    @Binding var canGoBack: Bool
    @Binding var canGoForward: Bool

    func makeCoordinator() -> CUWebViewCoordinator {
        CUWebViewCoordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptEnabled = true
        config.allowsInlineMediaPlayback = true

        // Add message handler for network interceptor
        config.userContentController.add(
            context.coordinator,
            name: NetworkInterceptor.shared.isActive ? "cuNetworkInterceptor" : "cuMessageHandler"
        )

        let wkWebView = WKWebView(frame: .zero, configuration: config)
        wkWebView.navigationDelegate = context.coordinator
        wkWebView.allowsBackForwardNavigationGestures = true

        // Allow inspection in debug builds
        #if DEBUG
        if #available(iOS 16.4, *) {
            wkWebView.isInspectable = true
        }
        #endif

        DispatchQueue.main.async {
            self.webView = wkWebView
        }

        return wkWebView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Sync state from webView
        DispatchQueue.main.async {
            canGoBack = webView.canGoBack
            canGoForward = webView.canGoForward
        }
    }
}

// MARK: - WebView Coordinator

class CUWebViewCoordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    var parent: CUWebViewContainer

    init(_ parent: CUWebViewContainer) {
        self.parent = parent
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        DispatchQueue.main.async {
            self.parent.isLoading = true
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.async {
            self.parent.isLoading = false
            self.parent.canGoBack = webView.canGoBack
            self.parent.canGoForward = webView.canGoForward
            if let url = webView.url?.absoluteString {
                self.parent.currentURL = url
            }
            if let title = webView.title, !title.isEmpty {
                self.parent.pageTitle = title
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.async {
            self.parent.isLoading = false
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "cuNetworkInterceptor",
           let body = message.body as? String {
            NetworkInterceptor.shared.processLogEntry(body)
        }
    }
}

// MARK: - Preview

struct ComputerUseBrowserView_Previews: PreviewProvider {
    static var previews: some View {
        ComputerUseBrowserView()
    }
}
