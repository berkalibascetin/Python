# Faz 1b — İzolasyonlu Docker Sandbox (uygulama ve sonuç)

> Üst plan: [`MASTER_PLAN.md`](./MASTER_PLAN.md) §14.3 · Önceki faz: [`PHASE_1A_PLAN.md`](./PHASE_1A_PLAN.md)
>
> **Amaç:** Faz 1a'daki çalışan agent runtime'ı bozmadan, güvenilmeyen kullanıcı projelerini çalıştırabilecek izole bir yürütme katmanına taşımak.

## 1. Neden gerekliydi

Faz 1a'nın `LocalProcessSandbox`'ı komutları host üzerinde normal bir çocuk süreç olarak çalıştırıyordu. Sağladığı tek koruma workspace'e yol hapsi ve süre limitiydi; ağ açıktı, dosya sistemi kısıtı yoktu, kaynak sınırı yoktu. Bu yüzden yalnızca *bizim ürettiğimiz* golden fixture'lar çalıştırılabiliyordu ve bu kısıt Faz 1a'nın kapanış raporunda açık risk olarak yazılmıştı.

Faz 1b bu kısıtı kaldırır: kullanıcı projesi artık **güvenilmeyen kod** olarak kabul edilir ve izole bir container'da koşar.

## 2. Mimari: iş yükü ile ölçüm ayrılır

Kritik tasarım kararı — workspace host'ta kalır, container'a **yalnızca çalışma ağacı** mount edilir:

```
host: /tmp/mc-<mission>/
        ├── work/   ← container'a mount edilen TEK dizin
        └── git/    ← ölçüm için GIT_DIR; container göremez

read / write / list  → host dosya sistemi (yol hapsi ile)
exec                 → tek kullanımlık container (güvenilmeyen kodun
                       çalışabildiği TEK yer)
git / diff           → host'ta, mount DIŞINDAKİ git dizini ile
```

Güvenlik sonucu önemli: container `.git`'i göremez, dolayısıyla güvenilmeyen kod kendi değişikliğini gizlemek için geçmişi yeniden yazamaz. Timeline'da gösterilen "N dosya değişti" ölçümü, ölçtüğü kodun erişemediği bir yerden gelir. Bu, adversarial test (15) ile kanıtlanmıştır.

Soyutlama korundu: `SandboxProvider` arayüzü değişmedi, agent runtime hiçbir yerde Docker bilmiyor.

```
SandboxProvider
├── LocalProcessSandbox   (isolatesUntrustedCode = false)
└── DockerSandbox         (isolatesUntrustedCode = true)
```

## 3. İki katmanlı yetki: tool policy ≠ sandbox policy

Faz 1a'nın tool izin sistemi olduğu gibi korundu. İki katman bağımsız çalışır:

```
Agent → Tool Policy (rol izinleri, komut allowlist'i, metakarakter reddi)
      → Sandbox Policy (izolasyon, kaynak limitleri, ağ)
      → Execution
```

Prompt injection ile kandırılan bir agent, izin verilmeyen tool'u çağıramaz (tool katmanı), çağırabildiği tool bile sandbox sınırlarını aşamaz (sandbox katmanı). Her iki katmanın da testi var.

## 4. Güven seviyesi (`TrustLevel`)

`create()` artık `trust` alır ve **belirtilmezse `untrusted` kabul eder** — unutulan bir parametre asla izolasyonsuz çalıştırmaya dönüşmez. `LocalProcessSandbox` untrusted proje verildiğinde `UntrustedProjectError` fırlatır; bu bir konfigürasyon uyarısı değil, güvenlik reddidir.

## 5. Uygulanan güvenlik kontrolleri

| Kontrol | Bayrak / mekanizma | Doğrulayan test |
|---|---|---|
| Ağ kapalı | `--network=none` | adversarial (6) |
| Host FS erişimi yok | yalnızca `work/` bind mount | adversarial (3) |
| Docker socket erişimi yok | socket asla mount edilmez | adversarial (4) |
| Privileged yok | `--privileged` ve `--cap-add` hiç kullanılmaz | dockerArgs |
| Capability düşürme | `--cap-drop=ALL` | dockerArgs, adversarial (7) |
| Ayrıcalık yükseltme engeli | `--security-opt=no-new-privileges` | dockerArgs |
| Salt-okunur rootfs | `--read-only` + `--tmpfs /tmp:noexec` | adversarial (7) |
| Non-root çalıştırma | host root ise `65534:65534` | dockerArgs |
| Host env sızmaz | `-e`/`--env-file` hiç geçilmez + çalışma anı kontrolü | adversarial (5) |
| Bellek limiti | `--memory` + `--memory-swap` (takas yok) | adversarial (8) |
| CPU limiti | `--cpus` | adversarial (9) — cgroup kotası okunarak |
| Process limiti | `--pids-limit` | adversarial (10) |
| Süre limiti | host tarafı timer + `docker kill` | adversarial (11) |
| Çıktı boyutu limiti | akış sırasında bayt sayımı + kill | adversarial (12) |
| Container temizliği | `--rm` + etiketli `reapOrphans()` | adversarial (14), dockerMission |
| Ölçümün korunması | GIT_DIR mount dışında | adversarial (15) |
| Kaynak projenin geçmişi taşınmaz | `.git` kopyalanmaz | adversarial (ek) |

