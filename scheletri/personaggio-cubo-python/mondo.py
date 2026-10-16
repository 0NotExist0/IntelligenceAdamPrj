"""Il mondo: il cubo su cui sta il personaggio e qualche gradino su cui saltare.

Tutto e' fatto di scatole (fisica.Scatola). Per cambiare il livello si cambia solo questo file:
la fisica e il disegno usano quello che trovano qui.
"""
from fisica import Scatola

# Il cubo grande: 8 x 4 x 8 metri. La sua faccia di sopra e' a quota 0: li' si cammina.
CUBO = Scatola(0.0, -2.0, 0.0, 4.0, 2.0, 4.0, colore=(90, 150, 110))

# I gradini appoggiati sul cubo (il centro sta a meta' della loro altezza).
GRADINI = [
    Scatola(2.2, 0.4, -2.2, 0.8, 0.4, 0.8, colore=(200, 160, 80)),     # alto 0,8 m: un salto facile
    Scatola(-2.2, 0.75, -2.2, 0.8, 0.75, 0.8, colore=(190, 110, 90)),  # alto 1,5 m: serve un salto preciso
    Scatola(-2.4, 0.3, 2.0, 0.6, 0.3, 1.2, colore=(120, 130, 190)),    # una panca bassa
]

SCATOLE = [CUBO] + GRADINI

PARTENZA = (0.0, 3.0, 0.0)   # il personaggio arriva dall'alto e cade sul cubo
QUOTA_CADUTA = -15.0          # se cade dal cubo e scende sotto questa quota, riparte
CIELO = (28, 32, 44)
