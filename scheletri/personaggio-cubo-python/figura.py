"""La figura del personaggio: le immagini (sprite) di un personaggio riggato, fatte da Blender.

Il personaggio 3D vero (Robott: 25.000 triangoli) e' troppo pesante per questo disegno fatto a mano,
quindi Blender lo fotografa da 8 direzioni, fermo e in 8 pose della camminata (lo fa lo Studio:
strumenti/personaggio.js, oppure il pannello 3D). Qui si sceglie la foto giusta a ogni fotogramma:
  - la DIREZIONE dipende da dove guarda il personaggio rispetto alla camera (0 = di spalle);
  - la POSA dipende da quanta strada ha fatto: cosi' i piedi non scivolano sul pavimento.
Se le immagini non ci sono, disegno.py disegna il personaggio a scatole, come prima.

Dove si cercano (vince la prima che c'e'):
  ../personaggio-3d/sprite   convertito dal pannello 3D nella cartella del progetto
  personaggio-3d/sprite      quello che viaggia con il gioco (Robott)
"""
import json
import math
import os

import pygame

CARTELLE = (os.path.join('..', 'personaggio-3d', 'sprite'), os.path.join('personaggio-3d', 'sprite'))
METRI_PER_CICLO = 1.6    # strada fatta in una camminata completa (due passi): i piedi non scivolano
FERMO = 0.4              # sotto questa velocita' (m/s) il personaggio sta fermo
POSA_IN_ARIA = 2         # nei salti: la posa della camminata a gambe aperte
MAX_SCALATE = 300        # quante immagini gia' ridimensionate tenere pronte
META_ALTEZZA = 0.9       # il centro del corpo, sopra i piedi: da li' si misura la sua profondita'


def trova(cartella_gioco):
    """Il percorso di sprite.json, o None se non c'e'."""
    for relativa in CARTELLE:
        scheda = os.path.normpath(os.path.join(cartella_gioco, relativa, 'sprite.json'))
        if os.path.isfile(scheda):
            return scheda
    return None


def direzione(guarda, angolo_camera, direzioni=8):
    """Quale delle foto: 0 = di spalle (si allontana dalla camera), 2 = va verso destra sullo schermo,
    4 = viene verso la camera, 6 = va verso sinistra. guarda e angolo_camera in radianti."""
    relativo = (guarda - angolo_camera) % (2 * math.pi)
    return int(round(relativo / (2 * math.pi / direzioni))) % direzioni


def posa(strada, velocita, a_terra, fotogrammi=8):
    """None = la foto da fermo; altrimenti il fotogramma della camminata (0..fotogrammi-1)."""
    if not fotogrammi:
        return None
    if not a_terra:
        return POSA_IN_ARIA % fotogrammi
    if velocita < FERMO:
        return None
    return int((strada % METRI_PER_CICLO) / METRI_PER_CICLO * fotogrammi) % fotogrammi


class Figura:
    """Le foto caricate, e le stesse gia' ridimensionate per la distanza dalla camera."""

    def __init__(self, scheda):
        with open(scheda, encoding='utf-8') as f:
            info = json.load(f)
        cartella = os.path.dirname(scheda)
        self.cartella = cartella
        self.nome = info.get('nome') or os.path.basename(os.path.dirname(cartella))
        self.direzioni = int(info.get('direzioni', 8))
        self.fotogrammi = int(info.get('fotogrammi_camminata', 0))
        self.altezza_px = int(info.get('altezza', 256))
        larghezza_px = int(info.get('larghezza', 128))
        altezza_metri = float(info.get('altezza_metri', 1.8))
        # quanti metri e' alto un pixel e a che riga stanno i piedi (le immagini vecchie non lo dicono:
        # la camera di Blender copriva 1,12 volte l'altezza del personaggio, sul lato lungo)
        self.metri_per_pixel = float(info.get('metri_per_pixel') or altezza_metri * 1.12 / max(larghezza_px, self.altezza_px))
        self.piedi_px = float(info.get('piedi_px') or self.altezza_px / 2.0 + altezza_metri * 0.5 / self.metri_per_pixel)
        self.foto = {}
        for d in range(self.direzioni):
            self.foto[(d, None)] = self._carica('riposo_d%d.png' % d)
            for f in range(self.fotogrammi):
                self.foto[(d, f)] = self._carica('cammina_d%d_f%d.png' % (d, f))
        self._scalate = {}

    def _carica(self, nome):
        return pygame.image.load(os.path.join(self.cartella, nome)).convert_alpha()

    def immagine(self, d, f, altezza_sullo_schermo):
        """La foto (d, f) alta altezza_sullo_schermo pixel."""
        chiave = (d, f, altezza_sullo_schermo)
        pronta = self._scalate.get(chiave)
        if pronta is None:
            if len(self._scalate) > MAX_SCALATE:
                self._scalate.clear()
            originale = self.foto[(d, f)]
            scala = altezza_sullo_schermo / float(self.altezza_px)
            misura = (max(1, int(round(originale.get_width() * scala))), max(1, altezza_sullo_schermo))
            pronta = pygame.transform.smoothscale(originale, misura)
            self._scalate[chiave] = pronta
        return pronta

    def disposta(self, piedi_sullo_schermo, pixel_per_metro, d, f):
        """(immagine, rettangolo) con i piedi della foto sul punto dei piedi sullo schermo."""
        altezza = max(4, int(round(self.altezza_px * self.metri_per_pixel * pixel_per_metro)))
        immagine = self.immagine(d, f, altezza)
        scala = altezza / float(self.altezza_px)
        x = piedi_sullo_schermo[0] - immagine.get_width() / 2.0
        y = piedi_sullo_schermo[1] - self.piedi_px * scala
        return immagine, pygame.Rect(int(round(x)), int(round(y)), immagine.get_width(), immagine.get_height())


