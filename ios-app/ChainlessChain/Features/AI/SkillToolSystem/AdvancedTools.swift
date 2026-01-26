import Foundation
import UIKit
import CoreImage

/// 高级工具集 - 文件、数学、图像、字符串处理等
public enum AdvancedTools {

    // MARK: - 文件操作工具 (8个)

    /// 读取文件内容
    private static let fileReadTool = Tool(
        id: "tool.file.read",
        name: "读取文件",
        description: "读取文件内容",
        category: .system,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "文件路径", required: true),
            ToolParameter(name: "encoding", type: .string, description: "编码方式", required: false, defaultValue: "utf8")
        ],
        returnType: .string,
        returnDescription: "文件内容",
        tags: ["file", "io"]
    )

    private static let fileReadExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少文件路径")
        }

        let url = URL(fileURLWithPath: path)

        do {
            let content = try String(contentsOf: url, encoding: .utf8)
            return .success(data: content)
        } catch {
            return .failure(error: "读取文件失败: \(error.localizedDescription)")
        }
    }

    /// 写入文件
    private static let fileWriteTool = Tool(
        id: "tool.file.write",
        name: "写入文件",
        description: "写入内容到文件",
        category: .system,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "文件路径", required: true),
            ToolParameter(name: "content", type: .string, description: "文件内容", required: true),
            ToolParameter(name: "append", type: .boolean, description: "是否追加", required: false, defaultValue: "false")
        ],
        returnType: .boolean,
        returnDescription: "是否成功",
        tags: ["file", "io"]
    )

    private static let fileWriteExecutor: ToolExecutor = { input in
        guard let path = input.getString("path"),
              let content = input.getString("content") else {
            return .failure(error: "缺少必要参数")
        }

        let append = input.getBool("append") ?? false
        let url = URL(fileURLWithPath: path)

        do {
            if append, FileManager.default.fileExists(atPath: path) {
                let handle = try FileHandle(forWritingTo: url)
                handle.seekToEndOfFile()
                if let data = content.data(using: .utf8) {
                    handle.write(data)
                }
                handle.closeFile()
            } else {
                try content.write(to: url, atomically: true, encoding: .utf8)
            }
            return .success(data: true)
        } catch {
            return .failure(error: "写入文件失败: \(error.localizedDescription)")
        }
    }

    /// 检查文件是否存在
    private static let fileExistsTool = Tool(
        id: "tool.file.exists",
        name: "检查文件存在",
        description: "检查文件或目录是否存在",
        category: .system,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "文件路径", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否存在",
        tags: ["file"]
    )

    private static let fileExistsExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少文件路径")
        }

        let exists = FileManager.default.fileExists(atPath: path)
        return .success(data: exists)
    }

    /// 删除文件
    private static let fileDeleteTool = Tool(
        id: "tool.file.delete",
        name: "删除文件",
        description: "删除文件或目录",
        category: .system,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "文件路径", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否成功",
        tags: ["file"]
    )

    private static let fileDeleteExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少文件路径")
        }

        let url = URL(fileURLWithPath: path)

        do {
            try FileManager.default.removeItem(at: url)
            return .success(data: true)
        } catch {
            return .failure(error: "删除失败: \(error.localizedDescription)")
        }
    }

    /// 获取文件信息
    private static let fileInfoTool = Tool(
        id: "tool.file.info",
        name: "文件信息",
        description: "获取文件或目录的详细信息",
        category: .system,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "文件路径", required: true)
        ],
        returnType: .object,
        returnDescription: "文件信息（大小、创建时间、修改时间等）",
        tags: ["file"]
    )

    private static let fileInfoExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少文件路径")
        }

        let url = URL(fileURLWithPath: path)

        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: path)
            var info: [String: Any] = [:]

            info["size"] = attributes[.size] as? Int ?? 0
            info["creationDate"] = (attributes[.creationDate] as? Date)?.timeIntervalSince1970 ?? 0
            info["modificationDate"] = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            info["isDirectory"] = (attributes[.type] as? FileAttributeType) == .typeDirectory
            info["permissions"] = attributes[.posixPermissions] as? Int ?? 0

            return .success(data: info)
        } catch {
            return .failure(error: "获取信息失败: \(error.localizedDescription)")
        }
    }

    /// 列出目录内容
    private static let fileListTool = Tool(
        id: "tool.file.list",
        name: "列出目录",
        description: "列出目录下的所有文件和子目录",
        category: .system,
        parameters: [
            ToolParameter(name: "path", type: .string, description: "目录路径", required: true),
            ToolParameter(name: "recursive", type: .boolean, description: "是否递归", required: false, defaultValue: "false")
        ],
        returnType: .array,
        returnDescription: "文件和目录列表",
        tags: ["file"]
    )

    private static let fileListExecutor: ToolExecutor = { input in
        guard let path = input.getString("path") else {
            return .failure(error: "缺少目录路径")
        }

        let recursive = input.getBool("recursive") ?? false
        let url = URL(fileURLWithPath: path)

        do {
            let items: [String]
            if recursive {
                let enumerator = FileManager.default.enumerator(atPath: path)
                items = enumerator?.allObjects as? [String] ?? []
            } else {
                items = try FileManager.default.contentsOfDirectory(atPath: path)
            }

            return .success(data: items.sorted())
        } catch {
            return .failure(error: "列出目录失败: \(error.localizedDescription)")
        }
    }

    /// 复制文件
    private static let fileCopyTool = Tool(
        id: "tool.file.copy",
        name: "复制文件",
        description: "复制文件或目录",
        category: .system,
        parameters: [
            ToolParameter(name: "source", type: .string, description: "源路径", required: true),
            ToolParameter(name: "destination", type: .string, description: "目标路径", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否成功",
        tags: ["file"]
    )

    private static let fileCopyExecutor: ToolExecutor = { input in
        guard let source = input.getString("source"),
              let destination = input.getString("destination") else {
            return .failure(error: "缺少必要参数")
        }

        let srcURL = URL(fileURLWithPath: source)
        let dstURL = URL(fileURLWithPath: destination)

        do {
            try FileManager.default.copyItem(at: srcURL, to: dstURL)
            return .success(data: true)
        } catch {
            return .failure(error: "复制失败: \(error.localizedDescription)")
        }
    }

    /// 移动文件
    private static let fileMoveTool = Tool(
        id: "tool.file.move",
        name: "移动文件",
        description: "移动或重命名文件",
        category: .system,
        parameters: [
            ToolParameter(name: "source", type: .string, description: "源路径", required: true),
            ToolParameter(name: "destination", type: .string, description: "目标路径", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否成功",
        tags: ["file"]
    )

    private static let fileMoveExecutor: ToolExecutor = { input in
        guard let source = input.getString("source"),
              let destination = input.getString("destination") else {
            return .failure(error: "缺少必要参数")
        }

        let srcURL = URL(fileURLWithPath: source)
        let dstURL = URL(fileURLWithPath: destination)

        do {
            try FileManager.default.moveItem(at: srcURL, to: dstURL)
            return .success(data: true)
        } catch {
            return .failure(error: "移动失败: \(error.localizedDescription)")
        }
    }

    // MARK: - 数学计算工具 (8个)

    /// 基础数学运算
    private static let mathCalculateTool = Tool(
        id: "tool.math.calculate",
        name: "数学计算",
        description: "执行基础数学运算",
        category: .data,
        parameters: [
            ToolParameter(name: "expression", type: .string, description: "数学表达式", required: true)
        ],
        returnType: .number,
        returnDescription: "计算结果",
        tags: ["math", "calculate"]
    )

    private static let mathCalculateExecutor: ToolExecutor = { input in
        guard let expression = input.getString("expression") else {
            return .failure(error: "缺少表达式")
        }

        // 简单的表达式计算器（使用NSExpression）
        let expr = NSExpression(format: expression)

        do {
            if let result = expr.expressionValue(with: nil, context: nil) as? NSNumber {
                return .success(data: result.doubleValue)
            } else {
                return .failure(error: "计算失败")
            }
        } catch {
            return .failure(error: "表达式错误: \(error.localizedDescription)")
        }
    }

    /// 随机数生成
    private static let mathRandomTool = Tool(
        id: "tool.math.random",
        name: "随机数",
        description: "生成随机数",
        category: .data,
        parameters: [
            ToolParameter(name: "min", type: .number, description: "最小值", required: false, defaultValue: "0"),
            ToolParameter(name: "max", type: .number, description: "最大值", required: false, defaultValue: "1"),
            ToolParameter(name: "count", type: .number, description: "生成数量", required: false, defaultValue: "1")
        ],
        returnType: .array,
        returnDescription: "随机数数组",
        tags: ["math", "random"]
    )

    private static let mathRandomExecutor: ToolExecutor = { input in
        let min = input.getDouble("min") ?? 0.0
        let max = input.getDouble("max") ?? 1.0
        let count = input.getInt("count") ?? 1

        let randoms = (0..<count).map { _ in
            Double.random(in: min...max)
        }

        return .success(data: randoms)
    }

    /// 数学函数
    private static let mathFunctionTool = Tool(
        id: "tool.math.function",
        name: "数学函数",
        description: "执行数学函数（sin, cos, tan, log, exp等）",
        category: .data,
        parameters: [
            ToolParameter(name: "function", type: .string, description: "函数名", required: true),
            ToolParameter(name: "value", type: .number, description: "输入值", required: true)
        ],
        returnType: .number,
        returnDescription: "函数结果",
        tags: ["math", "function"]
    )

    private static let mathFunctionExecutor: ToolExecutor = { input in
        guard let function = input.getString("function"),
              let value = input.getDouble("value") else {
            return .failure(error: "缺少必要参数")
        }

        let result: Double
        switch function.lowercased() {
        case "sin": result = sin(value)
        case "cos": result = cos(value)
        case "tan": result = tan(value)
        case "asin": result = asin(value)
        case "acos": result = acos(value)
        case "atan": result = atan(value)
        case "sinh": result = sinh(value)
        case "cosh": result = cosh(value)
        case "tanh": result = tanh(value)
        case "log": result = log(value)
        case "log10": result = log10(value)
        case "log2": result = log2(value)
        case "exp": result = exp(value)
        case "sqrt": result = sqrt(value)
        case "cbrt": result = cbrt(value)
        case "abs": result = abs(value)
        case "ceil": result = ceil(value)
        case "floor": result = floor(value)
        case "round": result = round(value)
        default:
            return .failure(error: "未知函数: \(function)")
        }

        return .success(data: result)
    }

    /// 排列组合
    private static let mathPermutationTool = Tool(
        id: "tool.math.permutation",
        name: "排列组合",
        description: "计算排列数和组合数",
        category: .data,
        parameters: [
            ToolParameter(name: "n", type: .number, description: "总数", required: true),
            ToolParameter(name: "r", type: .number, description: "选取数", required: true),
            ToolParameter(name: "type", type: .string, description: "类型(permutation/combination)", required: false, defaultValue: "combination")
        ],
        returnType: .number,
        returnDescription: "排列数或组合数",
        tags: ["math", "combinatorics"]
    )

    private static let mathPermutationExecutor: ToolExecutor = { input in
        guard let n = input.getInt("n"),
              let r = input.getInt("r") else {
            return .failure(error: "缺少必要参数")
        }

        let type = input.getString("type") ?? "combination"

        func factorial(_ n: Int) -> Int {
            return n <= 1 ? 1 : n * factorial(n - 1)
        }

        let result: Int
        if type == "permutation" {
            // P(n, r) = n! / (n-r)!
            result = factorial(n) / factorial(n - r)
        } else {
            // C(n, r) = n! / (r! * (n-r)!)
            result = factorial(n) / (factorial(r) * factorial(n - r))
        }

        return .success(data: result)
    }

    /// 质数判断
    private static let mathIsPrimeTool = Tool(
        id: "tool.math.isprime",
        name: "质数判断",
        description: "判断一个数是否为质数",
        category: .data,
        parameters: [
            ToolParameter(name: "number", type: .number, description: "待判断的数", required: true)
        ],
        returnType: .boolean,
        returnDescription: "是否为质数",
        tags: ["math", "prime"]
    )

    private static let mathIsPrimeExecutor: ToolExecutor = { input in
        guard let number = input.getInt("number") else {
            return .failure(error: "缺少数字参数")
        }

        if number < 2 {
            return .success(data: false)
        }

        if number == 2 {
            return .success(data: true)
        }

        if number % 2 == 0 {
            return .success(data: false)
        }

        let sqrtNum = Int(sqrt(Double(number)))
        for i in stride(from: 3, through: sqrtNum, by: 2) {
            if number % i == 0 {
                return .success(data: false)
            }
        }

        return .success(data: true)
    }

    /// 最大公约数
    private static let mathGcdTool = Tool(
        id: "tool.math.gcd",
        name: "最大公约数",
        description: "计算两个数的最大公约数",
        category: .data,
        parameters: [
            ToolParameter(name: "a", type: .number, description: "第一个数", required: true),
            ToolParameter(name: "b", type: .number, description: "第二个数", required: true)
        ],
        returnType: .number,
        returnDescription: "最大公约数",
        tags: ["math", "gcd"]
    )

    private static let mathGcdExecutor: ToolExecutor = { input in
        guard let a = input.getInt("a"),
              let b = input.getInt("b") else {
            return .failure(error: "缺少必要参数")
        }

        func gcd(_ a: Int, _ b: Int) -> Int {
            return b == 0 ? a : gcd(b, a % b)
        }

        return .success(data: gcd(abs(a), abs(b)))
    }

    /// 最小公倍数
    private static let mathLcmTool = Tool(
        id: "tool.math.lcm",
        name: "最小公倍数",
        description: "计算两个数的最小公倍数",
        category: .data,
        parameters: [
            ToolParameter(name: "a", type: .number, description: "第一个数", required: true),
            ToolParameter(name: "b", type: .number, description: "第二个数", required: true)
        ],
        returnType: .number,
        returnDescription: "最小公倍数",
        tags: ["math", "lcm"]
    )

    private static let mathLcmExecutor: ToolExecutor = { input in
        guard let a = input.getInt("a"),
              let b = input.getInt("b") else {
            return .failure(error: "缺少必要参数")
        }

        func gcd(_ a: Int, _ b: Int) -> Int {
            return b == 0 ? a : gcd(b, a % b)
        }

        let result = abs(a * b) / gcd(abs(a), abs(b))
        return .success(data: result)
    }

    /// 数组统计
    private static let mathArrayStatsTool = Tool(
        id: "tool.math.arraystats",
        name: "数组统计",
        description: "计算数组的统计信息（总和、平均、最大最小值等）",
        category: .data,
        parameters: [
            ToolParameter(name: "numbers", type: .array, description: "数字数组", required: true)
        ],
        returnType: .object,
        returnDescription: "统计信息",
        tags: ["math", "statistics"]
    )

    private static let mathArrayStatsExecutor: ToolExecutor = { input in
        guard let numbersArray = input.getArray("numbers"),
              let numbers = numbersArray as? [Double] else {
            return .failure(error: "缺少数字数组")
        }

        guard !numbers.isEmpty else {
            return .failure(error: "数组为空")
        }

        let sum = numbers.reduce(0, +)
        let mean = sum / Double(numbers.count)
        let min = numbers.min() ?? 0
        let max = numbers.max() ?? 0

        let sortedNumbers = numbers.sorted()
        let median: Double
        if numbers.count % 2 == 0 {
            median = (sortedNumbers[numbers.count / 2 - 1] + sortedNumbers[numbers.count / 2]) / 2
        } else {
            median = sortedNumbers[numbers.count / 2]
        }

        let variance = numbers.map { pow($0 - mean, 2) }.reduce(0, +) / Double(numbers.count)
        let stdDev = sqrt(variance)

        return .success(data: [
            "count": numbers.count,
            "sum": sum,
            "mean": mean,
            "median": median,
            "min": min,
            "max": max,
            "variance": variance,
            "stdDev": stdDev
        ])
    }

    // MARK: - 字符串处理工具 (6个)

    /// 字符串反转
    private static let stringReverseTool = Tool(
        id: "tool.string.reverse",
        name: "字符串反转",
        description: "反转字符串",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true)
        ],
        returnType: .string,
        returnDescription: "反转后的文本",
        tags: ["string"]
    )

    private static let stringReverseExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        return .success(data: String(text.reversed()))
    }

    /// 字符串替换
    private static let stringReplaceTool = Tool(
        id: "tool.string.replace",
        name: "字符串替换",
        description: "替换字符串中的文本",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "find", type: .string, description: "查找内容", required: true),
            ToolParameter(name: "replace", type: .string, description: "替换内容", required: true),
            ToolParameter(name: "regex", type: .boolean, description: "是否使用正则", required: false, defaultValue: "false")
        ],
        returnType: .string,
        returnDescription: "替换后的文本",
        tags: ["string", "replace"]
    )

    private static let stringReplaceExecutor: ToolExecutor = { input in
        guard let text = input.getString("text"),
              let find = input.getString("find"),
              let replace = input.getString("replace") else {
            return .failure(error: "缺少必要参数")
        }

        let useRegex = input.getBool("regex") ?? false

        let result: String
        if useRegex {
            do {
                let regex = try NSRegularExpression(pattern: find)
                let range = NSRange(text.startIndex..., in: text)
                result = regex.stringByReplacingMatches(in: text, range: range, withTemplate: replace)
            } catch {
                return .failure(error: "正则表达式错误: \(error.localizedDescription)")
            }
        } else {
            result = text.replacingOccurrences(of: find, with: replace)
        }

        return .success(data: result)
    }

    /// 字符串大小写转换
    private static let stringCaseTool = Tool(
        id: "tool.string.case",
        name: "大小写转换",
        description: "转换字符串大小写",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "mode", type: .string, description: "模式(upper/lower/capitalize)", required: false, defaultValue: "lower")
        ],
        returnType: .string,
        returnDescription: "转换后的文本",
        tags: ["string", "case"]
    )

    private static let stringCaseExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        let mode = input.getString("mode") ?? "lower"

        let result: String
        switch mode {
        case "upper":
            result = text.uppercased()
        case "lower":
            result = text.lowercased()
        case "capitalize":
            result = text.capitalized
        default:
            result = text
        }

        return .success(data: result)
    }

    /// 字符串修剪
    private static let stringTrimTool = Tool(
        id: "tool.string.trim",
        name: "修剪字符串",
        description: "去除字符串首尾空白字符",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "characters", type: .string, description: "要去除的字符", required: false)
        ],
        returnType: .string,
        returnDescription: "修剪后的文本",
        tags: ["string", "trim"]
    )

    private static let stringTrimExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        let result: String
        if let characters = input.getString("characters") {
            let characterSet = CharacterSet(charactersIn: characters)
            result = text.trimmingCharacters(in: characterSet)
        } else {
            result = text.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return .success(data: result)
    }

    /// 字符串分割
    private static let stringSplitTool = Tool(
        id: "tool.string.split",
        name: "分割字符串",
        description: "按分隔符分割字符串",
        category: .system,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "输入文本", required: true),
            ToolParameter(name: "separator", type: .string, description: "分隔符", required: false, defaultValue: ","),
            ToolParameter(name: "limit", type: .number, description: "最大分割数", required: false)
        ],
        returnType: .array,
        returnDescription: "分割后的数组",
        tags: ["string", "split"]
    )

    private static let stringSplitExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本参数")
        }

        let separator = input.getString("separator") ?? ","
        let limit = input.getInt("limit")

        var parts = text.components(separatedBy: separator)

        if let maxCount = limit, maxCount > 0 {
            parts = Array(parts.prefix(maxCount))
        }

        return .success(data: parts)
    }

    /// 字符串拼接
    private static let stringJoinTool = Tool(
        id: "tool.string.join",
        name: "拼接字符串",
        description: "用分隔符拼接字符串数组",
        category: .system,
        parameters: [
            ToolParameter(name: "array", type: .array, description: "字符串数组", required: true),
            ToolParameter(name: "separator", type: .string, description: "分隔符", required: false, defaultValue: ",")
        ],
        returnType: .string,
        returnDescription: "拼接后的字符串",
        tags: ["string", "join"]
    )

    private static let stringJoinExecutor: ToolExecutor = { input in
        guard let array = input.getArray("array") as? [String] else {
            return .failure(error: "缺少字符串数组")
        }

        let separator = input.getString("separator") ?? ","
        return .success(data: array.joined(separator: separator))
    }

    // MARK: - 所有高级工具

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 文件操作工具 (8)
            (fileReadTool, fileReadExecutor),
            (fileWriteTool, fileWriteExecutor),
            (fileExistsTool, fileExistsExecutor),
            (fileDeleteTool, fileDeleteExecutor),
            (fileInfoTool, fileInfoExecutor),
            (fileListTool, fileListExecutor),
            (fileCopyTool, fileCopyExecutor),
            (fileMoveTool, fileMoveExecutor),

            // 数学计算工具 (8)
            (mathCalculateTool, mathCalculateExecutor),
            (mathRandomTool, mathRandomExecutor),
            (mathFunctionTool, mathFunctionExecutor),
            (mathPermutationTool, mathPermutationExecutor),
            (mathIsPrimeTool, mathIsPrimeExecutor),
            (mathGcdTool, mathGcdExecutor),
            (mathLcmTool, mathLcmExecutor),
            (mathArrayStatsTool, mathArrayStatsExecutor),

            // 字符串处理工具 (6)
            (stringReverseTool, stringReverseExecutor),
            (stringReplaceTool, stringReplaceExecutor),
            (stringCaseTool, stringCaseExecutor),
            (stringTrimTool, stringTrimExecutor),
            (stringSplitTool, stringSplitExecutor),
            (stringJoinTool, stringJoinExecutor)
        ]
    }

    public static var totalCount: Int {
        return all.count
    }
}

/// 工具管理器扩展 - 注册高级工具
extension ToolManager {
    /// 注册所有高级工具
    public func registerAdvancedTools() {
        for (tool, executor) in AdvancedTools.all {
            register(tool, executor: executor)
        }
        Logger.shared.info("已注册 \(AdvancedTools.totalCount) 个高级工具")
    }
}
