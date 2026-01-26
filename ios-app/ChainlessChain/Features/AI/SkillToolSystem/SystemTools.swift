import Foundation
import UIKit

/// 系统工具集 - 设备信息、数据验证、网络检查
public enum SystemTools {

    // MARK: - 设备信息工具 (8个)

    /// 获取设备信息
    private static let deviceInfoTool = Tool(
        id: "tool.device.info",
        name: "设备信息",
        description: "获取当前设备的详细信息",
        category: .system,
        parameters: [],
        returnType: .object,
        returnDescription: "设备信息（型号、系统版本、屏幕等）",
        tags: ["device", "info"]
    )

    private static let deviceInfoExecutor: ToolExecutor = { _ in
        let device = UIDevice.current
        let screen = UIScreen.main

        var info: [String: Any] = [:]
        info["model"] = device.model
        info["systemName"] = device.systemName
        info["systemVersion"] = device.systemVersion
        info["name"] = device.name
        info["screenWidth"] = Int(screen.bounds.width)
        info["screenHeight"] = Int(screen.bounds.height)
        info["screenScale"] = screen.scale
        info["identifierForVendor"] = device.identifierForVendor?.uuidString ?? ""

        return .success(data: info)
    }

    /// 获取系统版本
    private static let systemVersionTool = Tool(
        id: "tool.system.version",
        name: "系统版本",
        description: "获取操作系统版本号",
        category: .system,
        parameters: [],
        returnType: .string,
        returnDescription: "系统版本",
        tags: ["system", "version"]
    )

    private static let systemVersionExecutor: ToolExecutor = { _ in
        return .success(data: UIDevice.current.systemVersion)
    }

    /// 获取应用信息
    private static let appInfoTool = Tool(
        id: "tool.app.info",
        name: "应用信息",
        description: "获取当前应用的信息",
        category: .system,
        parameters: [],
        returnType: .object,
        returnDescription: "应用信息（版本、Bundle ID等）",
        tags: ["app", "info"]
    )

    private static let appInfoExecutor: ToolExecutor = { _ in
        guard let infoDictionary = Bundle.main.infoDictionary else {
            return .failure(error: "无法获取应用信息")
        }

        var info: [String: String] = [:]
        info["bundleId"] = Bundle.main.bundleIdentifier
        info["version"] = infoDictionary["CFBundleShortVersionString"] as? String
        info["build"] = infoDictionary["CFBundleVersion"] as? String
        info["displayName"] = infoDictionary["CFBundleDisplayName"] as? String ?? infoDictionary["CFBundleName"] as? String

        return .success(data: info)
    }

    /// 获取内存使用情况
    private static let memoryUsageTool = Tool(
        id: "tool.system.memory",
        name: "内存使用",
        description: "获取当前应用的内存使用情况",
        category: .system,
        parameters: [],
        returnType: .object,
        returnDescription: "内存使用信息（已用、总量等）",
        tags: ["system", "memory"]
    )

    private static let memoryUsageExecutor: ToolExecutor = { _ in
        var taskInfo = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let kerr: kern_return_t = withUnsafeMutablePointer(to: &taskInfo) {
            $0.withMemoryRebound(to: integer_t.self, capacity: 1) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }

        guard kerr == KERN_SUCCESS else {
            return .failure(error: "无法获取内存信息")
        }

        let usedMemory = taskInfo.resident_size
        let totalMemory = ProcessInfo.processInfo.physicalMemory

        return .success(data: [
            "usedMemory": Int(usedMemory),
            "totalMemory": Int(totalMemory),
            "usedMemoryMB": Int(usedMemory / 1024 / 1024),
            "totalMemoryMB": Int(totalMemory / 1024 / 1024),
            "percentage": Double(usedMemory) / Double(totalMemory) * 100
        ])
    }

