"""Un personaggio controllabile su un cubo, con fisica vera. Serve solo pygame.

Comandi: W A S D (o le frecce) per muoversi, Spazio per saltare, Q/E oppure il mouse (tieni premuto
il tasto sinistro e trascina) per girare la camera, R per ripartire, Esc per uscire.

Quale file fa cosa:
  main.py         la finestra, i tasti e il ciclo del gioco (questo file)
  fisica.py       gravita', salto, attrito e collisioni: solo numeri, niente pygame
  mondo.py        il cubo e i gradini: per cambiare il livello si cambia solo li'
  personaggio.py  dai tasti a una direzione nel mondo, e la ripartenza se cade
  disegno.py      la camera e il 3D
"""
import pygame

import disegno
import fisica
import mondo
from personaggio import Personaggio

LARGHEZZA, ALTEZZA = 960, 600


def main():
    pygame.init()
    schermo = pygame.display.set_mode((LARGHEZZA, ALTEZZA))
    pygame.display.set_caption('Personaggio sul cubo - fisica')
    orologio = pygame.time.Clock()
    font = pygame.font.SysFont('consolas', 16)

    eroe = Personaggio()
    camera = disegno.Camera()
    accumulato = 0.0
    salto_chiesto = False
    in_corso = True

    while in_corso:
        dt = min(orologio.tick(60) / 1000.0, 0.1)

        for evento in pygame.event.get():
            if evento.type == pygame.QUIT:
                in_corso = False
            elif evento.type == pygame.KEYDOWN:
                if evento.key == pygame.K_ESCAPE:
                    in_corso = False
                elif evento.key == pygame.K_SPACE:
                    salto_chiesto = True
                elif evento.key == pygame.K_r:
                    eroe.riparti(caduto=False)
            elif evento.type == pygame.MOUSEMOTION and evento.buttons[0]:
                camera.gira(evento.rel[0] * 0.008, evento.rel[1] * 0.005)

        tasti = pygame.key.get_pressed()
        avanti = int(tasti[pygame.K_w] or tasti[pygame.K_UP]) - int(tasti[pygame.K_s] or tasti[pygame.K_DOWN])
        destra = int(tasti[pygame.K_d] or tasti[pygame.K_RIGHT]) - int(tasti[pygame.K_a] or tasti[pygame.K_LEFT])
        if tasti[pygame.K_q]:
            camera.gira(-2.0 * dt, 0.0)
        if tasti[pygame.K_e]:
            camera.gira(2.0 * dt, 0.0)

        # La fisica va a passi fissi (1/120 di secondo), uguali su qualunque computer: con passi
        # che cambiano, i salti verrebbero piu' alti o piu' bassi a seconda di quanto e' veloce.
        accumulato += dt
        while accumulato >= fisica.PASSO:
            eroe.aggiorna(avanti, destra, salto_chiesto, camera.angolo)
            salto_chiesto = False
            accumulato -= fisica.PASSO

        camera.segui(eroe.corpo.pos, dt)
        disegno.scena(schermo, camera, mondo, eroe)
        disegno.scritte(schermo, font, eroe, orologio.get_fps())
        pygame.display.flip()   # la riga da non togliere mai: mostra sullo schermo quello che e' stato disegnato

    pygame.quit()


if __name__ == '__main__':
    main()
