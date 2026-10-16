# NotExist Intelligience Studio - Occhi dentro un programma Python con finestra (pygame).
#
# Python carica da solo "sitecustomize" all'avvio se lo trova nel percorso: lo Studio lancia il
# programma con questa cartella in PYTHONPATH e SDL_VIDEODRIVER=dummy (nessuna finestra sullo
# schermo dell'utente). Caso vero (15/9/2026): Adam dichiara "conversione completata con successo"
# perche' il processo e' uscito con codice 0; nel codice non c'era mai pygame.display.flip(), quindi
# la finestra non si sarebbe mai aggiornata, e pygame.draw.circle con il centro sbagliato avrebbe
# fermato il gioco al primo zombie. Qui si vede davvero:
#  - se il programma apre la finestra (set_mode) e se la aggiorna (flip/update);
#  - cosa c'e' sullo schermo: schermate dopo 1 e 3 secondi, con il colore che domina;
#  - cosa succede se si preme Spazio/Invio e si clicca, come farebbe una persona per iniziare.
# L'esito va in un file JSON (PROVA_PYTHON_ESITO) riscritto a ogni passo: il processo puo' essere
# fermato in qualsiasi momento senza perdere cio' che si e' visto.

import json
import os
import sys
import threading
import time

_ESITO = os.environ.get('PROVA_PYTHON_ESITO')
_SCHERMATE = os.environ.get('PROVA_PYTHON_SCHERMATE') or os.path.dirname(_ESITO or '.')
_inizio = time.time()
_blocco = threading.Lock()
_stato = {
    'pygame': False, 'finestra': None, 'finestraDopo': None, 'primoAggiornamento': None, 'aggiornamenti': 0,
    'schermate': [], 'input': [], 'titolo': None
}
_interno = {'t_finestra': None, 't_primo': None, 'momenti': [(1.0, 'dopo 1 secondo'), (3.0, 'dopo 3 secondi')]}


def _scrivi():
    if not _ESITO:
        return
    try:
        with _blocco:
            testo = json.dumps(_stato, ensure_ascii=False)
        temporaneo = _ESITO + '.tmp'
        with open(temporaneo, 'w', encoding='utf-8') as f:
            f.write(testo)
        os.replace(temporaneo, _ESITO)
    except Exception:
        pass


def _fotografa(pygame, etichetta):
    """Salva la schermata e misura quanto e' di un solo colore (campioni su una griglia)."""
    voce = {'momento': etichetta}
    try:
        superficie = pygame.display.get_surface()
        percorso = os.path.join(_SCHERMATE, 'python-%d-%d.png' % (int(_inizio * 1000), len(_stato['schermate'])))
        pygame.image.save(superficie, percorso)
        voce['file'] = percorso
        larghezza, altezza = superficie.get_size()
        conta = {}
        campioni = 0
        for gy in range(30):
            for gx in range(40):
                colore = superficie.get_at((int((gx + 0.5) * larghezza / 40), int((gy + 0.5) * altezza / 30)))
                chiave = (colore[0] >> 3, colore[1] >> 3, colore[2] >> 3)
                conta[chiave] = conta.get(chiave, 0) + 1
                campioni += 1
        dominante, quanti = max(conta.items(), key=lambda v: v[1])
        voce['quota'] = round(quanti / float(campioni), 3)
        voce['colore'] = '#%02x%02x%02x' % tuple((c << 3) | 4 for c in dominante)
    except Exception as e:
        voce['errore'] = str(e)[:200]
    with _blocco:
        _stato['schermate'].append(voce)
    _scrivi()


def _patch_pygame(pygame):
    display = pygame.display
    set_mode_originale = display.set_mode
    flip_originale = display.flip
    update_originale = display.update
    caption_originale = display.set_caption

    def set_mode(*a, **k):
        superficie = set_mode_originale(*a, **k)
        try:
            _stato['finestra'] = list(superficie.get_size())
            _stato['finestraDopo'] = round(time.time() - _inizio, 2)
            _interno['t_finestra'] = time.time()
        except Exception:
            pass
        _scrivi()
        return superficie

    def caption(titolo, *a, **k):
        _stato['titolo'] = str(titolo)[:80]
        return caption_originale(titolo, *a, **k)

    def dopo_aggiornamento():
        ora = time.time()
        _stato['aggiornamenti'] += 1
        if _interno['t_primo'] is None:
            _interno['t_primo'] = ora
            _stato['primoAggiornamento'] = round(ora - _inizio, 2)
            _scrivi()
        trascorso = ora - _interno['t_primo']
        while _interno['momenti'] and trascorso >= _interno['momenti'][0][0]:
            _, etichetta = _interno['momenti'].pop(0)
            _fotografa(pygame, etichetta)

    def flip(*a, **k):
        risultato = flip_originale(*a, **k)
        dopo_aggiornamento()
        return risultato

    def update(*a, **k):
        risultato = update_originale(*a, **k)
        dopo_aggiornamento()
        return risultato

    display.set_mode = set_mode
    display.flip = flip
    display.update = update
    display.set_caption = caption
    _stato['pygame'] = True
    _scrivi()


def _invia_input(pygame):
    """Come una persona davanti al menu: Spazio, Invio, un clic al centro, di nuovo Spazio."""
    passi = [(1.5, 'Spazio'), (1.7, 'Invio'), (2.0, 'clic al centro'), (2.4, 'Spazio')]
    for secondi, nome in passi:
        while _interno['t_finestra'] is None or time.time() - _interno['t_finestra'] < secondi:
            time.sleep(0.02)
        try:
            if nome == 'clic al centro':
                larghezza, altezza = _stato['finestra'] or [800, 600]
                centro = (larghezza // 2, altezza // 2)
                pygame.event.post(pygame.event.Event(pygame.MOUSEMOTION, pos=centro, rel=(0, 0), buttons=(0, 0, 0)))
                pygame.event.post(pygame.event.Event(pygame.MOUSEBUTTONDOWN, pos=centro, button=1))
                pygame.event.post(pygame.event.Event(pygame.MOUSEBUTTONUP, pos=centro, button=1))
            else:
                tasto = pygame.K_SPACE if nome == 'Spazio' else pygame.K_RETURN
                pygame.event.post(pygame.event.Event(pygame.KEYDOWN, key=tasto, mod=0, scancode=0, unicode=' ' if nome == 'Spazio' else '\r'))
                pygame.event.post(pygame.event.Event(pygame.KEYUP, key=tasto, mod=0, scancode=0))
            with _blocco:
                _stato['input'].append(nome)
        except Exception as e:
            with _blocco:
                _stato['input'].append(nome + ' (non inviato: %s)' % str(e)[:80])
        _scrivi()
    # Se il programma non aggiorna mai lo schermo, la schermata la si fa comunque: mostra cosa resta.
    while time.time() - _interno['t_finestra'] < 3.2:
        time.sleep(0.05)
    if _interno['t_primo'] is None:
        _fotografa(pygame, 'dopo 3 secondi, senza nessun aggiornamento dello schermo')


def _osserva():
    for _ in range(6000):
        modulo = sys.modules.get('pygame')
        if modulo is not None and getattr(modulo, 'display', None) is not None and hasattr(modulo.display, 'flip') and hasattr(modulo, 'event'):
            try:
                _patch_pygame(modulo)
            except Exception:
                return
            while _interno['t_finestra'] is None:
                time.sleep(0.02)
            try:
                _invia_input(modulo)
            except Exception:
                pass
            return
        time.sleep(0.005)


if _ESITO:
    _scrivi()
    threading.Thread(target=_osserva, daemon=True).start()
