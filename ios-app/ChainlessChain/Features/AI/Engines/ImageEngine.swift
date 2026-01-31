import Foundation
import UIKit
import Vision
import CoreImage

/// 图像引擎
///
/// 负责图像处理、OCR、视觉识别等任务
/// 参考：PC端 desktop-app-vue/src/main/ai-engine/engines/image-engine.js
public class ImageEngine: BaseAIEngine {

    public static let shared = ImageEngine()

    // 图像格式
    public enum ImageFormat: String {
        case jpeg = "jpeg"
        case png = "png"
        case heic = "heic"
        case gif = "gif"
        case bmp = "bmp"
        case tiff = "tiff"
    }

    // 图像处理操作
    public enum ImageOperation: String {
        case resize = "resize"
        case crop = "crop"
        case rotate = "rotate"
        case flip = "flip"
        case blur = "blur"
        case sharpen = "sharpen"
        case grayscale = "grayscale"
        case sepia = "sepia"
    }

    private init() {
        super.init(
            type: .image,
            name: "图像引擎",
            description: "处理图像处理、OCR、视觉识别等任务"
        )
    }

    public override var capabilities: [AIEngineCapability] {
        return [
            AIEngineCapability(
                id: "ocr",
                name: "OCR文字识别",
                description: "从图片中识别文字（支持多语言）"
            ),
            AIEngineCapability(
                id: "object_detection",
                name: "物体检测",
                description: "检测图片中的物体和场景"
            ),
            AIEngineCapability(
                id: "face_detection",
                name: "人脸检测",
                description: "检测和识别人脸"
            ),
            AIEngineCapability(
                id: "image_classification",
                name: "图像分类",
                description: "对图像进行分类和标注"
            ),
            AIEngineCapability(
                id: "resize",
                name: "图像缩放",
                description: "调整图像尺寸"
            ),
            AIEngineCapability(
                id: "crop",
                name: "图像裁剪",
                description: "裁剪图像区域"
            ),
            AIEngineCapability(
                id: "filter",
                name: "图像滤镜",
                description: "应用各种图像滤镜效果"
            ),
            AIEngineCapability(
                id: "compress",
                name: "图像压缩",
                description: "压缩图像减小文件大小"
            ),
            AIEngineCapability(
                id: "format_convert",
                name: "格式转换",
                description: "在不同图像格式间转换"
            ),
            AIEngineCapability(
                id: "metadata_extract",
                name: "元数据提取",
                description: "提取图像EXIF等元数据"
            ),
            AIEngineCapability(
                id: "ai_describe",
                name: "AI图像描述",
                description: "使用AI生成图像内容描述"
            )
        ]
    }

    // MARK: - 初始化

    public override func initialize() async throws {
        try await super.initialize()

        // 初始化Vision框架
        Logger.shared.info("图像引擎初始化完成")
    }

    // MARK: - 任务执行

    public override func execute(task: String, parameters: [String: Any]) async throws -> Any {
        guard status != .initializing else {
            throw AIEngineError.notInitialized
        }

        status = .running
        defer { status = .idle }

        Logger.shared.info("图像引擎执行任务: \(task)")

        // 根据任务类型执行不同操作
        switch task {
        case "ocr":
            return try await performOCR(parameters: parameters)

        case "object_detection":
            return try await detectObjects(parameters: parameters)

        case "face_detection":
            return try await detectFaces(parameters: parameters)

        case "classify":
            return try await classifyImage(parameters: parameters)

        case "resize":
            return try await resizeImage(parameters: parameters)

        case "crop":
            return try await cropImage(parameters: parameters)

        case "filter":
            return try await applyFilter(parameters: parameters)

        case "compress":
            return try await compressImage(parameters: parameters)

        case "convert":
            return try await convertFormat(parameters: parameters)

        case "metadata":
            return try await extractMetadata(parameters: parameters)

        case "describe":
            return try await describeImage(parameters: parameters)

        default:
            throw AIEngineError.capabilityNotSupported(task)
        }
    }

    // MARK: - OCR识别

