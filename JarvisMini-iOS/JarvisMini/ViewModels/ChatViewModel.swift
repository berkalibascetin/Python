import Foundation
import AVFoundation

struct ChatMessage: Identifiable, Codable, Equatable {
    let id: UUID
    let text: String
    let isFromUser: Bool
    let date: Date

    init(id: UUID = UUID(), text: String, isFromUser: Bool, date: Date = Date()) {
        self.id = id
        self.text = text
        self.isFromUser = isFromUser
        self.date = date
    }
}

@MainActor
final class ChatViewModel: ObservableObject {
    @Published private(set) var messages: [ChatMessage] = []
    @Published var draftText: String = ""
    @Published private(set) var isSending = false
    @Published private(set) var errorMessage: String?

    let speechRecognizer = SpeechRecognizer()

    private let gemini = GeminiClient()
    private let synthesizer = AVSpeechSynthesizer()
    private let memoryKey = "jarvismini.memory"

    init() {
        loadMemory()
    }

    /// Mikrofon butonuna tek dokunuşla çağrılır. Dinleme bittiğinde
    /// (kullanıcı tekrar dokunduğunda ya da tanıma tamamlandığında)
    /// biriken transkripti otomatik olarak gönderir.
    func toggleMic() {
        if speechRecognizer.state == .listening {
            speechRecognizer.stopListening()
            let text = speechRecognizer.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                Task { await send(text: text) }
            }
        } else {
            Task {
                let authorized = await speechRecognizer.requestAuthorization()
                guard authorized else {
                    errorMessage = "Mikrofon veya konuşma tanıma izni verilmedi."
                    return
                }
                try? speechRecognizer.startListening()
            }
        }
    }

    func sendDraft() {
        let text = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draftText = ""
        Task { await send(text: text) }
    }

    private func send(text: String) async {
        errorMessage = nil
        let userMessage = ChatMessage(text: text, isFromUser: true)
        messages.append(userMessage)

        if let remembered = rememberIfNeeded(text) {
            messages.append(ChatMessage(text: remembered, isFromUser: false))
            return
        }

        isSending = true
        defer { isSending = false }

        do {
            let history = Array(messages.dropLast())
            let reply = try await gemini.generateReply(for: text, history: history)
            let replyMessage = ChatMessage(text: reply, isFromUser: false)
            messages.append(replyMessage)
            speak(reply)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func speak(_ text: String) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "tr-TR")
        synthesizer.speak(utterance)
    }

    // MARK: - Basit "hatırla" özelliği (yerel kalıcılık)

    private var memory: [String] = []

    private func loadMemory() {
        guard let data = UserDefaults.standard.data(forKey: memoryKey),
              let saved = try? JSONDecoder().decode([String].self, from: data) else { return }
        memory = saved
    }

    private func saveMemory() {
        guard let data = try? JSONEncoder().encode(memory) else { return }
        UserDefaults.standard.set(data, forKey: memoryKey)
    }

    /// "Bunu hatırla: ..." / "Ne hatırlıyorsun?" gibi basit komutları
    /// Gemini'ye gitmeden yerelde yanıtlar. Gerçek bir NLU değil,
    /// orijinal projedeki "Bellek" özelliğinin en basit hali.
    private func rememberIfNeeded(_ text: String) -> String? {
        let lower = text.lowercased()

        if lower.hasPrefix("bunu hatırla:") {
            let note = String(text.dropFirst("bunu hatırla:".count)).trimmingCharacters(in: .whitespaces)
            guard !note.isEmpty else { return "Ne hatırlamamı istediğini yazmadın." }
            memory.append(note)
            saveMemory()
            return "Tamam, hatırladım: \"\(note)\""
        }

        if lower.contains("ne hatırlıyorsun") {
            guard !memory.isEmpty else { return "Şu an hatırladığım bir şey yok." }
            return "Hatırladıklarım:\n" + memory.map { "• \($0)" }.joined(separator: "\n")
        }

        return nil
    }
}