    /// 获取磁盘空间
    private static let diskSpaceTool = Tool(
        id: "tool.system.diskspace",
        name: "磁盘空间",
        description: "获取设备磁盘空间信息",
        category: .system,
        parameters: [],
        returnType: .object,
        returnDescription: "磁盘空间信息（可用、总量等）",
        tags: ["system", "disk"]
    )

    private static let diskSpaceExecutor: ToolExecutor = { _ in
        guard let path = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first else {
            return .failure(error: "无法获取路径")
        }

        do {
            let attributes = try FileManager.default.attributesOfFileSystem(forPath: path)

            let totalSpace = attributes[.systemSize] as? Int64 ?? 0
            let freeSpace = attributes[.systemFreeSize] as? Int64 ?? 0
            let usedSpace = totalSpace - freeSpace

            return .success(data: [
                "totalSpace": Int(totalSpace),
                "freeSpace": Int(freeSpace),
                "usedSpace": Int(usedSpace),
                "totalSpaceGB": Double(totalSpace) / 1024 / 1024 / 1024,
                "freeSpaceGB": Double(freeSpace) / 1024 / 1024 / 1024,
                "usedSpaceGB": Double(usedSpace) / 1024 / 1024 / 1024,
                "percentage": Double(usedSpace) / Double(totalSpace) * 100
            ])
        } catch {
            return .failure(error: "获取磁盘空间失败: \(error.localizedDescription)")
        }
    }

    /// 获取电池信息
    private static let batteryInfoTool = Tool(
        id: "tool.device.battery",
        name: "电池信息",
        description: "获取设备电池信息",
        category: .system,
        parameters: [],
        returnType: .object,
        returnDescription: "电池信息（电量、充电状态等）",
        tags: ["device", "battery"]
    )

    private static let batteryInfoExecutor: ToolExecutor = { _ in
        let device = UIDevice.current
        device.isBatteryMonitoringEnabled = true

        let level = device.batteryLevel
        let state = device.batteryState

        var stateString = "unknown"
        switch state {
        case .unplugged:
            stateString = "unplugged"
        case .charging:
            stateString = "charging"
        case .full:
            stateString = "full"
        default:
            stateString = "unknown"
        }

        return .success(data: [
            "level": level >= 0 ? Int(level * 100) : -1,
            "state": stateString,
            "isCharging": state == .charging || state == .full
        ])
    }

    /// 检查网络可达性
    private static let networkReachabilityTool = Tool(
        id: "tool.network.reachability",
        name: "网络状态",
        description: "检查网络连接状态",
        category: .web,
        parameters: [],
        returnType: .object,
        returnDescription: "网络状态信息",
        tags: ["network", "reachability"]
    )

    private static let networkReachabilityExecutor: ToolExecutor = { _ in
        // 简单的网络检查（通过尝试访问一个已知的主机）
        var zeroAddress = sockaddr_in()
        zeroAddress.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        zeroAddress.sin_family = sa_family_t(AF_INET)

        guard let defaultRouteReachability = withUnsafePointer(to: &zeroAddress, {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                SCNetworkReachabilityCreateWithAddress(nil, $0)
            }
        }) else {
            return .failure(error: "无法创建网络检查对象")
        }

        var flags: SCNetworkReachabilityFlags = []
        guard SCNetworkReachabilityGetFlags(defaultRouteReachability, &flags) else {
            return .failure(error: "无法获取网络状态")
        }

        let isReachable = flags.contains(.reachable)
        let needsConnection = flags.contains(.connectionRequired)
        let isConnected = isReachable && !needsConnection

