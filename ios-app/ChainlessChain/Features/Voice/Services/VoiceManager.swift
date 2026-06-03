import Foundation
import AVFoundation
import Speech
import Combine

// MARK: - VoiceManager
/// Central manager for voice processing operations
/// Ported from PC: voice/voice-manager.js
///
/// Features:
/// - Speech recognition (STT)
/// - Text-to-speech (TTS)
/// - Voice activity detection
/// - Multi-provider support
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Voice Manager Delegate

protocol VoiceManagerDelegate: AnyObject {
    func voiceManager(_ manager: VoiceManager, didChangeState state: VoiceState)
    func voiceManager(_ manager: VoiceManager, didReceiveTranscription result: TranscriptionResult)
    func voiceManager(_ manager: VoiceManager, didDetectVoiceActivity isActive: Bool)
    func voiceManager(_ manager: VoiceManager, didEncounterError error: VoiceError)
    func voiceManager(_ manager: VoiceManager, didCompleteSynthesis result: TTSResult)
}

// MARK: - Voice Manager

@MainActor
class VoiceManager: NSObject, ObservableObject {

    // MARK: - Singleton

    static let shared = VoiceManager()

    // MARK: - Properties

    private let logger = Logger.shared

    /// Current configuration
    @Published var configuration: VoiceConfiguration

    /// Current state
    @Published private(set) var state: VoiceState = .idle

    /// Current session
    @Published private(set) var currentSession: VoiceSession?

    /// Available voices
    @Published private(set) var availableVoices: [TTSVoice] = []

    /// Statistics
    @Published private(set) var statistics = VoiceStatistics()

    /// Audio engine
    private var audioEngine: AVAudioEngine?
    private var audioSession: AVAudioSession?

    /// Speech recognition
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    /// TTS
    private let synthesizer = AVSpeechSynthesizer()

    /// Audio processing
    private let audioProcessor = AudioProcessor()

    /// Delegate
    weak var delegate: VoiceManagerDelegate?

    /// Event publishers
    let stateChanged = PassthroughSubject<VoiceState, Never>()
    let transcriptionReceived = PassthroughSubject<TranscriptionResult, Never>()
    let voiceActivityDetected = PassthroughSubject<Bool, Never>()

    /// Internal state
    private var isAuthorized = false
    private var recordedBuffers: [AudioBuffer] = []
    private var silenceTimer: Timer?
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    private override init() {
        self.configuration = VoiceConfiguration()
        super.init()

        setupSynthesizer()
        loadAvailableVoices()
    }

    private func setupSynthesizer() {
        synthesizer.delegate = self
    }

    // MARK: - Authorization

    /// Request microphone and speech recognition permissions
    func requestAuthorization() async throws {
        logger.info("[VoiceManager] Requesting authorization")

        // Request microphone permission
        let micStatus = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }

        guard micStatus else {
            throw VoiceError.notAuthorized
        }