def carica(cartella_gioco):
    """La figura del gioco, o None (niente immagini, o immagini rotte: si torna alle scatole)."""
    scheda = trova(cartella_gioco)
    if not scheda:
        return None
    try:
        return Figura(scheda)
    except (OSError, ValueError, KeyError, pygame.error) as errore:
        print('Le immagini del personaggio in %s non si caricano (%s): disegno le scatole.' % (os.path.dirname(scheda), errore))
        return None


_caricate = {}


def del_gioco(cartella_gioco):
    """Come carica(), ma una volta sola: le foto si leggono dal disco al primo disegno e poi restano."""
    if cartella_gioco not in _caricate:
        _caricate[cartella_gioco] = carica(cartella_gioco)
    return _caricate[cartella_gioco]


def posto(fig, vista, angolo_camera, eroe):
    """Dove va la foto: (profondita', immagine, rettangolo), o None se il personaggio e' dietro la camera.
    La foto ha i piedi sul punto dei piedi e la misura giusta per la sua distanza; la profondita' e'
    quella del centro del corpo, per metterla in fila con le facce del mondo."""
    corpo = eroe.corpo
    a_terra = vista.proietta((corpo.pos[0], corpo.piedi(), corpo.pos[2]))
    centro = vista.proietta((corpo.pos[0], corpo.piedi() + META_ALTEZZA, corpo.pos[2]))
    if a_terra is None or centro is None:
        return None
    piedi_sullo_schermo, distanza = a_terra
    d = direzione(eroe.guarda, angolo_camera, fig.direzioni)
    f = posa(eroe.strada, corpo.velocita_orizzontale(), corpo.a_terra, fig.fotogrammi)
    immagine, rettangolo = fig.disposta(piedi_sullo_schermo, vista.focale / distanza, d, f)
    return centro[1], immagine, rettangolo


def _tocca(punti, rettangolo):
    """Vero se il poligono (punti sullo schermo) puo' toccare il rettangolo: basta il suo riquadro."""
    xs = [p[0] for p in punti]
    ys = [p[1] for p in punti]
    return min(xs) < rettangolo.right and max(xs) > rettangolo.left and min(ys) < rettangolo.bottom and max(ys) > rettangolo.top


def dietro_e_davanti(facce, posto_figura):
    """Le facce del mondo (profondita', punti, colore, ombra, sotto_i_piedi), dalla piu' lontana, divise
    in quelle da disegnare prima della foto e quelle dopo. Il pavimento sotto i piedi va sempre prima:
    il centro di un quadrato da un metro puo' essere piu' vicino alla camera del personaggio che ci
    cammina sopra, e gli taglierebbe i piedi."""
    facce = sorted(facce, key=lambda f: -f[0])
    if posto_figura is None:
        return facce, []
    profondita, _immagine, rettangolo = posto_figura
    dietro, davanti = [], []
    for faccia in facce:
        if faccia[0] >= profondita or (faccia[4] and _tocca(faccia[1], rettangolo)):
            dietro.append(faccia)
        else:
            davanti.append(faccia)
    return dietro, davanti
