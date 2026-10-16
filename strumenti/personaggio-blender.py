"""Blender in sottofondo per i personaggi riggati: dal file di Unity a quello che serve allo Studio.

Richiesta dell'utente (18/9/2026): usare il suo personaggio riggato di Unity (Robott) nel gioco sul
cubo, e vederlo in 3D in un pannello dello Studio, con il rendering vero di Blender.

Comandi (li lancia strumenti/personaggio.js):
  prepara  dal FBX: dimensioni giuste (1,8 m, piedi a terra), braccia giu' invece della posa a T,
           una camminata costruita sulle ossa di Mixamo, il file 3D per il pannello (GLB) e le
           immagini da 8 direzioni per il gioco in pygame.
  rendi    un'immagine di qualita' (EEVEE) dallo stesso punto di vista del pannello.

Uso: blender -b --factory-startup --python personaggio-blender.py -- <comando> <opzioni.json>
Stampa una riga "RISULTATO {...}" con l'esito.

Le ossa di Mixamo hanno nomi fissi (mixamorig:LeftArm...), ma gli assi di rotazione possono cambiare
da un personaggio all'altro: invece di indovinarli, qui si PROVANO (si gira un osso e si guarda dove
va a finire la mano o il piede) e si tiene l'asse che fa il movimento giusto.
"""
import json
import math
import os
import sys
import time

import bpy
from mathutils import Euler, Vector

ALTEZZA = 1.8
PREFISSO = 'mixamorig:'


def esito(dati):
    print('RISULTATO ' + json.dumps(dati))
    sys.stdout.flush()


def pulisci():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def importa(percorso):
    estensione = os.path.splitext(percorso)[1].lower()
    if estensione == '.fbx':
        bpy.ops.import_scene.fbx(filepath=percorso)
    elif estensione in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=percorso)
    else:
        raise ValueError('formato non gestito: ' + estensione)


def scheletro_e_maglie():
    oggetti = list(bpy.context.scene.objects)
    scheletri = [o for o in oggetti if o.type == 'ARMATURE']
    maglie = [o for o in oggetti if o.type == 'MESH']
    return (scheletri[0] if scheletri else None), maglie


def scatola(maglie):
    bpy.context.view_layer.update()
    angoli = [o.matrix_world @ Vector(c) for o in maglie for c in o.bound_box]
    minimo = Vector((min(p.x for p in angoli), min(p.y for p in angoli), min(p.z for p in angoli)))
    massimo = Vector((max(p.x for p in angoli), max(p.y for p in angoli), max(p.z for p in angoli)))
    return minimo, massimo


def normalizza(altezza=ALTEZZA):
    """Tutto sotto un'unica radice messa AI PIEDI del personaggio: alta `altezza`, piedi a quota 0,
    centrata. La radice sta ai piedi perche' e' li' che il personaggio gira su se stesso (le immagini
    da 8 direzioni): con la radice altrove girerebbe attorno a un punto fuori di lui."""
    _, maglie = scheletro_e_maglie()
    minimo, massimo = scatola(maglie)
    radice = bpy.data.objects.new('Personaggio', None)
    bpy.context.scene.collection.objects.link(radice)
    radice.location = ((minimo.x + massimo.x) / 2, (minimo.y + massimo.y) / 2, minimo.z)
    bpy.context.view_layer.update()
    for o in list(bpy.context.scene.objects):
        if o is not radice and o.parent is None:
            mondo = o.matrix_world.copy()
            o.parent = radice
            o.matrix_world = mondo
    fattore = altezza / max(1e-6, massimo.z - minimo.z)
    radice.location = (0.0, 0.0, 0.0)
    radice.scale = (fattore, fattore, fattore)
    bpy.context.view_layer.update()
    return radice


def testa_osso(scheletro, nome):
    bpy.context.view_layer.update()
    pb = scheletro.pose.bones.get(nome)
    return scheletro.matrix_world @ pb.head if pb else None


def prova_asse(scheletro, osso, punta, gradi, misura):
    """Gira `osso` di `gradi` su X e su Z, nei due versi, e tiene la rotazione che rende minima
    misura(posizione della punta). Restituisce (asse, verso)."""
    pb = scheletro.pose.bones[osso]
    pb.rotation_mode = 'XYZ'
    migliore = None
    for asse in (0, 2):
        for verso in (1, -1):
            angolo = [0.0, 0.0, 0.0]
            angolo[asse] = math.radians(gradi) * verso
            pb.rotation_euler = Euler(angolo)
            valore = misura(testa_osso(scheletro, punta))
            if migliore is None or valore < migliore[0]:
                migliore = (valore, asse, verso)
    pb.rotation_euler = Euler((0.0, 0.0, 0.0))
    return migliore[1], migliore[2]