        // Request speech recognition permission
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }

        guard speechStatus else {
            throw VoiceError.notAuthorized
        }

        isAuthorized = true
        logger.info("[VoiceManager] Authorization granted")
    }

    /// Check if authorized
    func checkAuthorization() -> Bool {
        let micStatus = AVAudioSession.sharedInstance().recordPermission == .granted
        let speechStatus = SFSpeechRecognizer.authorizationStatus() == .authorized
        return micStatus && speechStatus
    }

    // MARK: - Speech Recognition

    /// Start listening for speech
    func startListening() async throws {
        guard isAuthorized else {
            try await requestAuthorization()
        }

        guard state == .idle else {
            logger.warning("[VoiceManager] Already listening or processing")
            return
        }

        logger.info("[VoiceManager] Starting speech recognition")

        // Configure audio session
        try configureAudioSession()

        // Initialize speech recognizer
        let locale = Locale(identifier: configuration.language.localeIdentifier)
        speechRecognizer = SFSpeechRecognizer(locale: locale)

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            throw VoiceError.unsupportedLanguage(configuration.language)
        }

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        recognitionRequest?.shouldReportPartialResults = true

        // Start audio engine
        audioEngine = AVAudioEngine()
        guard let engine = audioEngine else {
            throw VoiceError.microphoneUnavailable
        }

        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        // Create session
        currentSession = VoiceSession(language: configuration.language)

        // Install tap for audio buffers
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, time in
            guard let self = self else { return }

            // Send to recognition
            self.recognitionRequest?.append(buffer)

            // Process for VAD
            Task { @MainActor in
                self.processAudioBuffer(buffer)
            }
        }

        // Start recognition task
        recognitionTask = recognizer.recognitionTask(with: recognitionRequest!) { [weak self] result, error in
            Task { @MainActor in
                self?.handleRecognitionResult(result, error: error)
            }
        }

        // Start engine
        engine.prepare()
        try engine.start()

        setState(.listening)
        logger.info("[VoiceManager] Listening started")
    }

    /// Stop listening
    func stopListening() {
        logger.info("[VoiceManager] Stopping speech recognition")

        // Stop audio engine
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)

        // End recognition
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        // Clear timers
        silenceTimer?.invalidate()
        silenceTimer = nil

        // Update session
        if var session = currentSession {
            session.state = .idle
            currentSession = session
        }

        // Cleanup
        recognitionRequest = nil
        recognitionTask = nil
        audioEngine = nil
        recordedBuffers.removeAll()

        setState(.idle)
        logger.info("[VoiceManager] Listening stopped")
    }

    /// Process audio buffer for VAD
    private func processAudioBuffer(_ buffer: AVAudioPCMBuffer) {
        guard configuration.enableVAD else { return }

        // Convert to AudioBuffer
        let audioBuffer = audioProcessor.convertBuffer(buffer)

        // Check voice activity
        let isVoice = audioBuffer.rmsEnergy > configuration.vadThreshold

        if isVoice {
            // Reset silence timer
            silenceTimer?.invalidate()
            silenceTimer = Timer.scheduledTimer(
                withTimeInterval: configuration.silenceTimeout,
                repeats: false
            ) { [weak self] _ in
                Task { @MainActor in
                    self?.handleSilenceTimeout()
                }
            }

            voiceActivityDetected.send(true)
            delegate?.voiceManager(self, didDetectVoiceActivity: true)
        }

        // Store buffer
        recordedBuffers.append(audioBuffer)
    }

    /// Handle recognition result
    private func handleRecognitionResult(_ result: SFSpeechRecognitionResult?, error: Error?) {
        if let error = error {
            logger.error("[VoiceManager] Recognition error: \(error)")
            let voiceError = VoiceError.transcriptionFailed(error.localizedDescription)
            delegate?.voiceManager(self, didEncounterError: voiceError)
            return
        }

        guard let result = result else { return }

        let transcription = TranscriptionResult(
            text: result.bestTranscription.formattedString,
            language: configuration.language,
            confidence: result.bestTranscription.segments.first?.confidence ?? 0,
            words: result.bestTranscription.segments.map { segment in
                TranscribedWord(
                    word: segment.substring,
                    startTime: segment.timestamp,
                    endTime: segment.timestamp + segment.duration,
                    confidence: segment.confidence
                )
            },
            isFinal: result.isFinal
        )

        transcriptionReceived.send(transcription)
        delegate?.voiceManager(self, didReceiveTranscription: transcription)

        if result.isFinal {
            logger.info("[VoiceManager] Final transcription: \(transcription.text)")

            // Update statistics
            let duration = recordedBuffers.reduce(0) { $0 + $1.duration }
            statistics.recordTranscription(
                duration: duration,
                confidence: transcription.confidence
            )

            // Complete session
            if var session = currentSession {
                session.complete(
                    transcription: transcription.text,
                    confidence: transcription.confidence
                )
                currentSession = session
            }
        }
    }

    /// Handle silence timeout
    private func handleSilenceTimeout() {
        logger.info("[VoiceManager] Silence timeout - stopping recognition")
        voiceActivityDetected.send(false)
        delegate?.voiceManager(self, didDetectVoiceActivity: false)
        stopListening()
    }

    // MARK: - Text-to-Speech

    /// Speak text
    func speak(_ text: String, voice: TTSVoice? = nil) async throws -> TTSResult {
        guard !text.isEmpty else {
            throw VoiceError.synthesisFailed("Empty text")
        }

        logger.info("[VoiceManager] Speaking: \(text.prefix(50))...")

        setState(.speaking)

        // Use appropriate provider
        switch configuration.ttsProvider {
        case .system:
            return try await speakWithSystem(text, voice: voice)
        case .edge:
            return try await speakWithEdgeTTS(text, voice: voice)
        case .openai:
            return try await speakWithOpenAI(text, voice: voice)
        case .elevenlabs:
            return try await speakWithElevenLabs(text, voice: voice)
        }
    }

    /// Speak with system TTS
    private func speakWithSystem(_ text: String, voice: TTSVoice?) async throws -> TTSResult {
        return try await withCheckedThrowingContinuation { continuation in
            let utterance = AVSpeechUtterance(string: text)

            // Set voice if available
            if let voiceId = voice?.id,
               let avVoice = AVSpeechSynthesisVoice(identifier: voiceId) {
                utterance.voice = avVoice
            } else {
                utterance.voice = AVSpeechSynthesisVoice(language: configuration.language.localeIdentifier)
            }

            // Configure speech parameters
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * configuration.language == .chinese ? 0.4 : 0.5
            utterance.pitchMultiplier = 1.0
            utterance.volume = 1.0

            // Store continuation for delegate callback
            self.speechContinuation = continuation
            self.currentSpeechText = text
            self.currentSpeechVoice = voice

            synthesizer.speak(utterance)
        }
    }

    private var speechContinuation: CheckedContinuation<TTSResult, Error>?
    private var currentSpeechText: String?
    private var currentSpeechVoice: TTSVoice?

    /// Speak with Edge TTS (Microsoft)
    private func speakWithEdgeTTS(_ text: String, voice: TTSVoice?) async throws -> TTSResult {
        // Edge TTS API endpoint
        let voiceName = voice?.id ?? getDefaultEdgeVoice()

        // Build SSML
        let ssml = """
        <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="\(configuration.language.localeIdentifier)">
            <voice name="\(voiceName)">
                \(text)
            </voice>
        </speak>
        """

        // Note: Edge TTS requires WebSocket connection
        // This is a simplified placeholder - full implementation would use WebSocket
        logger.warning("[VoiceManager] Edge TTS requires WebSocket - falling back to system")
        return try await speakWithSystem(text, voice: voice)
    }

    /// Get default Edge voice for current language
    private func getDefaultEdgeVoice() -> String {
        switch configuration.language {
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

    /// Speak with OpenAI TTS
    private func speakWithOpenAI(_ text: String, voice: TTSVoice?) async throws -> TTSResult {
        // Placeholder - would call OpenAI TTS API
        logger.warning("[VoiceManager] OpenAI TTS not implemented - falling back to system")
        return try await speakWithSystem(text, voice: voice)
    }

    /// Speak with ElevenLabs
    private func speakWithElevenLabs(_ text: String, voice: TTSVoice?) async throws -> TTSResult {
        // Placeholder - would call ElevenLabs API
        logger.warning("[VoiceManager] ElevenLabs TTS not implemented - falling back to system")
        return try await speakWithSystem(text, voice: voice)
    }

    /// Stop speaking
    func stopSpeaking() {
        synthesizer.stopSpeaking(at: .immediate)
        setState(.idle)
    }

    // MARK: - Voice Management

    /// Load available voices
    func loadAvailableVoices() {
        var voices: [TTSVoice] = []

        // System voices
        for voice in AVSpeechSynthesisVoice.speechVoices() {
            if let language = VoiceLanguage(rawValue: voice.language) {
                let gender: TTSVoice.VoiceGender = voice.gender == .male ? .male :
                                                   voice.gender == .female ? .female : .neutral

                let quality: TTSVoice.VoiceQuality = voice.quality == .enhanced ? .enhanced : .standard

                voices.append(TTSVoice(
                    id: voice.identifier,
                    name: voice.name,
                    language: language,
                    gender: gender,
                    provider: .system,
                    quality: quality
                ))
            }
        }

        availableVoices = voices
        logger.info("[VoiceManager] Loaded \(voices.count) available voices")
    }

    /// Get voices for language
    func getVoices(for language: VoiceLanguage) -> [TTSVoice] {
        return availableVoices.filter { $0.language == language }
    }

    // MARK: - Configuration

    /// Update configuration
    func updateConfiguration(_ config: VoiceConfiguration) {
        self.configuration = config

        // Update speech recognizer locale if changed
        if let recognizer = speechRecognizer,
           recognizer.locale.identifier != config.language.localeIdentifier {
            speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: config.language.localeIdentifier))
        }

        logger.info("[VoiceManager] Configuration updated")
    }

    // MARK: - Helpers

    private func configureAudioSession() throws {
        audioSession = AVAudioSession.sharedInstance()

        try audioSession?.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try audioSession?.setActive(true, options: .notifyOthersOnDeactivation)
    }

    private func setState(_ newState: VoiceState) {
        state = newState
        stateChanged.send(newState)
        delegate?.voiceManager(self, didChangeState: newState)
    }

    // MARK: - Cleanup

    func cleanup() {
        stopListening()
        stopSpeaking()
        cancellables.removeAll()
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension VoiceManager: AVSpeechSynthesizerDelegate {

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.logger.info("[VoiceManager] Speech synthesis completed")

            self.setState(.idle)
            self.statistics.recordSynthesis()

            // Create result
            let result = TTSResult(
                audioData: Data(),  // System TTS doesn't provide raw audio
                format: .m4a,
                durationSeconds: 0,
                text: self.currentSpeechText ?? "",
                voice: self.currentSpeechVoice
            )

            self.delegate?.voiceManager(self, didCompleteSynthesis: result)
            self.speechContinuation?.resume(returning: result)
            self.speechContinuation = nil
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.logger.info("[VoiceManager] Speech synthesis cancelled")
            self.setState(.idle)
            self.speechContinuation?.resume(throwing: VoiceError.cancelled)
            self.speechContinuation = nil
        }
    }
}
