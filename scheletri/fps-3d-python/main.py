"""
FPS a blocchi in prima persona, multiplayer - scheletro di partenza.

MOTORE 3D: raycasting. Non serve installare niente oltre a pygame: la vista in prima persona si
disegna con i raggi (una colonna di schermo per volta), come nei primi FPS. Niente schede grafiche,
niente librerie da scaricare: parte e basta.

Comandi: W A S D per muoversi, mouse per girare, tasto sinistro per sparare, ESC per uscire.
Per giocare in due: avvia una volta sola "server.py", poi "main.py" su ogni finestra o computer.

Questo file e' fatto per essere MODIFICATO un pezzo alla volta. Ogni parte e' segnata qui sotto:
impostazioni, mappa, rete, motore 3D, gioco, ciclo principale.
"""

import json
import math
import os
import random
import socket
import threading
import time

import pygame

# La mappa sta in mondo.py: la usano sia il gioco sia il server, e resta una sola.
from mondo import MAPPA_LARGA, MAPPA_ALTA, e_un_blocco, posto_libero

# ----------------------------------------------------------------- impostazioni

LARGHEZZA, ALTEZZA = 800, 600
PASSO_RAGGI = 2              # una colonna ogni 2 pixel: piu' basso = piu' bello e piu' lento
CAMPO_VISIVO = math.pi / 3   # 60 gradi
VELOCITA = 3.2               # caselle al secondo
SENSIBILITA_MOUSE = 0.0032
PORTATA_SPARO = 12.0
MUNIZIONI_PIENE = 30
INDIRIZZO_SERVER = ('127.0.0.1', int(os.environ.get('PORTA_GIOCO', 50007)))

CIELO = (120, 190, 235)
TERRA = (70, 105, 60)
COLORI_BLOCCHI = [(95, 165, 95), (120, 150, 85), (135, 120, 80)]   # erba, muschio, terra

# La mappa e i suoi aiuti (e_un_blocco, posto_libero) stanno in mondo.py, importati qui sopra.

# ----------------------------------------------------------------- la rete (altri giocatori e zombie)

class Rete:
    """Manda la nostra posizione al server e riceve quella degli altri. Se il server non c'e',
    il gioco continua da solo: 'collegato' resta False e gli zombie li mette il gioco stesso."""

    def __init__(self, indirizzo=INDIRIZZO_SERVER):
        self.indirizzo = indirizzo
        self.presa = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.presa.settimeout(0.3)
        self.id = None
        self.collegato = False
        self.giocatori = []
        self.zombie = []
        self.vita = None
        self.punti = 0
        self._ultimo = 0.0
        self._acceso = True
        threading.Thread(target=self._ascolta, daemon=True).start()

    def manda(self, messaggio):
        try:
            self.presa.sendto(json.dumps(messaggio).encode('utf-8'), self.indirizzo)
        except OSError:
            pass

    def _ascolta(self):
        while self._acceso:
            try:
                dati, _ = self.presa.recvfrom(65535)
            except socket.timeout:
                if time.time() - self._ultimo > 2.0:
                    self.collegato = False
                continue
            except OSError:
                return
            try:
                m = json.loads(dati.decode('utf-8'))
            except ValueError:
                continue
            self._ultimo = time.time()
            self.collegato = True
            if m.get('tipo') == 'benvenuto':
                self.id = m.get('id')
            elif m.get('tipo') == 'mondo':
                self.giocatori = m.get('giocatori', [])
                self.zombie = m.get('zombie', [])
                mio = next((g for g in self.giocatori if g.get('id') == self.id), None)
                if mio:
                    self.vita = mio.get('vita')
                    self.punti = mio.get('punti', 0)

    def chiudi(self):
        self._acceso = False
        try:
            self.presa.close()
        except OSError:
            pass


# ----------------------------------------------------------------- motore 3D (raycasting)

