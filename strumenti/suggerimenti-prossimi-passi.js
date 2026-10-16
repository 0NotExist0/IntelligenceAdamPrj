// NotExist Intelligience Studio - Suggerimenti e Azioni Rapide per Flusso di Lavoro
//
// Questo modulo genera automaticamente pulsanti interattivi con prompt ottimizzati
// quando Adam si ferma o conclude un passo (es. "PASSO FATTO", traguardi del capo-progetto,
// elenchi numerati di modifiche proposte da Adam, o verifiche).
// L'utente può cliccare un pulsante per far proseguire Adam all'istante senza dover
// digitare a mano "vai" o riscrivere le istruzioni.

const path = require('path');
const fs = require('fs');

function accorcia(testo, max = 45) {
  if (!testo) return '';
  const pulito = String(testo).replace(/\s+/g, ' ').trim();
  return pulito.length > max ? pulito.slice(0, max - 1).trim() + '…' : pulito;
}

function estraiPuntiNumerati(testo) {
  if (!testo) return [];
  const righe = String(testo).split('\n');
  const punti = [];
  const rePunto = /^\s*(\d+)[\.)\-]\s+(.+)/;

  for (const riga of righe) {
    const m = riga.match(rePunto);
    if (m) {
      const num = parseInt(m[1], 10);
      const contenuto = m[2].trim().replace(/[*_`]/g, '');
      if (contenuto.length > 5 && !contenuto.toLowerCase().startsWith('passo fatto')) {
        punti.push({ num, testo: contenuto });
      }
    }
  }

  // Se i numeri sono consecutivi (es. 1, 2, 3...)
  if (punti.length >= 2) {
    return punti.slice(0, 6);
  }
  return [];
}

function eProgettoUnity(projectDir) {
  if (!projectDir) return false;
  return fs.existsSync(path.join(projectDir, 'Assets')) && fs.existsSync(path.join(projectDir, 'ProjectSettings'));
}

/**
 * Genera l'elenco delle azioni rapide / prompt suggeriti per far proseguire il flusso.
 * @param {Object} params
 * @param {string} params.projectDir - Cartella del progetto
 * @param {string} params.lastTurnText - Testo generato da Adam nell'ultimo turno
 * @param {Object} [params.piano] - Oggetto piano di capo-progetto (se presente)
 * @param {string} [params.lastSystemMessage] - Testo dell'ultimo messaggio di sistema
 * @param {Array} [params.failures] - Eventuali errori di verifica
 * @returns {Array<{ id: string, titolo: string, prompt: string, icona: string, tipo: string, badge?: string }>}
 */
function generaAzioniRapide(params = {}) {
  const { projectDir, lastTurnText = '', piano = null, lastSystemMessage = '', failures = [] } = params;
  const azioni = [];
  const isUnity = eProgettoUnity(projectDir);

  // 1. Caso Errori di verifica: priorità massima alla correzione
  if (failures && failures.length > 0) {
    azioni.push({
      id: 'act_fix_errors',
      titolo: `🔧 Correggi ${failures.length} ${failures.length === 1 ? 'errore' : 'errori'}`,
      prompt: `Correggi subito tutti gli errori riscontrati nella verifica automatica dei file toccati. Non spiegare soltanto: modifica i file per risolvere il problema.`,
      icona: 'wrench',
      tipo: 'danger',
      badge: 'Priorità'
    });
    azioni.push({
      id: 'act_reverify',
      titolo: '🧪 Riverifica senza modifiche',
      prompt: 'Esegui nuovamente il controllo di verifica sui file del progetto per controllare se gli errori persistono.',
      icona: 'check',
      tipo: 'secondary'
    });
    return azioni;
  }

  // 2. Azione dal Piano Attivo (Capo Progetto)
  if (piano && Array.isArray(piano.passi) && piano.passi.length > 0) {
    const idxCorrente = typeof piano.corrente === 'number' ? piano.corrente : 0;
    const passoCorrente = piano.passi[idxCorrente];

    if (passoCorrente && !piano.finito && idxCorrente < piano.passi.length) {
      const numPasso = idxCorrente + 1;
      const totPassi = piano.passi.length;
      const titoloPasso = passoCorrente.testo || '';

      let promptOttimizzato = `Procedi adesso con il PASSO ${numPasso} di ${totPassi}: "${titoloPasso}".\n`;
      if (isUnity) {
        promptOttimizzato += `Ambiente: Unity 6 URP. Crea o modifica gli script C# necessari all'interno di Assets/Scripts/. Assicurati che ereditino da MonoBehaviour o NetworkBehaviour se applicabile.`;
      } else {
        promptOttimizzato += `Applica le modifiche necessarie ai file del progetto e verifica che il codice sia privo di errori di sintassi.`;
      }

      azioni.push({
        id: 'act_prossimo_passo',
        titolo: `▶ Passo ${numPasso}/${totPassi}: ${accorcia(titoloPasso, 38)}`,
        prompt: promptOttimizzato,
        icona: 'play',
        tipo: 'primary',
        badge: `Passo ${numPasso}`
      });

      // Se c'è un passo successivo al corrente
      if (idxCorrente + 1 < piano.passi.length) {
        const passoDopo = piano.passi[idxCorrente + 1];
        azioni.push({
          id: 'act_passo_successivo_preview',
          titolo: `⏭ Salta a Passo ${numPasso + 1}: ${accorcia(passoDopo.testo, 32)}`,
          prompt: `Salta direttamente al passo ${numPasso + 1} di ${totPassi}: "${passoDopo.testo}".`,
          icona: 'forward',
          tipo: 'secondary'
        });
      }
    } else if (piano.finito) {
      azioni.push({
        id: 'act_piano_completato_test',
        titolo: '🎉 Piano completato: Collauda progetto',
        prompt: 'Tutti i passi previsti risultano completati con successo. Esegui un collaudo approfondito e una sintesi delle modifiche implementate.',
        icona: 'check-circle',
        tipo: 'success',
        badge: 'Completato'
      });
    }
  }

  // 3. Estrazione dei punti proposti direttamente da Adam
  const puntiNumerati = estraiPuntiNumerati(lastTurnText);
  if (puntiNumerati.length >= 2) {
    // Tasto per eseguire tutti i punti in blocco
    const testoTutti = puntiNumerati.map(p => `${p.num}. ${p.testo}`).join('\n');
    let promptTutti = `Procedi ed esegui i ${puntiNumerati.length} punti che hai individuato:\n${testoTutti}\n`;
    if (isUnity) {
      promptTutti += `Lavora nei percorsi appropriati di Unity (Assets/ e Packages/manifest.json).`;
    }

    azioni.push({
      id: 'act_esegui_tutti_punti',
      titolo: `⚡ Esegui tutti i ${puntiNumerati.length} punti proposti`,
      prompt: promptTutti,
      icona: 'zap',
      tipo: 'accent',
      badge: `${puntiNumerati.length} task`
    });

    // Singoli punti principali (primi 3)
    puntiNumerati.slice(0, 3).forEach(p => {
      azioni.push({
        id: `act_punto_${p.num}`,
        titolo: `${p.num}. ${accorcia(p.testo, 34)}`,
        prompt: `Procedi eseguendo specificamente il punto ${p.num}: ${p.testo}`,
        icona: 'code',
        tipo: 'substep'
      });
    });
  }

  // 4. Se Adam ha dichiarato PASSO FATTO e non abbiamo ancora azioni primarie
  if (azioni.length === 0 && /PASSO FATTO/i.test(lastTurnText)) {
    azioni.push({
      id: 'act_continua_generico',
      titolo: '▶ Continua con il prossimo passo',
      prompt: 'Ottimo lavoro. Procedi con la prossima modifica necessaria per completare il flusso.',
      icona: 'play',
      tipo: 'primary'
    });
  }

  // 5. Azioni contestuali di supporto (Unity o Web)
  if (isUnity) {
    if (/netcode|multiplayer|network/i.test(lastTurnText) || /netcode|multiplayer|network/i.test(lastSystemMessage)) {
      azioni.push({
        id: 'act_doc_netcode',
        titolo: '📚 Consulta documentazione Unity Netcode',
        prompt: 'Verifica la documentazione ufficiale di Unity Learn su https://learn.unity.com/ per Netcode for GameObjects, NetworkManager e NetworkObject, applicando l\'architettura corretta.',
        icona: 'book-open',
        tipo: 'secondary'
      });
    }

    azioni.push({
      id: 'act_verifica_unity',
      titolo: '🔍 Verifica conformità Unity 6 C#',
      prompt: 'Effettua una verifica degli script C# in Assets/Scripts/: assicurati che usino il New Input System, metodi aggiornati di Unity 6 (es. FindFirstObjectByType) e che non contengano librerie deprecate.',
      icona: 'check-square',
      tipo: 'secondary'
    });
  } else {
    azioni.push({
      id: 'act_verifica_generale',
      titolo: '🔍 Verifica e collaudo codice',
      prompt: 'Verifica che i file toccati funzionino regolarmente, non generino errori a runtime e rispettino le buone pratiche di codice pulito.',
      icona: 'check-square',
      tipo: 'secondary'
    });
  }

  // Azione per richiedere spiegazione o piano dettagliato se l'utente vuole orientarsi
  azioni.push({
    id: 'act_spiega_passi',
    titolo: '💡 Spiegami cosa farai nel dettaglio',
    prompt: 'Prima di procedere, spiegami in modo sintetico e chiaro quali file intendi modificare e quali classi o componenti andrai a creare.',
    icona: 'help-circle',
    tipo: 'subtle'
  });

  return azioni;
}

module.exports = {
  accorcia,
  estraiPuntiNumerati,
  eProgettoUnity,
  generaAzioniRapide
};
