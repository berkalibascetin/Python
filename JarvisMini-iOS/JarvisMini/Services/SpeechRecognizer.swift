import Foundation
import Speech
import AVFoundation

/// Dokun-başlat / dokun-durdur (toggle) konuşma tanıma.
///
/// Mahremiyet notu: mikrofon SADECE `.listening` durumundayken açık kalır.
/// `stopListening()` çağrıldığında `AVAudioSession` tamamen serbest bırakılır;
/// hiçbir zaman arka planda veya kullanıcı fark etmeden dinleme yapılmaz.
@MainActor
final class SpeechRecognizer: ObservableObject {
    enum State: Equatable {
        case idle
        case listening
        case denied
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var transcript: String = ""

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "tr-TR"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    func requestAuthorization() async -> Bool {
        let speechStatus = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
        let micGranted = await AVAudioApplication.requestRecordPermission()

        let authorized = speechStatus == .authorized && micGranted
        if !authorized {
            state = .denied
        }
        return authorized
    }

    /// Dinlemeyi başlatır. Zaten dinliyorsa hiçbir şey yapmaz.
    func startListening() throws {
        guard state != .listening else { return }
        guard let recognizer, recognizer.isAvailable else {
            throw NSError(domain: "SpeechRecognizer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Konuşma tanıma şu an kullanılamıyor."])
        }

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let newRequest = SFSpeechAudioBufferRecognitionRequest()
        newRequest.shouldReportPartialResults = true
        request = newRequest

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak newRequest] buffer, _ in
            newRequest?.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()

        transcript = ""
        state = .listening

        task = recognizer.recognitionTask(with: newRequest) { [weak self] result, error in
            guard let self else { return }
            Task { @MainActor in
                if let result {
                    self.transcript = result.bestTranscription.formattedString
                }
                if error != nil || (result?.isFinal ?? false) {
                    self.stopListening()
                }
            }
        }
    }

    /// Dinlemeyi kesin olarak durdurur ve audio session'ı serbest bırakır.
    /// Kullanıcı mikrofon butonuna tekrar dokunduğunda ya da tanıma
    /// tamamlandığında/hata verdiğinde çağrılır.
    func stopListening() {
        guard state == .listening else { return }

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        state = .idle
    }

    /// Mikrofon butonuna dokunulduğunda çağrılacak tek giriş noktası.
    func toggleListening() {
        if state == .listening {
            stopListening()
        } else {
            try? startListening()
        }
    }
}
