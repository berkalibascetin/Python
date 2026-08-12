import SwiftUI

@main
struct JarvisMiniApp: App {
    @StateObject private var chatViewModel = ChatViewModel()

    var body: some Scene {
        WindowGroup {
            ChatView()
                .environmentObject(chatViewModel)
        }
    }
}
