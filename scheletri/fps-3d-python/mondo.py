"""La mappa del mondo: la usano sia il gioco (main.py) sia il server (server.py).

Sta in un file a parte apposta: se cambi la mappa qui, cambia per tutti insieme. Se invece ne
tieni due copie, prima o poi giocatori e zombie si muovono in due mondi diversi.

1 = blocco pieno, 0 = aria. Righe e colonne sono quadrate: MAPPA[y][x].
"""

import random

MAPPA = [
    "1111111111111111",
    "1000000000000001",
    "1011100000011101",
    "1010000110000101",
    "1010011111100101",
    "1000010000100001",
    "1000010000100001",
    "1001110000111001",
    "1000000000000001",
    "1000110000110001",
    "1000100000010001",
    "1011100000011101",
    "1010000000000101",
    "1010001111000101",
    "1000000000000001",
    "1111111111111111",
]
MAPPA_LARGA = len(MAPPA[0])
MAPPA_ALTA = len(MAPPA)


def e_un_blocco(x, y):
    """C'e' un blocco in questo punto? Fuori dalla mappa conta come blocco: non si esce."""
    if x < 0 or y < 0 or x >= MAPPA_LARGA or y >= MAPPA_ALTA:
        return True
    return MAPPA[int(y)][int(x)] == '1'


def posto_libero():
    """Un punto a caso dove non c'e' un blocco: per far nascere giocatori e zombie."""
    for _ in range(500):
        x = random.uniform(1.5, MAPPA_LARGA - 1.5)
        y = random.uniform(1.5, MAPPA_ALTA - 1.5)
        if not e_un_blocco(x, y):
            return x, y
    return 1.5, 1.5
