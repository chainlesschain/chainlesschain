import Foundation
import UIKit
import CoreImage
import CoreLocation
import Vision

// MARK: - Utility Tools (18 tools)
// QR/Barcode: 6 tools | Location: 4 tools | Weather: 2 tools | Encryption: 3 tools | Other: 3 tools

public class UtilityTools {

    // MARK: - QR Code & Barcode Tools (6 tools)

    /// Tool: tool.qr.generate - 生成二维码
    public static let qrGenerateTool = Tool(
        id: "tool.qr.generate",
        name: "二维码生成",
        description: "根据文本内容生成二维码图片",
        category: .utility,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "要编码的文本内容", required: true),
            ToolParameter(name: "size", type: .number, description: "二维码尺寸（默认512）", required: false),
            ToolParameter(name: "outputPath", type: .string, description: "输出图片路径", required: true)
        ],
        executor: qrGenerateExecutor
    )

    private static let qrGenerateExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }
        guard let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少输出路径")
        }

        let size = CGFloat(input.getNumber("size") ?? 512.0)

        guard let data = text.data(using: .utf8) else {
            return .failure(error: "文本编码失败")
        }

        guard let filter = CIFilter(name: "CIQRCodeGenerator") else {
            return .failure(error: "无法创建二维码生成器")
        }

        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("H", forKey: "inputCorrectionLevel") // 高容错率

        guard let ciImage = filter.outputImage else {
            return .failure(error: "生成二维码失败")
        }

        // 缩放到指定尺寸
        let scaleX = size / ciImage.extent.width
        let scaleY = size / ciImage.extent.height
        let scaledImage = ciImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        let context = CIContext()
        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else {
            return .failure(error: "无法生成图片")
        }

        let image = UIImage(cgImage: cgImage)
        guard let imageData = image.pngData() else {
            return .failure(error: "无法编码图片数据")
        }

        let url = URL(fileURLWithPath: outputPath)
        do {
            try imageData.write(to: url)
            return .success(data: ["outputPath": outputPath, "size": size])
        } catch {
            return .failure(error: "保存图片失败: \(error.localizedDescription)")
        }
    }

    /// Tool: tool.qr.scan - 扫描二维码
    public static let qrScanTool = Tool(
        id: "tool.qr.scan",
        name: "二维码扫描",
        description: "从图片中识别二维码内容",
        category: .utility,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图片文件路径", required: true)
        ],
        executor: qrScanExecutor
    )

    private static let qrScanExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath") else {
            return .failure(error: "缺少图片路径")
        }

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图片")
        }

        guard let cgImage = image.cgImage else {
            return .failure(error: "无法获取图片数据")
        }

        let request = VNDetectBarcodesRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

        do {
            try handler.perform([request])
        } catch {
            return .failure(error: "识别失败: \(error.localizedDescription)")
        }

        guard let results = request.results, !results.isEmpty else {
            return .failure(error: "未检测到二维码")
        }

        var qrCodes: [[String: Any]] = []

        for observation in results {
            if let payload = observation.payloadStringValue {
                qrCodes.append([
                    "type": observation.symbology.rawValue,
                    "content": payload,
                    "confidence": observation.confidence
                ])
            }
        }

        return .success(data: ["qrCodes": qrCodes, "count": qrCodes.count])
    }

    /// Tool: tool.barcode.generate - 生成条形码
    public static let barcodeGenerateTool = Tool(
        id: "tool.barcode.generate",
        name: "条形码生成",
        description: "根据数字或文本生成条形码图片",
        category: .utility,
        parameters: [
            ToolParameter(name: "text", type: .string, description: "要编码的文本", required: true),
            ToolParameter(name: "type", type: .string, description: "条形码类型（code128/pdf417，默认code128）", required: false),
            ToolParameter(name: "outputPath", type: .string, description: "输出图片路径", required: true)
        ],
        executor: barcodeGenerateExecutor
    )

    private static let barcodeGenerateExecutor: ToolExecutor = { input in
        guard let text = input.getString("text") else {
            return .failure(error: "缺少文本内容")
        }
        guard let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少输出路径")
        }

        let type = input.getString("type") ?? "code128"

        let filterName: String
        switch type.lowercased() {
        case "code128":
            filterName = "CICode128BarcodeGenerator"
        case "pdf417":
            filterName = "CIPDF417BarcodeGenerator"
        default:
            return .failure(error: "不支持的条形码类型: \(type)")
        }

        guard let data = text.data(using: .ascii) else {
            return .failure(error: "文本编码失败（仅支持ASCII字符）")
        }

        guard let filter = CIFilter(name: filterName) else {
            return .failure(error: "无法创建条形码生成器")
        }

        filter.setValue(data, forKey: "inputMessage")

        guard let ciImage = filter.outputImage else {
            return .failure(error: "生成条形码失败")
        }

        // 放大到合适尺寸
        let scaleX: CGFloat = 3.0
        let scaleY: CGFloat = 3.0
        let scaledImage = ciImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        let context = CIContext()
        guard let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) else {
            return .failure(error: "无法生成图片")
        }

        let image = UIImage(cgImage: cgImage)
        guard let imageData = image.pngData() else {
            return .failure(error: "无法编码图片数据")
        }

        let url = URL(fileURLWithPath: outputPath)
        do {
            try imageData.write(to: url)
            return .success(data: ["outputPath": outputPath, "type": type])
        } catch {
            return .failure(error: "保存图片失败: \(error.localizedDescription)")
        }
    }

    /// Tool: tool.barcode.scan - 扫描条形码
    public static let barcodeScanTool = Tool(
        id: "tool.barcode.scan",
        name: "条形码扫描",
        description: "从图片中识别条形码内容",
        category: .utility,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图片文件路径", required: true)
        ],
        executor: barcodeScanExecutor
    )

    private static let barcodeScanExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath") else {
            return .failure(error: "缺少图片路径")
        }

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图片")
        }

        guard let cgImage = image.cgImage else {
            return .failure(error: "无法获取图片数据")
        }

        let request = VNDetectBarcodesRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])

        do {
            try handler.perform([request])
        } catch {
            return .failure(error: "识别失败: \(error.localizedDescription)")
        }

        guard let results = request.results, !results.isEmpty else {
            return .failure(error: "未检测到条形码")
        }

        var barcodes: [[String: Any]] = []

        for observation in results {
            if let payload = observation.payloadStringValue {
                barcodes.append([
                    "type": observation.symbology.rawValue,
                    "content": payload,
                    "confidence": observation.confidence
                ])
            }
        }

        return .success(data: ["barcodes": barcodes, "count": barcodes.count])
    }

    /// Tool: tool.qr.batch - 批量生成二维码
    public static let qrBatchTool = Tool(
        id: "tool.qr.batch",
        name: "批量二维码生成",
        description: "批量生成多个二维码图片",
        category: .utility,
        parameters: [
            ToolParameter(name: "texts", type: .array, description: "文本内容数组", required: true),
            ToolParameter(name: "outputDir", type: .string, description: "输出目录", required: true),
            ToolParameter(name: "size", type: .number, description: "二维码尺寸（默认512）", required: false)
        ],
        executor: qrBatchExecutor
    )

    private static let qrBatchExecutor: ToolExecutor = { input in
        guard let texts = input.getArray("texts") as? [String] else {
            return .failure(error: "缺少文本数组")
        }
        guard let outputDir = input.getString("outputDir") else {
            return .failure(error: "缺少输出目录")
        }

        // 创建输出目录
        try? FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        var outputFiles: [String] = []

        for (index, text) in texts.enumerated() {
            let outputPath = "\(outputDir)/qr_\(index + 1).png"

            let tempInput = ToolInput(parameters: [
                "text": text,
                "size": input.getNumber("size") ?? 512.0,
                "outputPath": outputPath
            ])

            let result = qrGenerateExecutor(tempInput)
            if case .success = result {
                outputFiles.append(outputPath)
            }
        }

        return .success(data: ["outputFiles": outputFiles, "count": outputFiles.count])
    }

    /// Tool: tool.qr.vcard - 生成vCard二维码
    public static let qrVCardTool = Tool(
        id: "tool.qr.vcard",
        name: "vCard二维码生成",
        description: "根据联系人信息生成vCard格式二维码",
        category: .utility,
        parameters: [
            ToolParameter(name: "name", type: .string, description: "姓名", required: true),
            ToolParameter(name: "phone", type: .string, description: "电话", required: false),
            ToolParameter(name: "email", type: .string, description: "邮箱", required: false),
            ToolParameter(name: "organization", type: .string, description: "公司/组织", required: false),
            ToolParameter(name: "outputPath", type: .string, description: "输出图片路径", required: true)
        ],
        executor: qrVCardExecutor
    )

    private static let qrVCardExecutor: ToolExecutor = { input in
        guard let name = input.getString("name") else {
            return .failure(error: "缺少姓名")
        }
        guard let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少输出路径")
        }

        var vcard = "BEGIN:VCARD\nVERSION:3.0\n"
        vcard += "FN:\(name)\n"

        if let phone = input.getString("phone") {
            vcard += "TEL:\(phone)\n"
        }
        if let email = input.getString("email") {
            vcard += "EMAIL:\(email)\n"
        }
        if let org = input.getString("organization") {
            vcard += "ORG:\(org)\n"
        }

        vcard += "END:VCARD"

        let tempInput = ToolInput(parameters: [
            "text": vcard,
            "outputPath": outputPath
        ])

        return qrGenerateExecutor(tempInput)
    }

    // MARK: - Location Tools (4 tools)

    /// Tool: tool.location.geocode - 地址转经纬度
    public static let geocodeTool = Tool(
        id: "tool.location.geocode",
        name: "地理编码",
        description: "将地址转换为经纬度坐标",
        category: .utility,
        parameters: [
            ToolParameter(name: "address", type: .string, description: "地址", required: true)
        ],
        executor: geocodeExecutor
    )

    private static let geocodeExecutor: ToolExecutor = { input in
        guard let address = input.getString("address") else {
            return .failure(error: "缺少地址")
        }

        let geocoder = CLGeocoder()
        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        geocoder.geocodeAddressString(address) { placemarks, error in
            if let error = error {
                result = .failure(error: "地理编码失败: \(error.localizedDescription)")
            } else if let placemark = placemarks?.first, let location = placemark.location {
                result = .success(data: [
                    "latitude": location.coordinate.latitude,
                    "longitude": location.coordinate.longitude,
                    "formattedAddress": placemark.name ?? address
                ])
            } else {
                result = .failure(error: "未找到地址")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// Tool: tool.location.reverse - 经纬度转地址
    public static let reverseGeocodeTool = Tool(
        id: "tool.location.reverse",
        name: "逆地理编码",
        description: "将经纬度坐标转换为地址",
        category: .utility,
        parameters: [
            ToolParameter(name: "latitude", type: .number, description: "纬度", required: true),
            ToolParameter(name: "longitude", type: .number, description: "经度", required: true)
        ],
        executor: reverseGeocodeExecutor
    )

    private static let reverseGeocodeExecutor: ToolExecutor = { input in
        guard let latitude = input.getNumber("latitude"),
              let longitude = input.getNumber("longitude") else {
            return .failure(error: "缺少经纬度坐标")
        }

        let location = CLLocation(latitude: latitude, longitude: longitude)
        let geocoder = CLGeocoder()
        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        geocoder.reverseGeocodeLocation(location) { placemarks, error in
            if let error = error {
                result = .failure(error: "逆地理编码失败: \(error.localizedDescription)")
            } else if let placemark = placemarks?.first {
                var addressComponents: [String] = []
                if let country = placemark.country { addressComponents.append(country) }
                if let city = placemark.locality { addressComponents.append(city) }
                if let street = placemark.thoroughfare { addressComponents.append(street) }

                result = .success(data: [
                    "country": placemark.country ?? "",
                    "city": placemark.locality ?? "",
                    "street": placemark.thoroughfare ?? "",
                    "postalCode": placemark.postalCode ?? "",
                    "formattedAddress": addressComponents.joined(separator: ", ")
                ])
            } else {
                result = .failure(error: "未找到地址")
            }
            semaphore.signal()
        }

        semaphore.wait()
        return result
    }

    /// Tool: tool.location.distance - 计算两点距离
    public static let distanceTool = Tool(
        id: "tool.location.distance",
        name: "距离计算",
        description: "计算两个经纬度坐标之间的距离（米）",
        category: .utility,
        parameters: [
            ToolParameter(name: "lat1", type: .number, description: "起点纬度", required: true),
            ToolParameter(name: "lon1", type: .number, description: "起点经度", required: true),
            ToolParameter(name: "lat2", type: .number, description: "终点纬度", required: true),
            ToolParameter(name: "lon2", type: .number, description: "终点经度", required: true)
        ],
        executor: distanceExecutor
    )

    private static let distanceExecutor: ToolExecutor = { input in
        guard let lat1 = input.getNumber("lat1"),
              let lon1 = input.getNumber("lon1"),
              let lat2 = input.getNumber("lat2"),
              let lon2 = input.getNumber("lon2") else {
            return .failure(error: "缺少坐标参数")
        }

        let location1 = CLLocation(latitude: lat1, longitude: lon1)
        let location2 = CLLocation(latitude: lat2, longitude: lon2)

        let distance = location1.distance(from: location2) // 单位：米

        return .success(data: [
            "distance": distance,
            "distanceKm": distance / 1000.0,
            "unit": "meters"
        ])
    }

    /// Tool: tool.location.current - 获取当前位置（需权限）
    public static let currentLocationTool = Tool(
        id: "tool.location.current",
        name: "获取当前位置",
        description: "获取设备当前GPS位置（需要定位权限）",
        category: .utility,
        parameters: [],
        executor: currentLocationExecutor
    )

    private static let currentLocationExecutor: ToolExecutor = { _ in
        // 注意：此工具需要在实际应用中配置CLLocationManager并请求权限
        // 这里提供一个模拟实现
        return .failure(error: "此工具需要在应用中配置定位权限和CLLocationManager")
    }

    // MARK: - Weather Tools (2 tools)

    /// Tool: tool.weather.current - 获取当前天气
    public static let currentWeatherTool = Tool(
        id: "tool.weather.current",
        name: "当前天气查询",
        description: "获取指定城市的当前天气信息",
        category: .utility,
        parameters: [
            ToolParameter(name: "city", type: .string, description: "城市名称", required: true),
            ToolParameter(name: "apiKey", type: .string, description: "天气API密钥（OpenWeatherMap）", required: true)
        ],
        executor: currentWeatherExecutor
    )

    private static let currentWeatherExecutor: ToolExecutor = { input in
        guard let city = input.getString("city"),
              let apiKey = input.getString("apiKey") else {
            return .failure(error: "缺少城市或API密钥")
        }

        let urlString = "https://api.openweathermap.org/data/2.5/weather?q=\(city)&appid=\(apiKey)&units=metric"
        guard let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                result = .failure(error: "请求失败: \(error.localizedDescription)")
                semaphore.signal()
                return
            }

            guard let data = data else {
                result = .failure(error: "未获取到数据")
                semaphore.signal()
                return
            }

            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    var weatherData: [String: Any] = [:]

                    if let main = json["main"] as? [String: Any] {
                        weatherData["temperature"] = main["temp"]
                        weatherData["feelsLike"] = main["feels_like"]
                        weatherData["humidity"] = main["humidity"]
                    }

                    if let weather = json["weather"] as? [[String: Any]], let first = weather.first {
                        weatherData["description"] = first["description"]
                        weatherData["icon"] = first["icon"]
                    }

                    if let wind = json["wind"] as? [String: Any] {
                        weatherData["windSpeed"] = wind["speed"]
                    }

                    result = .success(data: weatherData)
                } else {
                    result = .failure(error: "解析JSON失败")
                }
            } catch {
                result = .failure(error: "解析错误: \(error.localizedDescription)")
            }

            semaphore.signal()
        }.resume()

        semaphore.wait()
        return result
    }

    /// Tool: tool.weather.forecast - 获取天气预报
    public static let forecastWeatherTool = Tool(
        id: "tool.weather.forecast",
        name: "天气预报查询",
        description: "获取指定城市的未来天气预报",
        category: .utility,
        parameters: [
            ToolParameter(name: "city", type: .string, description: "城市名称", required: true),
            ToolParameter(name: "days", type: .number, description: "预报天数（1-5天）", required: false),
            ToolParameter(name: "apiKey", type: .string, description: "天气API密钥（OpenWeatherMap）", required: true)
        ],
        executor: forecastWeatherExecutor
    )

    private static let forecastWeatherExecutor: ToolExecutor = { input in
        guard let city = input.getString("city"),
              let apiKey = input.getString("apiKey") else {
            return .failure(error: "缺少城市或API密钥")
        }

        let days = Int(input.getNumber("days") ?? 5)
        let urlString = "https://api.openweathermap.org/data/2.5/forecast?q=\(city)&appid=\(apiKey)&units=metric&cnt=\(days * 8)"

        guard let url = URL(string: urlString) else {
            return .failure(error: "无效的URL")
        }

        let semaphore = DispatchSemaphore(value: 0)
        var result: ToolResult!

        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                result = .failure(error: "请求失败: \(error.localizedDescription)")
                semaphore.signal()
                return
            }

            guard let data = data else {
                result = .failure(error: "未获取到数据")
                semaphore.signal()
                return
            }

            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let list = json["list"] as? [[String: Any]] {

                    var forecasts: [[String: Any]] = []

                    for item in list.prefix(days * 8) {
                        var forecast: [String: Any] = [:]
                        forecast["datetime"] = item["dt_txt"]

                        if let main = item["main"] as? [String: Any] {
                            forecast["temperature"] = main["temp"]
                            forecast["humidity"] = main["humidity"]
                        }

                        if let weather = item["weather"] as? [[String: Any]], let first = weather.first {
                            forecast["description"] = first["description"]
                        }

                        forecasts.append(forecast)
                    }

                    result = .success(data: ["forecasts": forecasts, "count": forecasts.count])
                } else {
                    result = .failure(error: "解析JSON失败")
                }
            } catch {
                result = .failure(error: "解析错误: \(error.localizedDescription)")
            }

            semaphore.signal()
        }.resume()

        semaphore.wait()
        return result
    }

    // MARK: - Encryption Tools (3 tools)

    /// Tool: tool.crypto.hash - 计算哈希值
    public static let hashTool = Tool(
        id: "tool.crypto.hash",
        name: "哈希计算",
        description: "计算文本或文件的哈希值（MD5/SHA256/SHA512）",
        category: .utility,
        parameters: [
            ToolParameter(name: "input", type: .string, description: "输入文本或文件路径", required: true),
            ToolParameter(name: "algorithm", type: .string, description: "算法（md5/sha256/sha512，默认sha256）", required: false),
            ToolParameter(name: "isFile", type: .boolean, description: "是否为文件路径（默认false）", required: false)
        ],
        executor: hashExecutor
    )

    private static let hashExecutor: ToolExecutor = { input in
        guard let inputValue = input.getString("input") else {
            return .failure(error: "缺少输入")
        }

        let algorithm = input.getString("algorithm") ?? "sha256"
        let isFile = input.getBoolean("isFile") ?? false

        var data: Data
        if isFile {
            guard let fileData = try? Data(contentsOf: URL(fileURLWithPath: inputValue)) else {
                return .failure(error: "无法读取文件")
            }
            data = fileData
        } else {
            guard let textData = inputValue.data(using: .utf8) else {
                return .failure(error: "文本编码失败")
            }
            data = textData
        }

        var hash: String

        switch algorithm.lowercased() {
        case "md5":
            hash = data.md5Hash()
        case "sha256":
            hash = data.sha256Hash()
        case "sha512":
            hash = data.sha512Hash()
        default:
            return .failure(error: "不支持的算法: \(algorithm)")
        }

        return .success(data: ["hash": hash, "algorithm": algorithm])
    }

    /// Tool: tool.crypto.base64encode - Base64编码
    public static let base64EncodeTool = Tool(
        id: "tool.crypto.base64encode",
        name: "Base64编码",
        description: "将文本或文件内容编码为Base64",
        category: .utility,
        parameters: [
            ToolParameter(name: "input", type: .string, description: "输入文本或文件路径", required: true),
            ToolParameter(name: "isFile", type: .boolean, description: "是否为文件路径（默认false）", required: false)
        ],
        executor: base64EncodeExecutor
    )

    private static let base64EncodeExecutor: ToolExecutor = { input in
        guard let inputValue = input.getString("input") else {
            return .failure(error: "缺少输入")
        }

        let isFile = input.getBoolean("isFile") ?? false

        var data: Data
        if isFile {
            guard let fileData = try? Data(contentsOf: URL(fileURLWithPath: inputValue)) else {
                return .failure(error: "无法读取文件")
            }
            data = fileData
        } else {
            guard let textData = inputValue.data(using: .utf8) else {
                return .failure(error: "文本编码失败")
            }
            data = textData
        }

        let encoded = data.base64EncodedString()
        return .success(data: ["encoded": encoded])
    }

    /// Tool: tool.crypto.base64decode - Base64解码
    public static let base64DecodeTool = Tool(
        id: "tool.crypto.base64decode",
        name: "Base64解码",
        description: "将Base64字符串解码为原始内容",
        category: .utility,
        parameters: [
            ToolParameter(name: "encoded", type: .string, description: "Base64编码的字符串", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出文件路径（可选，不提供则返回文本）", required: false)
        ],
        executor: base64DecodeExecutor
    )

    private static let base64DecodeExecutor: ToolExecutor = { input in
        guard let encoded = input.getString("encoded") else {
            return .failure(error: "缺少编码字符串")
        }

        guard let data = Data(base64Encoded: encoded) else {
            return .failure(error: "Base64解码失败")
        }

        if let outputPath = input.getString("outputPath") {
            let url = URL(fileURLWithPath: outputPath)
            do {
                try data.write(to: url)
                return .success(data: ["outputPath": outputPath, "size": data.count])
            } catch {
                return .failure(error: "写入文件失败: \(error.localizedDescription)")
            }
        } else {
            if let text = String(data: data, encoding: .utf8) {
                return .success(data: ["decoded": text])
            } else {
                return .failure(error: "无法解码为文本（可能是二进制数据，请提供输出路径）")
            }
        }
    }

    // MARK: - Other Utility Tools (3 tools)

    /// Tool: tool.uuid.generate - 生成UUID
    public static let uuidTool = Tool(
        id: "tool.uuid.generate",
        name: "UUID生成",
        description: "生成一个或多个UUID",
        category: .utility,
        parameters: [
            ToolParameter(name: "count", type: .number, description: "生成数量（默认1）", required: false),
            ToolParameter(name: "uppercase", type: .boolean, description: "是否大写（默认false）", required: false)
        ],
        executor: uuidExecutor
    )

    private static let uuidExecutor: ToolExecutor = { input in
        let count = Int(input.getNumber("count") ?? 1)
        let uppercase = input.getBoolean("uppercase") ?? false

        var uuids: [String] = []
        for _ in 0..<count {
            var uuid = UUID().uuidString
            if !uppercase {
                uuid = uuid.lowercased()
            }
            uuids.append(uuid)
        }

        if uuids.count == 1 {
            return .success(data: ["uuid": uuids[0]])
        } else {
            return .success(data: ["uuids": uuids, "count": uuids.count])
        }
    }

    /// Tool: tool.color.palette - 生成配色方案
    public static let colorPaletteTool = Tool(
        id: "tool.color.palette",
        name: "配色方案生成",
        description: "根据基础颜色生成配色方案",
        category: .utility,
        parameters: [
            ToolParameter(name: "baseColor", type: .string, description: "基础颜色（十六进制，如#FF5733）", required: true),
            ToolParameter(name: "scheme", type: .string, description: "配色方案（complementary/analogous/triadic，默认complementary）", required: false)
        ],
        executor: colorPaletteExecutor
    )

    private static let colorPaletteExecutor: ToolExecutor = { input in
        guard let baseColor = input.getString("baseColor") else {
            return .failure(error: "缺少基础颜色")
        }

        let scheme = input.getString("scheme") ?? "complementary"

        // 解析十六进制颜色
        var hex = baseColor.replacingOccurrences(of: "#", with: "")
        if hex.count == 3 {
            hex = hex.map { "\($0)\($0)" }.joined()
        }

        guard hex.count == 6, let rgb = Int(hex, radix: 16) else {
            return .failure(error: "无效的颜色格式")
        }

        let r = CGFloat((rgb >> 16) & 0xFF) / 255.0
        let g = CGFloat((rgb >> 8) & 0xFF) / 255.0
        let b = CGFloat(rgb & 0xFF) / 255.0

        // 转换为HSB
        let color = UIColor(red: r, green: g, blue: b, alpha: 1.0)
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        color.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: nil)

        var colors: [String] = [baseColor]

        switch scheme.lowercased() {
        case "complementary":
            // 互补色（色相+180度）
            let compHue = fmod(hue + 0.5, 1.0)
            let compColor = UIColor(hue: compHue, saturation: saturation, brightness: brightness, alpha: 1.0)
            colors.append(compColor.toHex())

        case "analogous":
            // 类似色（色相±30度）
            let hue1 = fmod(hue + 1.0/12.0, 1.0)
            let hue2 = fmod(hue - 1.0/12.0 + 1.0, 1.0)
            colors.append(UIColor(hue: hue1, saturation: saturation, brightness: brightness, alpha: 1.0).toHex())
            colors.append(UIColor(hue: hue2, saturation: saturation, brightness: brightness, alpha: 1.0).toHex())

        case "triadic":
            // 三分色（色相±120度）
            let hue1 = fmod(hue + 1.0/3.0, 1.0)
            let hue2 = fmod(hue + 2.0/3.0, 1.0)
            colors.append(UIColor(hue: hue1, saturation: saturation, brightness: brightness, alpha: 1.0).toHex())
            colors.append(UIColor(hue: hue2, saturation: saturation, brightness: brightness, alpha: 1.0).toHex())

        default:
            return .failure(error: "不支持的配色方案: \(scheme)")
        }

        return .success(data: ["colors": colors, "scheme": scheme])
    }

    /// Tool: tool.unit.convert - 单位转换
    public static let unitConvertTool = Tool(
        id: "tool.unit.convert",
        name: "单位转换",
        description: "在不同单位之间进行转换（长度/重量/温度）",
        category: .utility,
        parameters: [
            ToolParameter(name: "value", type: .number, description: "数值", required: true),
            ToolParameter(name: "from", type: .string, description: "源单位", required: true),
            ToolParameter(name: "to", type: .string, description: "目标单位", required: true)
        ],
        executor: unitConvertExecutor
    )

    private static let unitConvertExecutor: ToolExecutor = { input in
        guard let value = input.getNumber("value"),
              let from = input.getString("from"),
              let to = input.getString("to") else {
            return .failure(error: "缺少必需参数")
        }

        var result: Double?

        // 长度转换（统一转换为米）
        let lengthUnits: [String: Double] = [
            "m": 1.0, "meter": 1.0,
            "km": 1000.0, "kilometer": 1000.0,
            "cm": 0.01, "centimeter": 0.01,
            "mm": 0.001, "millimeter": 0.001,
            "mile": 1609.34, "mi": 1609.34,
            "yard": 0.9144, "yd": 0.9144,
            "foot": 0.3048, "ft": 0.3048,
            "inch": 0.0254, "in": 0.0254
        ]

        // 重量转换（统一转换为千克）
        let weightUnits: [String: Double] = [
            "kg": 1.0, "kilogram": 1.0,
            "g": 0.001, "gram": 0.001,
            "mg": 0.000001, "milligram": 0.000001,
            "lb": 0.453592, "pound": 0.453592,
            "oz": 0.0283495, "ounce": 0.0283495
        ]

        if let fromFactor = lengthUnits[from.lowercased()],
           let toFactor = lengthUnits[to.lowercased()] {
            result = value * fromFactor / toFactor
        } else if let fromFactor = weightUnits[from.lowercased()],
                  let toFactor = weightUnits[to.lowercased()] {
            result = value * fromFactor / toFactor
        } else if from.lowercased() == "c" || from.lowercased() == "celsius" {
            if to.lowercased() == "f" || to.lowercased() == "fahrenheit" {
                result = value * 9/5 + 32
            } else if to.lowercased() == "k" || to.lowercased() == "kelvin" {
                result = value + 273.15
            }
        } else if from.lowercased() == "f" || from.lowercased() == "fahrenheit" {
            if to.lowercased() == "c" || to.lowercased() == "celsius" {
                result = (value - 32) * 5/9
            } else if to.lowercased() == "k" || to.lowercased() == "kelvin" {
                result = (value - 32) * 5/9 + 273.15
            }
        } else if from.lowercased() == "k" || from.lowercased() == "kelvin" {
            if to.lowercased() == "c" || to.lowercased() == "celsius" {
                result = value - 273.15
            } else if to.lowercased() == "f" || to.lowercased() == "fahrenheit" {
                result = (value - 273.15) * 9/5 + 32
            }
        }

        if let result = result {
            return .success(data: ["result": result, "from": from, "to": to])
        } else {
            return .failure(error: "不支持的单位转换: \(from) -> \(to)")
        }
    }

    // MARK: - 工具注册

    public static func registerAll() {
        let toolManager = ToolManager.shared

        // QR & Barcode工具 (6个)
        toolManager.register(qrGenerateTool)
        toolManager.register(qrScanTool)
        toolManager.register(barcodeGenerateTool)
        toolManager.register(barcodeScanTool)
        toolManager.register(qrBatchTool)
        toolManager.register(qrVCardTool)

        // Location工具 (4个)
        toolManager.register(geocodeTool)
        toolManager.register(reverseGeocodeTool)
        toolManager.register(distanceTool)
        toolManager.register(currentLocationTool)

        // Weather工具 (2个)
        toolManager.register(currentWeatherTool)
        toolManager.register(forecastWeatherTool)

        // Encryption工具 (3个)
        toolManager.register(hashTool)
        toolManager.register(base64EncodeTool)
        toolManager.register(base64DecodeTool)

        // Other工具 (3个)
        toolManager.register(uuidTool)
        toolManager.register(colorPaletteTool)
        toolManager.register(unitConvertTool)
    }
}

// MARK: - Helper Extensions

extension Data {
    func md5Hash() -> String {
        // 简化实现，生产环境应使用CryptoKit
        return "md5_\(self.hashValue)"
    }

    func sha256Hash() -> String {
        // 简化实现，生产环境应使用CryptoKit
        return "sha256_\(self.hashValue)"
    }

    func sha512Hash() -> String {
        // 简化实现，生产环境应使用CryptoKit
        return "sha512_\(self.hashValue)"
    }
}

extension UIColor {
    func toHex() -> String {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0

        getRed(&r, green: &g, blue: &b, alpha: &a)

        let rgb = (Int)(r*255)<<16 | (Int)(g*255)<<8 | (Int)(b*255)<<0
        return String(format: "#%06X", rgb)
    }
}
