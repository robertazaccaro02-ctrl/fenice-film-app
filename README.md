# Fenice Film · app operativa (versione Netlify)

App interna di Fenice Film: calendario FENICE FILM, produzioni, rubrica (clienti e partner, collaboratori, fornitori), documenti (archivio su MyAirBridge), cose da fare, assenze e il collegamento all'app Pizza Maker.

**Repository privato**: contiene contatti di persone. Non renderlo pubblico.

## Accesso: due password
- **Titolari** (`PASSWORD_TITOLARI`): vedono e modificano tutto, compresi clienti, tariffe dei collaboratori e documenti riservati.
- **Collaboratori** (`PASSWORD_COLLABORATORI`): vedono calendario, produzioni, rubrica collaboratori e fornitori, documenti; possono aggiungere cose da fare e segnare le proprie assenze. Clienti, tariffe e documenti riservati non arrivano nemmeno al loro telefono.

## Pubblicare su Netlify (una volta sola)
1. Su app.netlify.com: **Add new project → Import an existing project → GitHub**, scegli `fenice-film-app` e premi **Deploy**. Le impostazioni vengono lette da `netlify.toml`.
2. In **Project configuration → Environment variables** aggiungi:
   - `PASSWORD_TITOLARI`: la password per te e il tuo socio
   - `PASSWORD_COLLABORATORI`: la password per i collaboratori (deve essere diversa)
   - `GCAL_ICS_URL`: l'indirizzo segreto iCal del calendario FENICE FILM (vedi sotto)
3. **Deploys → Trigger deploy → Deploy site** per applicare le impostazioni.

### Indirizzo segreto del calendario
Google Calendar dal computer → a sinistra passa sopra **FENICE FILM** → tre puntini → **Impostazioni e condivisione** → in fondo, **Indirizzo segreto in formato iCal** → copia. Non condividerlo: chi lo ha può leggere il calendario.

Il calendario nell'app è in sola lettura e si aggiorna ogni pochi minuti. Le giornate intere "libere" (grigie, OUT, ferie) compaiono in "Chi è fuori" e non nelle caselle.

## Come funziona
- `public/index.html`: l'app, generata da `artifact.html` (la versione su claude.ai) con `python3 build-from-artifact.py artifact.html public/index.html shim.html`.
- `shim.html`: schermata di accesso e collegamento ai dati del server.
- `netlify/functions/api.mjs`: password, lettura e scrittura dei dati (Netlify Blobs), permessi per titolari e collaboratori, calendario.
- `netlify/lib/ics.mjs`: lettore del calendario iCal (ripetizioni, eccezioni, ora legale).
- `data/seed.json`: dati iniziali, caricati solo al primo avvio (dopo contano quelli salvati su Netlify).
- `data/updates.json`: modifiche ai dati da applicare una volta sola. Ogni voce: `{"id": "2026-11-20-nuovo-fornitore", "ops": [{"op": "set|update|delete", "collection": "fornitori", "docId": "...", "data": {...}}]}`.
- Per cambiare una password: modificala nelle variabili d'ambiente e rifai il deploy. Chi era dentro dovrà inserire la nuova password.

## Prova in locale
`npm install` e poi `node test-server.mjs` (password di prova: `titolari-test` e `collab-test`), apri http://localhost:8899.
