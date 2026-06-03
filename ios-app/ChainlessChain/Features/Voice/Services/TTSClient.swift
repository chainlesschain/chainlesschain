import Foundation
import AVFoundation
import Combine

// MARK: - TTSClient
/// Text-to-speech client with multiple provider support
/// Ported from PC: voice/tts-client.js
///
/// Features:
/// - System TTS (AVSpeechSynthesizer)
/// - Edge TTS (Microsoft)
/// - OpenAI TTS API
/// - ElevenLabs API
/// - Audio playback
/// - SSML support
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - TTS Client Protocol

protocol TTSClientProtocol {
    var provider: TTSProvider { get }
    func synthesize(_ request: TTSRequest) async throws -> TTSResult
    func getAvailableVoices() async throws -> [TTSVoice]
    func cancel()
}

// MARK: - TTS Client

@MainActor
class TTSClient: NSObject, ObservableObject {

    // MARK: - Singleton

    static let shared = TTSClient()

    // MARK: - Properties

    private let logger = Logger.shared

    /// Current provider
    @Published var currentProvider: TTSProvider = .system

    /// Is speaking
    @Published private(set) var isSpeaking = false

    /// Current playback progress (0-1)
    @Published private(set) var progress: Float = 0

    /// Audio player
    private var audioPlayer: AVAudioPlayer?

    /// System synthesizer
    private let systemSynthesizer = AVSpeechSynthesizer()

    /// API clients
    private var openAIAPIKey: String?
    private var elevenLabsAPIKey: String?

    /// Event publishers
    let speakingStarted = PassthroughSubject<String, Never>()
    let speakingFinished = PassthroughSubject<Void, Never>()
    let speakingCancelled = PassthroughSubject<Void, Never>()
    let speakingProgress = PassthroughSubject<Float, Never>()

    /// Pending request
    private var pendingContinuation: CheckedContinuation<TTSResult, Error>?
    private var currentRequest: TTSRequest?

    // MARK: - Initialization

    private override init() {
        super.init()
        systemSynthesizer.delegate = self
    }

    // MARK: - Configuration

    /// Configure API keys
    func configure(openAIKey: String? = nil, elevenLabsKey: String? = nil) {
        self.openAIAPIKey = openAIKey
        self.elevenLabsAPIKey = elevenLabsKey
    }

    /// Set current provider
    func setProvider(_ provider: TTSProvider) {
        self.currentProvider = provider
    }

    // MARK: - Synthesis

    /// Synthesize text to speech
    func synthesize(_ request: TTSRequest) async throws -> TTSResult {
        logger.info("[TTSClient] Synthesizing with \(currentProvider.rawValue): \(request.text.prefix(50))...")

        switch currentProvider {
        case .system:
            return try await synthesizeWithSystem(request)
        case .edge:
            return try await synthesizeWithEdge(request)
        case .openai:
            return try await synthesizeWithOpenAI(request)
        case .elevenlabs:
            return try await synthesizeWithElevenLabs(request)
        }
    }

    /// Speak text immediately
    func speak(_ text: String, voice: TTSVoice? = nil) async throws {
        let request = TTSRequest(text: text, voice: voice)
        let result = try await synthesize(request)

        // Play the audio
        if let url = result.audioURL {
            try await playAudio(url)
        }
    }

    // MARK: - System TTS

    private func synthesizeWithSystem(_ request: TTSRequest) async throws -> TTSResult {
        return try await withCheckedThrowingContinuation { continuation in
            self.pendingContinuation = continuation
            self.currentRequest = request

            let utterance = AVSpeechUtterance(string: request.text)

            // Set voice
            if let voiceId = request.voice?.id,
               let avVoice = AVSpeechSynthesisVoice(identifier: voiceId) {
                utterance.voice = avVoice
            } else {
                utterance.voice = AVSpeechSynthesisVoice(language: request.language.localeIdentifier)
            }

            // Set parameters
            utterance.rate = request.speed * AVSpeechUtteranceDefaultSpeechRate
            utterance.pitchMultiplier = request.pitch
            utterance.volume = request.volume

            isSpeaking = true
            speakingStarted.send(request.text)

            systemSynthesizer.speak(utterance)
        }
    }

