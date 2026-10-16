"""Texture che si ripetono senza cuciture, fatte con i numeri.

Non scarica niente e non usa modelli: il disegno nasce da rumore periodico (lo stesso principio dei
materiali di Blender), quindi il bordo destro combacia con il sinistro e il basso con l'alto. Va
bene per i blocchi di un gioco: pietra, erba, terra, legno, mattoni, sabbia, metallo, foglie.

Uso:  python texture-procedurale.py <tipo> <file.png> [dimensione] [seme]
Stampa TEXTURE=<json> con le misure di quello che ha prodotto (colori, cucitura, colore dominante):
sono quelle che lo Studio controlla per dire se la texture e' venuta bene o e' un quadrato piatto.
"""

import json
import struct
import sys
import zlib

import numpy as np

TIPI = ('pietra', 'erba', 'terra', 'legno', 'mattoni', 'sabbia', 'metallo', 'foglie')


# ----------------------------------------------------------------- rumore che si ripete

def rumore(dim, celle, rng):
    """Rumore morbido su una griglia che si richiude su se stessa (quindi senza cuciture)."""
    griglia = rng.random((celle, celle))
    passi = np.linspace(0, celle, dim, endpoint=False)
    i0 = np.floor(passi).astype(int) % celle
    i1 = (i0 + 1) % celle
    t = passi - np.floor(passi)
    t = t * t * (3 - 2 * t)                      # curva morbida: niente spigoli fra una cella e l'altra

    alto = griglia[np.ix_(i0, i0)] * (1 - t)[None, :] + griglia[np.ix_(i0, i1)] * t[None, :]
    basso = griglia[np.ix_(i1, i0)] * (1 - t)[None, :] + griglia[np.ix_(i1, i1)] * t[None, :]
    return alto * (1 - t)[:, None] + basso * t[:, None]


def frattale(dim, rng, ottave=4, celle=4):
    """Piu' rumori sovrapposti, ognuno il doppio piu' fitto e la meta' piu' debole."""
    somma = np.zeros((dim, dim))
    ampiezza = 1.0
    totale = 0.0
    for o in range(ottave):
        somma += rumore(dim, celle * (2 ** o), rng) * ampiezza
        totale += ampiezza
        ampiezza *= 0.5
    return somma / totale


def mescola(colore_a, colore_b, quanto):
    a = np.array(colore_a, dtype=float)
    b = np.array(colore_b, dtype=float)
    return a[None, None, :] + (b - a)[None, None, :] * quanto[:, :, None]


# ----------------------------------------------------------------- i tipi di texture