## 6. Lifecycle

```
CREATE   → geçici workspace, work/ + git/ ayrımı, baseline commit
PREPARE  → kaynak kopyalanır, .git temizlenir, izinler ayarlanır
EXECUTE  → her komut için tek kullanımlık container (--rm, etiketli)
VERIFY   → test koşumu aynı izolasyon altında
COLLECT  → diff/facts host tarafında, container erişemez
DESTROY  → etiketli container'lar force-remove + workspace silinir
```

`destroy()` mission başarısız olsa da `finally` bloğundan çağrılır. Anormal sonlanma için `reapOrphans(missionId?)` güvenlik ağı vardır.

## 7. Veri akışı ve retention

| Veri | Nerede | Ne kadar |
|---|---|---|
| Kaynak kod | Yalnızca host'taki geçici workspace + container mount'u | Mission süresi; `destroy()` ile silinir |
| Agent prompt / model yanıtı | Bellek; container'a hiç girmez | Çağrı ömrü |
| Tool çıktısı / test çıktısı | Bellek, kırpılmış; event'te referans | Mission geçmişi |
| Diff / artifact | Host, git dizini (mount dışı) | Mission geçmişi |
| Container | Ephemeral, `--rm` | Komut süresi |

Faz 1a'nın privacy kararları korundu: kaynak kod kalıcı depoya yazılmaz.

## 8. Test sonuçları

Docker daemon çalışır durumdayken, tam suite iki kez üst üste koşuldu (kararlılık kontrolü):

```
Existing tests (Faz 1a):     66/66   ✅ hiçbiri değişmedi
Docker arg/policy tests:     14/14   ✅ (Docker gerektirmez)
Docker adversarial tests:    22/22   ✅ (gerçek container)
Docker mission integration:   6/6    ✅ (uçtan uca izole mission)
─────────────────────────────────────
TOPLAM:                    108/108   ✅ (+1 canlı model testi atlandı)

Golden eval (docker sandbox):  10/10  ✅
Golden eval (local sandbox):   10/10  ✅ regresyon
```

Negatif kontroller Docker yolunda da korundu: düzeltmeyen agent, hiçbir şey yapmayan agent ve çalışan projeyi bozan agent hâlâ **başarılı sayılmıyor**; `INCONCLUSIVE ≠ 0 failed` ayrımı Docker yolunda ayrıca test edildi.

## 9. Uygulama sırasında bulunan gerçek kusurlar

1. **Container, host'un yazdığı dosyaları değiştiremiyordu.** Non-root container, host'un 0644 root sahipli yazdığı dosyalara yazamıyordu; dosya yazan meşru test setleri (snapshot, sqlite, üretilen fixture) kırılırdı. `writeFile` artık container kullanıcısı için izinleri açıyor. Adversarial test (15) bunu ortaya çıkardı ve test, saldırının gerçekten *gerçekleştiğini* doğrulayacak şekilde güçlendirildi — aksi hâlde olmayan bir korumayı kanıtlamış olurdu.
2. **CPU testi zamanlamaya dayanıyordu** ve paralel yük altında kırılıyordu. cgroup kotasını doğrudan okuyacak şekilde deterministik hale getirildi (cgroup v1 ve v2 desteğiyle).
3. **`reapOrphans()` global sayıyordu**; eşzamanlı testlerin container'larını da topluyordu. Mission'a sınırlandırılabilir hale getirildi.

## 10. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `packages/sandbox/src/types.ts` | `TrustLevel`, `ResourceLimits`, `NetworkPolicy`, yeni hata tipleri, `isolatesUntrustedCode` |
| `packages/sandbox/src/docker.ts` | **yeni** — DockerSandbox + provider + `buildRunArgs` (saf, test edilebilir) |
| `packages/sandbox/src/local.ts` | untrusted reddi + limits alanı (davranışı korundu) |
| `packages/sandbox/test/dockerArgs.test.ts` | **yeni** — 14 test, Docker gerektirmez |
| `packages/sandbox/test/dockerAdversarial.test.ts` | **yeni** — 22 adversarial test |
| `packages/runtime/src/missionRunner.ts` | `trust` parametresi (varsayılan untrusted) |
| `packages/runtime/test/dockerMission.test.ts` | **yeni** — 6 uçtan uca izole mission testi |
| `packages/runtime/src/eval.ts` / `evalCli.ts` | rapora `sandboxKind`, Docker varsa onu seç |
| `apps/api/src/config.ts` / `server.ts` | sağlayıcı seçimi, izolasyon durumu `/config`'de |
| `apps/api/public/index.html` | izolasyon rozeti |
| `scripts/build-sandbox-image.sh` | **yeni** — registry ve kısıtlı-ağ (import) yolları |

