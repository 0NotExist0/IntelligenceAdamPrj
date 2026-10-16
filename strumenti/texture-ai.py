"""Texture fotografiche generate in locale, e fatte in modo che si ripetano senza cuciture.

Gira sulla scheda video di questo computer (niente internet, niente account): usa i modelli che sono
gia' scaricati in cache. Il trucco per la ripetizione e' cambiare il modo in cui le reti riempiono i
bordi ("circular"): cosi' l'immagine nasce gia' continua da un lato all'altro, invece di essere
ritagliata dopo.

Uso:  python texture-ai.py '<json>'
json: {"descrizione": "muro di pietra antica", "uscita": "img/pietra.png", "dimensione": 512,
       "passi": 22, "modello": "foto"|"sdxl", "seme": 7, "ripetibile": true}

Stampa TEXTURE=<json> con le stesse misure della texture fatta a mano (colori, colore dominante,
giunzione): e' lo Studio a decidere se e' venuta bene, non il modello che l'ha disegnata.
"""

import importlib.util
import json
import os
import sys
import time

MODELLI = {
    'foto': ('emilianJR/epiCRealism', 'sd'),                                  # fotorealistico, leggero e veloce
    'sdxl': ('stabilityai/stable-diffusion-xl-base-1.0', 'sdxl')              # piu' grande e piu' dettagliato
}

CONTORNO = ('seamless tileable texture, flat top-down view, even diffuse lighting, no shadows, '
            'no perspective, sharp detail, photographic, 4k material scan')
DA_EVITARE = ('object, border, frame, watermark, text, logo, vignette, drop shadow, perspective, '
              'people, hands, blurry, lowres')


def strumento(nome):
    """Carica una funzione da un file che sta qui accanto (il nome ha un trattino: niente import)."""
    percorso = os.path.join(os.path.dirname(os.path.abspath(__file__)), nome)
    specifica = importlib.util.spec_from_file_location('strumento_' + nome.replace('-', '_').replace('.py', ''), percorso)
    modulo = importlib.util.module_from_spec(specifica)
    specifica.loader.exec_module(modulo)
    return modulo


def rendi_ripetibile(pipeline):
    """Bordi 'circolari' in tutte le convoluzioni: l'immagine si richiude su se stessa."""
    import torch.nn as nn
    cambiate = 0
    for parte in ('unet', 'vae'):
        rete = getattr(pipeline, parte, None)
        if rete is None:
            continue
        for modulo in rete.modules():
            if isinstance(modulo, nn.Conv2d) and modulo.padding_mode != 'circular':
                modulo.padding_mode = 'circular'
                cambiate += 1
    return cambiate


def carica(nome_modello):
    import torch
    from diffusers import StableDiffusionPipeline, StableDiffusionXLPipeline

    if nome_modello not in MODELLI:
        raise SystemExit('modello sconosciuto: %s (modelli: %s)' % (nome_modello, ', '.join(MODELLI)))
    identificativo, famiglia = MODELLI[nome_modello]
    classe = StableDiffusionXLPipeline if famiglia == 'sdxl' else StableDiffusionPipeline
    comuni = {'torch_dtype': torch.float16, 'use_safetensors': True}
    if famiglia == 'sd':
        comuni['safety_checker'] = None          # il filtro scarterebbe texture innocue lasciando un'immagine nera
        comuni['requires_safety_checker'] = False
    try:
        pipeline = classe.from_pretrained(identificativo, local_files_only=True, **comuni)
    except Exception:
        pipeline = classe.from_pretrained(identificativo, **comuni)   # non era in cache: si scarica una volta sola
    pipeline.set_progress_bar_config(disable=True)
    if torch.cuda.is_available():
        pipeline.to('cuda')
        try:
            pipeline.enable_vae_tiling()
        except Exception:
            pass
        if famiglia == 'sdxl':
            pipeline.enable_attention_slicing()    # 8 GB di scheda video: SDXL ci sta solo cosi'
    return pipeline, famiglia


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    opzioni = json.loads(sys.argv[1])
    descrizione = str(opzioni.get('descrizione') or '').strip()
    uscita = opzioni.get('uscita')
    if not descrizione or not uscita:
        raise SystemExit('servono "descrizione" e "uscita"')
    dimensione = int(opzioni.get('dimensione') or 512)
    passi = int(opzioni.get('passi') or 22)
    seme = int(opzioni.get('seme') if opzioni.get('seme') is not None else 7)
    nome_modello = opzioni.get('modello') or 'foto'

    import numpy as np
    import torch

    inizio = time.time()
    pipeline, famiglia = carica(nome_modello)
    caricato = time.time()
    ripetibile = opzioni.get('ripetibile', True)
    cambiate = rendi_ripetibile(pipeline) if ripetibile else 0

    generatore = torch.Generator(device='cuda' if torch.cuda.is_available() else 'cpu').manual_seed(seme)
    immagine = pipeline(
        prompt=descrizione + ', ' + CONTORNO,
        negative_prompt=DA_EVITARE,
        num_inference_steps=passi,
        guidance_scale=float(opzioni.get('forza') or (6.0 if famiglia == 'sdxl' else 7.0)),
        width=dimensione, height=dimensione,
        generator=generatore
    ).images[0]

    os.makedirs(os.path.dirname(os.path.abspath(uscita)) or '.', exist_ok=True)
    immagine.save(uscita)
    pixel = np.array(immagine.convert('RGB'), dtype=np.uint8)

    # La prova che si ripete davvero: la stessa texture messa quattro volte. Se la giunzione si
    # vede, qui si vede a occhio - e chi guarda non deve fidarsi di un numero.
    prova = None
    if opzioni.get('prova', True):
        from PIL import Image
        radice, estensione = os.path.splitext(os.path.abspath(uscita))
        prova = radice + '-ripetuta' + estensione
        foglio = Image.new('RGB', (pixel.shape[1] * 2, pixel.shape[0] * 2))
        for x in (0, pixel.shape[1]):
            for y in (0, pixel.shape[0]):
                foglio.paste(immagine, (x, y))
        foglio.save(prova)

    misure = strumento('texture-procedurale.py').misure(pixel)
    esito = {
        'tipo': 'ai:' + nome_modello, 'descrizione': descrizione, 'file': os.path.abspath(uscita),
        'larghezza': pixel.shape[1], 'altezza': pixel.shape[0], 'seme': seme, 'passi': passi,
        'convoluzioniCircolari': cambiate,
        'secondiCaricamento': round(caricato - inizio, 1),
        'secondiDisegno': round(time.time() - caricato, 1),
        'prova': prova
    }
    esito.update(misure)
    print('TEXTURE=' + json.dumps(esito, ensure_ascii=False))


if __name__ == '__main__':
    main()
