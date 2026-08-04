import SwiftUI

/// Swift Playgrounds (iPad) üzerinde JarvisMini'nin temelinin çalışıp
/// çalışmadığını görmek için tek dosyalık, en basit hâliyle bir test.
/// Keychain, EventKit, Speech YOK — sadece: SwiftUI + async ağ isteği +
/// Gemini API'den gerçekten cevap alabiliyor muyuz, onu doğruluyoruz.
struct ContentView: View {
    // Sadece bu hızlı test için buraya geçici olarak yapıştırıyoruz.
    // Gerçek uygulamada (JarvisMini/) bu asla kodun içine yazılmaz,
    // Keychain'de saklanır (bkz. Services/KeychainHelper.swift).
    @State private var apiKey = "BURAYA_GEMINI_API_ANAHTARINI_YAPISTIR"
    @State private var question = ""
    @State private var answer = "Henüz bir şey sormadın."
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 16) {
            Text("JarvisMini Hızlı Test")
                .font(.title2).bold()

            TextField("Bir şey sor...", text: $question)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)

            Button(isLoading ? "Soruluyor..." : "Sor") {
                Task { await ask() }
            }
            .disabled(question.isEmpty || isLoading)
            .buttonStyle(.borderedProminent)

            ScrollView {
                Text(answer)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
        }
        .padding()
    }

    private func ask() async {
        isLoading = true
        defer { isLoading = false }

        guard apiKey != "BURAYA_GEMINI_API_ANAHTARINI_YAPISTIR" else {
            answer = "Önce apiKey değişkenine kendi Gemini anahtarını yapıştır (aistudio.google.com)."
            return
        }
        guard let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent") else {
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")

        let body: [String: Any] = [
            "contents": [["role": "user", "parts": [["text": question]]]]
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, _) = try await URLSession.shared.data(for: request)
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let candidates = json["candidates"] as? [[String: Any]],
               let content = candidates.first?["content"] as? [String: Any],
               let parts = content["parts"] as? [[String: Any]],
               let text = parts.first?["text"] as? String {
                answer = text
            } else {
                answer = "Beklenmeyen yanıt: \(String(data: data, encoding: .utf8) ?? "?")"
            }
        } catch {
            answer = "Hata: \(error.localizedDescription)"
        }
    }
}

#Preview {
    ContentView()
}
