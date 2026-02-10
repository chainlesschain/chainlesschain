import Foundation
import AVFoundation
import Speech
import Combine

// MARK: - RealtimeVoiceInput
/// Real-time voice input with streaming transcription
/// Ported from PC: voice/realtime-voice-input.js
///
/// Features:
/// - Continuous listening mode
/// - Streaming transcription
/// - Wake word detection
/// - Push-to-talk mode
/// - Audio level monitoring
///
/// Version: v1.7.0
/// Date: 2026-02-10

// MARK: - Input Mode

enum VoiceInputMode: String, Codable, CaseIterable {
    case pushToTalk = "push_to_talk"
    case continuous = "continuous"
    case wakeWord = "wake_word"
    case voiceActivated = "voice_activated"
}

// MARK: - Realtime Voice Input Delegate

protocol RealtimeVoiceInputDelegate: AnyObject {
    func voiceInput(_ input: RealtimeVoiceInput, didStartListening mode: VoiceInputMode)
    func voiceInput(_ input: RealtimeVoiceInput, didStopListening reason: StopReason)
    func voiceInput(_ input: RealtimeVoiceInput, didReceivePartialTranscription text: String)
    func voiceInput(_ input: RealtimeVoiceInput, didReceiveFinalTranscription result: TranscriptionResult)
    func voiceInput(_ input: RealtimeVoiceInput, didUpdateAudioLevel level: Float)
    func voiceInput(_ input: RealtimeVoiceInput, didDetectWakeWord word: String)
    func voiceInput(_ input: RealtimeVoiceInput, didEncounterError error: VoiceError)
}

enum StopReason {
    case userStopped
    case silenceTimeout
    case maxDurationReached
    case error(VoiceError)
    case wakeWordTimeout
}

// MARK: - Realtime Voice Input

@MainActor
class RealtimeVoiceInput: NSObject, ObservableObject {

    // MARK: - Properties

    private let logger = Logger.shared

    /// Input mode
    @Published var mode: VoiceInputMode = .pushToTalk

    /// Is listening
    @Published private(set) var isListening = false

    /// Current audio level (0-1)
    @Published private(set) var audioLevel: Float = 0

    /// Partial transcription
    @Published private(set) var partialTranscription: String = ""

    /// Configuration
    var configuration: VoiceConfiguration

    /// Wake word
    var wakeWord: String = "Hey Assistant"

    /// Delegate
    weak var delegate: RealtimeVoiceInputDelegate?

    /// Publishers
    let partialTranscriptionReceived = PassthroughSubject<String, Never>()
    let finalTranscriptionReceived = PassthroughSubject<TranscriptionResult, Never>()
    let audioLevelUpdated = PassthroughSubject<Float, Never>()
    let wakeWordDetected = PassthroughSubject<String, Never>()

    /// Audio components
    private var audioEngine: AVAudioEngine?
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    /// Audio processor
    private let audioProcessor = AudioProcessor()

    /// State
    private var lastSpeechTime: Date?
    private var silenceTimer: Timer?
    private var maxDurationTimer: Timer?
    private var isWakeWordMode = false
    private var audioBuffers: [AudioBuffer] = []
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init(configuration: VoiceConfiguration = VoiceConfiguration()) {
        self.configuration = configuration
        super.init()
    }

    // MARK: - Listening Control

    /// Start listening
    func startListening() async throws {
        guard !isListening else {
            logger.warning("[RealtimeVoiceInput] Already listening")
            return
        }

        logger.info("[RealtimeVoiceInput] Starting in mode: \(mode.rawValue)")

        // Check permissions
        guard await checkPermissions() else {
            throw VoiceError.notAuthorized
        }

        // Configure audio session
        try configureAudioSession()

        // Initialize speech recognition
        try initializeSpeechRecognition()

        // Start audio engine
        try startAudioEngine()

        isListening = true
        lastSpeechTime = Date()
        partialTranscription = ""

        // Start timers based on mode
        if mode == .continuous || mode == .voiceActivated {
            startSilenceTimer()
        }

        if configuration.maxRecordingDuration > 0 {
            startMaxDurationTimer()
        }

        delegate?.voiceInput(self, didStartListening: mode)

        logger.info("[RealtimeVoiceInput] Listening started")
    }

