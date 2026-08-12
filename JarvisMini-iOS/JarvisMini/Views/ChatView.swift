import SwiftUI

struct ChatView: View {
    @EnvironmentObject private var viewModel: ChatViewModel
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                messageList

                if viewModel.speechRecognizer.state == .listening {
                    listeningBanner
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                inputBar
            }
            .navigationTitle("JarvisMini")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                    if viewModel.isSending {
                        ProgressView()
                            .padding(.leading)
                    }
                }
                .padding()
            }
            .onChange(of: viewModel.messages) { _, newValue in
                guard let last = newValue.last else { return }
                withAnimation {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    /// Dinleme SADECE burada, kullanıcı butona dokunduğunda aktif olur.
    /// Bu banner, dinlemenin açık olduğunu her zaman görsel olarak belli eder.
    private var listeningBanner: some View {
        HStack {
            Image(systemName: "waveform")
            Text(viewModel.speechRecognizer.transcript.isEmpty
                 ? "Dinleniyor..."
                 : viewModel.speechRecognizer.transcript)
                .lineLimit(2)
            Spacer()
            Button("Durdur") {
                viewModel.toggleMic()
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
        }
        .padding()
        .background(Color.red.opacity(0.1))
    }

    private var inputBar: some View {
        HStack(spacing: 12) {
            Button {
                viewModel.toggleMic()
            } label: {
                Image(systemName: viewModel.speechRecognizer.state == .listening ? "mic.fill" : "mic")
                    .font(.title2)
                    .foregroundStyle(viewModel.speechRecognizer.state == .listening ? .red : .accentColor)
            }
            .accessibilityLabel("Mikrofon, dokunarak başlat/durdur")

            TextField("Bir şey yaz...", text: $viewModel.draftText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .onSubmit { viewModel.sendDraft() }

            Button("Gönder") {
                viewModel.sendDraft()
            }
            .disabled(viewModel.draftText.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding()
    }
}

private struct MessageBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isFromUser { Spacer(minLength: 40) }

            Text(message.text)
                .padding(10)
                .background(message.isFromUser ? Color.accentColor.opacity(0.2) : Color.gray.opacity(0.15))
                .clipShape(RoundedRectangle(cornerRadius: 12))

            if !message.isFromUser { Spacer(minLength: 40) }
        }
    }
}

#Preview {
    ChatView()
        .environmentObject(ChatViewModel())
}
