# JarvisMini (iOS)

`alpunlu12-commits/jarvis` deposundaki Mac/Windows masaüstü asistanının **gerçekçi bir iPhone/iPad alternatifi**. Orijinal proje gibi kendi yapay zekası yok — bu uygulama da aynı şekilde **Google Gemini API**'sine bağlanan bir istemci. Farkı: orijinal projenin terminal komutu çalıştırma, rastgele uygulama açma, WhatsApp Desktop otomasyonu ve arka planda sürekli "Jarvis" uyandırma kelimesi dinleme gibi özellikleri iOS'un App Store sandbox kurallarıyla temelden çeliştiği için bu sürümde **yoktur**. Bunun yerine sadece iOS'ta gerçekten native ve yasal olan mekanizmalar kullanılır.

Bu klasördeki kod bir Linux konteynerinde, Mac/Xcode olmadan yazıldı — yani **burada derlenip test edilmedi**. Aşağıdaki adımlarla kendi Mac'inizde açıp derlemeniz gerekir.

## Neden Xcode projesi yok, sadece Swift dosyaları var?

`.xcodeproj` ikili proje dosyasını Xcode dışında elle güvenilir şekilde üretmek mümkün değil. Bu yüzden burada sadece kaynak dosyalar var; siz Xcode'da boş bir proje oluşturup bunları içine sürükleyeceksiniz.

## Kurulum (kendi Mac'inizde)

1. Xcode 15+ açın → **File → New → Project → iOS → App**.
   - Product Name: `JarvisMini`
   - Interface: SwiftUI, Language: Swift
2. Oluşan projenin varsayılan `ContentView.swift` ve `JarvisMiniApp.swift` dosyalarını silin.
3. Bu klasördeki `JarvisMini/` içindeki tüm dosyaları (Views, ViewModels, Services, Intents) Xcode proje gezgininde ilgili gruplara sürükleyip bırakın ("Copy items if needed" işaretli olsun).
4. `Info.plist` içindeki izin açıklama anahtarlarını (aşağıda) kendi projenizin Info.plist'ine ekleyin (Xcode 15+'ta bunlar genelde proje ayarları > Info sekmesinden eklenir).
5. **Ücretsiz Gemini API anahtarı alın:** https://aistudio.google.com → "Get API Key" → "Create API Key".
6. Uygulamayı simülatörde çalıştırın, Ayarlar sekmesinden Gemini anahtarınızı yapıştırın (Keychain'e kaydedilir).

## Test etme

- **Metin sohbeti + Takvim/Hatırlatıcı:** Simülatörde test edilebilir.
- **Mikrofon/konuşma tanıma doğruluğu, WeatherKit, MusicKit:** Gerçek bir iPhone'da, kendi Apple Developer hesabınızla imzalanmış olarak çalıştırmanız gerekir. WeatherKit ve MusicKit **ücretli** ($99/yıl) Apple Developer Program üyeliği ve ilgili entitlement'ların projeye eklenmesini gerektirir — bu dosyalarda entegrasyon noktaları hazır ama entitlement'lar sizin Apple Developer hesabınızdan eklenmeli.
- İlk çalıştırmada mikrofon, konuşma tanıma ve takvim izin isteklerini onaylayın.
- Doğrulama: bir mesaj yazıp Gemini'den cevap geldiğini, mikrofon butonuna dokunup konuşarak metne çevrildiğini, ve "yarın saat 10'da diş hekimi diye hatırlat" gibi bir komutla EventKit'e hatırlatıcı eklendiğini kontrol edin.

## Mahremiyet: mikrofon nasıl çalışır

Bu uygulama **hiçbir zaman arka planda veya sessizce dinlemez**. Mikrofon butonu bas-tut değil, **dokun-başlat / dokun-durdur** (toggle) şeklindedir:

- Butona bir kez dokunursunuz → dinleme başlar, ekranda kırmızı "Dinleniyor... (Durdurmak için dokun)" göstergesi belirir.
- Butona tekrar dokunana kadar dinlemeye devam eder.
- Tekrar dokunduğunuzda dinleme **kesin olarak** durur, `AVAudioSession` serbest bırakılır — arka planda askıda kalmaz.

İsteğe bağlı Siri entegrasyonu (`Intents/AskJarvisIntent.swift`, "Hey Siri, Jarvis'e ..." gibi) kullanılırsa, ham ses akışı bu uygulamaya değil doğrudan Siri'ye gider; uygulama sadece Siri tarafından tetiklenir. Bu yüzden ekstra bir mahremiyet riski oluşturmaz.

## Taşınabilir özellikler (bu sürümde var)

| Özellik | Framework |
|---|---|
| Sohbet (metin/sesli) | `GeminiClient` (Gemini REST API) |
| Konuşma tanıma | `SFSpeechRecognizer` + `AVAudioEngine` |
| Sesli yanıt | `AVSpeechSynthesizer` |
| Takvim / Hatırlatıcılar | `EventKit` |
| Hava durumu | `WeatherKit` (ücretli Developer Program gerekir) |
| Apple Music | `MusicKit` (üyelik + entitlement gerekir) |
| Pil durumu | `UIDevice` (sadece pil; CPU/RAM/disk iOS'ta erişilemez) |
| Web açma / arama | `SFSafariViewController` / `UIApplication.open` |
| "Hatırla" (basit hafıza) | Yerel kalıcılık (`UserDefaults` + `Codable`) |
| Siri ile tetikleme | `AppIntent` (`AskJarvisIntent`) |

## Taşınamayan özellikler (ve neden)

| Orijinal özellik | Neden iOS'ta yok | En yakın alternatif |
|---|---|---|
| Terminal komutu çalıştırma | iOS'ta shell exec yok | Yok, kapsam dışı |
| İsme göre rastgele uygulama açma (`"Spotify'ı aç"`) | Sadece bildirilmiş URL scheme ile açılabilir | Bilinen uygulamalar için `UIApplication.open(URL)` |
| WhatsApp Desktop otomasyonu (otomatik mesaj gönderme) | 3. parti uygulama UI otomasyonu yasak | `whatsapp://send?phone=X&text=Y` ile mesajı ön dolu compose ekranına getirmek; gönderme kullanıcının kendi dokunuşuyla olur |
| Arka planda sürekli "Jarvis" uyandırma kelimesi | Arka planda sürekli mikrofon dinleme App Store kurallarına aykırı | Dokun-başlat/dokun-durdur mikrofon butonu + isteğe bağlı Siri App Intent |
| CPU/RAM/Disk bilgisi | iOS sandbox'ta bu bilgilere erişim yok | Sadece pil seviyesi/durumu |
