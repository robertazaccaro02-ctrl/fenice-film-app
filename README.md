# Fenice Film · app operativa (versione Cloudflare)

App interna di Fenice Film: calendario FENICE FILM, produzioni, rubrica (clienti e partner, collaboratori, fornitori), documenti (archivio su MyAirBridge), cose da fare, assenze e il collegamento all'app Pizza Maker.

**Repository privato**: contiene contatti di persone. Non renderlo pubblico.

## Accesso: due password
- **Titolari** (`PASSWORD_TITOLARI`): vedono e modificano tutto, compresi clienti, tariffe dei collaboratori e documenti riservati.
- **Collaboratori** (`PASSWORD_COLLABORATORI`): vedono calendario, produzioni, rubrica collaboratori e fornitori, documenti; possono aggiungere cose da fare e segnare le proprie assenze. Clienti, tariffe e documenti riservati non arrivano nemmeno al loro telefono.

## Pubblicare su Cloudflare (una volta sola)
1. Su dash.cloudflare.com: **Compute (Workers) → Workers & Pages → Create → Import a repository**, collega GitHub e scegli `fenice-film-app`. Lascia le impostazioni proposte (il comando di pubblicazione è `npx wrangler deploy`) e premi **Deploy**.
2. Nel progetto appena creato: **Settings → Variables and Secrets → Add**, tipo **Secret**:
   - `PASSWORD_TITOLARI`: la password per te e il tuo socio
   - `PASSWORD_COLLABORATORI`: la password per i collaboratori (deve essere diversa)
   - `GCAL_SERVICE_ACCOUNT`: il file JSON dell'account di servizio Google (vedi sotto). Serve per i colori degli eventi (grigio = assenza).
   - `GCAL_ICS_URL` (riserva, facoltativo): l'indirizzo segreto iCal del calendario FENICE FILM. Non ha i colori.
3. Da quel momento ogni modifica caricata su GitHub (ramo `main`) viene ripubblicata da sola in un paio di minuti.

I dati (rubrica, da fare, assenze, proposta salvata) stanno in un archivio Cloudflare (Durable Object "Archivio") creato in automatico. La prima volta si riempie con `data/seed.json`.

### Calendario con i colori: account di servizio Google
1. console.cloud.google.com → crea un progetto (es. "Fenice Film App").
2. **API e servizi → Libreria** → cerca **Google Calendar API** → **Abilita**.
3. **IAM e amministrazione → Account di servizio → Crea account di servizio** → nome "calendario-app" → **Fine** (nessun ruolo).
4. Apri l'account creato → **Chiavi → Aggiungi chiave → Crea nuova chiave → JSON**: si scarica un file.
5. Google Calendar → FENICE FILM → **Impostazioni e condivisione → Condividi con persone specifiche** → aggiungi l'email dell'account di servizio (finisce con `iam.gserviceaccount.com`) con **Visualizzare tutti i dettagli degli eventi**.
6. Cloudflare → Settings → Variables and Secrets → Secret `GCAL_SERVICE_ACCOUNT` = tutto il contenuto del file JSON.

### Indirizzo segreto del calendario
Google Calendar dal computer → a sinistra passa sopra **FENICE FILM** → tre puntini → **Impostazioni e condivisione** → in fondo, **Indirizzo segreto in formato iCal** → copia. Non condividerlo: chi lo ha può leggere il calendario.

Il calendario nell'app è in sola lettura e si aggiorna ogni pochi minuti. Le giornate intere "libere" (grigie, OUT, ferie) compaiono in piccolo in fondo alle caselle e in "Chi è fuori"; gli eventi che iniziano con "Edit" sono un pallino viola.

## Come funziona
- `public/index.html`: l'app, generata da `artifact.html` (la versione su claude.ai) con `python3 build-from-artifact.py artifact.html public/index.html shim.html`.
- `shim.html`: schermata di accesso e collegamento ai dati del server.
- `worker/index.mjs`: il Worker Cloudflare (file dell'app, API, archivio dati). `wrangler.jsonc`: la sua configurazione.
- `server/api.mjs`: password, lettura e scrittura dei dati, permessi per titolari e collaboratori, calendario, proposta.
- `server/ics.mjs`: lettore del calendario iCal (ripetizioni, eccezioni, ora legale).
- `public/_private/proposta.html`: la proposta di partnership di partenza; non è raggiungibile direttamente, la serve l'API solo ai titolari.
- `data/seed.json`: dati iniziali, caricati solo al primo avvio (dopo contano quelli salvati su Cloudflare).
- `data/updates.json`: modifiche ai dati da applicare una volta sola. Ogni voce: `{"id": "2026-11-20-nuovo-fornitore", "ops": [{"op": "set|update|delete", "collection": "fornitori", "docId": "...", "data": {...}}]}`.
- Per cambiare una password: modificala in Settings → Variables and Secrets. Chi era dentro dovrà inserire la nuova password.

## Prova in locale
`npm install`, crea `.dev.vars` con `PASSWORD_TITOLARI=...` e `PASSWORD_COLLABORATORI=...` e lancia `npx wrangler dev`. In alternativa, senza Cloudflare: `node test-server.mjs` (password di prova `titolari-test` e `collab-test`), poi http://localhost:8899.