## 11. SECURITY LIMITATIONS

**Docker bir güvenlik sınırı garantisi değildir.** Aşağıdakiler bu implementasyonun **çözmediği** risklerdir ve ürün iddialarında bunların üzeri örtülmemelidir:

1. **Paylaşılan çekirdek.** Container izolasyonu host çekirdeğini paylaşır. Bir çekirdek açığı (privilege escalation, container escape) bu katmanı geçersiz kılar. VM/hypervisor seviyesi izolasyon (Firecracker, gVisor) bu riski daraltır; biz onu kullanmıyoruz.
2. **User namespace remapping yok.** Varsayılan olarak non-root (65534) çalıştırıyoruz, ancak Docker'ın `userns-remap` özelliği yapılandırılmadı. Bir yapılandırma hatasıyla container root'u host root'una eşlenebilir.
3. **Özel seccomp/AppArmor profili yok.** Docker'ın varsayılan seccomp profiline güveniyoruz; daraltılmış özel bir profil yazılmadı.
4. **Workspace disk kotası yok.** Bellek, CPU ve process sınırlandı; ancak mount edilen workspace'e yazılan veri için kota uygulanmıyor. Güvenilmeyen kod host diskini doldurabilir. **Bilinen açık eksik** — Faz 2 adayı (loop device kotası veya `--storage-opt`).
5. **Workspace `noexec` değil.** Proje kendi çalıştırılabilirlerini koşabilsin diye mount `noexec` işaretlenmedi; yani güvenilmeyen kod workspace'e binary yazıp çalıştırabilir. Bilinçli işlevsellik ödünü.
6. **Global kaynak yönetimi yok.** Container başına limit var, ama eşzamanlı mission sayısı için host düzeyinde bir kabul kontrolü (admission control) yok. Çok sayıda paralel mission host'u tüketebilir.
7. **Yan kanallar.** Zamanlama, CPU önbelleği ve benzeri yan kanal saldırıları ele alınmadı.
8. **Image güveni.** Image imzası/provenance doğrulaması yapılmıyor. Bu ortamda image host rootfs'inden üretildiği için geniş bir yüzey içeriyor (kabuklar, git, paket yöneticileri); üretimde minimal bir image kullanılmalı.
9. **Platform sürecinin kendisi Docker'a erişir.** Container'a socket verilmiyor, ancak platformu çalıştıran süreç daemon'a erişebilir; platform sürecinin ele geçirilmesi host'un ele geçirilmesidir.
10. **Sızıntı yalnızca ağla olmaz.** Ağ kapalı ama agent, okuduğu dosya içeriğini model çağrısına koyar; prompt injection ile hassas içerik model sağlayıcısına ya da üretilen diff'e taşınabilir. Bu sandbox'ın değil, §9'daki injection savunmasının konusudur ve tamamen çözülmüş değildir.

## 12. Faz 1b'de çözülemeyenler

- **Workspace disk kotası** (yukarıda madde 4).
- **Gerçek modelle ölçüm** — hâlâ API anahtarı gerektiriyor; golden eval mock sürücüyle koşuyor.
- **Zip/kullanıcı yükleme arayüzü** — izolasyon artık hazır olduğu için teknik engel kalktı, ancak yükleme akışı (boyut limiti, arşiv bombası koruması, MIME doğrulama) ayrı bir iş kalemi.
- **Registry tabanlı image** — bu ortamda proxy Docker Hub blob CDN'ini engellediği için image host rootfs'inden üretildi. `scripts/build-sandbox-image.sh` normal ortamlar için registry yolunu içeriyor ama burada test edilemedi.

## 13. Faz 2'ye geçiş önerisi

Sıralama önerisi:

1. **Kullanıcı yükleme akışı** (zip) — izolasyon hazır; asıl eksik olan güvenli ingest (boyut/derinlik limitleri, arşiv bombası).
2. **Workspace disk kotası** — sandbox'ın son açık kaynak limiti.
3. **Faz 2 orkestrasyon**: Manager rolü + insan plan onay kapısı, ardından Reviewer.

Gerçek modelle golden eval ölçümü bu üçünden bağımsız olarak, anahtar sağlandığı anda tek komutla koşulabilir (`ANTHROPIC_API_KEY=... npm run eval`).

## 14. Geliştirici deneyimi

- Docker yoksa sistem **açık hata verir**: `SandboxUnavailableError` daemon durumunu veya eksik image'ı ve ne yapılacağını söyler.
- Docker yokken golden fixture'lar hâlâ çalışır (izolasyonsuz sağlayıcı, `trusted` olarak), ancak arayüz `no isolation` rozeti gösterir ve sunucu logunda uyarı basar.
- `MC_EVAL_SANDBOX=local` ile eval izolasyonsuz koşturulabilir (CI'da Docker yoksa).
- Bu geliştirme ortamında daemon manuel başlatılmalıdır: `dockerd --iptables=false --bridge=none &`
