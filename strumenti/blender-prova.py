# NotExist Intelligience Studio - Prova dentro Blender, senza finestra.
#
# Per Blender "verificare come un programmatore esperto" vuol dire eseguire davvero e guardare il
# risultato: un add-on deve registrarsi e togliersi senza errori, uno script deve girare fino in
# fondo e creare quello che promette. Questo file gira DENTRO Blender:
#   blender -b --factory-startup --python blender-prova.py -- addon  <cartella o file dell'add-on>
#   blender -b --factory-startup --python blender-prova.py -- script <file.py> [<anteprima.png>]
# e stampa una riga che comincia con PROVA_BLENDER= seguita da un JSON con l'esito.
# --factory-startup: niente add-on e preferenze dell'utente, la prova e' ripetibile.

import importlib
import json
import os
import sys
import traceback

import bpy


def rispondi(dati):
    print('PROVA_BLENDER=' + json.dumps(dati, ensure_ascii=False))
    sys.stdout.flush()


def riga_nel_file(eccezione, bersaglio):
    righe = [f.lineno for f in traceback.extract_tb(eccezione.__traceback__)
             if os.path.normcase(os.path.abspath(f.filename)) == os.path.normcase(bersaglio)]
    if isinstance(eccezione, SyntaxError) and eccezione.lineno:
        return eccezione.lineno
    return righe[-1] if righe else None


def anteprima(percorso):
    """Fotografa la scena con una camera che inquadra tutti gli oggetti (motore Workbench, veloce)."""
    import mathutils
    scena = bpy.context.scene
    visibili = [o for o in scena.objects if o.type in {'MESH', 'CURVE', 'SURFACE', 'META', 'FONT', 'CURVES', 'POINTCLOUD', 'VOLUME'}]
    if not visibili:
        return 'nella scena non c\'e\' niente da fotografare'
    punti = [o.matrix_world @ mathutils.Vector(angolo) for o in visibili for angolo in o.bound_box]
    minimo = mathutils.Vector((min(p.x for p in punti), min(p.y for p in punti), min(p.z for p in punti)))
    massimo = mathutils.Vector((max(p.x for p in punti), max(p.y for p in punti), max(p.z for p in punti)))
    centro = (minimo + massimo) / 2
    grandezza = max((massimo - minimo).length, 0.01)
    dati_camera = bpy.data.cameras.new('AnteprimaCervello')
    camera = bpy.data.objects.new('AnteprimaCervello', dati_camera)
    scena.collection.objects.link(camera)
    camera.location = centro + mathutils.Vector((1.0, -1.0, 0.75)).normalized() * grandezza * 1.7
    camera.rotation_euler = (centro - camera.location).to_track_quat('-Z', 'Y').to_euler()
    dati_camera.clip_start = grandezza / 1000
    dati_camera.clip_end = grandezza * 50
    scena.camera = camera
    scena.render.engine = 'BLENDER_WORKBENCH'
    scena.render.resolution_x = 960
    scena.render.resolution_y = 540
    scena.render.resolution_percentage = 100
    scena.render.image_settings.file_format = 'PNG'
    scena.render.filepath = percorso
    bpy.ops.render.render(write_still=True)
    return None


def main():
    argomenti = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(argomenti) < 2:
        rispondi({'ok': False, 'errore': 'uso: -- addon <percorso> | -- script <file.py> [anteprima.png]'})
        return
    modo = argomenti[0]
    bersaglio = os.path.abspath(argomenti[1])
    esito = {'modo': modo, 'file': bersaglio, 'versione': bpy.app.version_string, 'ok': False}
    try:
        if modo == 'addon':
            if os.path.isdir(bersaglio) or os.path.basename(bersaglio) == '__init__.py':
                cartella = bersaglio if os.path.isdir(bersaglio) else os.path.dirname(bersaglio)
                sys.path.insert(0, os.path.dirname(cartella))
                nome = os.path.basename(cartella)
                file_principale = os.path.join(cartella, '__init__.py')
            else:
                sys.path.insert(0, os.path.dirname(bersaglio))
                nome = os.path.splitext(os.path.basename(bersaglio))[0]
                file_principale = bersaglio
            bersaglio = file_principale
            tipi_prima = set(dir(bpy.types))
            modulo = importlib.import_module(nome)
            if not hasattr(modulo, 'register') or not hasattr(modulo, 'unregister'):
                raise RuntimeError('l\'add-on non ha register() e unregister()')
            modulo.register()
            esito['registrate'] = sorted(set(dir(bpy.types)) - tipi_prima)[:40]
            modulo.unregister()
            rimaste = sorted(set(esito['registrate']) & set(dir(bpy.types)))
            if rimaste:
                esito['avviso'] = 'dopo unregister() restano registrate: ' + ', '.join(rimaste[:10])
            esito['ok'] = True
        elif modo == 'script':
            prima = {o.name for o in bpy.data.objects}
            with open(bersaglio, encoding='utf-8') as f:
                codice = f.read()
            ambiente = {'__name__': '__main__', '__file__': bersaglio}
            exec(compile(codice, bersaglio, 'exec'), ambiente)
            esito['oggetti'] = len(bpy.data.objects)
            esito['nuovi'] = sorted(o.name for o in bpy.data.objects if o.name not in prima)[:40]
            esito['tolti'] = sorted(prima - {o.name for o in bpy.data.objects})[:20]
            esito['mesh'] = len(bpy.data.meshes)
            esito['materiali'] = len(bpy.data.materials)
            if len(argomenti) > 2:
                esito['anteprima'] = os.path.abspath(argomenti[2])
                motivo = anteprima(esito['anteprima'])
                if motivo:
                    esito['anteprima'] = None
                    esito['avviso'] = motivo
            esito['ok'] = True
        else:
            esito['errore'] = 'modo sconosciuto: ' + modo
    except BaseException as e:  # anche SystemExit dentro lo script provato
        esito['errore'] = '%s: %s' % (type(e).__name__, e)
        esito['riga'] = riga_nel_file(e, bersaglio)
        esito['traccia'] = traceback.format_exc()[-1500:]
    rispondi(esito)


main()
