"""Il disegno in 3D: una camera che segue il personaggio da dietro e le scatole viste in prospettiva.

Niente librerie 3D: gli angoli di ogni faccia si proiettano sullo schermo e le facce si disegnano
dalla piu' lontana alla piu' vicina (l'"algoritmo del pittore"). Le facce grandi sono divise in
quadrati da un metro: l'ordine giusto si sbaglia di rado, e il pavimento a scacchi fa capire quanto
ci si muove. L'ombra sotto i piedi dice dove si atterrera': senza, nei salti ci si perde.

Il personaggio e' una foto fatta da Blender (figura.py) messa alla sua profondita' fra le facce;
se le foto non ci sono, e' fatto di scatole come il resto.
"""
import math
import os

import pygame

import figura
import fisica


def _normalizza(x, y, z):
    lunghezza = math.sqrt(x * x + y * y + z * z)
    return (x / lunghezza, y / lunghezza, z / lunghezza)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


LUCE = _normalizza(0.35, 1.0, -0.45)   # da dove arriva la luce
VICINO = 0.15                           # piu' vicino di cosi' alla camera non si disegna
LATO_QUADRATO = 1.0                     # le facce grandi si dividono in quadrati da un metro
CARTELLA = os.path.dirname(os.path.abspath(__file__))   # qui (e accanto) si cercano le foto


class Camera:
    """Terza persona: guarda il personaggio da dietro e un po' dall'alto."""

    def __init__(self):
        self.angolo = 0.0       # giro orizzontale: 0 = guarda verso +z
        self.alzo = 0.55        # quanto guarda dall'alto, in radianti
        self.distanza = 12.0    # abbastanza lontana da vedere il cubo intero, lati compresi
        self.bersaglio = [0.0, 0.6, 0.0]

    def gira(self, orizzontale, verticale):
        self.angolo += orizzontale
        self.alzo = min(1.25, max(0.12, self.alzo + verticale))

    def segui(self, pos, dt):
        # insegue il personaggio con un po' di morbidezza: niente scatti a ogni passo
        k = min(1.0, dt * 8.0)
        obiettivo = (pos[0], pos[1] + 0.2, pos[2])
        for i in range(3):
            self.bersaglio[i] += (obiettivo[i] - self.bersaglio[i]) * k

    def assi(self):
        sa, ca = math.sin(self.angolo), math.cos(self.angolo)
        sp, cp = math.sin(self.alzo), math.cos(self.alzo)
        avanti = (sa * cp, -sp, ca * cp)
        destra = (ca, 0.0, -sa)
        su = (sa * sp, cp, ca * sp)
        posizione = tuple(self.bersaglio[i] - avanti[i] * self.distanza for i in range(3))
        return posizione, avanti, destra, su


class _Vista:
    """La camera di questo fotogramma: da punto del mondo a punto dello schermo."""

    def __init__(self, camera, larghezza, altezza):
        self.pos, self.avanti, self.destra, self.su = camera.assi()
        self.cx, self.cy = larghezza / 2.0, altezza / 2.0
        self.focale = larghezza * 0.72

    def proietta(self, p):
        v = (p[0] - self.pos[0], p[1] - self.pos[1], p[2] - self.pos[2])
        z = _dot(v, self.avanti)
        if z < VICINO:
            return None
        return (self.cx + self.focale * _dot(v, self.destra) / z, self.cy - self.focale * _dot(v, self.su) / z), z


def _ombreggia(colore, normale, scacco=1.0):
    luce = 0.5 + 0.5 * max(0.0, _dot(normale, LUCE))
    return tuple(max(0, min(255, int(c * luce * scacco))) for c in colore)


def _ruota(p, centro, angolo):
    """Gira un punto attorno all'asse verticale che passa per centro."""
    if not angolo:
        return p
    s, c = math.sin(angolo), math.cos(angolo)
    dx, dz = p[0] - centro[0], p[2] - centro[2]
    return (centro[0] + dx * c + dz * s, p[1], centro[2] - dx * s + dz * c)


def _divisioni(minimo, massimo, tagli=()):
    """Dove dividere un lato: su una griglia da un metro ferma nel mondo (cosi' gli scacchi combaciano
    fra una faccia e l'altra), piu' i bordi delle cose appoggiate sopra. Con i bordi, un quadrato di
    pavimento o e' tutto sotto un gradino o e' tutto fuori: mai a meta'."""
    punti = {minimo, massimo}
    k = math.floor(minimo / LATO_QUADRATO) + 1
    while k * LATO_QUADRATO < massimo - 1e-9:
        punti.add(k * LATO_QUADRATO)
        k += 1
    for taglio in tagli:
        if minimo + 1e-9 < taglio < massimo - 1e-9:
            punti.add(taglio)
    return sorted(punti)


