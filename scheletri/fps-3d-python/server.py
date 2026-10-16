"""Server della partita: tiene insieme i giocatori e gli zombie.

Avvialo UNA VOLTA SOLA, prima dei giochi:   python server.py
Poi ogni giocatore avvia main.py. Non serve installare niente: usa solo quello che c'e' in Python.

Chi comanda e' il server: le posizioni degli zombie e la vita dei giocatori le decide lui e le
manda a tutti. Cosi' i due giocatori vedono la stessa partita, invece di due partite diverse.
"""

import json
import math
import os
import socket
import threading
import time

from mondo import e_un_blocco, posto_libero

# La porta si puo' cambiare senza toccare il codice (serve anche alle prove dello Studio).
INDIRIZZO = ('0.0.0.0', int(os.environ.get('PORTA_GIOCO', 50007)))
ZOMBIE_MASSIMI = 6
SECONDI_FRA_ZOMBIE = 4.0
DANNO_ZOMBIE = 12.0          # al secondo, stando attaccati
DANNO_COLPO = 25

giocatori = {}               # indirizzo -> stato del giocatore
zombie = []
prossimo_id = 1
prossimo_zombie = 1
blocco = threading.Lock()
presa = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)


def manda(indirizzo, messaggio):
    try:
        presa.sendto(json.dumps(messaggio).encode('utf-8'), indirizzo)
    except OSError:
        pass


def manda_a_tutti(messaggio):
    for indirizzo in list(giocatori.keys()):
        manda(indirizzo, messaggio)


def elenco_giocatori():
    return [{'id': g['id'], 'x': round(g['x'], 3), 'y': round(g['y'], 3), 'ang': round(g['ang'], 3),
             'vita': int(g['vita']), 'punti': g['punti']} for g in giocatori.values()]


def elenco_zombie():
    return [{'id': z['id'], 'x': round(z['x'], 3), 'y': round(z['y'], 3), 'vita': int(z['vita'])} for z in zombie]


def entra(indirizzo):
    global prossimo_id
    x, y = posto_libero()
    giocatori[indirizzo] = {'id': prossimo_id, 'x': x, 'y': y, 'ang': 0.0, 'vita': 100, 'punti': 0, 'visto': time.time()}
    prossimo_id += 1
    print('[Server] Giocatore %d entrato (%d in partita)' % (giocatori[indirizzo]['id'], len(giocatori)))
    manda(indirizzo, {'tipo': 'benvenuto', 'id': giocatori[indirizzo]['id'],
                      'giocatori': elenco_giocatori(), 'zombie': elenco_zombie()})


def spara(indirizzo, messaggio):
    sparatore = giocatori.get(indirizzo)
    if not sparatore:
        return
    if messaggio.get('bersaglio') == 'giocatore':
        vittima = next((g for g in giocatori.values() if g['id'] == messaggio.get('id')), None)
        if not vittima:
            return
        vittima['vita'] -= DANNO_COLPO
        if vittima['vita'] <= 0:
            vittima['vita'] = 100
            vittima['x'], vittima['y'] = posto_libero()
            sparatore['punti'] += 1
    elif messaggio.get('bersaglio') == 'zombie':
        colpito = next((z for z in zombie if z['id'] == messaggio.get('id')), None)
        if not colpito:
            return
        colpito['vita'] -= 34
        if colpito['vita'] <= 0:
            zombie.remove(colpito)
            sparatore['punti'] += 1


def ascolta():
    while True:
        try:
            dati, indirizzo = presa.recvfrom(65535)
        except OSError:
            return
        try:
            messaggio = json.loads(dati.decode('utf-8'))
        except ValueError:
            continue
        with blocco:
            if indirizzo not in giocatori:
                entra(indirizzo)
            giocatore = giocatori[indirizzo]
            giocatore['visto'] = time.time()
            tipo = messaggio.get('tipo')
            if tipo == 'stato':
                giocatore['x'] = float(messaggio.get('x', giocatore['x']))
                giocatore['y'] = float(messaggio.get('y', giocatore['y']))
                giocatore['ang'] = float(messaggio.get('ang', giocatore['ang']))
            elif tipo == 'sparo':
                spara(indirizzo, messaggio)
            elif tipo == 'esco':
                print('[Server] Giocatore %d uscito' % giocatore['id'])
                del giocatori[indirizzo]


def partita():
    global prossimo_zombie
    ultimo_zombie = time.time()
    ultimo_giro = time.time()
    while True:
        time.sleep(1 / 15.0)
        ora = time.time()
        dt = ora - ultimo_giro
        ultimo_giro = ora
        with blocco:
            # Chi non si fa piu' sentire da 5 secondi ha chiuso il gioco.
            for indirizzo in [a for a, g in giocatori.items() if ora - g['visto'] > 5]:
                print('[Server] Giocatore %d sparito' % giocatori[indirizzo]['id'])
                del giocatori[indirizzo]
            if not giocatori:
                zombie.clear()
                continue
            if len(zombie) < ZOMBIE_MASSIMI and ora - ultimo_zombie > SECONDI_FRA_ZOMBIE:
                ultimo_zombie = ora
                x, y = posto_libero()
                zombie.append({'id': prossimo_zombie, 'x': x, 'y': y, 'vita': 100})
                prossimo_zombie += 1
            for z in zombie:
                vicino = min(giocatori.values(), key=lambda g: (g['x'] - z['x']) ** 2 + (g['y'] - z['y']) ** 2)
                dx = vicino['x'] - z['x']
                dy = vicino['y'] - z['y']
                distanza = math.hypot(dx, dy) or 1.0
                if distanza > 0.8:
                    passo_x = (dx / distanza) * 1.4 * dt
                    passo_y = (dy / distanza) * 1.4 * dt
                    if not e_un_blocco(z['x'] + passo_x, z['y']):
                        z['x'] += passo_x
                    if not e_un_blocco(z['x'], z['y'] + passo_y):
                        z['y'] += passo_y
                else:
                    vicino['vita'] -= DANNO_ZOMBIE * dt
                    if vicino['vita'] <= 0:
                        vicino['vita'] = 100
                        vicino['x'], vicino['y'] = posto_libero()
            manda_a_tutti({'tipo': 'mondo', 'giocatori': elenco_giocatori(), 'zombie': elenco_zombie()})


def main():
    presa.bind(INDIRIZZO)
    print('Server pronto sulla porta %d: adesso avvia main.py (anche in due finestre).' % INDIRIZZO[1])
    threading.Thread(target=partita, daemon=True).start()
    try:
        ascolta()
    except KeyboardInterrupt:
        print('\nServer fermato.')


if __name__ == '__main__':
    main()