def lancia_raggio(x, y, angolo):
    """Quanto e' lontano il primo blocco in quella direzione, e se e' colpito di lato.
    Restituisce: distanza, lato (0 = faccia est/ovest, 1 = nord/sud), casella colpita, e in che
    punto della faccia (0..1) - serve a disegnare i bordi dei cubi."""
    dx = math.cos(angolo)
    dy = math.sin(angolo)
    casella_x, casella_y = int(x), int(y)
    delta_x = abs(1.0 / dx) if dx else 1e9
    delta_y = abs(1.0 / dy) if dy else 1e9
    if dx < 0:
        passo_x, prossimo_x = -1, (x - casella_x) * delta_x
    else:
        passo_x, prossimo_x = 1, (casella_x + 1 - x) * delta_x
    if dy < 0:
        passo_y, prossimo_y = -1, (y - casella_y) * delta_y
    else:
        passo_y, prossimo_y = 1, (casella_y + 1 - y) * delta_y
    lato = 0
    for _ in range(64):
        if prossimo_x < prossimo_y:
            prossimo_x += delta_x
            casella_x += passo_x
            lato = 0
        else:
            prossimo_y += delta_y
            casella_y += passo_y
            lato = 1
        if e_un_blocco(casella_x, casella_y):
            distanza = max(0.05, (prossimo_x - delta_x) if lato == 0 else (prossimo_y - delta_y))
            dove = (y + distanza * dy) if lato == 0 else (x + distanza * dx)
            return distanza, lato, casella_x, casella_y, dove - math.floor(dove)
    return 64.0, 0, 0, 0, 0.0


