# Kuormitustestit (loadtests)

Kaksi skriptiä KitSat-dashboardin skaalautuvuuden testaamiseen. Tarvitsevat vain
Node 18+ (realtime-testi käyttää projektin `@supabase/supabase-js`:ää, joten aja
projektin juuresta). Anon-avain on julkinen ja vain-luku.

## `kitsat_realtime_test.mjs` ← KÄYTÄ TÄTÄ

Testaa **oikeaa arkkitehtuuria**: Realtime Broadcast, kanava `telemetry`, event
`telemetry_insert` (sama kuin `src/hooks/useTelemetry.js`). Avaa N yhtäaikaista
WebSocket-tilaajaa = N selainvälilehteä ja mittaa todellisen rajan:

- montako yhtäaikaista katsojaa Realtime **hyväksyy** (= kattosi), ja
- leviääkö yksi insert **kaikille** tilaajille (fan-out).

Pätevä yhdestä koneesta, koska Realtime-yhteyskatto on **projektin laajuinen**,
ei per-IP.

```bash
node loadtests/kitsat_realtime_test.mjs 300 90            # 300 katsojaa, pidä 90 s
ulimit -n 4096 && node loadtests/kitsat_realtime_test.mjs 500 90   # >250: nosta soketit ensin
```

Fan-outin näkemiseksi lisää rivi telemetry-tauluun (Supabase SQL editor) sillä
aikaa kun skripti on "holding"-vaiheessa — `viewers-with-msg` pitäisi hypätä N/N.

⚠ Yhteydet kuluttavat **projektin yhteistä** Realtime-kattoa. Jos oikea lento on
käynnissä ja katsojia on, testi kilpailee heidän kanssaan — aja lennon ulkopuolella.

## `kitsat_rest_poll_test.mjs` ← VANHENTUNUT / HARHAANJOHTAVA

Kaverin alkuperäinen REST-pollaustesti. Kaksi syytä miksi sen tulos ei kerro
backendin kapasiteetista:

1. Testaa **pollausarkkitehtuuria**, jota dashboard ei enää käytä (vaihdettu
   Broadcastiin, commit `c80fd71`).
2. Kaikki "katsojat" tulevat **yhdestä IP:stä** → Cloudflare throttlaa per-IP →
   "FAIL" + valtavat latenssit ovat **testimetodin artefakti**, eivät backendin
   todellinen raja. Oikeat katsojat tulevat eri IP:istä.

Säilytetty vain vertailun vuoksi. Älä käytä kapasiteetin arviointiin.
