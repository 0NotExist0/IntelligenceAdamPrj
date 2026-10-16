"""La fisica del personaggio: gravita', salto, spinta, attrito e collisioni con i cubi.

Qui dentro non c'e' pygame: sono solo numeri. Cosi' la fisica si prova da sola (lo fanno le prove
dello Studio) e si cambia senza toccare il disegno. Le misure sono in metri e secondi.

Come funziona, in breve:
- ogni cosa solida e' una SCATOLA dritta (un cubo o un parallelepipedo, mai storto);
- il personaggio e' anche lui una scatola, con una velocita';
- a ogni passo (1/120 di secondo) si muove un asse alla volta: se finisce dentro una scatola lo si
  rimette a filo e si ferma la velocita' su quell'asse. Se succede scendendo, vuol dire che e' a terra.
"""

GRAVITA = 25.0             # m/s^2: piu' della Terra, per un salto svelto da videogioco
VELOCITA_MAX = 6.0         # m/s camminando
ACCELERAZIONE = 40.0       # m/s^2 quando si spinge stando a terra
ACCELERAZIONE_ARIA = 15.0  # in aria si puo' correggere la direzione, ma meno
ATTRITO = 30.0             # m/s^2 di frenata a terra quando non si spinge
VELOCITA_SALTO = 9.0       # m/s verso l'alto: il salto arriva a circa 1,6 m
CADUTA_MAX = 30.0          # oltre questa velocita' non si accelera piu' cadendo
TEMPO_COYOTE = 0.08        # s: appena usciti dal bordo si puo' ancora saltare
PASSO = 1.0 / 120.0        # s: la simulazione va sempre a passi uguali
MARGINE = 1e-4             # distanza minima dalle superfici, per non restarci incastrati


class Scatola:
    """Una cosa solida: centro e mezze misure (mezza larghezza, mezza altezza, mezza profondita')."""

    def __init__(self, x, y, z, mx, my, mz, colore=(150, 150, 160)):
        self.centro = [x, y, z]
        self.mezze = [mx, my, mz]
        self.colore = colore

    def minimo(self, asse):
        return self.centro[asse] - self.mezze[asse]

    def massimo(self, asse):
        return self.centro[asse] + self.mezze[asse]

    def cima(self):
        return self.massimo(1)


class Corpo:
    """Una scatola che si muove: il personaggio."""

    def __init__(self, x, y, z, mx=0.3, my=0.8, mz=0.3):
        self.pos = [x, y, z]          # il centro del corpo
        self.vel = [0.0, 0.0, 0.0]
        self.mezze = [mx, my, mz]
        self.a_terra = False
        self.tempo_in_aria = 0.0

    def piedi(self):
        return self.pos[1] - self.mezze[1]

    def velocita_orizzontale(self):
        return (self.vel[0] ** 2 + self.vel[2] ** 2) ** 0.5


def sovrapposti(corpo, scatola):
    """Vero se il corpo e' (anche solo un po') dentro la scatola."""
    for asse in range(3):
        if corpo.pos[asse] + corpo.mezze[asse] <= scatola.minimo(asse):
            return False
        if corpo.pos[asse] - corpo.mezze[asse] >= scatola.massimo(asse):
            return False
    return True


def _muovi_asse(corpo, scatole, asse, spostamento):
    if spostamento == 0:
        return
    corpo.pos[asse] += spostamento
    for scatola in scatole:
        if not sovrapposti(corpo, scatola):
            continue
        if spostamento > 0:
            corpo.pos[asse] = scatola.minimo(asse) - corpo.mezze[asse] - MARGINE
        else:
            corpo.pos[asse] = scatola.massimo(asse) + corpo.mezze[asse] + MARGINE
            if asse == 1:
                corpo.a_terra = True       # sbattuto scendendo: ha i piedi su qualcosa
        corpo.vel[asse] = 0.0


def _verso(valore, obiettivo, quanto):
    """Avvicina valore a obiettivo, di al massimo quanto."""
    if valore < obiettivo:
        return min(obiettivo, valore + quanto)
    return max(obiettivo, valore - quanto)


def passo(corpo, scatole, direzione=(0.0, 0.0), salta=False, dt=PASSO):
    """Un passo di simulazione.

    direzione = (dx, dz): dove vuole andare il personaggio, nel mondo, lunga al massimo 1.
    salta = vero nel passo in cui si preme il tasto del salto.
    """
    dx, dz = direzione
    lunghezza = (dx * dx + dz * dz) ** 0.5
    if lunghezza > 1.0:
        dx, dz, lunghezza = dx / lunghezza, dz / lunghezza, 1.0

    # 1. la spinta: verso la velocita' voluta, oppure (a terra, senza spinta) la frenata
    spinta = ACCELERAZIONE if corpo.a_terra else ACCELERAZIONE_ARIA
    if lunghezza > 0:
        corpo.vel[0] = _verso(corpo.vel[0], dx * VELOCITA_MAX, spinta * dt)
        corpo.vel[2] = _verso(corpo.vel[2], dz * VELOCITA_MAX, spinta * dt)
    elif corpo.a_terra:
        veloce = corpo.velocita_orizzontale()
        if veloce > 0:
            resta = max(0.0, veloce - ATTRITO * dt)
            corpo.vel[0] *= resta / veloce
            corpo.vel[2] *= resta / veloce

    # 2. il salto: da terra, o un attimo dopo essere usciti dal bordo (non in aria: niente doppio salto)
    if salta and (corpo.a_terra or corpo.tempo_in_aria < TEMPO_COYOTE):
        corpo.vel[1] = VELOCITA_SALTO
        corpo.a_terra = False
        corpo.tempo_in_aria = TEMPO_COYOTE

    # 3. la gravita'
    corpo.vel[1] = max(-CADUTA_MAX, corpo.vel[1] - GRAVITA * dt)

    # 4. il movimento, un asse alla volta, con le collisioni
    corpo.a_terra = False
    _muovi_asse(corpo, scatole, 0, corpo.vel[0] * dt)
    _muovi_asse(corpo, scatole, 2, corpo.vel[2] * dt)
    _muovi_asse(corpo, scatole, 1, corpo.vel[1] * dt)
    if corpo.a_terra:
        corpo.tempo_in_aria = 0.0
    else:
        corpo.tempo_in_aria += dt
    return corpo


def appoggio(corpo, scatole):
    """La cima piu' alta sotto i piedi del personaggio (per disegnare l'ombra), o None."""
    migliore = None
    for scatola in scatole:
        dentro_x = scatola.minimo(0) <= corpo.pos[0] <= scatola.massimo(0)
        dentro_z = scatola.minimo(2) <= corpo.pos[2] <= scatola.massimo(2)
        if dentro_x and dentro_z and scatola.cima() <= corpo.piedi() + 0.05:
            if migliore is None or scatola.cima() > migliore:
                migliore = scatola.cima()
    return migliore
