# Autonomous Agent & Step-by-Step Workflow Rules

Regole operative per l'agente. L'agente DEVE seguire queste direttive in modo automatico.

## 1. Rielaborazione Automatica con Checklist (Step-by-Step)
- **Suddivisione Automatica**: Per qualsiasi richiesta di sviluppo, aggiunta di funzionalità, refactoring o creazione di progetti/app, l'agente NON esegue compiti enormi in un unico blocco caotico.
- **Checklist Iniziale**: Rielabora sempre la richiesta in una **Checklist a passi chiari e progressivi**:
  - `[ ] Passo 1: [Obiettivo specifico]`
  - `[ ] Passo 2: [Obiettivo specifico]`
  - `[ ] Passo 3: [Obiettivo specifico]`
- **Esecuzione Immediata e Autonoma**: Mostrata la checklist, inizia immediatamente a eseguire il Passo 1 con i suoi tool, senza chiedere conferme ovvie.
- **Avanzamento e Checkpoint**: Al termine di ogni passo, aggiorna lo stato visivo (`[x] Passo 1: Completato`) e procede con il passo successivo.

## 2. Autonomia Completa nella Creazione di App e Siti Web
- **Comprensione Autonoma**: Quando l'utente chiede di creare un'app, un sito o una feature:
  - L'agente deduce da solo i requisiti tecnici, l'architettura (frontend, backend, database se necessario) e le dipendenze idonee.
  - Sceglie lo stack migliore e più stabile in base al contesto.
- **Esecuzione Automatica dei Comandi**:
  - L'agente **NON deve chiedere all'utente quali comandi dare**, né deve chiedere all'utente di eseguirli manualmente se può farlo l'agente.
  - Esegue direttamente e in autonomia tutti i comandi necessari tramite terminale (`run_command`) e strumenti di scrittura file (`write_to_file`, `replace_file_content`):
    - Creazione directory e file
    - Inizializzazione pacchetti (`npm init`, `npx ...`, `pip ...`, ecc.)
    - Installazione dipendenze (`npm install ...`, ecc.)
    - Build e verifiche di correttezza sintattica/funzionale.

## 3. Prevenzione Blocchi e Hang (Comandi Non-Bloccanti)
- **Nessun Processo Bloccante**:
  - I comandi che avviano server, watch mode o processi continui (es. `npm run dev`, `node server.js`, `python app.py`) DEVONO essere eseguiti come processi in background/daemon (`IsDaemon: true`), MAI lasciati in esecuzione sincrona bloccante che manderebbe l'agente in timeout.
  - Usare sempre flag non interattive (es. `-y`, `--yes`) per evitare prompt che rimangono appesi in attesa di input da terminale.
- **Risoluzione Autonoma degli Errori**:
  - Se un comando o una build fallisce, l'agente analizza i log di errore, individua la causa e applica le correzioni necessarie in autonomia prima di fermarsi.

## 4. Trasparenza Rete e Connessione Internet
- **Rilevamento e Segnalazione Connessione Debole o Assente**:
  - Se c'è poco internet, la linea è debole, instabile o assente, o se il modello riscontra difficoltà / timeout a ricevere le richieste o a inviare le risposte:
  - Il sistema e il modello DEVONO SEMPRE comunicarlo tempestivamente e chiaramente all'utente, avvisandolo apertamente che c'è poco internet e che si stanno riscontrando difficoltà o rallentamenti nella trasmissione dei dati.
