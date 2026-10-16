"""Il personaggio: trasforma i comandi in una direzione nel mondo, li passa alla fisica, riparte se cade."""
import math

import fisica
import mondo


class Personaggio:
    def __init__(self):
        self.corpo = fisica.Corpo(*mondo.PARTENZA)
        self.guarda = 0.0      # verso dove e' girato (radianti): serve solo a disegnarlo
        self.strada = 0.0      # metri fatti camminando: decide la posa della camminata (figura.py)
        self.cadute = 0

    def riparti(self, caduto=True):
        self.corpo = fisica.Corpo(*mondo.PARTENZA)
        if caduto:
            self.cadute += 1

    def aggiorna(self, avanti, destra, salta, angolo_camera, dt=fisica.PASSO):
        """Un passo. avanti e destra vanno da -1 a 1 e sono relativi a dove guarda la camera:
        "avanti" allontana il personaggio dalla camera, "destra" lo sposta verso destra sullo schermo."""
        fx, fz = math.sin(angolo_camera), math.cos(angolo_camera)   # davanti alla camera
        rx, rz = fz, -fx                                              # a destra della camera
        dx = fx * avanti + rx * destra
        dz = fz * avanti + rz * destra
        fisica.passo(self.corpo, mondo.SCATOLE, (dx, dz), salta, dt)
        if self.corpo.a_terra:
            self.strada += self.corpo.velocita_orizzontale() * dt
        if abs(dx) + abs(dz) > 0.01:
            self.guarda = math.atan2(dx, dz)
        if self.corpo.pos[1] < mondo.QUOTA_CADUTA:
            self.riparti()