    /// 执行OCR文字识别
    private func performOCR(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        let languages = parameters["languages"] as? [String] ?? ["zh-Hans", "en-US"]
        let recognitionLevel = parameters["recognitionLevel"] as? String ?? "accurate" // fast, accurate

        let image = try loadImage(from: imagePath)

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: AIEngineError.executionFailed("OCR失败: \(error.localizedDescription)"))
                    return
                }

                guard let observations = request.results as? [VNRecognizedTextObservation] else {
                    continuation.resume(throwing: AIEngineError.executionFailed("无法获取OCR结果"))
                    return
                }

                var recognizedTexts: [[String: Any]] = []
                var fullText = ""

                for observation in observations {
                    guard let topCandidate = observation.topCandidates(1).first else { continue }

                    let text = topCandidate.string
                    let confidence = topCandidate.confidence
                    let boundingBox = observation.boundingBox

                    recognizedTexts.append([
                        "text": text,
                        "confidence": confidence,
                        "boundingBox": [
                            "x": boundingBox.origin.x,
                            "y": boundingBox.origin.y,
                            "width": boundingBox.width,
                            "height": boundingBox.height
                        ]
                    ])

                    fullText += text + "\n"
                }

                let result: [String: Any] = [
                    "text": fullText.trimmingCharacters(in: .whitespacesAndNewlines),
                    "details": recognizedTexts,
                    "count": recognizedTexts.count,
                    "languages": languages
                ]

                continuation.resume(returning: result)
            }

            // 配置识别级别
            request.recognitionLevel = recognitionLevel == "fast" ? .fast : .accurate
            request.recognitionLanguages = languages

            // 执行请求
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: AIEngineError.executionFailed("OCR执行失败: \(error.localizedDescription)"))
            }
        }
    }

    // MARK: - 物体检测

    /// 检测图像中的物体
    private func detectObjects(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        let image = try loadImage(from: imagePath)

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeAnimalsRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: AIEngineError.executionFailed("物体检测失败: \(error.localizedDescription)"))
                    return
                }

                guard let observations = request.results as? [VNRecognizedObjectObservation] else {
                    continuation.resume(returning: ["objects": [], "count": 0])
                    return
                }

                let objects = observations.map { observation -> [String: Any] in
                    let label = observation.labels.first?.identifier ?? "unknown"
                    let confidence = observation.labels.first?.confidence ?? 0.0

                    return [
                        "label": label,
                        "confidence": confidence,
                        "boundingBox": [
                            "x": observation.boundingBox.origin.x,
                            "y": observation.boundingBox.origin.y,
                            "width": observation.boundingBox.width,
                            "height": observation.boundingBox.height
                        ]
                    ]
                }

                continuation.resume(returning: [
                    "objects": objects,
                    "count": objects.count
                ])
            }

            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: AIEngineError.executionFailed("物体检测执行失败: \(error.localizedDescription)"))
            }
        }
    }

    // MARK: - 人脸检测

    /// 检测人脸
    private func detectFaces(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        let image = try loadImage(from: imagePath)

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNDetectFaceRectanglesRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: AIEngineError.executionFailed("人脸检测失败: \(error.localizedDescription)"))
                    return
                }

                guard let observations = request.results as? [VNFaceObservation] else {
                    continuation.resume(returning: ["faces": [], "count": 0])
                    return
                }

                let faces = observations.map { observation -> [String: Any] in
                    return [
                        "boundingBox": [
                            "x": observation.boundingBox.origin.x,
                            "y": observation.boundingBox.origin.y,
                            "width": observation.boundingBox.width,
                            "height": observation.boundingBox.height
                        ],
                        "confidence": observation.confidence
                    ]
                }

                continuation.resume(returning: [
                    "faces": faces,
                    "count": faces.count
                ])
            }

            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: AIEngineError.executionFailed("人脸检测执行失败: \(error.localizedDescription)"))
            }
        }
    }

    // MARK: - 图像分类

    /// 对图像进行分类
    private func classifyImage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        let image = try loadImage(from: imagePath)

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNClassifyImageRequest { request, error in
                if let error = error {
                    continuation.resume(throwing: AIEngineError.executionFailed("图像分类失败: \(error.localizedDescription)"))
                    return
                }

                guard let observations = request.results as? [VNClassificationObservation] else {
                    continuation.resume(returning: ["classifications": [], "count": 0])
                    return
                }

                let classifications = observations.prefix(10).map { observation -> [String: Any] in
                    return [
                        "identifier": observation.identifier,
                        "confidence": observation.confidence
                    ]
                }

                continuation.resume(returning: [
                    "classifications": classifications,
                    "count": classifications.count,
                    "topResult": classifications.first ?? [:]
                ])
            }

            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(throwing: AIEngineError.executionFailed("图像分类执行失败: \(error.localizedDescription)"))
            }
        }
    }

    // MARK: - 图像处理

    /// 调整图像大小
    private func resizeImage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String,
              let width = parameters["width"] as? CGFloat,
              let height = parameters["height"] as? CGFloat else {
            throw AIEngineError.invalidParameters("缺少imagePath、width或height参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? imagePath.replacingOccurrences(of: ".", with: "_resized.")

        let image = try loadImage(from: imagePath)
        let newSize = CGSize(width: width, height: height)

        guard let resizedImage = resizeImage(image, to: newSize) else {
            throw AIEngineError.executionFailed("图像缩放失败")
        }

        try saveImage(resizedImage, to: outputPath, format: .png)

        return [
            "outputPath": outputPath,
            "originalSize": ["width": image.width, "height": image.height],
            "newSize": ["width": width, "height": height],
            "success": true
        ]
    }

    /// 裁剪图像
    private func cropImage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String,
              let x = parameters["x"] as? CGFloat,
              let y = parameters["y"] as? CGFloat,
              let width = parameters["width"] as? CGFloat,
              let height = parameters["height"] as? CGFloat else {
            throw AIEngineError.invalidParameters("缺少必要参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? imagePath.replacingOccurrences(of: ".", with: "_cropped.")

        let image = try loadImage(from: imagePath)
        let cropRect = CGRect(x: x, y: y, width: width, height: height)

        guard let croppedImage = image.cropping(to: cropRect) else {
            throw AIEngineError.executionFailed("图像裁剪失败")
        }

        try saveImage(croppedImage, to: outputPath, format: .png)

        return [
            "outputPath": outputPath,
            "cropRect": ["x": x, "y": y, "width": width, "height": height],
            "success": true
        ]
    }

    /// 应用滤镜
    private func applyFilter(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String,
              let filterName = parameters["filter"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath或filter参数")
        }

        let outputPath = parameters["outputPath"] as? String ?? imagePath.replacingOccurrences(of: ".", with: "_filtered.")

        let image = try loadImage(from: imagePath)
        let ciImage = CIImage(cgImage: image)
        let context = CIContext()

        guard let filter = CIFilter(name: filterName) else {
            throw AIEngineError.executionFailed("不支持的滤镜: \(filterName)")
        }

        filter.setValue(ciImage, forKey: kCIInputImageKey)

        guard let outputImage = filter.outputImage,
              let cgImage = context.createCGImage(outputImage, from: outputImage.extent) else {
            throw AIEngineError.executionFailed("滤镜应用失败")
        }

        try saveImage(cgImage, to: outputPath, format: .png)

        return [
            "outputPath": outputPath,
            "filter": filterName,
            "success": true
        ]
    }

    /// 压缩图像
    private func compressImage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        let quality = parameters["quality"] as? CGFloat ?? 0.8
        let outputPath = parameters["outputPath"] as? String ?? imagePath.replacingOccurrences(of: ".", with: "_compressed.")

        let image = try loadImage(from: imagePath)

        guard let uiImage = UIImage(cgImage: image),
              let compressedData = uiImage.jpegData(compressionQuality: quality) else {
            throw AIEngineError.executionFailed("图像压缩失败")
        }

        let fileURL = URL(fileURLWithPath: outputPath)
        try compressedData.write(to: fileURL)

        let originalSize = try FileManager.default.attributesOfItem(atPath: imagePath)[.size] as? Int ?? 0
        let compressedSize = compressedData.count

        return [
            "outputPath": outputPath,
            "originalSize": originalSize,
            "compressedSize": compressedSize,
            "compressionRatio": Double(compressedSize) / Double(originalSize),
            "quality": quality,
            "success": true
        ]
    }

    /// 转换图像格式
    private func convertFormat(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String,
              let formatString = parameters["format"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath或format参数")
        }

        guard let format = ImageFormat(rawValue: formatString.lowercased()) else {
            throw AIEngineError.invalidParameters("不支持的格式: \(formatString)")
        }

        let outputPath = parameters["outputPath"] as? String ?? imagePath.replacingOccurrences(of: "\\.[^.]+$", with: ".\(format.rawValue)", options: .regularExpression)

        let image = try loadImage(from: imagePath)
        try saveImage(image, to: outputPath, format: format)

        return [
            "outputPath": outputPath,
            "format": format.rawValue,
            "success": true
        ]
    }

    // MARK: - 元数据处理

    /// 提取图像元数据
    private func extractMetadata(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        let fileURL = URL(fileURLWithPath: imagePath)
        guard let imageSource = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
              let metadata = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [String: Any] else {
            throw AIEngineError.executionFailed("无法提取元数据")
        }

        return [
            "metadata": metadata,
            "imagePath": imagePath
        ]
    }

    // MARK: - AI增强

    /// 使用AI描述图像内容
    private func describeImage(parameters: [String: Any]) async throws -> [String: Any] {
        guard let imagePath = parameters["imagePath"] as? String else {
            throw AIEngineError.invalidParameters("缺少imagePath参数")
        }

        // 执行图像分类获取基本信息
        let classification = try await classifyImage(parameters: ["imagePath": imagePath])
        let topResults = classification["classifications"] as? [[String: Any]] ?? []

        // 执行OCR提取文字
        let ocrResult = try await performOCR(parameters: ["imagePath": imagePath])
        let ocrText = ocrResult["text"] as? String ?? ""

        // 构建描述
        let topLabels = topResults.prefix(5).compactMap { $0["identifier"] as? String }

        let prompt = """
        请基于以下信息描述这张图片：

        图像分类标签：\(topLabels.joined(separator: ", "))
        图像中的文字：\(ocrText.isEmpty ? "无" : ocrText)

        请用1-2句话描述图片的主要内容、场景和氛围。
        """

        let description = try await generateWithLLM(
            prompt: prompt,
            systemPrompt: "你是一个图像描述专家，擅长用简洁生动的语言描述图片内容。"
        )

        return [
            "description": description,
            "classifications": topLabels,
            "ocrText": ocrText,
            "imagePath": imagePath
        ]
    }

    // MARK: - 辅助方法

    /// 加载图像
    private func loadImage(from path: String) throws -> CGImage {
        let fileURL = URL(fileURLWithPath: path)

        guard let imageSource = CGImageSourceCreateWithURL(fileURL as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
            throw AIEngineError.executionFailed("无法加载图像: \(path)")
        }

        return image
    }

    /// 保存图像
    private func saveImage(_ image: CGImage, to path: String, format: ImageFormat) throws {
        let fileURL = URL(fileURLWithPath: path)

        guard let destination = CGImageDestinationCreateWithURL(
            fileURL as CFURL,
            format.utType as CFString,
            1,
            nil
        ) else {
            throw AIEngineError.executionFailed("无法创建图像目标")
        }

        CGImageDestinationAddImage(destination, image, nil)

        if !CGImageDestinationFinalize(destination) {
            throw AIEngineError.executionFailed("图像保存失败")
        }
    }

    /// 调整图像大小（辅助函数）
    private func resizeImage(_ image: CGImage, to newSize: CGSize) -> CGImage? {
        guard let colorSpace = image.colorSpace,
              let context = CGContext(
                data: nil,
                width: Int(newSize.width),
                height: Int(newSize.height),
                bitsPerComponent: image.bitsPerComponent,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: image.bitmapInfo.rawValue
              ) else {
            return nil
        }

        context.interpolationQuality = .high
        context.draw(image, in: CGRect(origin: .zero, size: newSize))

        return context.makeImage()
    }
}

// MARK: - ImageFormat Extension

extension ImageEngine.ImageFormat {
    var utType: String {
        switch self {
        case .jpeg: return "public.jpeg"
        case .png: return "public.png"
        case .heic: return "public.heic"
        case .gif: return "com.compuserve.gif"
        case .bmp: return "com.microsoft.bmp"
        case .tiff: return "public.tiff"
        }
    }
}
