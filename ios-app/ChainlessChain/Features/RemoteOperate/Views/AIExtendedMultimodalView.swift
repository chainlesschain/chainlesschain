import SwiftUI
import PhotosUI
import AVFoundation
import CoreP2P
import UniformTypeIdentifiers

/// Phase 6.4 v0.2 — `AIExtendedView` multimodal 子界面（4 mode segmented）。
///
/// - **生图** (generateImage)：text prompt → 桌面 LLM 返 URL / base64 → 显图（最多 4 张）
/// - **OCR** (ocrImage)：PhotosPicker → base64 → 桌面识别文字
/// - **TTS** (textToSpeech)：text → 桌面合成 base64 audio → AVAudioPlayer 播放
/// - **语音转文字** (transcribeAudio)：文件 picker (.fileImporter) → base64 → 桌面识别
///
/// **明确 defer**：实时录音（AVAudioRecorder + NSMicrophoneUsageDescription 权限）
/// 留 v0.3；本版用文件 picker 模式跑通流程，避麦克权限弹窗 + 录音 UI 复杂度。
struct AIExtendedMultimodalView: View {
    @ObservedObject var viewModel: RemoteAIExtendedViewModel

    @State private var photoItem: PhotosPickerItem?
    @State private var audioPlayer: AVAudioPlayer?
    @State private var audioPlaying: Bool = false
    @State private var showAudioPicker: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            modePicker
            Divider()
            ScrollView {
                Group {
                    switch viewModel.multimodalMode {
                    case .generateImage: generateImageSection
                    case .ocrImage: ocrImageSection
                    case .textToSpeech: textToSpeechSection
                    case .transcribeAudio: transcribeAudioSection
                    }
                }
                .padding()
            }
        }
        .fileImporter(
            isPresented: $showAudioPicker,
            allowedContentTypes: [.audio, .mpeg4Audio, .wav, .mp3],
            allowsMultipleSelection: false
        ) { result in
            handleAudioFilePicker(result)
        }
    }

    // MARK: - mode picker (segmented, 4 mode 在 iOS HIG 内)

    private var modePicker: some View {
        Picker("模式", selection: $viewModel.multimodalMode) {
            ForEach(RemoteAIExtendedViewModel.MultimodalMode.allCases) { mode in
                Label(mode.label, systemImage: mode.icon).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal).padding(.vertical, 8)
    }

    // MARK: - generateImage

    private var generateImageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("生成图像").font(.headline)
            Text("用桌面 LLM 文本生图（DALL-E / SD 等）")
                .font(.caption).foregroundColor(.secondary)

            TextField("如：a sleepy orange cat in cyberpunk style", text: $viewModel.imagePrompt, axis: .vertical)
                .lineLimit(2...4)
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(8)

            Button(action: { Task { await viewModel.runGenerateImage() } }) {
                if viewModel.multimodalLoading {
                    ProgressView()
                } else {
                    Label("生成", systemImage: "wand.and.stars")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.multimodalLoading || viewModel.imagePrompt.isEmpty)

            if !viewModel.generatedImages.isEmpty {
                Divider().padding(.vertical, 4)
                Text("结果").font(.caption).foregroundColor(.secondary)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(Array(viewModel.generatedImages.enumerated()), id: \.offset) { _, img in
                        imageView(img)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func imageView(_ img: GeneratedImage) -> some View {
        if let url = img.url, let u = URL(string: url) {
            AsyncImage(url: u) { phase in
                if let i = phase.image {
                    i.resizable().scaledToFit()
                } else if phase.error != nil {
                    Color.red.opacity(0.1)
                        .overlay(Text("加载失败").font(.caption))
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, minHeight: 120)
            .cornerRadius(8)
        } else if let b64 = img.data,
                  let data = Data(base64Encoded: b64),
                  let ui = UIImage(data: data) {
            Image(uiImage: ui)
                .resizable().scaledToFit()
                .frame(maxWidth: .infinity, minHeight: 120)
                .cornerRadius(8)
        } else {
            Color(.systemGray5)
                .frame(maxWidth: .infinity, minHeight: 120)
                .overlay(Text("无可显内容").font(.caption))
                .cornerRadius(8)
        }
    }

    // MARK: - OCR

    private var ocrImageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("图像 OCR").font(.headline)
            Text("从相册选图，桌面识别文字").font(.caption).foregroundColor(.secondary)

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label(viewModel.ocrImageBase64 == nil ? "选择图片" : "已选 ✓ 重选",
                      systemImage: "photo.on.rectangle.angled")
            }
            .buttonStyle(.bordered)
            .onChange(of: photoItem) { newItem in
                Task { await loadPhotoItem(newItem) }
            }

            Picker("语言", selection: $viewModel.ocrLanguage) {
                Text("自动").tag("auto")
                Text("中文").tag("zh")
                Text("英文").tag("en")
                Text("日文").tag("ja")
            }
            .pickerStyle(.menu)

            Button(action: { Task { await viewModel.runOcrImage() } }) {
                if viewModel.multimodalLoading {
                    ProgressView()
                } else {
                    Label("识别", systemImage: "text.viewfinder")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.multimodalLoading || viewModel.ocrImageBase64 == nil)

            if let r = viewModel.ocrResult {
                Divider().padding(.vertical, 4)
                HStack {
                    Text("结果").font(.caption).foregroundColor(.secondary)
                    Spacer()
                    Text("置信度 \(String(format: "%.0f%%", r.confidence * 100))")
                        .font(.caption2)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.green.opacity(0.15))
                        .cornerRadius(4)
                    Text(r.language).font(.caption2).foregroundColor(.blue)
                }
                Text(r.text.isEmpty ? "(空)" : r.text)
                    .font(.body)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .textSelection(.enabled)
            }
        }
    }

    @MainActor
    private func loadPhotoItem(_ item: PhotosPickerItem?) async {
        guard let item = item else { return }
        if let data = try? await item.loadTransferable(type: Data.self) {
            viewModel.ocrImageBase64 = data.base64EncodedString()
        }
    }

    // MARK: - TTS

    private var textToSpeechSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("文字转语音").font(.headline)
            Text("桌面合成 audio → iPhone 播放").font(.caption).foregroundColor(.secondary)

            TextField("输入要朗读的文字", text: $viewModel.ttsInput, axis: .vertical)
                .lineLimit(3...6)
                .padding(8)
                .background(Color(.systemGray6))
                .cornerRadius(8)

            HStack {
                Picker("声音", selection: $viewModel.ttsVoice) {
                    Text("默认").tag("default")
                    Text("Alloy").tag("alloy")
                    Text("Echo").tag("echo")
                    Text("Nova").tag("nova")
                }
                .pickerStyle(.menu)

                Spacer()

                Button(action: {
                    Task { await viewModel.runTextToSpeech() }
                }) {
                    if viewModel.multimodalLoading {
                        ProgressView()
                    } else {
                        Label("合成", systemImage: "speaker.wave.2")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.multimodalLoading || viewModel.ttsInput.isEmpty)
            }

            if let r = viewModel.ttsResult {
                Divider().padding(.vertical, 4)
                HStack {
                    Button(action: { togglePlay(r) }) {
                        Label(audioPlaying ? "暂停" : "播放",
                              systemImage: audioPlaying ? "pause.circle.fill" : "play.circle.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    Spacer()
                    Text("\(r.format) · \(String(format: "%.1fs", r.duration ?? 0))")
                        .font(.caption).foregroundColor(.secondary)
                }
            }
        }
    }

    private func togglePlay(_ r: TTSResponse) {
        if let player = audioPlayer, audioPlaying {
            player.pause()
            audioPlaying = false
            return
        }
        // 重建或继续播
        if audioPlayer == nil {
            guard let data = Data(base64Encoded: r.audioData) else {
                viewModel.errorMessage = "音频 base64 解码失败"
                return
            }
            do {
                let p = try AVAudioPlayer(data: data)
                p.prepareToPlay()
                audioPlayer = p
            } catch {
                viewModel.errorMessage = "AVAudioPlayer 创建失败: \(error)"
                return
            }
        }
        audioPlayer?.play()
        audioPlaying = true
    }

    // MARK: - transcribeAudio

    private var transcribeAudioSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("音频转文字").font(.headline)
            Text("从文件选音频，桌面 Whisper/ASR 识别")
                .font(.caption).foregroundColor(.secondary)
            Text("v0.2 用文件 picker；实时录音（需麦克权限）留 v0.3")
                .font(.caption2).foregroundColor(.orange)

            Button(action: { showAudioPicker = true }) {
                Label(viewModel.audioFilename ?? "选择音频文件",
                      systemImage: "waveform")
            }
            .buttonStyle(.bordered)

            Picker("语言", selection: $viewModel.transcribeLanguage) {
                Text("自动").tag("auto")
                Text("中文").tag("zh")
                Text("英文").tag("en")
            }
            .pickerStyle(.menu)

            Button(action: { Task { await viewModel.runTranscribeAudio() } }) {
                if viewModel.multimodalLoading {
                    ProgressView()
                } else {
                    Label("识别", systemImage: "text.bubble")
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.multimodalLoading || viewModel.audioBase64 == nil)

            if let r = viewModel.transcribeResult {
                Divider().padding(.vertical, 4)
                HStack {
                    Text("结果").font(.caption).foregroundColor(.secondary)
                    Spacer()
                    Text(r.language).font(.caption2).foregroundColor(.blue)
                    if let d = r.duration {
                        Text(String(format: "%.1fs", d)).font(.caption2).foregroundColor(.secondary)
                    }
                }
                Text(r.text.isEmpty ? "(空)" : r.text)
                    .font(.body)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.systemGray6))
                    .cornerRadius(8)
                    .textSelection(.enabled)
            }
        }
    }

    private func handleAudioFilePicker(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            // security-scoped resource 必须 start/stop
            let didStart = url.startAccessingSecurityScopedResource()
            defer { if didStart { url.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: url)
                viewModel.audioBase64 = data.base64EncodedString()
                viewModel.audioFilename = url.lastPathComponent
            } catch {
                viewModel.errorMessage = "读音频失败: \(error)"
            }
        case .failure(let err):
            viewModel.errorMessage = "选音频失败: \(err)"
        }
    }
}
