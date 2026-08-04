import Foundation

enum GeminiClientError: LocalizedError {
    case missingAPIKey
    case invalidResponse
    case http(status: Int, body: String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            return "Gemini API anahtarı ayarlanmamış. Ayarlar'dan ekleyin."
        case .invalidResponse:
            return "Gemini'den beklenmeyen bir yanıt geldi."
        case let .http(status, body):
            return "Gemini isteği başarısız (\(status)): \(body)"
        }
    }
}

/// Gemini REST API'sine doğrudan (backend'siz) bağlanan istemci.
/// API anahtarı sadece Keychain'den okunur, hiçbir yerde sabit kodlanmaz.
final class GeminiClient {
    private let model = "gemini-2.5-flash"
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    /// Basit tek turluk soru-cevap. Sohbet geçmişi `contents` dizisine
    /// önceki turlar eklenerek genişletilebilir (v0'da tek mesaj gönderiyoruz).
    func generateReply(for prompt: String, history: [ChatMessage] = []) async throws -> String {
        guard let apiKey = KeychainHelper.loadAPIKey(), !apiKey.isEmpty else {
            throw GeminiClientError.missingAPIKey
        }

        guard let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent") else {
            throw GeminiClientError.invalidResponse
        }

        var contents: [[String: Any]] = history.map { message in
            [
                "role": message.isFromUser ? "user" : "model",
                "parts": [["text": message.text]],
            ]
        }
        contents.append(["role": "user", "parts": [["text": prompt]]])

        let body: [String: Any] = ["contents": contents]

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "x-goog-api-key")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw GeminiClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let bodyText = String(data: data, encoding: .utf8) ?? "?"
            throw GeminiClientError.http(status: httpResponse.statusCode, body: bodyText)
        }

        return try Self.extractText(from: data)
    }

    private static func extractText(from data: Data) throws -> String {
        struct GeminiResponse: Decodable {
            struct Candidate: Decodable {
                struct Content: Decodable {
                    struct Part: Decodable { let text: String? }
                    let parts: [Part]
                }
                let content: Content
            }
            let candidates: [Candidate]
        }

        let decoded = try JSONDecoder().decode(GeminiResponse.self, from: data)
        guard let text = decoded.candidates.first?.content.parts.first?.text else {
            throw GeminiClientError.invalidResponse
        }
        return text
    }
}
