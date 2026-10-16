"""Zombie a blocchi, pochi triangoli: esempio di modello da mettere in un gioco.

Questo e' uno script di Blender: costruisce il modello con il codice, quindi si puo' modificare,
rifare e verificare come qualsiasi altro file del progetto. Si lancia dallo Studio:

  node strumenti/modelli.js --script strumenti/modelli-esempi/zombie.py \
       --uscita modelli/zombie.glb --anteprima img/zombie.png --sprite img/zombie.png --angoli 4

Il .glb va nel gioco web (Three.js) e in Unity; gli sprite PNG trasparenti nel gioco pygame.
Copialo e cambialo: le misure sono in metri, l'asse Z e' l'altezza.
"""

import bpy


def materiale(nome, colore):
    """Un colore vero, che si vede sia nel gioco sia nell'anteprima dello Studio."""
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    principale = m.node_tree.nodes.get('Principled BSDF')
    if principale:
        principale.inputs['Base Color'].default_value = (colore[0], colore[1], colore[2], 1.0)
        if 'Roughness' in principale.inputs:
            principale.inputs['Roughness'].default_value = 0.85
    m.diffuse_color = (colore[0], colore[1], colore[2], 1.0)     # colore usato nell'anteprima
    return m


def blocco(nome, centro, misure, materiale_del_blocco):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=centro)
    oggetto = bpy.context.active_object
    oggetto.name = nome
    oggetto.scale = misure
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    oggetto.data.materials.append(materiale_del_blocco)
    return oggetto


pelle = materiale('PelleZombie', (0.22, 0.44, 0.20))
stoffa = materiale('Stoffa', (0.26, 0.22, 0.32))
occhio = materiale('Occhi', (0.95, 0.84, 0.10))

blocco('Busto', (0.0, 0.0, 1.05), (0.62, 0.34, 0.90), stoffa)
blocco('Testa', (0.0, 0.0, 1.72), (0.46, 0.42, 0.44), pelle)
blocco('BraccioSinistro', (-0.44, 0.10, 1.15), (0.22, 0.22, 0.78), pelle)
blocco('BraccioDestro', (0.44, 0.10, 1.15), (0.22, 0.22, 0.78), pelle)
blocco('GambaSinistra', (-0.17, 0.0, 0.30), (0.26, 0.28, 0.62), stoffa)
blocco('GambaDestra', (0.17, 0.0, 0.30), (0.26, 0.28, 0.62), stoffa)
blocco('OcchioSinistro', (-0.12, -0.22, 1.78), (0.10, 0.04, 0.08), occhio)
blocco('OcchioDestro', (0.12, -0.22, 1.78), (0.10, 0.04, 0.08), occhio)

# Le braccia in avanti: cosi' si capisce al volo che e' uno zombie e non un manichino.
for nome in ('BraccioSinistro', 'BraccioDestro'):
    braccio = bpy.data.objects[nome]
    braccio.rotation_euler[0] = -1.35
