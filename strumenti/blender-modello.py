"""Crea un modello 3D con Blender ed esportalo per il gioco, con le immagini per guardarlo.

Gira DENTRO Blender, senza finestre:
  blender -b --factory-startup --python blender-modello.py -- <json di opzioni>

Opzioni: {"script": "crea_zombie.py",       lo script Blender che costruisce il modello
          "uscita": "modelli/zombie.glb",   .glb per il web e Unity, .fbx per Unity, .obj generico
          "anteprima": "img/zombie.png",    una foto del modello, da guardare con Read
          "sprite": "img/zombie.png",       immagini su sfondo trasparente per i giochi 2D/raycasting
          "angoli": 4,                      quante viste per lo sprite (girando intorno al modello)
          "dimensione": 256}

Stampa MODELLO_BLENDER=<json>: oggetti, triangoli, materiali, file scritti. Serve allo Studio per
dire se il modello e' davvero venuto fuori o se e' un file vuoto: "esportato" non vuol dire "c'e'".
"""

import json
import math
import os
import sys
import traceback

import bpy
import mathutils


def rispondi(esito):
    print('MODELLO_BLENDER=' + json.dumps(esito, ensure_ascii=False))


def riga_dell_errore(percorso, eccezione):
    righe = [t.lineno for t in traceback.extract_tb(eccezione.__traceback__) if t.filename == percorso]
    if isinstance(eccezione, SyntaxError) and eccezione.lineno:
        return eccezione.lineno
    return righe[-1] if righe else None