        return .success(data: [
            "isConnected": isConnected,
            "isReachable": isReachable,
            "needsConnection": needsConnection
        ])
    }

    /// 获取设备方向
    private static let deviceOrientationTool = Tool(
        id: "tool.device.orientation",
        name: "设备方向",
        description: "获取设备当前方向",
        category: .system,
        parameters: [],
        returnType: .string,
        returnDescription: "设备方向",
        tags: ["device", "orientation"]
    )

    private static let deviceOrientationExecutor: ToolExecutor = { _ in
        let orientation = UIDevice.current.orientation

        let orientationString: String
        switch orientation {
        case .portrait:
            orientationString = "portrait"
        case .portraitUpsideDown:
            orientationString = "portraitUpsideDown"
        case .landscapeLeft:
            orientationString = "landscapeLeft"
        case .landscapeRight:
            orientationString = "landscapeRight"
        case .faceUp:
            orientationString = "faceUp"
        case .faceDown:
            orientationString = "faceDown"
        default:
            orientationString = "unknown"
        }

        return .success(data: orientationString)
    }

    // MARK: - 数据验证工具 (10个)

    /// 验证邮箱
    private static let validateEmailTool = Tool(
        id: "tool.validate.email",
        name: "验证邮箱",
        description: "验证邮箱地址格式是否正确",
        category: .data,
        parameters: [
            ToolParameter(name: "email", type: .string, description: "邮箱地址", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "email"]
    )

    private static let validateEmailExecutor: ToolExecutor = { input in
        guard let email = input.getString("email") else {
            return .failure(error: "缺少邮箱参数")
        }

        let emailRegex = "[A-Z0-9a-z._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,64}"
        let emailPredicate = NSPredicate(format: "SELF MATCHES %@", emailRegex)
        let isValid = emailPredicate.evaluate(with: email)

        return .success(data: isValid)
    }

    /// 验证手机号
    private static let validatePhoneTool = Tool(
        id: "tool.validate.phone",
        name: "验证手机号",
        description: "验证手机号码格式是否正确",
        category: .data,
        parameters: [
            ToolParameter(name: "phone", type: .string, description: "手机号码", required: true),
            ToolParameter(name: "region", type: .string, description: "地区(cn/us等)", required: false, defaultValue: "cn")
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "phone"]
    )

    private static let validatePhoneExecutor: ToolExecutor = { input in
        guard let phone = input.getString("phone") else {
            return .failure(error: "缺少手机号参数")
        }

        let region = input.getString("region") ?? "cn"

        let regex: String
        switch region.lowercased() {
        case "cn":
            regex = "^1[3-9]\\d{9}$"
        case "us":
            regex = "^\\d{10}$"
        default:
            regex = "^\\d{10,15}$"
        }

        let phonePredicate = NSPredicate(format: "SELF MATCHES %@", regex)
        let isValid = phonePredicate.evaluate(with: phone)

        return .success(data: isValid)
    }

    /// 验证身份证
    private static let validateIdCardTool = Tool(
        id: "tool.validate.idcard",
        name: "验证身份证",
        description: "验证中国身份证号码格式",
        category: .data,
        parameters: [
            ToolParameter(name: "idCard", type: .string, description: "身份证号码", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "idcard"]
    )

    private static let validateIdCardExecutor: ToolExecutor = { input in
        guard let idCard = input.getString("idCard") else {
            return .failure(error: "缺少身份证参数")
        }

        // 18位身份证正则
        let idCardRegex = "^[1-9]\\d{5}(18|19|20)\\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\\d{3}[0-9Xx]$"
        let idCardPredicate = NSPredicate(format: "SELF MATCHES %@", idCardRegex)
        let isValid = idCardPredicate.evaluate(with: idCard)

        return .success(data: isValid)
    }

    /// 验证URL
    private static let validateUrlTool = Tool(
        id: "tool.validate.url",
        name: "验证URL",
        description: "验证URL格式是否正确",
        category: .data,
        parameters: [
            ToolParameter(name: "url", type: .string, description: "URL地址", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "url"]
    )

    private static let validateUrlExecutor: ToolExecutor = { input in
        guard let urlString = input.getString("url") else {
            return .failure(error: "缺少URL参数")
        }

        if let url = URL(string: urlString),
           url.scheme != nil,
           url.host != nil {
            return .success(data: true)
        }

        return .success(data: false)
    }

    /// 验证IP地址
    private static let validateIpTool = Tool(
        id: "tool.validate.ip",
        name: "验证IP地址",
        description: "验证IP地址格式（IPv4或IPv6）",
        category: .data,
        parameters: [
            ToolParameter(name: "ip", type: .string, description: "IP地址", required: true),
            ToolParameter(name: "version", type: .string, description: "IP版本(4/6/auto)", required: false, defaultValue: "auto")
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "ip"]
    )

    private static let validateIpExecutor: ToolExecutor = { input in
        guard let ip = input.getString("ip") else {
            return .failure(error: "缺少IP参数")
        }

        let version = input.getString("version") ?? "auto"

        let ipv4Regex = "^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$"
        let ipv6Regex = "^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2})$"

        let isValidIPv4 = NSPredicate(format: "SELF MATCHES %@", ipv4Regex).evaluate(with: ip)
        let isValidIPv6 = NSPredicate(format: "SELF MATCHES %@", ipv6Regex).evaluate(with: ip)

        let isValid: Bool
        switch version {
        case "4":
            isValid = isValidIPv4
        case "6":
            isValid = isValidIPv6
        default:
            isValid = isValidIPv4 || isValidIPv6
        }

        return .success(data: isValid)
    }

    /// 验证信用卡
    private static let validateCreditCardTool = Tool(
        id: "tool.validate.creditcard",
        name: "验证信用卡",
        description: "验证信用卡号码格式（Luhn算法）",
        category: .data,
        parameters: [
            ToolParameter(name: "cardNumber", type: .string, description: "信用卡号码", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "creditcard"]
    )

    private static let validateCreditCardExecutor: ToolExecutor = { input in
        guard let cardNumber = input.getString("cardNumber") else {
            return .failure(error: "缺少卡号参数")
        }

        let cleanedNumber = cardNumber.replacingOccurrences(of: " ", with: "")

        guard cleanedNumber.allSatisfy({ $0.isNumber }),
              cleanedNumber.count >= 13,
              cleanedNumber.count <= 19 else {
            return .success(data: false)
        }

        // Luhn算法
        var sum = 0
        let reversedDigits = cleanedNumber.reversed().compactMap { Int(String($0)) }

        for (index, digit) in reversedDigits.enumerated() {
            if index % 2 == 1 {
                let doubled = digit * 2
                sum += doubled > 9 ? doubled - 9 : doubled
            } else {
                sum += digit
            }
        }

        return .success(data: sum % 10 == 0)
    }

    /// 验证密码强度
    private static let validatePasswordTool = Tool(
        id: "tool.validate.password",
        name: "验证密码强度",
        description: "评估密码强度",
        category: .data,
        parameters: [
            ToolParameter(name: "password", type: .string, description: "密码", required: true)
        ],
        returnType: .object,
        returnDescription: "密码强度评估结果",
        tags: ["validate", "password"]
    )

    private static let validatePasswordExecutor: ToolExecutor = { input in
        guard let password = input.getString("password") else {
            return .failure(error: "缺少密码参数")
        }

        var score = 0
        var feedback: [String] = []

        // 长度检查
        if password.count >= 8 {
            score += 1
        } else {
            feedback.append("密码应至少8位")
        }

        // 包含小写字母
        if password.range(of: "[a-z]", options: .regularExpression) != nil {
            score += 1
        } else {
            feedback.append("应包含小写字母")
        }

        // 包含大写字母
        if password.range(of: "[A-Z]", options: .regularExpression) != nil {
            score += 1
        } else {
            feedback.append("应包含大写字母")
        }

        // 包含数字
        if password.range(of: "[0-9]", options: .regularExpression) != nil {
            score += 1
        } else {
            feedback.append("应包含数字")
        }

        // 包含特殊字符
        if password.range(of: "[!@#$%^&*(),.?\":{}|<>]", options: .regularExpression) != nil {
            score += 1
        } else {
            feedback.append("应包含特殊字符")
        }

        let strength: String
        switch score {
        case 0...1:
            strength = "weak"
        case 2...3:
            strength = "medium"
        case 4...5:
            strength = "strong"
        default:
            strength = "weak"
        }

        return .success(data: [
            "strength": strength,
            "score": score,
            "maxScore": 5,
            "feedback": feedback
        ])
    }

    /// 验证日期格式
    private static let validateDateTool = Tool(
        id: "tool.validate.date",
        name: "验证日期",
        description: "验证日期字符串格式是否正确",
        category: .data,
        parameters: [
            ToolParameter(name: "date", type: .string, description: "日期字符串", required: true),
            ToolParameter(name: "format", type: .string, description: "日期格式", required: false, defaultValue: "yyyy-MM-dd")
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "date"]
    )

    private static let validateDateExecutor: ToolExecutor = { input in
        guard let dateString = input.getString("date") else {
            return .failure(error: "缺少日期参数")
        }

        let format = input.getString("format") ?? "yyyy-MM-dd"

        let formatter = DateFormatter()
        formatter.dateFormat = format
        formatter.locale = Locale(identifier: "en_US_POSIX")

        let isValid = formatter.date(from: dateString) != nil
        return .success(data: isValid)
    }

    /// 验证MAC地址
    private static let validateMacTool = Tool(
        id: "tool.validate.mac",
        name: "验证MAC地址",
        description: "验证MAC地址格式",
        category: .data,
        parameters: [
            ToolParameter(name: "mac", type: .string, description: "MAC地址", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "mac"]
    )

    private static let validateMacExecutor: ToolExecutor = { input in
        guard let mac = input.getString("mac") else {
            return .failure(error: "缺少MAC参数")
        }

        let macRegex = "^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$"
        let macPredicate = NSPredicate(format: "SELF MATCHES %@", macRegex)
        let isValid = macPredicate.evaluate(with: mac)

        return .success(data: isValid)
    }

    /// 验证端口号
    private static let validatePortTool = Tool(
        id: "tool.validate.port",
        name: "验证端口号",
        description: "验证端口号是否在有效范围内",
        category: .data,
        parameters: [
            ToolParameter(name: "port", type: .number, description: "端口号", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否有效",
        tags: ["validate", "port"]
    )

    private static let validatePortExecutor: ToolExecutor = { input in
        guard let port = input.getInt("port") else {
            return .failure(error: "缺少端口参数")
        }

        let isValid = port > 0 && port <= 65535
        return .success(data: isValid)
    }

    // MARK: - 所有系统工具

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 设备信息工具 (8)
            (deviceInfoTool, deviceInfoExecutor),
            (systemVersionTool, systemVersionExecutor),
            (appInfoTool, appInfoExecutor),
            (memoryUsageTool, memoryUsageExecutor),
            (diskSpaceTool, diskSpaceExecutor),
            (batteryInfoTool, batteryInfoExecutor),
            (networkReachabilityTool, networkReachabilityExecutor),
            (deviceOrientationTool, deviceOrientationExecutor),

            // 数据验证工具 (10)
            (validateEmailTool, validateEmailExecutor),
            (validatePhoneTool, validatePhoneExecutor),
            (validateIdCardTool, validateIdCardExecutor),
            (validateUrlTool, validateUrlExecutor),
            (validateIpTool, validateIpExecutor),
            (validateCreditCardTool, validateCreditCardExecutor),
            (validatePasswordTool, validatePasswordExecutor),
            (validateDateTool, validateDateExecutor),
            (validateMacTool, validateMacExecutor),
            (validatePortTool, validatePortExecutor)
        ]
    }

    public static var totalCount: Int {
        return all.count
    }
}

/// 工具管理器扩展 - 注册系统工具
extension ToolManager {
    /// 注册所有系统工具
    public func registerSystemTools() {
        for (tool, executor) in SystemTools.all {
            register(tool, executor: executor)
        }
        Logger.shared.info("已注册 \(SystemTools.totalCount) 个系统工具")
    }
}
