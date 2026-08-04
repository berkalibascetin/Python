import AppIntents

/// "Hey Siri, Jarvis'e ... sor" ile tetiklenebilen App Intent.
///
/// Bu, orijinal projedeki her zaman dinleyen "Jarvis" uyandırma kelimesinin
/// iOS'ta yasal olan tek eşdeğeridir: ham ses akışı bu uygulamaya değil
/// doğrudan Siri'ye gider, uygulama sadece Siri tarafından tetiklenir.
/// Bu yüzden sürekli mikrofon dinlemesi gerektirmez ve App Store kurallarına
/// aykırı değildir.
struct AskJarvisIntent: AppIntent {
    static var title: LocalizedStringResource = "Jarvis'e Sor"
    static var description = IntentDescription("Gemini destekli JarvisMini asistanına bir soru sorar.")

    @Parameter(title: "Soru")
    var question: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let gemini = GeminiClient()
        do {
            let reply = try await gemini.generateReply(for: question)
            return .result(dialog: IntentDialog(stringLiteral: reply))
        } catch {
            return .result(dialog: IntentDialog(stringLiteral: "Bir hata oluştu: \(error.localizedDescription)"))
        }
    }
}

struct JarvisMiniShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskJarvisIntent(),
            phrases: [
                "\(.applicationName) üzerinden \(\.$question) diye sor",
                "Jarvis'e \(\.$question) diye sor"
            ],
            shortTitle: "Jarvis'e Sor",
            systemImageName: "mic.circle"
        )
    }
}
