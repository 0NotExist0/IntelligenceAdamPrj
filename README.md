# NotExist Intelligience Studio

Interfaccia locale per Claude Code basata su Node.js, Express e WebSocket. Lo Studio riunisce chat, terminale, anteprima, analisi del progetto, verifiche automatiche, memoria, strumenti di ripristino e scheletri di progetto.

## Avvio rapido

Su Windows, esegui `Avvia-Studio.bat`. Lo script:

1. verifica che Node.js sia disponibile;
2. installa le dipendenze se `node_modules` non esiste;
3. chiude un'eventuale istanza precedente sulla porta 3456;
4. avvia lo Studio e apre `http://localhost:3456`.

Avvio manuale:

```powershell
npm install
npm start
```

Poi apri `http://localhost:3456` nel browser.

## Pubblicazione come sito

Il progetto include `Dockerfile` e `render.yaml`, quindi puo essere pubblicato
come servizio web su Render o su qualsiasi piattaforma compatibile con Docker.
Il server usa WebSocket e API dinamiche: non puo essere ospitato come semplice
sito statico (per esempio con GitHub Pages).

Su Render, crea un nuovo **Blueprint** collegato a questo repository. Il file
`render.yaml` imposta automaticamente porta, health check e un token di accesso.
Recupera `STUDIO_API_TOKEN` dalle variabili d'ambiente del servizio e apri:

```text
https://IL-TUO-DOMINIO/?token=IL-TUO-STUDIO_API_TOKEN
```

Il token viene conservato soltanto nella sessione del browser e rimosso subito
dall'indirizzo visibile. Non condividere l'URL completo: lo Studio puo leggere e
modificare i file presenti nel container ed eseguire comandi al suo interno.

Avvio con Docker in locale:

```powershell
docker build -t intelligence-adam .
docker run --rm -p 3456:3456 -e STUDIO_API_TOKEN="un-token-lungo-e-casuale" intelligence-adam
```

## Struttura

- `server.js`: server HTTP/WebSocket e API dello Studio.
- `public/`: interfaccia web.
- `strumenti/`: moduli di analisi, verifica, memoria e automazione.
- `test/`: suite di test Node.js.
- `scheletri/`: progetti di partenza usati dallo Studio.
- `dati/`: chat, ripristini e stato persistente dell'utente.
- `Media/`: risorse multimediali dell'interfaccia.

## Verifica

```powershell
npm test
```

Alcune prove avanzate per texture fotografiche richiedono dipendenze Python/ML opzionali e possono non essere disponibili su una macchina configurata soltanto per il runtime Node.js.

## Dati e credenziali

`dati/`, `.env` e i file di configurazione possono contenere stato locale o credenziali. Non pubblicarli e non cancellarli durante una normale pulizia del codice.

## Motore PDF dell'agente

Adam dispone di `strumenti/pdf-agent.py`, un motore PDF ibrido che preferisce l'elaborazione locale:

- PyMuPDF per testo, annotazioni, rendering e modifiche visive;
- pypdf per pagine, cifratura e moduli AcroForm;
- qpdf per controllo, riparazione e linearizzazione;
- PDFtk come fallback per dati FDF/XFDF;
- APDF come backend cloud opzionale per OCR, analytics, link tracciati e webhook.

Verifica delle dipendenze:

```powershell
python strumenti/pdf-agent.py capabilities
```

APDF viene attivato soltanto impostando `APDF_API_TOKEN` nell'ambiente. La chiave non deve essere inserita nel repository. Per le operazioni locali non serve alcuna connessione Internet.
