import Foundation
import SQLite3

/// 网络和数据库工具集
public enum NetworkDatabaseTools {

    // MARK: - 网络工具 (7个)

    /// HTTP GET请求
    private static let httpGetTool = Tool(
        id: "tool.http.get",
        name: "HTTP GET",
        description: "发送HTTP GET请求",
        category: .web,
        parameters: [
            ToolParameter(name: "url", type: .url, description: "请求URL", required: true),
            ToolParameter(name: "headers", type: .object, description: "请求头", required: false),
            ToolParameter(name: "timeout", type: .number, description: "超时时间(秒)", required: false, defaultValue: "30")
        ],
        returnType: .object,
        returnDescription: "响应数据（statusCode、headers、body）",
        tags: ["http", "get", "network"]
    )

    private static let httpGetExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url"),
              let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        if let headers = input.getObject("headers") as? [String: String] {
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }

        let timeout = input.getDouble("timeout") ?? 30
        request.timeoutInterval = timeout

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                result = .failure(error: "请求失败: \(error.localizedDescription)")
                semaphore.signal()
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                result = .failure(error: "无效的响应")
                semaphore.signal()
                return
            }

            var responseData: [String: Any] = [:]
            responseData["statusCode"] = httpResponse.statusCode
            responseData["headers"] = httpResponse.allHeaderFields

            if let data = data {
                if let jsonObject = try? JSONSerialization.jsonObject(with: data),
                   let json = jsonObject as? [String: Any] {
                    responseData["body"] = json
                } else if let text = String(data: data, encoding: .utf8) {
                    responseData["body"] = text
                } else {
                    responseData["body"] = data.base64EncodedString()
                }
            }

            result = .success(data: responseData)
            semaphore.signal()
        }

        task.resume()
        semaphore.wait()

        return result
    }

    /// HTTP POST请求
    private static let httpPostTool = Tool(
        id: "tool.http.post",
        name: "HTTP POST",
        description: "发送HTTP POST请求",
        category: .web,
        parameters: [
            ToolParameter(name: "url", type: .url, description: "请求URL", required: true),
            ToolParameter(name: "body", type: .object, description: "请求体（JSON对象）", required: false),
            ToolParameter(name: "headers", type: .object, description: "请求头", required: false),
            ToolParameter(name: "timeout", type: .number, description: "超时时间(秒)", required: false, defaultValue: "30")
        ],
        returnType: .object,
        returnDescription: "响应数据",
        tags: ["http", "post", "network"]
    )

    private static let httpPostExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url"),
              let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        if let headers = input.getObject("headers") as? [String: String] {
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }

        if let body = input.getObject("body") {
            do {
                let jsonData = try JSONSerialization.data(withJSONObject: body)
                request.httpBody = jsonData
            } catch {
                return .failure(error: "无法序列化请求体: \(error.localizedDescription)")
            }
        }

        let timeout = input.getDouble("timeout") ?? 30
        request.timeoutInterval = timeout

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                result = .failure(error: "请求失败: \(error.localizedDescription)")
                semaphore.signal()
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                result = .failure(error: "无效的响应")
                semaphore.signal()
                return
            }

            var responseData: [String: Any] = [:]
            responseData["statusCode"] = httpResponse.statusCode
            responseData["headers"] = httpResponse.allHeaderFields

            if let data = data {
                if let jsonObject = try? JSONSerialization.jsonObject(with: data) {
                    responseData["body"] = jsonObject
                } else if let text = String(data: data, encoding: .utf8) {
                    responseData["body"] = text
                }
            }

            result = .success(data: responseData)
            semaphore.signal()
        }

        task.resume()
        semaphore.wait()

        return result
    }

    /// 下载文件
    private static let downloadFileTool = Tool(
        id: "tool.http.download",
        name: "下载文件",
        description: "从URL下载文件",
        category: .web,
        parameters: [
            ToolParameter(name: "url", type: .url, description: "文件URL", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "保存路径", required: true)
        ],
        returnType: .object,
        returnDescription: "下载结果（文件路径、大小等）",
        tags: ["http", "download", "network"]
    )

    private static let downloadFileExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url"),
              let url = URL(string: urlString),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        let task = URLSession.shared.downloadTask(with: url) { tempURL, response, error in
            if let error = error {
                result = .failure(error: "下载失败: \(error.localizedDescription)")
                semaphore.signal()
                return
            }

            guard let tempURL = tempURL else {
                result = .failure(error: "临时文件不存在")
                semaphore.signal()
                return
            }

            do {
                if FileManager.default.fileExists(atPath: outputPath) {
                    try FileManager.default.removeItem(at: outputURL)
                }

                try FileManager.default.moveItem(at: tempURL, to: outputURL)

                let fileSize = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int) ?? 0

                result = .success(data: [
                    "outputPath": outputPath,
                    "fileSize": fileSize,
                    "fileSizeMB": Double(fileSize) / 1024 / 1024
                ])
                semaphore.signal()
            } catch {
                result = .failure(error: "保存文件失败: \(error.localizedDescription)")
                semaphore.signal()
            }
        }

        task.resume()
        semaphore.wait()

        return result
    }

    /// 检查URL可达性
    private static let checkUrlTool = Tool(
        id: "tool.http.check",
        name: "检查URL",
        description: "检查URL是否可访问",
        category: .web,
        parameters: [
            ToolParameter(name: "url", type: .url, description: "要检查的URL", required: true),
            ToolParameter(name: "timeout", type: .number, description: "超时时间(秒)", required: false, defaultValue: "10")
        ],
        returnType: .object,
        returnDescription: "检查结果（是否可达、状态码、响应时间）",
        tags: ["http", "check", "network"]
    )

    private static let checkUrlExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url"),
              let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"

        let timeout = input.getDouble("timeout") ?? 10
        request.timeoutInterval = timeout

        let startTime = Date()
        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        let task = URLSession.shared.dataTask(with: request) { _, response, error in
            let responseTime = Date().timeIntervalSince(startTime)

            if let error = error {
                result = .success(data: [
                    "isReachable": false,
                    "error": error.localizedDescription,
                    "responseTime": responseTime
                ])
                semaphore.signal()
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                result = .success(data: [
                    "isReachable": false,
                    "responseTime": responseTime
                ])
                semaphore.signal()
                return
            }

            result = .success(data: [
                "isReachable": true,
                "statusCode": httpResponse.statusCode,
                "responseTime": responseTime,
                "headers": httpResponse.allHeaderFields
            ])
            semaphore.signal()
        }

        task.resume()
        semaphore.wait()

        return result
    }

    /// Ping测试
    private static let pingTool = Tool(
        id: "tool.network.ping",
        name: "Ping测试",
        description: "测试主机连通性",
        category: .web,
        parameters: [
            ToolParameter(name: "host", type: .string, description: "主机地址", required: true),
            ToolParameter(name: "count", type: .number, description: "ping次数", required: false, defaultValue: "4")
        ],
        returnType: .object,
        returnDescription: "Ping结果",
        tags: ["network", "ping"]
    )

    private static let pingExecutor: ToolExecutor = { input in
        // iOS不支持直接发送ICMP包，需要使用SimplePing等第三方库
        // 这里使用HTTP HEAD请求作为替代
        guard let host = input.getString("host") else {
            return .failure(error: "缺少主机地址")
        }

        let count = input.getInt("count") ?? 4
        var successCount = 0
        var failCount = 0
        var responseTimes: [Double] = []

        for _ in 0..<count {
            let urlString = host.hasPrefix("http") ? host : "http://\(host)"
            guard let url = URL(string: urlString) else {
                failCount += 1
                continue
            }

            var request = URLRequest(url: url)
            request.httpMethod = "HEAD"
            request.timeoutInterval = 5

            let startTime = Date()
            let semaphore = DispatchSemaphore(value: 0)
            var isSuccess = false

            let task = URLSession.shared.dataTask(with: request) { _, response, error in
                let responseTime = Date().timeIntervalSince(startTime) * 1000 // 转换为毫秒

                if error == nil, let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode < 500 {
                    isSuccess = true
                    responseTimes.append(responseTime)
                }

                semaphore.signal()
            }

            task.resume()
            semaphore.wait()

            if isSuccess {
                successCount += 1
            } else {
                failCount += 1
            }
        }

        let avgTime = responseTimes.isEmpty ? 0 : responseTimes.reduce(0, +) / Double(responseTimes.count)
        let minTime = responseTimes.min() ?? 0
        let maxTime = responseTimes.max() ?? 0

        return .success(data: [
            "host": host,
            "sent": count,
            "received": successCount,
            "lost": failCount,
            "lossRate": Double(failCount) / Double(count) * 100,
            "avgTime": avgTime,
            "minTime": minTime,
            "maxTime": maxTime
        ])
    }

    /// DNS查询
    private static let dnsLookupTool = Tool(
        id: "tool.network.dns",
        name: "DNS查询",
        description: "查询域名的DNS记录",
        category: .web,
        parameters: [
            ToolParameter(name: "domain", type: .string, description: "域名", required: true)
        ],
        returnType: .object,
        returnDescription: "DNS记录",
        tags: ["network", "dns"]
    )

    private static let dnsLookupExecutor: ToolExecutor = { input in
        guard let domain = input.getString("domain") else {
            return .failure(error: "缺少域名")
        }

        var addresses: [String] = []

        let host = CFHostCreateWithName(nil, domain as CFString).takeRetainedValue()
        CFHostStartInfoResolution(host, .addresses, nil)

        var success: DarwinBoolean = false
        if let addressesRef = CFHostGetAddressing(host, &success)?.takeUnretainedValue() as? [Data] {
            for addressData in addressesRef {
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                addressData.withUnsafeBytes { (pointer: UnsafeRawBufferPointer) in
                    guard let baseAddress = pointer.baseAddress else { return }
                    let addr = baseAddress.assumingMemoryBound(to: sockaddr.self)

                    getnameinfo(addr, socklen_t(addressData.count), &hostname, socklen_t(hostname.count), nil, 0, NI_NUMERICHOST)
                }

                let address = String(cString: hostname)
                if !address.isEmpty {
                    addresses.append(address)
                }
            }
        }

        return .success(data: [
            "domain": domain,
            "addresses": addresses,
            "count": addresses.count
        ])
    }

    /// 获取公网IP
    private static let publicIpTool = Tool(
        id: "tool.network.publicip",
        name: "获取公网IP",
        description: "获取当前设备的公网IP地址",
        category: .web,
        parameters: [],
        returnType: .object,
        returnDescription: "公网IP信息",
        tags: ["network", "ip"]
    )

    private static let publicIpExecutor: ToolExecutor = { _ in
        guard let url = URL(string: "https://api.ipify.org?format=json") else {
            return .failure(error: "无法创建URL")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        let task = URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                result = .failure(error: "获取失败: \(error.localizedDescription)")
                semaphore.signal()
                return
            }

            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
                  let ip = json["ip"] else {
                result = .failure(error: "解析响应失败")
                semaphore.signal()
                return
            }

            result = .success(data: [
                "ip": ip,
                "timestamp": Date().timeIntervalSince1970
            ])
            semaphore.signal()
        }

        task.resume()
        semaphore.wait()

        return result
    }

    // MARK: - 数据库工具 (8个)

    /// SQLite执行查询
    private static let sqliteQueryTool = Tool(
        id: "tool.sqlite.query",
        name: "SQLite查询",
        description: "执行SQLite查询语句",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true),
            ToolParameter(name: "sql", type: .string, description: "SQL查询语句", required: true)
        ],
        returnType: .array,
        returnDescription: "查询结果",
        tags: ["database", "sqlite", "query"]
    )

    private static let sqliteQueryExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath"),
              let sql = input.getString("sql") else {
            return .failure(error: "缺少必要参数")
        }

        var db: OpaquePointer?
        var results: [[String: Any]] = []

        if sqlite3_open(dbPath, &db) != SQLITE_OK {
            return .failure(error: "无法打开数据库")
        }

        defer {
            sqlite3_close(db)
        }

        var statement: OpaquePointer?

        if sqlite3_prepare_v2(db, sql, -1, &statement, nil) != SQLITE_OK {
            let error = String(cString: sqlite3_errmsg(db))
            return .failure(error: "SQL错误: \(error)")
        }

        defer {
            sqlite3_finalize(statement)
        }

        let columnCount = sqlite3_column_count(statement)

        while sqlite3_step(statement) == SQLITE_ROW {
            var row: [String: Any] = [:]

            for i in 0..<columnCount {
                let columnName = String(cString: sqlite3_column_name(statement, i))
                let columnType = sqlite3_column_type(statement, i)

                switch columnType {
                case SQLITE_INTEGER:
                    row[columnName] = Int(sqlite3_column_int64(statement, i))
                case SQLITE_FLOAT:
                    row[columnName] = sqlite3_column_double(statement, i)
                case SQLITE_TEXT:
                    row[columnName] = String(cString: sqlite3_column_text(statement, i))
                case SQLITE_NULL:
                    row[columnName] = NSNull()
                default:
                    break
                }
            }

            results.append(row)
        }

        return .success(data: results)
    }

    /// SQLite执行更新
    private static let sqliteExecuteTool = Tool(
        id: "tool.sqlite.execute",
        name: "SQLite执行",
        description: "执行SQLite更新语句（INSERT/UPDATE/DELETE）",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true),
            ToolParameter(name: "sql", type: .string, description: "SQL语句", required: true)
        ],
        returnType: .object,
        returnDescription: "执行结果",
        tags: ["database", "sqlite", "execute"]
    )

    private static let sqliteExecuteExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath"),
              let sql = input.getString("sql") else {
            return .failure(error: "缺少必要参数")
        }

        var db: OpaquePointer?

        if sqlite3_open(dbPath, &db) != SQLITE_OK {
            return .failure(error: "无法打开数据库")
        }

        defer {
            sqlite3_close(db)
        }

        var error: UnsafeMutablePointer<CChar>?

        if sqlite3_exec(db, sql, nil, nil, &error) != SQLITE_OK {
            let errorMessage = error != nil ? String(cString: error!) : "未知错误"
            sqlite3_free(error)
            return .failure(error: "执行失败: \(errorMessage)")
        }

        let changes = sqlite3_changes(db)
        let lastInsertId = sqlite3_last_insert_rowid(db)

        return .success(data: [
            "success": true,
            "affectedRows": Int(changes),
            "lastInsertId": Int(lastInsertId)
        ])
    }

    /// SQLite获取表列表
    private static let sqliteTablesTool = Tool(
        id: "tool.sqlite.tables",
        name: "SQLite表列表",
        description: "获取数据库中的所有表",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true)
        ],
        returnType: .array,
        returnDescription: "表名列表",
        tags: ["database", "sqlite", "tables"]
    )

    private static let sqliteTablesExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath") else {
            return .failure(error: "缺少数据库路径")
        }

        let sql = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"

        var db: OpaquePointer?
        var tables: [String] = []

        if sqlite3_open(dbPath, &db) != SQLITE_OK {
            return .failure(error: "无法打开数据库")
        }

        defer {
            sqlite3_close(db)
        }

        var statement: OpaquePointer?

        if sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK {
            while sqlite3_step(statement) == SQLITE_ROW {
                if let name = sqlite3_column_text(statement, 0) {
                    tables.append(String(cString: name))
                }
            }
        }

        sqlite3_finalize(statement)

        return .success(data: tables)
    }

    /// SQLite获取表结构
    private static let sqliteSchemaTool = Tool(
        id: "tool.sqlite.schema",
        name: "SQLite表结构",
        description: "获取表的结构信息",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true),
            ToolParameter(name: "tableName", type: .string, description: "表名", required: true)
        ],
        returnType: .array,
        returnDescription: "列信息",
        tags: ["database", "sqlite", "schema"]
    )

    private static let sqliteSchemaExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath"),
              let tableName = input.getString("tableName") else {
            return .failure(error: "缺少必要参数")
        }

        let sql = "PRAGMA table_info(\(tableName))"

        var db: OpaquePointer?
        var columns: [[String: Any]] = []

        if sqlite3_open(dbPath, &db) != SQLITE_OK {
            return .failure(error: "无法打开数据库")
        }

        defer {
            sqlite3_close(db)
        }

        var statement: OpaquePointer?

        if sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK {
            while sqlite3_step(statement) == SQLITE_ROW {
                var column: [String: Any] = [:]

                column["cid"] = Int(sqlite3_column_int(statement, 0))
                if let name = sqlite3_column_text(statement, 1) {
                    column["name"] = String(cString: name)
                }
                if let type = sqlite3_column_text(statement, 2) {
                    column["type"] = String(cString: type)
                }
                column["notNull"] = sqlite3_column_int(statement, 3) != 0
                if let defaultValue = sqlite3_column_text(statement, 4) {
                    column["defaultValue"] = String(cString: defaultValue)
                }
                column["primaryKey"] = sqlite3_column_int(statement, 5) != 0

                columns.append(column)
            }
        }

        sqlite3_finalize(statement)

        return .success(data: columns)
    }

    /// SQLite导出数据
    private static let sqliteExportTool = Tool(
        id: "tool.sqlite.export",
        name: "SQLite导出",
        description: "导出表数据为JSON",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true),
            ToolParameter(name: "tableName", type: .string, description: "表名", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "导出结果",
        tags: ["database", "sqlite", "export"]
    )

    private static let sqliteExportExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath"),
              let tableName = input.getString("tableName"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        // 先查询数据
        let queryResult = sqliteQueryExecutor([
            "dbPath": dbPath,
            "sql": "SELECT * FROM \(tableName)"
        ])

        guard case .success(let data) = queryResult,
              let rows = data as? [[String: Any]] else {
            return .failure(error: "查询数据失败")
        }

        // 写入JSON文件
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: rows, options: .prettyPrinted)
            let outputURL = URL(fileURLWithPath: outputPath)
            try jsonData.write(to: outputURL)

            return .success(data: [
                "outputPath": outputPath,
                "rowCount": rows.count,
                "fileSize": jsonData.count
            ])
        } catch {
            return .failure(error: "导出失败: \(error.localizedDescription)")
        }
    }

    /// SQLite导入数据
    private static let sqliteImportTool = Tool(
        id: "tool.sqlite.import",
        name: "SQLite导入",
        description: "从JSON文件导入数据",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true),
            ToolParameter(name: "tableName", type: .string, description: "表名", required: true),
            ToolParameter(name: "jsonPath", type: .string, description: "JSON文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "导入结果",
        tags: ["database", "sqlite", "import"]
    )

    private static let sqliteImportExecutor: ToolExecutor = { input in
        // 简化实现：返回待实现提示
        return .failure(error: "SQLite导入功能需要事务处理，当前版本暂不支持")
    }

    /// SQLite备份
    private static let sqliteBackupTool = Tool(
        id: "tool.sqlite.backup",
        name: "SQLite备份",
        description: "备份SQLite数据库",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "源数据库路径", required: true),
            ToolParameter(name: "backupPath", type: .string, description: "备份文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "备份结果",
        tags: ["database", "sqlite", "backup"]
    )

    private static let sqliteBackupExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath"),
              let backupPath = input.getString("backupPath") else {
            return .failure(error: "缺少必要参数")
        }

        do {
            let sourceURL = URL(fileURLWithPath: dbPath)
            let backupURL = URL(fileURLWithPath: backupPath)

            if FileManager.default.fileExists(atPath: backupPath) {
                try FileManager.default.removeItem(at: backupURL)
            }

            try FileManager.default.copyItem(at: sourceURL, to: backupURL)

            let fileSize = (try? FileManager.default.attributesOfItem(atPath: backupPath)[.size] as? Int) ?? 0

            return .success(data: [
                "backupPath": backupPath,
                "fileSize": fileSize,
                "fileSizeMB": Double(fileSize) / 1024 / 1024,
                "timestamp": Date().timeIntervalSince1970
            ])
        } catch {
            return .failure(error: "备份失败: \(error.localizedDescription)")
        }
    }

    /// SQLite优化
    private static let sqliteOptimizeTool = Tool(
        id: "tool.sqlite.optimize",
        name: "SQLite优化",
        description: "优化SQLite数据库（VACUUM）",
        category: .data,
        parameters: [
            ToolParameter(name: "dbPath", type: .string, description: "数据库文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "优化结果",
        tags: ["database", "sqlite", "optimize"]
    )

    private static let sqliteOptimizeExecutor: ToolExecutor = { input in
        guard let dbPath = input.getString("dbPath") else {
            return .failure(error: "缺少数据库路径")
        }

        let originalSize = (try? FileManager.default.attributesOfItem(atPath: dbPath)[.size] as? Int) ?? 0

        var db: OpaquePointer?

        if sqlite3_open(dbPath, &db) != SQLITE_OK {
            return .failure(error: "无法打开数据库")
        }

        defer {
            sqlite3_close(db)
        }

        var error: UnsafeMutablePointer<CChar>?

        if sqlite3_exec(db, "VACUUM", nil, nil, &error) != SQLITE_OK {
            let errorMessage = error != nil ? String(cString: error!) : "未知错误"
            sqlite3_free(error)
            return .failure(error: "优化失败: \(errorMessage)")
        }

        let optimizedSize = (try? FileManager.default.attributesOfItem(atPath: dbPath)[.size] as? Int) ?? 0
        let savedBytes = originalSize - optimizedSize
        let savedPercentage = originalSize > 0 ? Double(savedBytes) / Double(originalSize) * 100 : 0

        return .success(data: [
            "success": true,
            "originalSize": originalSize,
            "optimizedSize": optimizedSize,
            "savedBytes": savedBytes,
            "savedPercentage": savedPercentage
        ])
    }

    // MARK: - 所有网络和数据库工具

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 网络工具 (7)
            (httpGetTool, httpGetExecutor),
            (httpPostTool, httpPostExecutor),
            (downloadFileTool, downloadFileExecutor),
            (checkUrlTool, checkUrlExecutor),
            (pingTool, pingExecutor),
            (dnsLookupTool, dnsLookupExecutor),
            (publicIpTool, publicIpExecutor),

            // 数据库工具 (8)
            (sqliteQueryTool, sqliteQueryExecutor),
            (sqliteExecuteTool, sqliteExecuteExecutor),
            (sqliteTablesTool, sqliteTablesExecutor),
            (sqliteSchemaT ool, sqliteSchemaExecutor),
            (sqliteExportTool, sqliteExportExecutor),
            (sqliteImportTool, sqliteImportExecutor),
            (sqliteBackupTool, sqliteBackupExecutor),
            (sqliteOptimizeTool, sqliteOptimizeExecutor)
        ]
    }

    public static var totalCount: Int {
        return all.count
    }
}

/// 工具管理器扩展 - 注册网络和数据库工具
extension ToolManager {
    /// 注册所有网络和数据库工具
    public func registerNetworkDatabaseTools() {
        for (tool, executor) in NetworkDatabaseTools.all {
            register(tool, executor: executor)
        }
        Logger.shared.info("已注册 \(NetworkDatabaseTools.totalCount) 个网络和数据库工具")
    }
}