def ruota(pb, asse, gradi):
    angolo = [0.0, 0.0, 0.0]
    angolo[asse] = math.radians(gradi)
    pb.rotation_mode = 'XYZ'
    pb.rotation_euler = Euler(angolo)


def costruisci_animazioni(scheletro, fotogrammi=24):
    """Riposo (braccia giu') e Camminata, sulle ossa di Mixamo. Restituisce i nomi delle azioni."""
    ossa = scheletro.pose.bones
    if (PREFISSO + 'LeftArm') not in ossa:
        return []                          # non e' uno scheletro Mixamo: si lascia com'e'
    avanti_y = -1.0                        # i personaggi di Mixamo guardano verso -Y

    # assi, trovati provando: braccia che scendono, gambe e braccia che vanno avanti, ginocchia che piegano
    assi = {}
    for lato in ('Left', 'Right'):
        assi[lato + 'Arm'] = prova_asse(scheletro, PREFISSO + lato + 'Arm', PREFISSO + lato + 'Hand', 70, lambda p: p.z)
        assi[lato + 'UpLeg'] = prova_asse(scheletro, PREFISSO + lato + 'UpLeg', PREFISSO + lato + 'Foot', 25, lambda p: p.y * -avanti_y)
        assi[lato + 'Leg'] = prova_asse(scheletro, PREFISSO + lato + 'Leg', PREFISSO + lato + 'Foot', 35, lambda p: -p.y * -avanti_y)

    # per far oscillare le braccia gia' abbassate serve l'asse "avanti" con il braccio in posizione
    for lato in ('Left', 'Right'):
        asse, verso = assi[lato + 'Arm']
        ruota(ossa[PREFISSO + lato + 'Arm'], asse, 70 * verso)
    bpy.context.view_layer.update()
    oscillazione = {}
    for lato in ('Left', 'Right'):
        pb = ossa[PREFISSO + lato + 'ForeArm']
        oscillazione[lato] = prova_asse(scheletro, PREFISSO + lato + 'ForeArm', PREFISSO + lato + 'Hand', 20, lambda p: p.y * -avanti_y)
    for lato in ('Left', 'Right'):
        ossa[PREFISSO + lato + 'Arm'].rotation_euler = Euler((0.0, 0.0, 0.0))

    scheletro.animation_data_create()
    for vecchia in list(bpy.data.actions):       # la "animazione" del FBX era una posa ferma
        bpy.data.actions.remove(vecchia)

    def posa(fase):
        """fase None = riposo; altrimenti un punto del passo (radianti)."""
        for pb in ossa:
            pb.rotation_mode = 'XYZ'
            pb.rotation_euler = Euler((0.0, 0.0, 0.0))
        for lato in ('Left', 'Right'):
            asse, verso = assi[lato + 'Arm']
            ruota(ossa[PREFISSO + lato + 'Arm'], asse, 70 * verso)
        if fase is None:
            return
        for lato, spostamento in (('Left', 0.0), ('Right', math.pi)):
            f = fase + spostamento
            asse, verso = assi[lato + 'UpLeg']
            ruota(ossa[PREFISSO + lato + 'UpLeg'], asse, 26 * math.sin(f) * verso)
            asse, verso = assi[lato + 'Leg']
            ruota(ossa[PREFISSO + lato + 'Leg'], asse, 38 * max(0.0, math.cos(f)) * verso)
            # il braccio va avanti quando la gamba dello stesso lato va indietro
            asse, verso = oscillazione[lato]
            ruota(ossa[PREFISSO + lato + 'ForeArm'], asse, -16 * math.sin(f) * verso)

    def registra(nome, pose):
        azione = bpy.data.actions.new(nome)
        azione.use_fake_user = True
        scheletro.animation_data.action = azione
        for fotogramma, fase in pose:
            posa(fase)
            for pb in ossa:
                pb.keyframe_insert('rotation_euler', frame=fotogramma)
        return azione

    registra('Riposo', [(1, None)])
    registra('Camminata', [(1 + i, 2 * math.pi * i / fotogrammi) for i in range(fotogrammi + 1)])
    scheletro.animation_data.action = bpy.data.actions['Riposo']
    return ['Riposo', 'Camminata']


def usa_azione(scheletro, nome, tempo=0.0):
    azione = bpy.data.actions.get(nome) if nome else None
    if not scheletro or not azione:
        return
    scheletro.animation_data_create()
    scheletro.animation_data.action = azione
    inizio, fine = azione.frame_range
    bpy.context.scene.frame_set(int(round(inizio + (fine - inizio) * max(0.0, min(1.0, tempo)))))