def _facce(centro, mezze, colore, angolo=0.0, quadrati=True, tagli_x=(), tagli_z=()):
    """Le facce di una scatola, divise in quadrati. Ogni faccia: (angoli, normale, colore, sopra, rettangolo)."""
    facce = []
    for asse in range(3):
        u, v = [a for a in range(3) if a != asse]
        for segno in (-1.0, 1.0):
            normale = [0.0, 0.0, 0.0]
            normale[asse] = segno
            normale = tuple(normale)
            if angolo:
                n = _ruota((normale[0], normale[1], normale[2]), (0.0, 0.0, 0.0), angolo)
                normale = (n[0], n[1], n[2])
            sopra = asse == 1 and segno > 0
            lo_u, hi_u = centro[u] - mezze[u], centro[u] + mezze[u]
            lo_v, hi_v = centro[v] - mezze[v], centro[v] + mezze[v]
            if quadrati:
                cu = _divisioni(lo_u, hi_u, tagli_x if (sopra and u == 0) else ())
                cv = _divisioni(lo_v, hi_v, tagli_z if (sopra and v == 2) else ())
            else:
                cu, cv = [lo_u, hi_u], [lo_v, hi_v]
            for i in range(len(cu) - 1):
                for j in range(len(cv) - 1):
                    u0, u1, v0, v1 = cu[i], cu[i + 1], cv[j], cv[j + 1]
                    angoli = []
                    for (a, b) in ((u0, v0), (u1, v0), (u1, v1), (u0, v1)):
                        p = [0.0, 0.0, 0.0]
                        p[asse] = centro[asse] + segno * mezze[asse]
                        p[u], p[v] = a, b
                        angoli.append(_ruota(tuple(p), centro, angolo))
                    scacco = 1.0 if (math.floor((u0 + u1) / 2) + math.floor((v0 + v1) / 2)) % 2 == 0 else 0.9
                    rettangolo = (u0, u1, v0, v1) if sopra else None
                    facce.append((angoli, normale, _ombreggia(colore, normale, scacco), sopra, rettangolo))
    return facce


def _taglia(poligono, rettangolo):
    """Il pezzo di un poligono (punti x, z) che cade dentro un rettangolo (x0, x1, z0, z1)."""
    x0, x1, z0, z1 = rettangolo
    bordi = ((0, x0, 1), (0, x1, -1), (1, z0, 1), (1, z1, -1))
    for asse, limite, verso in bordi:
        if not poligono:
            break
        dentro = lambda p: (p[asse] - limite) * verso >= 0
        uscita = []
        for k in range(len(poligono)):
            a, b = poligono[k - 1], poligono[k]
            if dentro(b):
                if not dentro(a):
                    t = (limite - a[asse]) / (b[asse] - a[asse])
                    uscita.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                uscita.append(b)
            elif dentro(a):
                t = (limite - a[asse]) / (b[asse] - a[asse])
                uscita.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
        poligono = uscita
    return poligono