def oggetti_veri():
    return [o for o in bpy.context.scene.objects
            if o.type in {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT', 'CURVES', 'POINTCLOUD', 'VOLUME'}]


def misura_scena():
    """Quanti oggetti, triangoli e materiali: un modello senza triangoli non esiste."""
    triangoli = 0
    for o in oggetti_veri():
        if o.type != 'MESH':
            triangoli += 1          # curve e testi diventano mesh solo all'esportazione
            continue
        mesh = o.data
        try:
            mesh.calc_loop_triangles()
            triangoli += len(mesh.loop_triangles)
        except Exception:
            triangoli += len(mesh.polygons)
    return {
        'oggetti': len(oggetti_veri()),
        'nomi': [o.name for o in oggetti_veri()][:12],
        'triangoli': triangoli,
        'materiali': len(bpy.data.materials),
        # Non si chiama "immagini": quello e' l'elenco delle foto che scattiamo noi.
        'textureCaricate': len(bpy.data.images)
    }


def inquadra(centro, grandezza, direzione, ortografica=False, dimensione=512, trasparente=False):
    scena = bpy.context.scene
    dati = bpy.data.cameras.new('Foto')
    camera = bpy.data.objects.new('Foto', dati)
    scena.collection.objects.link(camera)
    camera.location = centro + direzione.normalized() * grandezza * 2.0
    camera.rotation_euler = (centro - camera.location).to_track_quat('-Z', 'Y').to_euler()
    dati.clip_start = max(grandezza / 1000.0, 0.0001)
    dati.clip_end = grandezza * 60
    if ortografica:
        dati.type = 'ORTHO'
        dati.ortho_scale = grandezza * 1.15
    scena.camera = camera
    scena.render.engine = 'BLENDER_WORKBENCH'      # nessuna scheda grafica richiesta, veloce e sicuro
    scena.render.film_transparent = trasparente
    scena.render.resolution_x = dimensione
    scena.render.resolution_y = dimensione
    scena.render.resolution_percentage = 100
    scena.render.image_settings.file_format = 'PNG'
    scena.render.image_settings.color_mode = 'RGBA' if trasparente else 'RGB'
    return camera


def dimensioni_scena():
    visibili = oggetti_veri()
    if not visibili:
        return None, None
    punti = [o.matrix_world @ mathutils.Vector(angolo) for o in visibili for angolo in o.bound_box]
    minimo = mathutils.Vector((min(p.x for p in punti), min(p.y for p in punti), min(p.z for p in punti)))
    massimo = mathutils.Vector((max(p.x for p in punti), max(p.y for p in punti), max(p.z for p in punti)))
    return (minimo + massimo) / 2, max((massimo - minimo).length, 0.01)


def scatta(percorso, direzione, ortografica=False, dimensione=512, trasparente=False):
    centro, grandezza = dimensioni_scena()
    if centro is None:
        return 'nella scena non c\'e\' niente da fotografare'
    camera = inquadra(centro, grandezza, direzione, ortografica, dimensione, trasparente)
    bpy.context.scene.render.filepath = percorso
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
    return None


def esporta(percorso):
    estensione = os.path.splitext(percorso)[1].lower()
    os.makedirs(os.path.dirname(os.path.abspath(percorso)) or '.', exist_ok=True)
    if estensione in ('.glb', '.gltf'):
        bpy.ops.export_scene.gltf(filepath=percorso, export_format='GLB' if estensione == '.glb' else 'GLTF_SEPARATE')
    elif estensione == '.fbx':
        bpy.ops.export_scene.fbx(filepath=percorso)
    elif estensione == '.obj':
        bpy.ops.wm.obj_export(filepath=percorso)
    elif estensione == '.blend':
        bpy.ops.wm.save_as_mainfile(filepath=percorso)
    else:
        return 'non so esportare in "%s": usa .glb, .fbx, .obj o .blend' % estensione
    return None


def main():
    argomenti = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not argomenti:
        rispondi({'ok': False, 'errore': 'manca il json delle opzioni'})
        return
    try:
        opzioni = json.loads(argomenti[0])
    except ValueError as e:
        rispondi({'ok': False, 'errore': 'opzioni non leggibili: %s' % e})
        return

    esito = {'ok': False, 'versione': bpy.app.version_string, 'file': [], 'immagini': []}
    try:
        # Si parte da una scena vuota: il cubo di Blender in un gioco non lo vuole nessuno.
        if not opzioni.get('tieniScena'):
            bpy.ops.wm.read_factory_settings(use_empty=True)

        script = opzioni.get('script')
        if script:
            percorso = os.path.abspath(script)
            esito['script'] = percorso
            with open(percorso, 'r', encoding='utf-8') as f:
                codice = f.read()
            spazio = {'__name__': '__main__', '__file__': percorso}
            try:
                exec(compile(codice, percorso, 'exec'), spazio)
            except Exception as e:
                esito['errore'] = '%s: %s' % (type(e).__name__, e)
                esito['riga'] = riga_dell_errore(percorso, e)
                esito['traccia'] = traceback.format_exc()[-1200:]
                rispondi(esito)
                return

        esito.update(misura_scena())
        if not esito['oggetti']:
            esito['errore'] = 'lo script non ha creato nessun oggetto: non c\'e\' niente da esportare'
            rispondi(esito)
            return

        uscita = opzioni.get('uscita')
        if uscita:
            motivo = esporta(os.path.abspath(uscita))
            if motivo:
                esito['errore'] = motivo
                rispondi(esito)
                return
            esito['file'].append(os.path.abspath(uscita))

        dimensione = int(opzioni.get('dimensione') or 512)
        anteprima = opzioni.get('anteprima')
        if anteprima:
            percorso = os.path.abspath(anteprima)
            os.makedirs(os.path.dirname(percorso) or '.', exist_ok=True)
            motivo = scatta(percorso, mathutils.Vector((1.0, -1.2, 0.8)), False, dimensione)
            if motivo:
                esito['avviso'] = motivo
            else:
                esito['immagini'].append(percorso)

        sprite = opzioni.get('sprite')
        if sprite:
            angoli = max(1, min(12, int(opzioni.get('angoli') or 1)))
            radice, estensione = os.path.splitext(os.path.abspath(sprite))
            os.makedirs(os.path.dirname(radice) or '.', exist_ok=True)
            for i in range(angoli):
                giro = (2 * math.pi * i) / angoli
                direzione = mathutils.Vector((math.sin(giro), -math.cos(giro), 0.18))
                percorso = radice + (estensione if angoli == 1 else '-%d%s' % (i, estensione))
                motivo = scatta(percorso, direzione, True, dimensione, True)
                if motivo:
                    esito['avviso'] = motivo
                    break
                esito['immagini'].append(percorso)

        esito['ok'] = True
    except Exception as e:
        esito['errore'] = '%s: %s' % (type(e).__name__, e)
        esito['traccia'] = traceback.format_exc()[-1200:]
    rispondi(esito)


if __name__ == '__main__':
    main()