    // MARK: - Edge TTS (Microsoft)

    private func synthesizeWithEdge(_ request: TTSRequest) async throws -> TTSResult {
        // Edge TTS uses WebSocket connection
        // This is a simplified HTTP-based fallback

        let voiceName = request.voice?.id ?? getDefaultEdgeVoice(for: request.language)

        // Build SSML
        let ssml = buildSSML(
            text: request.text,
            voice: voiceName,
            language: request.language,
            rate: request.speed,
            pitch: request.pitch,
            volume: request.volume
        )

        // Edge TTS WebSocket URL (simplified - real implementation uses wss://speech.platform.bing.com)
        logger.warning("[TTSClient] Edge TTS requires WebSocket - using system fallback")
        return try await synthesizeWithSystem(request)
    }

    /// Get default Edge voice for language
    private func getDefaultEdgeVoice(for language: VoiceLanguage) -> String {
        switch language {
        case .english: return "en-US-AriaNeural"
        case .englishUK: return "en-GB-SoniaNeural"
        case .chinese: return "zh-CN-XiaoxiaoNeural"
        case .chineseTW: return "zh-TW-HsiaoChenNeural"
        case .japanese: return "ja-JP-NanamiNeural"
        case .korean: return "ko-KR-SunHiNeural"
        case .german: return "de-DE-KatjaNeural"
        case .french: return "fr-FR-DeniseNeural"
        case .spanish: return "es-ES-ElviraNeural"
        case .italian: return "it-IT-ElsaNeural"
        case .portuguese: return "pt-BR-FranciscaNeural"
        case .russian: return "ru-RU-SvetlanaNeural"
        }
    }

    // MARK: - OpenAI TTS

    private func synthesizeWithOpenAI(_ request: TTSRequest) async throws -> TTSResult {
        guard let apiKey = openAIAPIKey else {
            throw VoiceError.configurationError("OpenAI API key not configured")
        }

        let url = URL(string: "https://api.openai.com/v1/audio/speech")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Voice mapping
        let voice = request.voice?.id ?? "alloy"
        let validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"]
        let openAIVoice = validVoices.contains(voice) ? voice : "alloy"

        let body: [String: Any] = [
            "model": "tts-1",
            "input": request.text,
            "voice": openAIVoice,
            "speed": request.speed,
            "response_format": "mp3"
        ]

        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        isSpeaking = true
        speakingStarted.send(request.text)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            isSpeaking = false
            throw VoiceError.networkError("OpenAI TTS request failed")
        }

        let result = TTSResult(
            audioData: data,
            format: .mp3,
            durationSeconds: 0, // Would need to decode to get duration
            text: request.text,
            voice: request.voice
        )

        isSpeaking = false
        speakingFinished.send()