def texture(tipo, dim, seme):
    rng = np.random.default_rng(seme)
    n = frattale(dim, rng, ottave=5, celle=4)
    fine = frattale(dim, rng, ottave=3, celle=16)

    if tipo == 'pietra':
        # Contrasto alto, granello fitto e crepe: con la sola sfumatura morbida sembrava nebbia.
        granello = frattale(dim, rng, ottave=2, celle=64)
        crepe = 1.0 - np.abs(frattale(dim, rng, ottave=3, celle=10) * 2 - 1)     # venature scure
        base = mescola((72, 72, 80), (198, 198, 208), np.clip((n - 0.5) * 1.7 + 0.5, 0, 1))
        base += (granello[:, :, None] - 0.5) * 52 + (fine[:, :, None] - 0.5) * 26
        base -= np.clip(crepe - 0.72, 0, 1)[:, :, None] * 190
    elif tipo == 'erba':
        base = mescola((44, 108, 40), (118, 176, 62), n)
        base += (fine[:, :, None] - 0.5) * 46
    elif tipo == 'terra':
        base = mescola((78, 54, 34), (146, 104, 66), n)
        base += (fine[:, :, None] - 0.5) * 30
    elif tipo == 'sabbia':
        granelli = frattale(dim, rng, ottave=2, celle=64)
        onde = np.sin((np.mgrid[0:dim, 0:dim][0] / float(dim) * 9.0 + n * 2.2) * np.pi * 2.0) * 0.5 + 0.5
        base = mescola((178, 150, 96), (240, 224, 180), np.clip(onde * 0.45 + n * 0.35 + granelli * 0.2, 0, 1))
        base += (granelli[:, :, None] - 0.5) * 26
    elif tipo == 'metallo':
        # endpoint=False: cosi' l'ultima colonna non ripete la prima e la texture si richiude bene.
        righe = np.sin(np.linspace(0, np.pi * 24, dim, endpoint=False))[None, :] * 0.5 + 0.5
        base = mescola((118, 122, 130), (196, 200, 210), n * 0.55 + righe * 0.45)
        base += (fine[:, :, None] - 0.5) * 12
    elif tipo == 'foglie':
        venature = frattale(dim, rng, ottave=3, celle=32)
        base = mescola((22, 62, 26), (128, 186, 72), np.clip(fine * 0.55 + n * 0.25 + venature * 0.2, 0, 1))
        base += (venature[:, :, None] - 0.5) * 42
        buchi = (fine > 0.74)
        base[buchi] = base[buchi] * 0.4
    elif tipo == 'legno':
        y, x = np.mgrid[0:dim, 0:dim] / float(dim)
        # Le venature seguono una serie di anelli deformati dal rumore: si ripetono ai bordi.
        anelli = np.sin((x * 7.0 + n * 1.6) * np.pi * 2.0) * 0.5 + 0.5
        base = mescola((104, 66, 34), (176, 128, 72), anelli * 0.75 + fine * 0.25)
        base += (fine[:, :, None] - 0.5) * 18
    elif tipo == 'mattoni':
        alte = max(4, dim // 8)                      # altezza di un mattone
        larghe = max(8, dim // 4)
        file_intere = max(1, dim // alte)
        colonne_intere = max(1, dim // larghe)
        y, x = np.mgrid[0:dim, 0:dim]
        fila = (y // alte) % file_intere
        sfalsa = (fila % 2) * (larghe // 2)
        # Gli indici si richiudono su se stessi: senza il "% colonne_intere" il mattone a destra non
        # e' lo stesso che riprende a sinistra, e ripetendo la texture si vede una riga netta.
        colonna = ((x + sfalsa) // larghe) % colonne_intere
        malta = ((y % alte) < max(1, alte // 10)) | (((x + sfalsa) % larghe) < max(1, larghe // 12))
        toni = rng.random((file_intere, colonne_intere))
        variazione = toni[fila, colonna]
        base = mescola((124, 52, 40), (186, 104, 80), variazione * 0.7 + n * 0.3)
        base[malta] = np.array((188, 184, 176)) * (0.85 + fine[malta][:, None] * 0.3)
    else:
        raise SystemExit('tipo sconosciuto: %s (tipi: %s)' % (tipo, ', '.join(TIPI)))

    return np.clip(base, 0, 255).astype(np.uint8)


# ----------------------------------------------------------------- salvataggio e misure

def salva_png(percorso, pixel):
    """PNG scritto a mano: nessuna libreria da installare."""
    altezza, larghezza, _ = pixel.shape
    grezzo = b''.join(b'\x00' + pixel[y].tobytes() for y in range(altezza))

    def pezzo(tipo, dati):
        return (struct.pack('>I', len(dati)) + tipo + dati +
                struct.pack('>I', zlib.crc32(tipo + dati) & 0xffffffff))

    testa = struct.pack('>IIBBBBB', larghezza, altezza, 8, 2, 0, 0, 0)
    with open(percorso, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + pezzo(b'IHDR', testa) +
                pezzo(b'IDAT', zlib.compress(grezzo, 6)) + pezzo(b'IEND', b''))


def misure(pixel):
    """Quanto e' varia, quanto e' invisibile la cucitura, quanto domina un colore solo.

    La cucitura si giudica confrontandola con i salti che esistono GIA' dentro la texture: una
    parete di mattoni ha una riga di malta netta anche in mezzo, quindi trovarla al bordo non e'
    un difetto; lo diventa se il bordo e' piu' netto di qualunque altro punto dell'immagine.
    """
    piatta = pixel.reshape(-1, 3) >> 3                       # 32 livelli per canale: colori "a occhio"
    chiavi = (piatta[:, 0].astype(int) << 10) | (piatta[:, 1].astype(int) << 5) | piatta[:, 2]
    valori, quanti = np.unique(chiavi, return_counts=True)

    dx = np.abs(pixel[:, 1:].astype(int) - pixel[:, :-1].astype(int)).mean(axis=2)
    dy = np.abs(pixel[1:].astype(int) - pixel[:-1].astype(int)).mean(axis=2)
    cucitura_x = float(np.abs(pixel[:, 0].astype(int) - pixel[:, -1].astype(int)).mean(axis=1).mean())
    cucitura_y = float(np.abs(pixel[0].astype(int) - pixel[-1].astype(int)).mean(axis=1).mean())
    return {
        'colori': int(len(valori)),
        'dominante': round(float(quanti.max()) / chiavi.size, 3),
        'cucitura': round(max(cucitura_x, cucitura_y), 2),
        'saltoNormale': round(float((dx.mean() + dy.mean()) / 2), 2),
        'saltoMassimo': round(float(max(np.percentile(dx, 99.0), np.percentile(dy, 99.0))), 2)
    }


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    tipo = sys.argv[1]
    percorso = sys.argv[2]
    dim = int(sys.argv[3]) if len(sys.argv) > 3 else 256
    seme = int(sys.argv[4]) if len(sys.argv) > 4 else 7
    if dim < 16 or dim > 2048:
        raise SystemExit('dimensione fuori misura: %d' % dim)
    pixel = texture(tipo, dim, seme)
    salva_png(percorso, pixel)
    esito = {'tipo': tipo, 'file': percorso, 'larghezza': dim, 'altezza': dim, 'seme': seme}
    esito.update(misure(pixel))
    print('TEXTURE=' + json.dumps(esito))


if __name__ == '__main__':
    main()
