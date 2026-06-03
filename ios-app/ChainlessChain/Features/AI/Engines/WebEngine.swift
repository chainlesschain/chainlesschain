import Foundation
import WebKit

/// Web引擎
///
/// 负责Web爬取、API调用、HTML解析等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/web-engine.js
public class WebEngine: BaseAIEngine {

    public static let shared = WebEngine()

    // HTTP方法
    public enum HTTPMethod: String {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case delete = "DELETE"
        case patch = "PATCH"
        case head = "HEAD"
        case options = "OPTIONS"
    }

    // 内容类型
    public enum ContentType: String {
        case json = "application/json"
        case formUrlEncoded = "application/x-www-form-urlencoded"
        case formData = "multipart/form-data"
        case xml = "application/xml"
        case text = "text/plain"
        case html = "text/html"
    }

    private init() {
        super.init(
            type: .web,
            name: "Web引擎",
            description: "处理Web爬取、API调用、HTML解析等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "http_request",
                name: "HTTP请求",
                description: "发送各种类型的HTTP请求"
            ),
            AIEngineCapability(
                id: "web_scrape",
                name: "网页爬取",
                description: "提取网页内容和结构化数据"
            ),
            AIEngineCapability(
                id: "html_parse",
                name: "HTML解析",
                description: "解析HTML并提取特定元素"
            ),
            AIEngineCapability(
                id: "api_call",
                name: "API调用",
                description: "调用REST API并处理响应"
            ),
            AIEngineCapability(
                id: "screenshot",
                name: "网页截图",
                description: "捕获网页截图"
            ),
            AIEngineCapability(
                id: "form_submit",
                name: "表单提交",
                description: "自动填写和提交Web表单"
            ),
            AIEngineCapability(
                id: "cookie_manage",
                name: "Cookie管理",
                description: "管理HTTP Cookie"
            ),
            AIEngineCapability(
                id: "proxy_support",
                name: "代理支持",
                description: "通过代理服务器发送请求"
            ),
            AIEngineCapability(
                id: "rate_limit",
                name: "速率限制",
                description: "控制请求频率"
            ),
            AIEngineCapability(
                id: "content_extract",
                name: "内容提取",
                description: "使用AI提取网页关键信息"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 配置URLSession
        Logger.shared.info("Web引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("Web引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "http_request":
            return try await httpRequest(parameters: parameters)

        case "web_scrape":
            return try await scrapeWeb(parameters: parameters)

        case "html_parse":
            return try await parseHTML(parameters: parameters)

        case "api_call":
            return try await callAPI(parameters: parameters)

        case "screenshot":
            return try await takeScreenshot(parameters: parameters)

        case "form_submit":
            return try await submitForm(parameters: parameters)

        case "extract_links":
            return try await extractLinks(parameters: parameters)

        case "extract_content":
            return try await extractContent(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - HTTP请求

    /// 发送HTTP请求
    private func httpRequest(parameters: [String: Any]) async throws -> [String: Any] {
        guard let urlString = parameters["url"] as? String,
              let url = URL(string: urlString) else {
            throw AIEngineError.invalidParameters("无效的URL")
        }

        let method = HTTPMethod(rawValue: parameters["method"] as? String ?? "GET") ?? .get
        let headers = parameters["headers"] as? [String: String] ?? [:]
        let body = parameters["body"]
        let timeout = parameters["timeout"] as? TimeInterval ?? 30.0

        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.timeoutInterval = timeout

        // 设置请求头
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }

        // 设置请求体
        if let bodyData = body {
            if let bodyString = bodyData as? String {
                request.httpBody = bodyString.data(using: .utf8)
            } else if let bodyDict = bodyData as? [String: Any] {
                request.httpBody = try? JSONSerialization.data(withJSONObject: bodyDict)
                if request.value(forHTTPHeaderField: "Content-Type") == nil {
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                }
            }
        }

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw AIEngineError.executionFailed("无效的HTTP响应")
            }

            let responseString = String(data: data, encoding: .utf8) ?? ""

            // 尝试解析JSON响应
            var parsedBody: Any = responseString
            if let json = try? JSONSerialization.jsonObject(with: data, options: []) {
                parsedBody = json
            }

            return [
                "statusCode": httpResponse.statusCode,
                "headers": httpResponse.allHeaderFields as [AnyHashable: Any],
                "body": parsedBody,
                "rawBody": responseString,
                "contentLength": data.count,
                "success": (200...299).contains(httpResponse.statusCode)
            ]

        } catch {
            throw AIEngineError.executionFailed("HTTP请求失败: \(error.localizedDescription)")
        }
    }

    // MARK: - Web爬取

    /// 爬取网页
    private func scrapeWeb(parameters: [String: Any]) async throws -> [String: Any] {
        guard let urlString = parameters["url"] as? String else {
            throw AIEngineError.invalidParameters("缺少url参数")
        }

        // 发送HTTP请求获取HTML
        let httpResult = try await httpRequest(parameters: [
            "url": urlString,
            "method": "GET"
        ])

        guard let html = httpResult["rawBody"] as? String else {
            throw AIEngineError.executionFailed("无法获取HTML内容")
        }

        // 提取基本信息
        let title = extractTitle(from: html)
        let metaTags = extractMetaTags(from: html)
        let links = extractAllLinks(from: html, baseURL: urlString)
        let images = extractImages(from: html, baseURL: urlString)
        let textContent = extractTextContent(from: html)

        return [
            "url": urlString,
            "title": title,
            "metaTags": metaTags,
            "links": links,
            "images": images,
            "textContent": textContent,
            "htmlLength": html.count,
            "statusCode": httpResult["statusCode"] ?? 0
        ]
    }

    // MARK: - HTML解析

    /// 解析HTML
    private func parseHTML(parameters: [String: Any]) async throws -> [String: Any] {
        var html: String?

        if let htmlString = parameters["html"] as? String {
            html = htmlString
        } else if let urlString = parameters["url"] as? String {
            let httpResult = try await httpRequest(parameters: ["url": urlString])
            html = httpResult["rawBody"] as? String
        }

        guard let htmlContent = html else {
            throw AIEngineError.invalidParameters("缺少html或url参数")
        }

        let selector = parameters["selector"] as? String
        let attribute = parameters["attribute"] as? String

        if let sel = selector {
            // 提取特定选择器的内容
            let elements = extractElements(from: htmlContent, selector: sel, attribute: attribute)
            return [
                "elements": elements,
                "count": elements.count
            ]
        } else {
            // 提取所有基本元素
            return [
                "title": extractTitle(from: htmlContent),
                "headings": extractHeadings(from: htmlContent),
                "paragraphs": extractParagraphs(from: htmlContent),
                "links": extractAllLinks(from: htmlContent, baseURL: nil)
            ]
        }
    }

    // MARK: - API调用

    /// 调用API
    private func callAPI(parameters: [String: Any]) async throws -> [String: Any] {
        guard let urlString = parameters["url"] as? String else {
            throw AIEngineError.invalidParameters("缺少url参数")
        }

        let method = parameters["method"] as? String ?? "GET"
        let headers = parameters["headers"] as? [String: String] ?? [:]
        var requestParams: [String: Any] = [
            "url": urlString,
            "method": method,
            "headers": headers
        ]

        // API认证
        if let apiKey = parameters["apiKey"] as? String {
            var authHeaders = headers
            authHeaders["Authorization"] = "Bearer \(apiKey)"
            requestParams["headers"] = authHeaders
        }

        // 请求体
        if let body = parameters["body"] {
            requestParams["body"] = body
        }

        // 查询参数
        if let queryParams = parameters["queryParams"] as? [String: String] {
            var urlComponents = URLComponents(string: urlString)
            urlComponents?.queryItems = queryParams.map { URLQueryItem(name: $0.key, value: $0.value) }
            if let fullURL = urlComponents?.url?.absoluteString {
                requestParams["url"] = fullURL
            }
        }

        return try await httpRequest(parameters: requestParams)
    }

    // MARK: - 网页截图

    /// 截取网页截图
    private func takeScreenshot(parameters: [String: Any]) async throws -> [String: Any] {
        guard let urlString = parameters["url"] as? String else {
            throw AIEngineError.invalidParameters("缺少url参数")
        }

        // iOS上使用WKWebView截图需要在主线程
        return await MainActor.run {
            let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1024, height: 768))

            // 这里需要异步加载并等待，简化实现返回占位符
            return [
                "url": urlString,
                "status": "pending",
                "message": "网页截图功能需要在主线程异步加载WKWebView"
            ]
        }
    }

    // MARK: - 表单提交

    /// 提交表单
    private func submitForm(parameters: [String: Any]) async throws -> [String: Any] {
        guard let urlString = parameters["url"] as? String,
              let formData = parameters["formData"] as? [String: String] else {
            throw AIEngineError.invalidParameters("缺少url或formData参数")
        }

        let method = parameters["method"] as? String ?? "POST"

        var requestParams: [String: Any] = [
            "url": urlString,
            "method": method
        ]

        // 根据内容类型格式化表单数据
        let contentType = parameters["contentType"] as? String ?? "application/x-www-form-urlencoded"

        if contentType == "application/x-www-form-urlencoded" {
            // URL编码表单
            let formBody = formData.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
                .joined(separator: "&")
            requestParams["body"] = formBody
            requestParams["headers"] = ["Content-Type": contentType]
        } else if contentType == "application/json" {
            // JSON格式
            requestParams["body"] = formData
            requestParams["headers"] = ["Content-Type": contentType]
        }

        return try await httpRequest(parameters: requestParams)
    }

    // MARK: - 链接提取

    /// 提取所有链接
    private func extractLinks(parameters: [String: Any]) async throws -> [String: Any] {
        var html: String?

        if let htmlString = parameters["html"] as? String {
            html = htmlString
        } else if let urlString = parameters["url"] as? String {
            let httpResult = try await httpRequest(parameters: ["url": urlString])
            html = httpResult["rawBody"] as? String
        }

        guard let htmlContent = html else {
            throw AIEngineError.invalidParameters("缺少html或url参数")
        }

        let baseURL = parameters["baseURL"] as? String
        let links = extractAllLinks(from: htmlContent, baseURL: baseURL)

        // 分类链接
        let internalLinks = links.filter { $0.hasPrefix(baseURL ?? "") }
        let externalLinks = links.filter { !$0.hasPrefix(baseURL ?? "") }

        return [
            "links": links,
            "totalCount": links.count,
            "internalLinks": internalLinks,
            "externalLinks": externalLinks
        ]
    }

    // MARK: - 内容提取（AI增强）

    /// 使用AI提取网页关键内容
    private func extractContent(parameters: [String: Any]) async throws -> [String: Any] {
        var html: String?

        if let htmlString = parameters["html"] as? String {
            html = htmlString
        } else if let urlString = parameters["url"] as? String {
            let httpResult = try await httpRequest(parameters: ["url": urlString])
            html = httpResult["rawBody"] as? String
        }

        guard let htmlContent = html else {
            throw AIEngineError.invalidParameters("缺少html或url参数")
        }

        let extractType = parameters["extractType"] as? String ?? "summary" // summary, data, article

        // 提取纯文本
        let textContent = extractTextContent(from: htmlContent)

        // 使用LLM提取结构化内容
        let prompt: String
        switch extractType {
        case "summary":
            prompt = """
            请对以下网页内容进行摘要：

            \(textContent.prefix(3000))

            请提供：
            1. 主要内容摘要（2-3句话）
            2. 关键要点（3-5个要点）
            3. 内容类型（新闻/文章/产品页/教程等）
            """

        case "data":
            prompt = """
            请从以下网页内容中提取结构化数据：

            \(textContent.prefix(3000))

            请以JSON格式返回提取的数据，包括：
            - 标题
            - 作者
            - 日期
            - 价格（如有）
            - 联系信息（如有）
            - 其他关键数据
            """

        case "article":
            prompt = """
            请提取以下网页的文章内容：

            \(textContent.prefix(5000))

            请提供：
            1. 文章标题
            2. 正文内容（去除广告和无关内容）
            3. 作者和发布时间（如有）
            4. 主题标签
            """

        default:
            prompt = "请分析这段网页内容：\(textContent.prefix(2000))"
        }

        let extraction = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个网页内容提取专家，擅长从HTML中提取结构化信息。"
        )

        return [
            "extraction": extraction,
            "extractType": extractType,
            "rawTextLength": textContent.count
        ]
    }

    // MARK: - HTML解析辅助方法

    /// 提取标题
    private func extractTitle(from html: String) -> String {
        if let range = html.range(of: "<title>(.*?)</title>", options: .regularExpression) {
            let titleHTML = String(html[range])
            return titleHTML.replacingOccurrences(of: "<title>", with: "")
                .replacingOccurrences(of: "</title>", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return ""
    }

    /// 提取meta标签
    private func extractMetaTags(from html: String) -> [String: String] {
        var metaTags: [String: String] = [:]

        let pattern = "<meta\\s+([^>]+)>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
            let nsString = html as NSString
            let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))

            for match in matches {
                let metaTag = nsString.substring(with: match.range(at: 1))

                // 提取name和content
                if let nameRange = metaTag.range(of: "name=\"([^\"]+)\"", options: .regularExpression),
                   let contentRange = metaTag.range(of: "content=\"([^\"]+)\"", options: .regularExpression) {
                    let name = String(metaTag[nameRange]).replacingOccurrences(of: "name=\"", with: "").replacingOccurrences(of: "\"", with: "")
                    let content = String(metaTag[contentRange]).replacingOccurrences(of: "content=\"", with: "").replacingOccurrences(of: "\"", with: "")
                    metaTags[name] = content
                }
            }
        }

        return metaTags
    }

    /// 提取所有链接
    private func extractAllLinks(from html: String, baseURL: String?) -> [String] {
        var links: [String] = []

        let pattern = "<a\\s+[^>]*href=\"([^\"]+)\"[^>]*>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
            let nsString = html as NSString
            let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))

            for match in matches {
                if match.numberOfRanges > 1 {
                    let href = nsString.substring(with: match.range(at: 1))

                    // 处理相对URL
                    if href.hasPrefix("http") {
                        links.append(href)
                    } else if let base = baseURL, let baseUrl = URL(string: base) {
                        if let absoluteURL = URL(string: href, relativeTo: baseUrl)?.absoluteString {
                            links.append(absoluteURL)
                        }
                    }
                }
            }
        }

        return Array(Set(links)) // 去重
    }

    /// 提取图片
    private func extractImages(from html: String, baseURL: String?) -> [String] {
        var images: [String] = []

        let pattern = "<img\\s+[^>]*src=\"([^\"]+)\"[^>]*>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
            let nsString = html as NSString
            let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))

            for match in matches {
                if match.numberOfRanges > 1 {
                    let src = nsString.substring(with: match.range(at: 1))

                    if src.hasPrefix("http") {
                        images.append(src)
                    } else if let base = baseURL, let baseUrl = URL(string: base) {
                        if let absoluteURL = URL(string: src, relativeTo: baseUrl)?.absoluteString {
                            images.append(absoluteURL)
                        }
                    }
                }
            }
        }

        return Array(Set(images))
    }

    /// 提取标题层级
    private func extractHeadings(from html: String) -> [String] {
        var headings: [String] = []

        for level in 1...6 {
            let pattern = "<h\(level)[^>]*>(.*?)</h\(level)>"
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) {
                let nsString = html as NSString
                let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))

                for match in matches {
                    if match.numberOfRanges > 1 {
                        let heading = nsString.substring(with: match.range(at: 1))
                        headings.append(stripHTMLTags(heading))
                    }
                }
            }
        }

        return headings
    }

    /// 提取段落
    private func extractParagraphs(from html: String) -> [String] {
        var paragraphs: [String] = []

        let pattern = "<p[^>]*>(.*?)</p>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) {
            let nsString = html as NSString
            let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))

            for match in matches {
                if match.numberOfRanges > 1 {
                    let paragraph = nsString.substring(with: match.range(at: 1))
                    let cleanText = stripHTMLTags(paragraph).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !cleanText.isEmpty {
                        paragraphs.append(cleanText)
                    }
                }
            }
        }

        return paragraphs
    }

    /// 提取纯文本内容
    private func extractTextContent(from html: String) -> String {
        // 移除script和style标签
        var cleanedHTML = html
        let tagsToRemove = ["script", "style", "noscript"]

        for tag in tagsToRemove {
            let pattern = "<\(tag)[^>]*>.*?</\(tag)>"
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) {
                cleanedHTML = regex.stringByReplacingMatches(
                    in: cleanedHTML,
                    options: [],
                    range: NSRange(location: 0, length: cleanedHTML.count),
                    withTemplate: ""
                )
            }
        }

        // 移除所有HTML标签
        let textContent = stripHTMLTags(cleanedHTML)

        // 清理多余的空白
        return textContent
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    /// 提取特定选择器的元素
    private func extractElements(from html: String, selector: String, attribute: String?) -> [String] {
        // 简化实现：只支持基本的标签选择器
        let tagName = selector.trimmingCharacters(in: CharacterSet(charactersIn: ".#[]"))

        let pattern = "<\(tagName)[^>]*>(.*?)</\(tagName)>"
        var elements: [String] = []

        if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]) {
            let nsString = html as NSString
            let matches = regex.matches(in: html, options: [], range: NSRange(location: 0, length: nsString.length))

            for match in matches {
                if match.numberOfRanges > 1 {
                    let element = nsString.substring(with: match.range(at: 1))
                    elements.append(stripHTMLTags(element))
                }
            }
        }

        return elements
    }

    /// 移除HTML标签
    private func stripHTMLTags(_ html: String) -> String {
        var result = html

        // 移除所有HTML标签
        let pattern = "<[^>]+>"
        if let regex = try? NSRegularExpression(pattern: pattern, options: []) {
            result = regex.stringByReplacingMatches(
                in: result,
                options: [],
                range: NSRange(location: 0, length: result.count),
                withTemplate: ""
            )
        }

        // 解码HTML实体
        result = result
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&#39;", with: "'")

        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