def esporta_glb(percorso):
    os.makedirs(os.path.dirname(percorso), exist_ok=True)
    opzioni = dict(filepath=percorso, export_format='GLB', export_animations=True)
    try:
        bpy.ops.export_scene.gltf(export_animation_mode='ACTIONS', **opzioni)
    except TypeError:
        bpy.ops.export_scene.gltf(**opzioni)


def motore(scena, qualita):
    if qualita:
        for nome in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
            try:
                scena.render.engine = nome
                return nome
            except TypeError:
                continue
    scena.render.engine = 'BLENDER_WORKBENCH'
    scena.display.shading.light = 'STUDIO'
    scena.display.shading.color_type = 'MATERIAL'
    return 'BLENDER_WORKBENCH'


def sprite(radice, scheletro, cartella, direzioni=8, fotogrammi=8, larghezza=192, altezza=256, nome=None):
    """Le immagini per il gioco: per ogni direzione, il riposo e i fotogrammi della camminata.
    Direzione 0 = di spalle (cammina lontano dalla camera); poi ogni 45 gradi verso destra."""
    os.makedirs(cartella, exist_ok=True)
    scena = bpy.context.scene
    motore(scena, qualita=False)
    scena.render.film_transparent = True
    scena.render.resolution_x = larghezza
    scena.render.resolution_y = altezza
    scena.render.image_settings.compression = 90   # PNG piu' piccoli: 72 immagini viaggiano con il gioco
    camera_dati = bpy.data.cameras.new('camera_sprite')
    camera_dati.type = 'ORTHO'
    camera_dati.ortho_scale = ALTEZZA * 1.12
    camera = bpy.data.objects.new('camera_sprite', camera_dati)
    scena.collection.objects.link(camera)
    camera.location = (0.0, -10.0, ALTEZZA * 0.5)
    camera.rotation_euler = Euler((math.radians(90), 0.0, 0.0))
    scena.camera = camera
    fatti = 0
    base = radice.rotation_euler.z
    for d in range(direzioni):
        radice.rotation_euler.z = base + math.radians(180 - d * 360.0 / direzioni)
        usa_azione(scheletro, 'Riposo', 0.0)
        scena.render.filepath = os.path.join(cartella, 'riposo_d%d.png' % d)
        bpy.ops.render.render(write_still=True)
        fatti += 1
        if scheletro and bpy.data.actions.get('Camminata'):
            for f in range(fotogrammi):
                usa_azione(scheletro, 'Camminata', f / float(fotogrammi))
                scena.render.filepath = os.path.join(cartella, 'cammina_d%d_f%d.png' % (d, f))
                bpy.ops.render.render(write_still=True)
                fatti += 1
    radice.rotation_euler.z = base
    # Quanto e' grande un pixel e dove stanno i piedi: il gioco li usa per mettere la figura a terra
    # alla misura giusta (la camera ortografica copre ortho_scale metri sul lato piu' lungo).
    metri_per_pixel = camera_dati.ortho_scale / float(max(larghezza, altezza))
    piedi_px = altezza / 2.0 + (ALTEZZA * 0.5) / metri_per_pixel
    with open(os.path.join(cartella, 'sprite.json'), 'w', encoding='utf-8') as scheda:
        json.dump({'nome': nome or 'personaggio', 'direzioni': direzioni,
                   'fotogrammi_camminata': fotogrammi if bpy.data.actions.get('Camminata') else 0,
                   'altezza_metri': ALTEZZA, 'larghezza': larghezza, 'altezza': altezza,
                   'metri_per_pixel': round(metri_per_pixel, 6), 'piedi_px': round(piedi_px, 2),
                   'direzione_0': 'di spalle: cammina lontano dalla camera; poi ogni passo e\' 45 gradi verso destra'}, scheda, indent=1)
    bpy.data.objects.remove(camera)
    return fatti


def prepara(opzioni):
    t0 = time.time()
    pulisci()
    importa(opzioni['modello'])
    scheletro, maglie = scheletro_e_maglie()
    triangoli = 0
    for o in maglie:
        o.data.calc_loop_triangles()
        triangoli += len(o.data.loop_triangles)
    radice = normalizza(opzioni.get('altezza', ALTEZZA))
    animazioni = costruisci_animazioni(scheletro) if scheletro else []
    uscita = opzioni['uscita']
    nome = opzioni.get('nome') or os.path.splitext(os.path.basename(opzioni['modello']))[0].lower()
    glb = os.path.join(uscita, nome + '.glb')
    if scheletro:
        usa_azione(scheletro, 'Riposo', 0.0)
    esporta_glb(glb)
    fatti = 0
    if opzioni.get('sprite', True):
        fatti = sprite(radice, scheletro, os.path.join(uscita, 'sprite'), nome=nome)
    esito({'ok': True, 'glb': glb, 'sprite': fatti, 'triangoli': triangoli,
           'ossa': len(scheletro.data.bones) if scheletro else 0, 'animazioni': animazioni,
           'secondi': round(time.time() - t0, 1)})