def scena(schermo, camera, mondo, eroe):
    larghezza, altezza = schermo.get_size()
    vista = _Vista(camera, larghezza, altezza)
    schermo.fill(mondo.CIELO)
    corpo = eroe.corpo
    piedi = corpo.piedi()

    # L'ombra: un cerchio sotto i piedi, sulla cima piu' alta che c'e' sotto. Piu' si e' in alto,
    # piu' e' piccola: e' quello che fa capire dove si atterrera'.
    cima = fisica.appoggio(corpo, mondo.SCATOLE)
    ombra = None
    if cima is not None:
        raggio = 0.38 * max(0.35, 1.0 - (corpo.piedi() - cima) / 6.0)
        ombra = (cima, [(corpo.pos[0] + raggio * math.cos(a * math.pi / 6), corpo.pos[2] + raggio * math.sin(a * math.pi / 6))
                        for a in range(12)])

    da_disegnare = []
    for scatola in mondo.SCATOLE:
        appoggiate = [s for s in mondo.SCATOLE if s is not scatola and abs(s.minimo(1) - scatola.cima()) < 1e-6]
        tagli_x = [b for s in appoggiate for b in (s.minimo(0), s.massimo(0))]
        tagli_z = [b for s in appoggiate for b in (s.minimo(2), s.massimo(2))]
        for angoli, normale, colore, sopra, rettangolo in _facce(scatola.centro, scatola.mezze, scatola.colore,
                                                                 tagli_x=tagli_x, tagli_z=tagli_z):
            meta = [sum(p[k] for p in angoli) / 4.0 for k in range(3)]
            verso_camera = (vista.pos[0] - meta[0], vista.pos[1] - meta[1], vista.pos[2] - meta[2])
            if _dot(normale, verso_camera) <= 0:
                continue                      # faccia girata dall'altra parte: non si vede
            if sopra and _coperta(rettangolo, meta[1], appoggiate):
                continue                      # pavimento sotto un gradino: non si vede mai
            proiettati = [vista.proietta(p) for p in angoli]
            if any(p is None for p in proiettati):
                continue
            profondita = sum(p[1] for p in proiettati) / 4.0
            pezzo_ombra = None
            if ombra and sopra and abs(angoli[0][1] - ombra[0]) < 1e-6:
                pezzo_ombra = _taglia(ombra[1], rettangolo)
            # "sotto i piedi": una faccia tutta piu' in basso dei piedi non copre mai il personaggio
            # (la camera guarda dall'alto), anche se il suo centro e' piu' vicino alla camera
            sotto_i_piedi = max(p[1] for p in angoli) <= piedi + 0.02
            da_disegnare.append((profondita, [p[0] for p in proiettati], colore, pezzo_ombra, sotto_i_piedi))

    fig = figura.del_gioco(CARTELLA)
    if fig:
        # prima quello che sta dietro al personaggio, poi la sua foto, poi quello che sta davanti
        posto = figura.posto(fig, vista, camera.angolo, eroe)
        dietro, davanti = figura.dietro_e_davanti(da_disegnare, posto)
        _disegna_facce(schermo, vista, dietro, ombra)
        if posto:
            schermo.blit(posto[1], posto[2])
        _disegna_facce(schermo, vista, davanti, ombra)
        return

    # Senza foto: corpo, testa e visiera a scatole, girati verso dove cammina (solo nel disegno:
    # per la fisica resta una scatola dritta).
    pezzi = [
        ((corpo.pos[0], piedi + 0.55, corpo.pos[2]), (0.3, 0.55, 0.22), (230, 90, 70)),
        ((corpo.pos[0], piedi + 1.33, corpo.pos[2]), (0.22, 0.22, 0.22), (240, 205, 165)),
    ]
    sa, ca = math.sin(eroe.guarda), math.cos(eroe.guarda)
    pezzi.append(((corpo.pos[0] + sa * 0.2, piedi + 1.38, corpo.pos[2] + ca * 0.2), (0.15, 0.05, 0.04), (40, 50, 70)))
    for centro, mezze, colore in pezzi:
        for angoli, normale, tinta, _sopra, _r in _facce(centro, mezze, colore, eroe.guarda, quadrati=False):
            meta = [sum(p[k] for p in angoli) / 4.0 for k in range(3)]
            verso_camera = (vista.pos[0] - meta[0], vista.pos[1] - meta[1], vista.pos[2] - meta[2])
            if _dot(normale, verso_camera) <= 0:
                continue
            proiettati = [vista.proietta(p) for p in angoli]
            if any(p is None for p in proiettati):
                continue
            da_disegnare.append((sum(p[1] for p in proiettati) / 4.0 - 0.01, [p[0] for p in proiettati], tinta, None, False))

    da_disegnare.sort(key=lambda f: -f[0])
    _disegna_facce(schermo, vista, da_disegnare, ombra)


def _disegna_facce(schermo, vista, facce, ombra):
    """Le facce nell'ordine dato (dalla piu' lontana), ciascuna con il suo pezzo d'ombra."""
    for _profondita, punti, colore, pezzo_ombra, _sotto in facce:
        pygame.draw.polygon(schermo, colore, punti)
        if pezzo_ombra and len(pezzo_ombra) >= 3:
            scura = tuple(int(c * 0.55) for c in colore)
            sullo_schermo = [vista.proietta((x, ombra[0] + 0.005, z)) for x, z in pezzo_ombra]
            if all(p is not None for p in sullo_schermo):
                pygame.draw.polygon(schermo, scura, [p[0] for p in sullo_schermo])


def _coperta(rettangolo, quota, appoggiate):
    """Vero se un quadrato del pavimento e' TUTTO sotto una scatola appoggiata li' sopra (non si vede mai).
    Tutto, non solo il centro: con il centro solo, accanto ai gradini restavano dei buchi."""
    x0, x1, z0, z1 = rettangolo
    for s in appoggiate:
        if abs(s.minimo(1) - quota) > 1e-6:
            continue
        if s.minimo(0) - 1e-6 <= x0 and x1 <= s.massimo(0) + 1e-6 and s.minimo(2) - 1e-6 <= z0 and z1 <= s.massimo(2) + 1e-6:
            return True
    return False


def scritte(schermo, font, eroe, fps):
    corpo = eroe.corpo
    fig = figura.del_gioco(CARTELLA)
    righe = [
        'W A S D / frecce: muovi   Spazio: salta   Q E / mouse (tasto sinistro): camera   R: riparti   Esc: esci',
        '%s   velocita\' %.1f m/s   quota piedi %.2f m   cadute %d   %d fps   personaggio: %s' % (
            'a terra' if corpo.a_terra else 'in aria', corpo.velocita_orizzontale(), corpo.piedi(), eroe.cadute, fps,
            fig.nome if fig else 'scatole (niente foto)'),
    ]
    y = 8
    for riga in righe:
        schermo.blit(font.render(riga, True, (232, 232, 238)), (10, y))
        y += 20
