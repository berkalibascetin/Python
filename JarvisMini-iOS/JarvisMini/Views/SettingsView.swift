import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey: String = KeychainHelper.loadAPIKey() ?? ""
    @State private var savedConfirmation = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("Gemini API Anahtarı", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .disableAutocorrection(true)
                } header: {
                    Text("Gemini API Anahtarı")
                } footer: {
                    Text("Ücretsiz anahtarınızı https://aistudio.google.com adresinden alabilirsiniz. Anahtar sadece cihazınızın Keychain'inde saklanır, hiçbir sunucuya gönderilmez.")
                }

                if savedConfirmation {
                    Text("Kaydedildi ✓")
                        .foregroundStyle(.green)
                }

                Section {
                    Button("Anahtarı Sil", role: .destructive) {
                        KeychainHelper.deleteAPIKey()
                        apiKey = ""
                    }
                }
            }
            .navigationTitle("Ayarlar")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Kaydet") {
                        KeychainHelper.save(apiKey: apiKey.trimmingCharacters(in: .whitespaces))
                        savedConfirmation = true
                        dismiss()
                    }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Kapat") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    SettingsView()
}
