# Golden set

Agent davranışının ölçüm zemini (MASTER_PLAN §16, PHASE_1A_PLAN §8). Her senaryo
küçük, bilinen bir kusur sınıfını temsil eder; hepsi birlikte "agent bir görevi
baştan sona tamamlayabiliyor mu" sorusunun ölçülebilir hâlidir.

| Senaryo | Kusur sınıfı | Neyi sınar |
|---|---|---|
| `py-auth-bug` | Eksik anahtar / None koruması | Temel oku-düzelt-test döngüsü |
| `py-off-by-one` | Sınır hatası (dilimleme) | Aritmetik akıl yürütme |
| `py-wrong-operator` | Yanlış karşılaştırma (`>` ↔ `>=`) | Tek karakterlik kusuru bulma |
| `py-missing-return` | Eksik `return` | Sessiz `None` dönüşü |
| `py-multi-file` | Kusur başka dosyada | Testin işaret ettiği yerden başka yere gitme |
| `py-exception-swallowed` | Yutulan istisna | Hatanın gizlenmesini fark etme |
| `py-mutable-default` | Paylaşılan mutable varsayılan | Dile özgü tuzak |
| `py-already-green` | **Kusur yok** | Olmayan sorunu "düzeltip" bozmama (negatif kontrol) |
| `js-sum-bug` | Yanlış başlangıç değeri | npm/node verification yolu (Python dışı pack) |
| `no-tests` | Test seti yok | "0 hata" yerine "hiçbir şey kontrol edilmedi" demesi |

## Nasıl koşulur

```bash
npm run eval          # tüm senaryolar, mock sürücüyle
```

Rapor sürücüyü (mock/live) açıkça etiketler. **Mock sürücüyle çıkan başarı oranı
model yeteneğinin ölçüsü değildir** — yalnızca harness'ın ve agent döngüsünün
doğruluğunu gösterir. Gerçek sayı, canlı sürücüyle koşulduğunda oluşur.

## Yeni senaryo eklerken

1. Küçük tut: tek kusur, birkaç dosya, saniyeler süren test seti.
2. Testler kusuru **davranışsal** olarak yakalasın (implementasyona değil sonuca baksın).
3. `packages/runtime/src/goldenSet.ts` içine kaydet; mock çözüm betiği gerçek bir
   modelin izleyeceği makul yolu taklit etmeli (oku → düzelt → test et).
