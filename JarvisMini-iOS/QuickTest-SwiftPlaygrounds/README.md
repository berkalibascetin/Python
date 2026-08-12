# Hızlı Test — Swift Playgrounds (iPad, Mac yok)

Amaç: Mac/Xcode olmadan, sadece iPad'de, Swift Playgrounds'ın gerçekten
JarvisMini'nin temelini (SwiftUI + ağ isteği + Gemini API) çalıştırıp
çalıştıramadığını 5 dakikada görmek. Bu, asıl `JarvisMini/` projesinin
küçültülmüş, tek dosyalık bir ön testi — Keychain, sesli komut, Takvim
entegrasyonu yok, sadece "temel çalışıyor mu?" sorusuna cevap arıyoruz.

## Adımlar

1. iPad'de App Store'dan **Swift Playgrounds** uygulamasını indir (ücretsiz).
2. Uygulamayı aç, sağ üstten **yeni proje oluştur** → şablon olarak
   **App** seç (bir ders/playground değil — gerçek bir uygulama projesi).
3. Platform olarak **iOS**'u, arayüz olarak **SwiftUI**'yi seç.
4. Projeye bir isim ver (örn. `JarvisTest`).
5. Sol taraftaki dosya listesinden `ContentView.swift`'i aç, içindeki
   varsayılan kodu tamamen sil, bu klasördeki `ContentView.swift`
   dosyasının içeriğini yapıştır.
6. https://aistudio.google.com adresine git → "Get API Key" → "Create API
   Key" ile ücretsiz bir Gemini anahtarı al.
7. Yapıştırdığın kodda `"BURAYA_GEMINI_API_ANAHTARINI_YAPISTIR"` yazan
   yeri kendi anahtarınla değiştir. (Bu SADECE bu hızlı test için — kalıcı
   uygulamada anahtar asla kod içine yazılmaz, Keychain'de saklanır.)
8. Sağ üstteki ▶️ **Çalıştır** düğmesine bas. Playgrounds bunu doğrudan
   kendi iPad'inde (fiziksel cihazda) çalıştırır, ayrı bir simülatöre
   gerek yok.
9. Açılan ekranda bir soru yaz, "Sor" butonuna bas. Gemini'den gerçek bir
   cevap gelirse: temel çalışıyor demektir, tam JarvisMini projesine
   güvenle geçebiliriz. Bir derleme hatası ya da çökme olursa, o hatayı
   bildir — birlikte hangi kısmın Playgrounds'da desteklenmediğini
   çözeriz.

## Sonraki adım

Bu test başarılı olursa, `../JarvisMini/` altındaki tam projeyi (Keychain,
mikrofon, EventKit dahil) aynı yöntemle Swift Playgrounds'a taşıyabiliriz.