def rendi(opzioni):
    """Un'immagine di qualita' dal punto di vista del pannello. Le coordinate arrivano come le usa
    three.js (Y in alto): in Blender Z e' in alto e -Y e' davanti."""
    t0 = time.time()
    pulisci()
    importa(opzioni['modello'])
    scheletro, maglie = scheletro_e_maglie()
    usa_azione(scheletro, opzioni.get('animazione'), opzioni.get('tempo', 0.0))
    scena = bpy.context.scene
    nome_motore = motore(scena, qualita=opzioni.get('qualita', True))

    def da_three(p):
        return Vector((p[0], -p[2], p[1]))

    camera_dati = bpy.data.cameras.new('camera')
    camera_dati.sensor_fit = 'VERTICAL'
    camera_dati.angle_y = math.radians(opzioni.get('fov', 45.0))
    camera = bpy.data.objects.new('camera', camera_dati)
    scena.collection.objects.link(camera)
    camera.location = da_three(opzioni.get('camera', (2.5, 1.6, 3.2)))
    bersaglio = da_three(opzioni.get('bersaglio', (0.0, 0.9, 0.0)))
    camera.rotation_euler = (bersaglio - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scena.camera = camera

    # tre luci: principale, di riempimento e di contorno. Solo la principale fa ombra: quella di
    # contorno viene da dietro e disegnerebbe una seconda ombra verso la camera.
    for nome, energia, rotazione in (('principale', 3.0, (50, 0, 35)), ('riempimento', 0.8, (65, 0, -120)), ('contorno', 1.6, (-40, 0, 180))):
        dati = bpy.data.lights.new(nome, 'SUN')
        dati.energy = energia
        if nome != 'principale' and hasattr(dati, 'use_shadow'):
            dati.use_shadow = False
        luce = bpy.data.objects.new(nome, dati)
        luce.rotation_euler = tuple(math.radians(a) for a in rotazione)
        scena.collection.objects.link(luce)

    # un pavimento scuro sotto i piedi: senza, il personaggio galleggia nel nulla. Grande, perche'
    # il suo bordo non si veda come una linea d'orizzonte.
    bpy.ops.mesh.primitive_plane_add(size=80.0, location=(0.0, 0.0, 0.0))
    pavimento = bpy.context.active_object
    materiale = bpy.data.materials.new('pavimento')
    materiale.use_nodes = True
    fondo = materiale.node_tree.nodes.get('Principled BSDF')
    if fondo:
        fondo.inputs['Base Color'].default_value = (0.035, 0.04, 0.05, 1.0)
        fondo.inputs['Roughness'].default_value = 0.85
        # niente riflesso: la luce di contorno, radente, lo farebbe sembrare grigio chiaro in lontananza
        for voce in ('Specular IOR Level', 'Specular'):
            if voce in fondo.inputs:
                fondo.inputs[voce].default_value = 0.0
                break
    materiale.diffuse_color = (0.035, 0.04, 0.05, 1.0)
    pavimento.data.materials.append(materiale)

    mondo = bpy.data.worlds.new('sfondo')
    mondo.color = (0.012, 0.013, 0.018)
    scena.world = mondo
    scena.render.film_transparent = False
    # colori come nel pannello (three.js non schiarisce le ombre come fa AgX, il predefinito di Blender 4)
    try:
        scena.view_settings.view_transform = 'Standard'
    except TypeError:
        pass
    # 16 campioni invece di 64: per un'immagine di controllo bastano, e il tempo scende
    if hasattr(scena, 'eevee') and hasattr(scena.eevee, 'taa_render_samples'):
        scena.eevee.taa_render_samples = 16
    scena.render.resolution_x = int(opzioni.get('larghezza', 720))
    scena.render.resolution_y = int(opzioni.get('altezza_immagine', 720))
    scena.render.filepath = opzioni['uscita']
    bpy.ops.render.render(write_still=True)
    esito({'ok': True, 'png': opzioni['uscita'], 'motore': nome_motore, 'secondi': round(time.time() - t0, 1)})


def main():
    argomenti = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(argomenti) < 2:
        esito({'ok': False, 'errore': 'uso: -- <prepara|rendi> <opzioni.json>'})
        return
    comando = argomenti[0]
    with open(argomenti[1], encoding='utf-8') as f:
        opzioni = json.load(f)
    try:
        if comando == 'prepara':
            prepara(opzioni)
        elif comando == 'rendi':
            rendi(opzioni)
        else:
            esito({'ok': False, 'errore': 'comando sconosciuto: ' + comando})
    except Exception as errore:
        esito({'ok': False, 'errore': '%s: %s' % (type(errore).__name__, errore)})


main()