    /// Stop listening
    func stopListening(reason: StopReason = .userStopped) {
        guard isListening else { return }

        logger.info("[RealtimeVoiceInput] Stopping listening: \(reason)")

        // Stop timers
        silenceTimer?.invalidate()
        silenceTimer = nil
        maxDurationTimer?.invalidate()
        maxDurationTimer = nil

        // Stop audio engine
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)

        // End recognition
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        // Cleanup
        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil
        audioBuffers.removeAll()

        isListening = false
        audioLevel = 0

        delegate?.voiceInput(self, didStopListening: reason)

        logger.info("[RealtimeVoiceInput] Listening stopped")
    }

    /// Toggle listening (for push-to-talk)
    func toggleListening() async throws {
        if isListening {
            stopListening()
        } else {
            try await startListening()
        }
    }

    // MARK: - Wake Word Mode

    /// Start wake word detection
    func startWakeWordDetection() async throws {
        mode = .wakeWord
        isWakeWordMode = true
        try await startListening()
    }

    /// Stop wake word detection
    func stopWakeWordDetection() {
        isWakeWordMode = false
        stopListening(reason: .wakeWordTimeout)
    }

    /// Check for wake word in transcription
    private func checkWakeWord(_ text: String) -> Bool {
        let normalizedText = text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedWakeWord = wakeWord.lowercased()

        return normalizedText.contains(normalizedWakeWord) ||
               levenshteinDistance(normalizedText, normalizedWakeWord) < 3
    }

    /// Simple Levenshtein distance for fuzzy matching
    private func levenshteinDistance(_ s1: String, _ s2: String) -> Int {
        let m = s1.count
        let n = s2.count

        if m == 0 { return n }
        if n == 0 { return m }

        var matrix = [[Int]](repeating: [Int](repeating: 0, count: n + 1), count: m + 1)

        for i in 0...m { matrix[i][0] = i }
        for j in 0...n { matrix[0][j] = j }

        let s1Array = Array(s1)
        let s2Array = Array(s2)

        for i in 1...m {
            for j in 1...n {
                let cost = s1Array[i-1] == s2Array[j-1] ? 0 : 1
                matrix[i][j] = min(
                    matrix[i-1][j] + 1,      // deletion
                    matrix[i][j-1] + 1,      // insertion
                    matrix[i-1][j-1] + cost  // substitution
                )
            }
        }

        return matrix[m][n]
    }

    // MARK: - Audio Session

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()

        try session.setCategory(.playAndRecord, mode: .default, options: [
            .defaultToSpeaker,
            .allowBluetooth,
            .allowBluetoothA2DP,
            .mixWithOthers
        ])

        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Speech Recognition

    private func initializeSpeechRecognition() throws {
        let locale = Locale(identifier: configuration.language.localeIdentifier)
        speechRecognizer = SFSpeechRecognizer(locale: locale)

        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            throw VoiceError.unsupportedLanguage(configuration.language)
        }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        recognitionRequest?.shouldReportPartialResults = true
        recognitionRequest?.taskHint = .dictation

        if #available(iOS 16.0, *) {
            recognitionRequest?.addsPunctuation = true
        }
    }

    private func startAudioEngine() throws {
        audioEngine = AVAudioEngine()

        guard let engine = audioEngine else {
            throw VoiceError.microphoneUnavailable
        }

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // Install tap
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
            guard let self = self else { return }

            // Send to speech recognition
            self.recognitionRequest?.append(buffer)

            // Process audio level
            Task { @MainActor in
                self.processAudioLevel(buffer)
            }
        }

        // Start recognition task
        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest!) { [weak self] result, error in
            Task { @MainActor in
                self?.handleRecognitionResult(result, error: error)
            }
        }

        engine.prepare()
        try engine.start()
    }

    // MARK: - Audio Processing

    private func processAudioLevel(_ buffer: AVAudioPCMBuffer) {
        let audioBuffer = audioProcessor.convertBuffer(buffer)
        let level = audioBuffer.rmsEnergy

        // Smooth the level
        let smoothedLevel = audioLevel * 0.7 + level * 0.3
        audioLevel = min(smoothedLevel, 1.0)

        audioLevelUpdated.send(audioLevel)
        delegate?.voiceInput(self, didUpdateAudioLevel: audioLevel)

        // Check for voice activity
        if configuration.enableVAD {
            let isVoice = level > configuration.vadThreshold

            if isVoice {
                lastSpeechTime = Date()

                // Reset silence timer
                silenceTimer?.invalidate()
                startSilenceTimer()
            }
        }

        // Store buffer
        audioBuffers.append(audioBuffer)

        // Keep only recent buffers (last 30 seconds)
        let maxBuffers = Int(30 * configuration.sampleRate / Double(audioBuffer.samples.count))
        if audioBuffers.count > maxBuffers {
            audioBuffers.removeFirst(audioBuffers.count - maxBuffers)
        }
    }

    // MARK: - Recognition Results

    private func handleRecognitionResult(_ result: SFSpeechRecognitionResult?, error: Error?) {
        if let error = error {
            logger.error("[RealtimeVoiceInput] Recognition error: \(error)")
            delegate?.voiceInput(self, didEncounterError: .transcriptionFailed(error.localizedDescription))
            return
        }

        guard let result = result else { return }

        let text = result.bestTranscription.formattedString

        if result.isFinal {
            // Final result
            let transcription = TranscriptionResult(
                text: text,
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
                isFinal: true
            )

            finalTranscriptionReceived.send(transcription)
            delegate?.voiceInput(self, didReceiveFinalTranscription: transcription)
            partialTranscription = ""

        } else {
            // Partial result
            partialTranscription = text
            partialTranscriptionReceived.send(text)
            delegate?.voiceInput(self, didReceivePartialTranscription: text)

            // Check for wake word in wake word mode
            if isWakeWordMode && checkWakeWord(text) {
                logger.info("[RealtimeVoiceInput] Wake word detected: \(wakeWord)")
                wakeWordDetected.send(wakeWord)
                delegate?.voiceInput(self, didDetectWakeWord: wakeWord)

                // Switch to continuous mode after wake word
                isWakeWordMode = false
                mode = .continuous
            }
        }
    }

    // MARK: - Timers

    private func startSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(
            withTimeInterval: configuration.silenceTimeout,
            repeats: false
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleSilenceTimeout()
            }
        }
    }

    private func startMaxDurationTimer() {
        maxDurationTimer?.invalidate()
        maxDurationTimer = Timer.scheduledTimer(
            withTimeInterval: configuration.maxRecordingDuration,
            repeats: false
        ) { [weak self] _ in
            Task { @MainActor in
                self?.handleMaxDurationReached()
            }
        }
    }

    private func handleSilenceTimeout() {
        logger.info("[RealtimeVoiceInput] Silence timeout")

        if mode == .wakeWord {
            // Keep listening in wake word mode
            startSilenceTimer()
        } else {
            stopListening(reason: .silenceTimeout)
        }
    }

    private func handleMaxDurationReached() {
        logger.info("[RealtimeVoiceInput] Max duration reached")
        stopListening(reason: .maxDurationReached)
    }

    // MARK: - Permissions

    private func checkPermissions() async -> Bool {
        // Check microphone
        let micStatus = AVAudioSession.sharedInstance().recordPermission
        if micStatus == .undetermined {
            return await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }

        guard micStatus == .granted else { return false }

        // Check speech recognition
        let speechStatus = SFSpeechRecognizer.authorizationStatus()
        if speechStatus == .notDetermined {
            return await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status == .authorized)
                }
            }
        }

        return speechStatus == .authorized
    }

    // MARK: - Audio Data Export

    /// Get recorded audio data
    func getRecordedAudio() -> AudioBuffer? {
        guard !audioBuffers.isEmpty else { return nil }

        // Combine all buffers
        var allSamples: [Float] = []
        for buffer in audioBuffers {
            allSamples.append(contentsOf: buffer.samples)
        }

        return AudioBuffer(
            samples: allSamples,
            sampleRate: configuration.sampleRate,
            channels: 1
        )
    }

    // MARK: - Cleanup

    func cleanup() {
        stopListening()
        cancellables.removeAll()
    }
}
