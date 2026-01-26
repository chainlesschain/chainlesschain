import Foundation
import UIKit
import CoreImage
import AVFoundation

/// 媒体工具集 - 图像、颜色、音频处理
public enum MediaTools {

    // MARK: - 图像处理工具 (10个)

    /// 获取图像信息
    private static let imageInfoTool = Tool(
        id: "tool.image.info",
        name: "图像信息",
        description: "获取图像的详细信息",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true)
        ],
        returnType: .object,
        returnDescription: "图像信息（宽度、高度、格式、大小等）",
        tags: ["image", "info"]
    )

    private static let imageInfoExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath") else {
            return .failure(error: "缺少图像路径")
        }

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图像")
        }

        let fileURL = URL(fileURLWithPath: imagePath)
        let fileSize = (try? FileManager.default.attributesOfItem(atPath: imagePath)[.size] as? Int) ?? 0

        var info: [String: Any] = [:]
        info["width"] = Int(image.size.width * image.scale)
        info["height"] = Int(image.size.height * image.scale)
        info["scale"] = image.scale
        info["orientation"] = image.imageOrientation.rawValue
        info["fileSize"] = fileSize
        info["format"] = fileURL.pathExtension

        return .success(data: info)
    }

    /// 调整图像大小
    private static let imageResizeTool = Tool(
        id: "tool.image.resize",
        name: "调整图像大小",
        description: "调整图像尺寸",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "width", type: .number, description: "目标宽度", required: true),
            ToolParameter(name: "height", type: .number, description: "目标高度", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "resize"]
    )

    private static let imageResizeExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let width = input.getInt("width"),
              let height = input.getInt("height"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图像")
        }

        let targetSize = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: targetSize)

        let resizedImage = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }

        guard let data = resizedImage.jpegData(compressionQuality: 0.9) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 裁剪图像
    private static let imageCropTool = Tool(
        id: "tool.image.crop",
        name: "裁剪图像",
        description: "裁剪图像的指定区域",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "x", type: .number, description: "起始X坐标", required: true),
            ToolParameter(name: "y", type: .number, description: "起始Y坐标", required: true),
            ToolParameter(name: "width", type: .number, description: "裁剪宽度", required: true),
            ToolParameter(name: "height", type: .number, description: "裁剪高度", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "crop"]
    )

    private static let imageCropExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let x = input.getInt("x"),
              let y = input.getInt("y"),
              let width = input.getInt("width"),
              let height = input.getInt("height"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        guard let image = UIImage(contentsOfFile: imagePath),
              let cgImage = image.cgImage else {
            return .failure(error: "无法加载图像")
        }

        let cropRect = CGRect(x: x, y: y, width: width, height: height)

        guard let croppedCGImage = cgImage.cropping(to: cropRect) else {
            return .failure(error: "裁剪失败")
        }

        let croppedImage = UIImage(cgImage: croppedCGImage)

        guard let data = croppedImage.jpegData(compressionQuality: 0.9) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 旋转图像
    private static let imageRotateTool = Tool(
        id: "tool.image.rotate",
        name: "旋转图像",
        description: "旋转图像指定角度",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "degrees", type: .number, description: "旋转角度", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "rotate"]
    )

    private static let imageRotateExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let degrees = input.getDouble("degrees"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图像")
        }

        let radians = degrees * .pi / 180

        let rotatedSize = CGRect(origin: .zero, size: image.size)
            .applying(CGAffineTransform(rotationAngle: radians))
            .integral.size

        let renderer = UIGraphicsImageRenderer(size: rotatedSize)

        let rotatedImage = renderer.image { context in
            context.cgContext.translateBy(x: rotatedSize.width / 2, y: rotatedSize.height / 2)
            context.cgContext.rotate(by: radians)
            image.draw(in: CGRect(
                x: -image.size.width / 2,
                y: -image.size.height / 2,
                width: image.size.width,
                height: image.size.height
            ))
        }

        guard let data = rotatedImage.jpegData(compressionQuality: 0.9) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 图像滤镜
    private static let imageFilterTool = Tool(
        id: "tool.image.filter",
        name: "图像滤镜",
        description: "对图像应用滤镜效果",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "filter", type: .string, description: "滤镜名称", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "filter"]
    )

    private static let imageFilterExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let filterName = input.getString("filter"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        guard let image = UIImage(contentsOfFile: imagePath),
              let ciImage = CIImage(image: image) else {
            return .failure(error: "无法加载图像")
        }

        let context = CIContext()

        // 根据名称选择滤镜
        let filterMap: [String: String] = [
            "sepia": "CISepiaTone",
            "noir": "CIPhotoEffectNoir",
            "chrome": "CIPhotoEffectChrome",
            "fade": "CIPhotoEffectFade",
            "instant": "CIPhotoEffectInstant",
            "mono": "CIPhotoEffectMono",
            "process": "CIPhotoEffectProcess",
            "transfer": "CIPhotoEffectTransfer",
            "blur": "CIGaussianBlur",
            "sharpen": "CISharpenLuminance"
        ]

        guard let ciFilterName = filterMap[filterName.lowercased()],
              let filter = CIFilter(name: ciFilterName) else {
            return .failure(error: "未知滤镜: \(filterName)")
        }

        filter.setValue(ciImage, forKey: kCIInputImageKey)

        guard let outputImage = filter.outputImage,
              let cgImage = context.createCGImage(outputImage, from: outputImage.extent) else {
            return .failure(error: "应用滤镜失败")
        }

        let resultImage = UIImage(cgImage: cgImage)

        guard let data = resultImage.jpegData(compressionQuality: 0.9) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 图像压缩
    private static let imageCompressTool = Tool(
        id: "tool.image.compress",
        name: "图像压缩",
        description: "压缩图像以减小文件大小",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "quality", type: .number, description: "压缩质量(0-1)", required: false, defaultValue: "0.8"),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .object,
        returnDescription: "压缩结果（输出路径、原始大小、压缩后大小）",
        tags: ["image", "compress"]
    )

    private static let imageCompressExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let quality = input.getDouble("quality") ?? 0.8

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图像")
        }

        let originalSize = (try? FileManager.default.attributesOfItem(atPath: imagePath)[.size] as? Int) ?? 0

        guard let data = image.jpegData(compressionQuality: quality) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)

            let compressedSize = data.count
            let compressionRatio = Double(compressedSize) / Double(originalSize)

            return .success(data: [
                "outputPath": outputPath,
                "originalSize": originalSize,
                "compressedSize": compressedSize,
                "compressionRatio": compressionRatio,
                "savedBytes": originalSize - compressedSize
            ])
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 提取图像颜色
    private static let imageColorsTool = Tool(
        id: "tool.image.colors",
        name: "提取图像颜色",
        description: "提取图像的主要颜色",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "count", type: .number, description: "提取颜色数", required: false, defaultValue: "5")
        ],
        returnType: .array,
        returnDescription: "颜色列表（RGB值）",
        tags: ["image", "color"]
    )

    private static let imageColorsExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath") else {
            return .failure(error: "缺少图像路径")
        }

        let count = input.getInt("count") ?? 5

        guard let image = UIImage(contentsOfFile: imagePath),
              let cgImage = image.cgImage else {
            return .failure(error: "无法加载图像")
        }

        // 简单的颜色提取算法（采样）
        let width = cgImage.width
        let height = cgImage.height

        guard let dataProvider = cgImage.dataProvider,
              let data = dataProvider.data,
              let bytes = CFDataGetBytePtr(data) else {
            return .failure(error: "无法读取图像数据")
        }

        var colors: [[String: Int]] = []
        let sampleCount = min(count * 10, 100)
        let step = max(width * height / sampleCount, 1)

        for i in stride(from: 0, to: width * height, by: step) {
            let offset = i * 4
            let r = Int(bytes[offset])
            let g = Int(bytes[offset + 1])
            let b = Int(bytes[offset + 2])

            colors.append(["r": r, "g": g, "b": b])

            if colors.count >= count {
                break
            }
        }

        return .success(data: colors)
    }

    /// 图像水印
    private static let imageWatermarkTool = Tool(
        id: "tool.image.watermark",
        name: "图像水印",
        description: "为图像添加文字水印",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "text", type: .string, description: "水印文字", required: true),
            ToolParameter(name: "position", type: .string, description: "位置(topLeft/topRight/bottomLeft/bottomRight/center)", required: false, defaultValue: "bottomRight"),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "watermark"]
    )

    private static let imageWatermarkExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let text = input.getString("text"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        let position = input.getString("position") ?? "bottomRight"

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图像")
        }

        let renderer = UIGraphicsImageRenderer(size: image.size)

        let watermarkedImage = renderer.image { context in
            image.draw(at: .zero)

            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 20),
                .foregroundColor: UIColor.white.withAlphaComponent(0.7)
            ]

            let textSize = text.size(withAttributes: attributes)
            let padding: CGFloat = 10

            let textOrigin: CGPoint
            switch position {
            case "topLeft":
                textOrigin = CGPoint(x: padding, y: padding)
            case "topRight":
                textOrigin = CGPoint(x: image.size.width - textSize.width - padding, y: padding)
            case "bottomLeft":
                textOrigin = CGPoint(x: padding, y: image.size.height - textSize.height - padding)
            case "bottomRight":
                textOrigin = CGPoint(x: image.size.width - textSize.width - padding, y: image.size.height - textSize.height - padding)
            case "center":
                textOrigin = CGPoint(x: (image.size.width - textSize.width) / 2, y: (image.size.height - textSize.height) / 2)
            default:
                textOrigin = CGPoint(x: image.size.width - textSize.width - padding, y: image.size.height - textSize.height - padding)
            }

            text.draw(at: textOrigin, withAttributes: attributes)
        }

        guard let data = watermarkedImage.jpegData(compressionQuality: 0.9) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 图像格式转换
    private static let imageConvertTool = Tool(
        id: "tool.image.convert",
        name: "格式转换",
        description: "转换图像格式",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "format", type: .string, description: "目标格式(jpeg/png)", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "convert"]
    )

    private static let imageConvertExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let format = input.getString("format"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        guard let image = UIImage(contentsOfFile: imagePath) else {
            return .failure(error: "无法加载图像")
        }

        let data: Data?
        switch format.lowercased() {
        case "jpeg", "jpg":
            data = image.jpegData(compressionQuality: 0.9)
        case "png":
            data = image.pngData()
        default:
            return .failure(error: "不支持的格式: \(format)")
        }

        guard let imageData = data else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try imageData.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    /// 灰度化
    private static let imageGrayscaleTool = Tool(
        id: "tool.image.grayscale",
        name: "灰度化",
        description: "将图像转换为灰度图",
        category: .system,
        parameters: [
            ToolParameter(name: "imagePath", type: .string, description: "图像路径", required: true),
            ToolParameter(name: "outputPath", type: .string, description: "输出路径", required: true)
        ],
        returnType: .string,
        returnDescription: "输出文件路径",
        tags: ["image", "grayscale"]
    )

    private static let imageGrayscaleExecutor: ToolExecutor = { input in
        guard let imagePath = input.getString("imagePath"),
              let outputPath = input.getString("outputPath") else {
            return .failure(error: "缺少必要参数")
        }

        guard let image = UIImage(contentsOfFile: imagePath),
              let ciImage = CIImage(image: image) else {
            return .failure(error: "无法加载图像")
        }

        let context = CIContext()
        let filter = CIFilter(name: "CIPhotoEffectMono")
        filter?.setValue(ciImage, forKey: kCIInputImageKey)

        guard let outputImage = filter?.outputImage,
              let cgImage = context.createCGImage(outputImage, from: outputImage.extent) else {
            return .failure(error: "灰度化失败")
        }

        let resultImage = UIImage(cgImage: cgImage)

        guard let data = resultImage.jpegData(compressionQuality: 0.9) else {
            return .failure(error: "无法生成图像数据")
        }

        let outputURL = URL(fileURLWithPath: outputPath)

        do {
            try data.write(to: outputURL)
            return .success(data: outputPath)
        } catch {
            return .failure(error: "保存失败: \(error.localizedDescription)")
        }
    }

    // MARK: - 颜色工具 (5个)

    /// RGB转HEX
    private static let colorRgbToHexTool = Tool(
        id: "tool.color.rgbtohex",
        name: "RGB转HEX",
        description: "将RGB颜色转换为HEX格式",
        category: .system,
        parameters: [
            ToolParameter(name: "r", type: .number, description: "红色(0-255)", required: true),
            ToolParameter(name: "g", type: .number, description: "绿色(0-255)", required: true),
            ToolParameter(name: "b", type: .number, description: "蓝色(0-255)", required: true)
        ],
        returnType: .string,
        returnDescription: "HEX颜色值",
        tags: ["color", "convert"]
    )

    private static let colorRgbToHexExecutor: ToolExecutor = { input in
        guard let r = input.getInt("r"),
              let g = input.getInt("g"),
              let b = input.getInt("b") else {
            return .failure(error: "缺少RGB参数")
        }

        let hex = String(format: "#%02X%02X%02X", r, g, b)
        return .success(data: hex)
    }

    /// HEX转RGB
    private static let colorHexToRgbTool = Tool(
        id: "tool.color.hextorgb",
        name: "HEX转RGB",
        description: "将HEX颜色转换为RGB格式",
        category: .system,
        parameters: [
            ToolParameter(name: "hex", type: .string, description: "HEX颜色值", required: true)
        ],
        returnType: .object,
        returnDescription: "RGB颜色值",
        tags: ["color", "convert"]
    )

    private static let colorHexToRgbExecutor: ToolExecutor = { input in
        guard let hex = input.getString("hex") else {
            return .failure(error: "缺少HEX参数")
        }

        var hexString = hex.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        if hexString.hasPrefix("#") {
            hexString.remove(at: hexString.startIndex)
        }

        guard hexString.count == 6 else {
            return .failure(error: "无效的HEX颜色值")
        }

        var rgbValue: UInt64 = 0
        Scanner(string: hexString).scanHexInt64(&rgbValue)

        let r = Int((rgbValue & 0xFF0000) >> 16)
        let g = Int((rgbValue & 0x00FF00) >> 8)
        let b = Int(rgbValue & 0x0000FF)

        return .success(data: ["r": r, "g": g, "b": b])
    }

    /// RGB转HSV
    private static let colorRgbToHsvTool = Tool(
        id: "tool.color.rgbtohsv",
        name: "RGB转HSV",
        description: "将RGB颜色转换为HSV格式",
        category: .system,
        parameters: [
            ToolParameter(name: "r", type: .number, description: "红色(0-255)", required: true),
            ToolParameter(name: "g", type: .number, description: "绿色(0-255)", required: true),
            ToolParameter(name: "b", type: .number, description: "蓝色(0-255)", required: true)
        ],
        returnType: .object,
        returnDescription: "HSV颜色值",
        tags: ["color", "convert"]
    )

    private static let colorRgbToHsvExecutor: ToolExecutor = { input in
        guard let r = input.getInt("r"),
              let g = input.getInt("g"),
              let b = input.getInt("b") else {
            return .failure(error: "缺少RGB参数")
        }

        let color = UIColor(red: CGFloat(r) / 255.0, green: CGFloat(g) / 255.0, blue: CGFloat(b) / 255.0, alpha: 1.0)

        var h: CGFloat = 0
        var s: CGFloat = 0
        var v: CGFloat = 0

        color.getHue(&h, saturation: &s, brightness: &v, alpha: nil)

        return .success(data: [
            "h": Int(h * 360),
            "s": Int(s * 100),
            "v": Int(v * 100)
        ])
    }

    /// 颜色亮度
    private static let colorBrightnessTool = Tool(
        id: "tool.color.brightness",
        name: "颜色亮度",
        description: "计算颜色的亮度值",
        category: .system,
        parameters: [
            ToolParameter(name: "r", type: .number, description: "红色(0-255)", required: true),
            ToolParameter(name: "g", type: .number, description: "绿色(0-255)", required: true),
            ToolParameter(name: "b", type: .number, description: "蓝色(0-255)", required: true)
        ],
        returnType: .number,
        returnDescription: "亮度值(0-255)",
        tags: ["color", "brightness"]
    )

    private static let colorBrightnessExecutor: ToolExecutor = { input in
        guard let r = input.getInt("r"),
              let g = input.getInt("g"),
              let b = input.getInt("b") else {
            return .failure(error: "缺少RGB参数")
        }

        // 使用加权平均计算亮度
        let brightness = Int(0.299 * Double(r) + 0.587 * Double(g) + 0.114 * Double(b))
        return .success(data: brightness)
    }

    /// 颜色反转
    private static let colorInvertTool = Tool(
        id: "tool.color.invert",
        name: "颜色反转",
        description: "反转颜色",
        category: .system,
        parameters: [
            ToolParameter(name: "r", type: .number, description: "红色(0-255)", required: true),
            ToolParameter(name: "g", type: .number, description: "绿色(0-255)", required: true),
            ToolParameter(name: "b", type: .number, description: "蓝色(0-255)", required: true)
        ],
        returnType: .object,
        returnDescription: "反转后的RGB值",
        tags: ["color", "invert"]
    )

    private static let colorInvertExecutor: ToolExecutor = { input in
        guard let r = input.getInt("r"),
              let g = input.getInt("g"),
              let b = input.getInt("b") else {
            return .failure(error: "缺少RGB参数")
        }

        return .success(data: [
            "r": 255 - r,
            "g": 255 - g,
            "b": 255 - b
        ])
    }

    // MARK: - 所有媒体工具

    public static var all: [(tool: Tool, executor: ToolExecutor)] {
        return [
            // 图像处理工具 (10)
            (imageInfoTool, imageInfoExecutor),
            (imageResizeTool, imageResizeExecutor),
            (imageCropTool, imageCropExecutor),
            (imageRotateTool, imageRotateExecutor),
            (imageFilterTool, imageFilterExecutor),
            (imageCompressTool, imageCompressExecutor),
            (imageColorsTool, imageColorsExecutor),
            (imageWatermarkTool, imageWatermarkExecutor),
            (imageConvertTool, imageConvertExecutor),
            (imageGrayscaleTool, imageGrayscaleExecutor),

            // 颜色工具 (5)
            (colorRgbToHexTool, colorRgbToHexExecutor),
            (colorHexToRgbTool, colorHexToRgbExecutor),
            (colorRgbToHsvTool, colorRgbToHsvExecutor),
            (colorBrightnessTool, colorBrightnessExecutor),
            (colorInvertTool, colorInvertExecutor)
        ]
    }

    public static var totalCount: Int {
        return all.count
    }
}

/// 工具管理器扩展 - 注册媒体工具
extension ToolManager {
    /// 注册所有媒体工具
    public func registerMediaTools() {
        for (tool, executor) in MediaTools.all {
            register(tool, executor: executor)
        }
        Logger.shared.info("已注册 \(MediaTools.totalCount) 个媒体工具")
    }
}
