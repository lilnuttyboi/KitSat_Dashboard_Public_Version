-- =============================================================================
-- Realtime Broadcast -migraatio (postgres_changes -> Broadcast)
-- =============================================================================
-- Tämä ajetaan Supabasen tietokannassa (SQL Editor). Frontend on jo päivitetty
-- kuuntelemaan Broadcastia (src/hooks/useTelemetry.js): kanava 'telemetry',
-- event 'telemetry_insert'.
--
-- MIKSI: postgres_changes-tilauksessa kanta tekee työtä JOKAISTA katsojaa kohden
-- (RLS tarkistetaan per rivi per asiakas), joten kuorma = rivit/s × katsojat.
-- Broadcastissa tietokantatriggeri lähettää yhden viestin, jonka Realtime-palvelin
-- monistaa kaikille tilaajille -> kannan kuorma ei kasva katsojamäärän mukaan.
--
-- SOPIMUS FRONTENDIN KANSSA (näiden on täsmättävä, tai rivit eivät tule perille):
--   topic  = 'telemetry'          <-> supabase.channel('telemetry')
--   event  = 'telemetry_insert'   <-> .on('broadcast', { event: 'telemetry_insert' })
--   payloadin avaimet (gps_lat, temp_c, ...) <-> updateData()/toHistoryEntry()
-- =============================================================================

-- 1) Funktio: lähettää jokaisen uuden rivin Broadcast-viestinä.
--    Lähetetään VAIN UI:n käyttämät sarakkeet (sama lista kuin TELEMETRY_COLUMNS
--    frontendissä) — kevyempi kuin postgres_changes, joka siirsi koko rivin.
create or replace function public.broadcast_telemetry_insert()
returns trigger
language plpgsql
security definer
as $$
begin
  -- TÄRKEÄÄ: broadcast EI saa koskaan kaataa INSERTtiä. AFTER-triggerin virhe
  -- peruisi koko transaktion — myös itse rivin tallennuksen — eli telemetrian
  -- kerääminen pysähtyisi. Siksi lähetys on omassa BEGIN/EXCEPTION-lohkossaan:
  -- jos realtime.send epäonnistuu (oikeudet, skeema, mikä tahansa), virhe
  -- niellään ja rivi tallentuu silti. Pahin tapaus = live-päivitys jää tulematta,
  -- ei koskaan datan menetys.
  begin
    perform realtime.send(
      jsonb_build_object(
        'created_at',   new.created_at,
        'flight_id',    new.flight_id,
        'gps_lat',      new.gps_lat,
        'gps_lon',      new.gps_lon,
        'gps_alt',      new.gps_alt,
        'gps_speed',    new.gps_speed,
        'gps_fix',      new.gps_fix,
        'temp_c',       new.temp_c,
        'pressure_hpa', new.pressure_hpa
      ),
      'telemetry_insert',   -- event (täsmää frontendin .on(...) eventiin)
      'telemetry',          -- topic  (täsmää supabase.channel('telemetry'):iin)
      false                 -- private=false -> julkinen kanava, ei per-asiakas-RLS:ää
    );
  exception when others then
    null; -- broadcastin virhe ei saa estää rivin tallennusta
  end;
  return new;
end;
$$;

-- 2) Triggeri: ajaa funktion jokaisen INSERTin jälkeen.
drop trigger if exists telemetry_broadcast on public.telemetry;
create trigger telemetry_broadcast
  after insert on public.telemetry
  for each row execute function public.broadcast_telemetry_insert();

-- =============================================================================
-- TESTAUS
-- =============================================================================
-- 1. Aja yllä oleva SQL.
-- 2. Avaa dashboard (npm run dev tai preview). Frontend kuuntelee jo Broadcastia.
-- 3. Lisää testirivi (tai odota oikeaa telemetriaa):
--      insert into public.telemetry (flight_id, created_at, gps_alt, temp_c)
--      values (<flight_id>, now(), 1234, -5);
-- 4. Rivin pitäisi ilmestyä dashboardiin heti. DEV-konsoli logittaa
--    "Realtime update received".
--
-- Vianetsintä jos rivit eivät tule:
--   - topic/event-nimet eivät täsmää frontendiin (yleisin syy)
--   - anon-roolilla ei oikeutta liittyä Realtimeen (toimi jo postgres_changesilla,
--     joten yleensä kunnossa)

-- =============================================================================
-- VALINNAINEN — vasta kun Broadcast on todettu toimivaksi ja frontend deployattu
-- =============================================================================
-- postgres_changes ei ole enää käytössä, joten taulun voi poistaa Realtime-
-- julkaisusta. Tämä lopettaa turhan WAL-replikoinnin ja keventää kantaa.
-- (Tee VASTA kun olet varma — tämän jälkeen vanha postgres_changes-frontend ei
--  enää saa live-päivityksiä.)
--
--   alter publication supabase_realtime drop table public.telemetry;

-- =============================================================================
-- VALINNAINEN — yksityinen kanava (kovennus, ei pakollinen julkiselle datalle)
-- =============================================================================
-- Jos halutaan rajata kuka voi tilata: vaihda yllä private=false -> true ja
-- frontendissä supabase.channel('telemetry', { config: { private: true } }).
-- Lisäksi tarvitaan RLS-policy realtime.messages-tauluun:
--
--   create policy "anon voi lukea telemetry-broadcastit"
--     on realtime.messages for select
--     to anon
--     using ( realtime.topic() = 'telemetry' );