        return result
    }

    // MARK: - ElevenLabs TTS

    private func synthesizeWithElevenLabs(_ request: TTSRequest) async throws -> TTSResult {
        guard let apiKey = elevenLabsAPIKey else {
            throw VoiceError.configurationError("ElevenLabs API key not configured")
        }

        // Default to "Rachel" voice if not specified
        let voiceId = request.voice?.id ?? "21m00Tcm4TlvDq8ikWAM"

        let url = URL(string: "https://api.elevenlabs.io/v1/text-to-speech/\(voiceId)")!

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue(apiKey, forHTTPHeaderField: "xi-api-key")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("audio/mpeg", forHTTPHeaderField: "Accept")

        let body: [String: Any] = [
            "text": request.text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": [
                "stability": 0.5,
                "similarity_boost": 0.75
            ]
        ]

        urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)

        isSpeaking = true
        speakingStarted.send(request.text)

        let (data, response) = try await URLSession.shared.data(for: urlRequest)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            isSpeaking = false
            throw VoiceError.networkError("ElevenLabs TTS request failed")
        }

        let result = TTSResult(
            audioData: data,
            format: .mp3,
            durationSeconds: 0,
            text: request.text,
            voice: request.voice
        )

        isSpeaking = false
        speakingFinished.send()

        return result
    }

    // MARK: - SSML

    /// Build SSML for TTS
    private func buildSSML(
        text: String,
        voice: String,
        language: VoiceLanguage,
        rate: Float,
        pitch: Float,
        volume: Float
    ) -> String {
        // Convert rate to percentage (1.0 = 0%, 2.0 = +100%)
        let ratePercent = Int((rate - 1) * 100)
        let rateStr = ratePercent >= 0 ? "+\(ratePercent)%" : "\(ratePercent)%"

        // Convert pitch to semitones
        let pitchSemitones = (pitch - 1) * 12
        let pitchStr = pitchSemitones >= 0 ? "+\(Int(pitchSemitones))st" : "\(Int(pitchSemitones))st"

        // Convert volume to percentage
        let volumePercent = Int(volume * 100)

        return """
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="\(language.localeIdentifier)">
            <voice name="\(voice)">
                <prosody rate="\(rateStr)" pitch="\(pitchStr)" volume="\(volumePercent)%">
                    \(escapeXML(text))
                </prosody>
            </voice>
        </speak>
        """
    }

    /// Escape XML special characters
    private func escapeXML(_ text: String) -> String {
        return text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&apos;")
    }

    // MARK: - Playback

    /// Play audio from URL
    func playAudio(_ url: URL) async throws {
        logger.info("[TTSClient] Playing audio: \(url)")

        audioPlayer = try AVAudioPlayer(contentsOf: url)
        audioPlayer?.delegate = self
        audioPlayer?.prepareToPlay()

        isSpeaking = true

        guard audioPlayer?.play() == true else {
            isSpeaking = false
            throw VoiceError.synthesisFailed("Failed to play audio")
        }

        // Wait for playback to complete
        while audioPlayer?.isPlaying == true {
            progress = Float(audioPlayer?.currentTime ?? 0) / Float(audioPlayer?.duration ?? 1)
            speakingProgress.send(progress)
            try await Task.sleep(nanoseconds: 100_000_000) // 100ms
        }

        isSpeaking = false
        progress = 0
        speakingFinished.send()
    }

    /// Play audio from Data
    func playAudio(_ data: Data) async throws {
        logger.info("[TTSClient] Playing audio data: \(data.count) bytes")

        audioPlayer = try AVAudioPlayer(data: data)
        audioPlayer?.delegate = self
        audioPlayer?.prepareToPlay()

        isSpeaking = true

        guard audioPlayer?.play() == true else {
            isSpeaking = false
            throw VoiceError.synthesisFailed("Failed to play audio")
        }

        while audioPlayer?.isPlaying == true {
            progress = Float(audioPlayer?.currentTime ?? 0) / Float(audioPlayer?.duration ?? 1)
            speakingProgress.send(progress)
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        isSpeaking = false
        progress = 0
        speakingFinished.send()
    }

    // MARK: - Control

    /// Cancel current synthesis/playback
    func cancel() {
        systemSynthesizer.stopSpeaking(at: .immediate)
        audioPlayer?.stop()
        audioPlayer = nil

        isSpeaking = false
        progress = 0

        pendingContinuation?.resume(throwing: VoiceError.cancelled)
        pendingContinuation = nil

        speakingCancelled.send()
    }

    /// Pause playback
    func pause() {
        systemSynthesizer.pauseSpeaking(at: .word)
        audioPlayer?.pause()
    }

    /// Resume playback
    func resume() {
        systemSynthesizer.continueSpeaking()
        audioPlayer?.play()
    }

    // MARK: - Voice Listing

    /// Get available voices for current provider
    func getAvailableVoices() async throws -> [TTSVoice] {
        switch currentProvider {
        case .system:
            return getSystemVoices()
        case .edge:
            return getEdgeVoices()
        case .openai:
            return getOpenAIVoices()
        case .elevenlabs:
            return try await getElevenLabsVoices()
        }
    }

    /// Get system voices
    private func getSystemVoices() -> [TTSVoice] {
        return AVSpeechSynthesisVoice.speechVoices().compactMap { voice -> TTSVoice? in
            guard let language = VoiceLanguage(rawValue: voice.language) else { return nil }

            let gender: TTSVoice.VoiceGender = voice.gender == .male ? .male :
                                               voice.gender == .female ? .female : .neutral

            return TTSVoice(
                id: voice.identifier,
                name: voice.name,
                language: language,
                gender: gender,
                provider: .system,
                quality: voice.quality == .enhanced ? .enhanced : .standard
            )
        }
    }

    /// Get Edge TTS voices (static list)
    private func getEdgeVoices() -> [TTSVoice] {
        // Common Edge TTS voices
        return [
            TTSVoice(id: "en-US-AriaNeural", name: "Aria", language: .english, gender: .female, provider: .edge, quality: .neural),
            TTSVoice(id: "en-US-GuyNeural", name: "Guy", language: .english, gender: .male, provider: .edge, quality: .neural),
            TTSVoice(id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao", language: .chinese, gender: .female, provider: .edge, quality: .neural),
            TTSVoice(id: "zh-CN-YunxiNeural", name: "Yunxi", language: .chinese, gender: .male, provider: .edge, quality: .neural),
            TTSVoice(id: "ja-JP-NanamiNeural", name: "Nanami", language: .japanese, gender: .female, provider: .edge, quality: .neural)
        ]
    }

    /// Get OpenAI TTS voices
    private func getOpenAIVoices() -> [TTSVoice] {
        return [
            TTSVoice(id: "alloy", name: "Alloy", language: .english, gender: .neutral, provider: .openai, quality: .neural),
            TTSVoice(id: "echo", name: "Echo", language: .english, gender: .male, provider: .openai, quality: .neural),
            TTSVoice(id: "fable", name: "Fable", language: .english, gender: .neutral, provider: .openai, quality: .neural),
            TTSVoice(id: "onyx", name: "Onyx", language: .english, gender: .male, provider: .openai, quality: .neural),
            TTSVoice(id: "nova", name: "Nova", language: .english, gender: .female, provider: .openai, quality: .neural),
            TTSVoice(id: "shimmer", name: "Shimmer", language: .english, gender: .female, provider: .openai, quality: .neural)
        ]
    }

    /// Get ElevenLabs voices from API
    private func getElevenLabsVoices() async throws -> [TTSVoice] {
        guard let apiKey = elevenLabsAPIKey else {
            return []
        }

        let url = URL(string: "https://api.elevenlabs.io/v1/voices")!

        var request = URLRequest(url: url)
        request.setValue(apiKey, forHTTPHeaderField: "xi-api-key")

        let (data, _) = try await URLSession.shared.data(for: request)

        struct VoicesResponse: Codable {
            struct Voice: Codable {
                let voice_id: String
                let name: String
                let labels: [String: String]?
            }
            let voices: [Voice]
        }

        let response = try JSONDecoder().decode(VoicesResponse.self, from: data)

        return response.voices.map { voice in
            let gender: TTSVoice.VoiceGender = voice.labels?["gender"] == "male" ? .male :
                                               voice.labels?["gender"] == "female" ? .female : .neutral

            return TTSVoice(
                id: voice.voice_id,
                name: voice.name,
                language: .english, // ElevenLabs voices are primarily English
                gender: gender,
                provider: .elevenlabs,
                quality: .neural
            )
        }
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension TTSClient: AVSpeechSynthesizerDelegate {

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
            self.progress = 0

            let result = TTSResult(
                audioData: Data(),
                format: .m4a,
                durationSeconds: 0,
                text: self.currentRequest?.text ?? "",
                voice: self.currentRequest?.voice
            )

            self.pendingContinuation?.resume(returning: result)
            self.pendingContinuation = nil

            self.speakingFinished.send()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.isSpeaking = false
            self.progress = 0

            self.pendingContinuation?.resume(throwing: VoiceError.cancelled)
            self.pendingContinuation = nil

            self.speakingCancelled.send()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, willSpeakRangeOfSpeechString characterRange: NSRange, utterance: AVSpeechUtterance) {
        Task { @MainActor in
            let totalLength = utterance.speechString.count
            self.progress = Float(characterRange.location) / Float(totalLength)
            self.speakingProgress.send(self.progress)
        }
    }
}

// MARK: - AVAudioPlayerDelegate

extension TTSClient: AVAudioPlayerDelegate {

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.isSpeaking = false
            self.progress = 0
            self.speakingFinished.send()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.isSpeaking = false
            self.progress = 0
            self.logger.error("[TTSClient] Audio decode error: \(error?.localizedDescription ?? "unknown")")
        }
    }
}