def disegna_vista(schermo, giocatore, profondita):
    pygame.draw.rect(schermo, CIELO, (0, 0, LARGHEZZA, ALTEZZA // 2))
    pygame.draw.rect(schermo, TERRA, (0, ALTEZZA // 2, LARGHEZZA, ALTEZZA - ALTEZZA // 2))
    meta = CAMPO_VISIVO / 2
    for i, colonna in enumerate(range(0, LARGHEZZA, PASSO_RAGGI)):
        angolo = giocatore['ang'] - meta + (colonna / LARGHEZZA) * CAMPO_VISIVO
        distanza, lato, casella_x, casella_y, dove = lancia_raggio(giocatore['x'], giocatore['y'], angolo)
        distanza *= math.cos(angolo - giocatore['ang'])          # toglie l'effetto "occhio di pesce"
        distanza = max(distanza, 0.05)
        profondita[i] = distanza
        altezza_muro = min(ALTEZZA * 3.0, ALTEZZA / distanza)
        cima = (ALTEZZA - altezza_muro) / 2
        ombra = max(0.25, 1.0 - distanza / 14.0) * (0.72 if lato else 1.0)
        # Ogni cubo un po' diverso dal vicino, e i bordi piu' scuri: cosi' si vedono i cubi
        # invece di una parete unica tutta dello stesso colore.
        base = COLORI_BLOCCHI[(casella_x * 3 + casella_y * 7) % len(COLORI_BLOCCHI)]
        if dove < 0.035 or dove > 0.965:
            ombra *= 0.55
        colore = (int(base[0] * ombra), int(base[1] * ombra), int(base[2] * ombra))
        pygame.draw.rect(schermo, colore, (colonna, int(cima), PASSO_RAGGI, int(altezza_muro)))


def disegna_sagome(schermo, giocatore, sagome, profondita):
    """Zombie e altri giocatori: rettangoli grandi quanto la distanza, nascosti dietro i muri."""
    in_ordine = sorted(sagome, key=lambda s: -((s['x'] - giocatore['x']) ** 2 + (s['y'] - giocatore['y']) ** 2))
    for s in in_ordine:
        dx = s['x'] - giocatore['x']
        dy = s['y'] - giocatore['y']
        distanza = math.hypot(dx, dy)
        if distanza < 0.25:
            continue
        angolo = math.atan2(dy, dx) - giocatore['ang']
        while angolo > math.pi:
            angolo -= 2 * math.pi
        while angolo < -math.pi:
            angolo += 2 * math.pi
        if abs(angolo) > CAMPO_VISIVO * 0.75:
            continue
        colonna = int((0.5 + angolo / CAMPO_VISIVO) * LARGHEZZA)
        indice = max(0, min(len(profondita) - 1, colonna // PASSO_RAGGI))
        if distanza > profondita[indice]:
            continue                                              # sta dietro un muro
        altezza = min(ALTEZZA * 2.0, ALTEZZA / distanza)
        corpo = pygame.Rect(0, 0, int(altezza * 0.45), int(altezza * 0.9))
        corpo.center = (colonna, ALTEZZA // 2 + int(altezza * 0.05))
        pygame.draw.rect(schermo, s['colore'], corpo)
        occhio = max(2, int(altezza * 0.06))
        pygame.draw.rect(schermo, (255, 230, 60), (corpo.centerx - occhio * 2, corpo.top + occhio, occhio, occhio))
        pygame.draw.rect(schermo, (255, 230, 60), (corpo.centerx + occhio, corpo.top + occhio, occhio, occhio))


def disegna_mirino(schermo):
    centro_x, centro_y = LARGHEZZA // 2, ALTEZZA // 2
    pygame.draw.line(schermo, (255, 255, 255), (centro_x - 10, centro_y), (centro_x + 10, centro_y), 2)
    pygame.draw.line(schermo, (255, 255, 255), (centro_x, centro_y - 10), (centro_x, centro_y + 10), 2)


# ----------------------------------------------------------------- il gioco

def main():
    pygame.init()
    schermo = pygame.display.set_mode((LARGHEZZA, ALTEZZA))
    pygame.display.set_caption("FPS a blocchi - multiplayer")
    orologio = pygame.time.Clock()
    scritte = pygame.font.Font(None, 30)

    # Si parte guardando verso il centro della mappa, e da un punto con un po' di spazio davanti:
    # nascere col naso contro un muro fa sembrare che il gioco non funzioni.
    partenza_x, partenza_y = posto_libero()
    verso_il_centro = math.atan2(MAPPA_ALTA / 2 - partenza_y, MAPPA_LARGA / 2 - partenza_x)
    for _ in range(40):
        if lancia_raggio(partenza_x, partenza_y, verso_il_centro)[0] > 3.0:
            break
        partenza_x, partenza_y = posto_libero()
        verso_il_centro = math.atan2(MAPPA_ALTA / 2 - partenza_y, MAPPA_LARGA / 2 - partenza_x)
    giocatore = {'x': partenza_x, 'y': partenza_y, 'ang': verso_il_centro, 'vita': 100,
                 'munizioni': MUNIZIONI_PIENE, 'punti': 0}
    profondita = [99.0] * (LARGHEZZA // PASSO_RAGGI + 1)
    zombie_locali = []
    prossimo_zombie = 1
    rete = Rete()
    rete.manda({'tipo': 'entro'})

    try:
        pygame.event.set_grab(True)
        pygame.mouse.set_visible(False)
    except pygame.error:
        pass   # senza finestra vera (per esempio nelle prove dello Studio) il mouse non si blocca

    ultimo_invio = 0.0
    in_gioco = True
    while in_gioco:
        dt = orologio.tick(60) / 1000.0
        ora = time.time()

        # --- cosa fa il giocatore
        for evento in pygame.event.get():
            if evento.type == pygame.QUIT:
                in_gioco = False
            elif evento.type == pygame.KEYDOWN:
                if evento.key == pygame.K_ESCAPE:
                    in_gioco = False
                elif evento.key == pygame.K_r:
                    giocatore['munizioni'] = MUNIZIONI_PIENE
            elif evento.type == pygame.MOUSEBUTTONDOWN and evento.button == 1:
                spara(giocatore, rete, zombie_locali)
            elif evento.type == pygame.MOUSEMOTION:
                giocatore['ang'] += evento.rel[0] * SENSIBILITA_MOUSE

        tasti = pygame.key.get_pressed()
        if tasti[pygame.K_LEFT]:
            giocatore['ang'] -= 2.2 * dt
        if tasti[pygame.K_RIGHT]:
            giocatore['ang'] += 2.2 * dt
        avanti = (1 if tasti[pygame.K_w] else 0) - (1 if tasti[pygame.K_s] else 0)
        lato = (1 if tasti[pygame.K_d] else 0) - (1 if tasti[pygame.K_a] else 0)
        muovi(giocatore, avanti, lato, dt)

        # --- gli altri: dal server, oppure zombie messi dal gioco se si gioca da soli
        if rete.collegato:
            if ora - ultimo_invio > 0.05:
                ultimo_invio = ora
                rete.manda({'tipo': 'stato', 'x': giocatore['x'], 'y': giocatore['y'], 'ang': giocatore['ang']})
            if rete.vita is not None:
                giocatore['vita'] = rete.vita
                giocatore['punti'] = rete.punti
            sagome = [{'x': g['x'], 'y': g['y'], 'colore': (70, 130, 220), 'tipo': 'giocatore', 'id': g['id']}
                      for g in rete.giocatori if g.get('id') != rete.id]
            sagome += [{'x': z['x'], 'y': z['y'], 'colore': (150, 40, 40), 'tipo': 'zombie', 'id': z['id']}
                       for z in rete.zombie]
        else:
            if len(zombie_locali) < 4 and random.random() < dt * 0.4:
                x, y = posto_libero()
                zombie_locali.append({'id': prossimo_zombie, 'x': x, 'y': y, 'vita': 100})
                prossimo_zombie += 1
            muovi_zombie_locali(zombie_locali, giocatore, dt)
            sagome = [{'x': z['x'], 'y': z['y'], 'colore': (150, 40, 40), 'tipo': 'zombie', 'id': z['id']}
                      for z in zombie_locali]

        # --- si disegna
        disegna_vista(schermo, giocatore, profondita)
        disegna_sagome(schermo, giocatore, sagome, profondita)
        disegna_mirino(schermo)
        schermo.blit(scritte.render('Vita: %d   Munizioni: %d   Punti: %d' % (
            giocatore['vita'], giocatore['munizioni'], giocatore['punti']), True, (255, 255, 255)), (14, 12))
        schermo.blit(scritte.render(
            'collegato: %d giocatori' % len(rete.giocatori) if rete.collegato else 'da solo (avvia server.py per giocare in due)',
            True, (255, 255, 255)), (14, 40))
        # SENZA QUESTA RIGA LO SCHERMO NON CAMBIA MAI: e' lei che mostra quello che hai disegnato.
        pygame.display.flip()

    rete.manda({'tipo': 'esco'})
    rete.chiudi()
    pygame.quit()


def muovi(giocatore, avanti, lato, dt):
    dx = (math.cos(giocatore['ang']) * avanti - math.sin(giocatore['ang']) * lato) * VELOCITA * dt
    dy = (math.sin(giocatore['ang']) * avanti + math.cos(giocatore['ang']) * lato) * VELOCITA * dt
    # Un asse per volta: cosi' si scivola lungo il muro invece di incastrarsi.
    if not e_un_blocco(giocatore['x'] + dx * 1.4, giocatore['y']):
        giocatore['x'] += dx
    if not e_un_blocco(giocatore['x'], giocatore['y'] + dy * 1.4):
        giocatore['y'] += dy


def muovi_zombie_locali(zombie, giocatore, dt):
    for z in zombie:
        dx = giocatore['x'] - z['x']
        dy = giocatore['y'] - z['y']
        distanza = math.hypot(dx, dy) or 1.0
        if distanza > 0.8:
            passo_x = (dx / distanza) * 1.4 * dt
            passo_y = (dy / distanza) * 1.4 * dt
            if not e_un_blocco(z['x'] + passo_x, z['y']):
                z['x'] += passo_x
            if not e_un_blocco(z['x'], z['y'] + passo_y):
                z['y'] += passo_y


def spara(giocatore, rete, zombie_locali):
    """Colpisce la sagoma piu' vicina che sta davvero davanti al mirino e non dietro un muro."""
    if giocatore['munizioni'] <= 0:
        return
    giocatore['munizioni'] -= 1
    if rete.collegato:
        bersagli = [(g, 'giocatore') for g in rete.giocatori if g.get('id') != rete.id]
        bersagli += [(z, 'zombie') for z in rete.zombie]
    else:
        bersagli = [(z, 'zombie') for z in zombie_locali]
    distanza_muro = lancia_raggio(giocatore['x'], giocatore['y'], giocatore['ang'])[0]
    migliore = None
    for bersaglio, tipo in bersagli:
        dx = bersaglio['x'] - giocatore['x']
        dy = bersaglio['y'] - giocatore['y']
        distanza = math.hypot(dx, dy)
        if distanza > min(PORTATA_SPARO, distanza_muro):
            continue
        scarto = math.atan2(dy, dx) - giocatore['ang']
        while scarto > math.pi:
            scarto -= 2 * math.pi
        while scarto < -math.pi:
            scarto += 2 * math.pi
        if abs(scarto) > 0.12:                      # non e' sotto il mirino
            continue
        if migliore is None or distanza < migliore[2]:
            migliore = (bersaglio, tipo, distanza)
    if migliore is None:
        return
    bersaglio, tipo, _ = migliore
    if rete.collegato:
        rete.manda({'tipo': 'sparo', 'bersaglio': tipo, 'id': bersaglio['id']})
    else:
        bersaglio['vita'] -= 34
        if bersaglio['vita'] <= 0 and bersaglio in zombie_locali:
            zombie_locali.remove(bersaglio)
            giocatore['punti'] += 1


if __name__ == '__main__':
    main()
