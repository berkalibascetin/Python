# Golden fixture: py-auth-bug

Faz 1a'nın ölçüm zemini (PHASE_1A_PLAN §A.9). Küçük, bilinen bug'lı bir Python projesi.

**Bug:** `authenticate()` bilinmeyen kullanıcıda `KeyError` fırlatıyor; `require_role()` de
`None` üzerinde indeksleme yapıyor. `pytest` ile 2 test kırmızı, 2 test yeşil başlar.

**Beklenen çözüm:** `USERS.get(username)` ile eksik kullanıcıyı ele almak ve `require_role`
içinde `None` kontrolü yapmak.

Bu fixture *güvenilen* koddur — `LocalProcessSandbox` izolasyon sağlamadığı için Faz 1a'da
yalnızca bu tür güvenilen projeler çalıştırılır (bkz. `packages/sandbox/src/local.ts`).
