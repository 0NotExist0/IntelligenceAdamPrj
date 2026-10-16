# NotExist Intelligience Studio - Il cervello del progetto per Python (e Blender).
#
# Come strumenti/cervello.js per JavaScript, ma con l'analizzatore di Python stesso (ast e
# symtable): legge ogni file .py del progetto e segna funzioni con i parametri, classi, variabili,
# import. Poi cerca gli errori che un modello piccolo fa piu' spesso:
#  - errori di sintassi, con riga e colonna;
#  - nomi usati ma mai definiti (NameError), con il nome giusto se ce n'e' uno simile;
#  - import di moduli che non esistono, o di nomi che il modulo locale non ha;
#  - chiamate a funzioni del progetto con argomenti sbagliati (TypeError);
#  - Blender: operatori, tipi e dati di bpy che non esistono in questa versione, add-on senza
#    register/unregister, bl_idname scritti male (Blender rifiuta la registrazione).
#
# Uso: python cervello-python.py <cartella del progetto> [--api-blender vendor/blender-api.json]
# Scrive su stdout un JSON: { "python": "3.11.0", "file": [ { file, righe, dichiarazioni, import, problemi, blender } ] }

import ast
import builtins
import difflib
import importlib.util
import io
import json
import os
import re
import sys
import symtable
import tokenize

CARTELLE_IGNORATE = {'.git', 'node_modules', '__pycache__', 'venv', '.venv', 'env', '.env', 'site-packages',
                     'Library', 'Temp', 'Logs', 'obj', 'build', 'dist', '.idea', '.vs', '.vscode', '.mypy_cache',
                     '.pytest_cache', '.tox', 'dati'}
MAX_FILE = 400
MAX_BYTE = 1_000_000

NOMI_SPECIALI = {'__name__', '__file__', '__doc__', '__package__', '__spec__', '__loader__', '__builtins__',
                 '__path__', '__annotations__', '__dict__', '__debug__', '__class__', '__qualname__', '__module__'}
BUILTIN = set(dir(builtins)) | NOMI_SPECIALI
MODULI_BLENDER = {'bpy', 'bmesh', 'mathutils', 'gpu', 'gpu_extras', 'blf', 'bgl', 'aud', 'idprop', 'freestyle',
                  'bl_math', 'imbuf', 'bpy_extras', 'bl_ui', 'bl_operators', 'addon_utils', 'rna_prop_ui',
                  'nodeitems_utils', 'keyingsets_utils', 'bpy_types'}


def simili(nome, candidati, quanti=3):
    return difflib.get_close_matches(nome, sorted(set(candidati)), n=quanti, cutoff=0.75)


def elenca_file(radice):
    trovati = []
    for cartella, sottocartelle, file in os.walk(radice):
        sottocartelle[:] = sorted(d for d in sottocartelle if d not in CARTELLE_IGNORATE and not d.startswith('.'))
        for nome in sorted(file):
            if nome.endswith('.py'):
                completo = os.path.join(cartella, nome)
                try:
                    if os.path.getsize(completo) <= MAX_BYTE:
                        trovati.append(completo)
                except OSError:
                    pass
                if len(trovati) >= MAX_FILE:
                    return trovati
    return trovati


def leggi_sorgente(percorso):
    with open(percorso, 'rb') as f:
        dati = f.read()
    try:
        codifica, _ = tokenize.detect_encoding(io.BytesIO(dati).readline)
    except SyntaxError:
        codifica = 'utf-8'
    return dati.decode(codifica, errors='replace').lstrip('﻿')


def rel(radice, percorso):
    return os.path.relpath(percorso, radice).replace('\\', '/')


def parametri_in_testo(args):
    parti = []
    posizionali = list(args.posonlyargs) + list(args.args)
    predefiniti = [None] * (len(posizionali) - len(args.defaults)) + list(args.defaults)
    for a, d in zip(posizionali, predefiniti):
        parti.append(a.arg + ('=' + ast.unparse(d)[:20] if d is not None else ''))
    if args.vararg:
        parti.append('*' + args.vararg.arg)
    elif args.kwonlyargs:
        parti.append('*')
    for a, d in zip(args.kwonlyargs, args.kw_defaults):
        parti.append(a.arg + ('=' + ast.unparse(d)[:20] if d is not None else ''))
    if args.kwarg:
        parti.append('**' + args.kwarg.arg)
    return ', '.join(parti)


def nomi_di_primo_livello(albero):
    """Nomi definiti al livello del modulo, anche dentro if/try/with/for (non dentro funzioni o classi)."""
    nomi = {}

    def bersagli(t, riga):
        if isinstance(t, ast.Name):
            nomi.setdefault(t.id, riga)
        elif isinstance(t, (ast.Tuple, ast.List)):
            for e in t.elts:
                bersagli(e, riga)
        elif isinstance(t, ast.Starred):
            bersagli(t.value, riga)

    def visita(corpo):
        for n in corpo:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                nomi.setdefault(n.name, n.lineno)
            elif isinstance(n, ast.Assign):
                for t in n.targets:
                    bersagli(t, n.lineno)
            elif isinstance(n, (ast.AnnAssign, ast.AugAssign)):
                bersagli(n.target, n.lineno)
            elif isinstance(n, (ast.Import, ast.ImportFrom)):
                for a in n.names:
                    if a.name != '*':
                        nomi.setdefault((a.asname or a.name).split('.')[0], n.lineno)
            elif isinstance(n, (ast.For, ast.AsyncFor)):
                bersagli(n.target, n.lineno)
                visita(n.body)
                visita(n.orelse)
            elif isinstance(n, (ast.With, ast.AsyncWith)):
                for it in n.items:
                    if it.optional_vars is not None:
                        bersagli(it.optional_vars, n.lineno)
                visita(n.body)
            elif isinstance(n, ast.If):
                visita(n.body)
                visita(n.orelse)
            elif isinstance(n, ast.Try) or (hasattr(ast, 'TryStar') and isinstance(n, ast.TryStar)):
                visita(n.body)
                for h in n.handlers:
                    if h.name:
                        nomi.setdefault(h.name, h.lineno)
                    visita(h.body)
                visita(n.orelse)
                visita(n.finalbody)
            elif isinstance(n, ast.While):
                visita(n.body)
                visita(n.orelse)
            elif hasattr(ast, 'Match') and isinstance(n, ast.Match):
                for caso in n.cases:
                    visita(caso.body)
        return nomi

    visita(albero.body)
    for n in ast.walk(albero):
        if isinstance(n, ast.NamedExpr) and isinstance(n.target, ast.Name):
            nomi.setdefault(n.target.id, n.lineno)
    return nomi


def globali_dichiarati(tabella):
    """Nomi dichiarati 'global' e assegnati dentro funzioni: esistono a livello del modulo."""
    trovati = set()
    for figlio in tabella.get_children():
        for s in figlio.get_symbols():
            if s.is_declared_global() and s.is_assigned():
                trovati.add(s.get_name())
        trovati |= globali_dichiarati(figlio)
    return trovati


def nomi_non_definiti(tabella, definiti):
    """Nomi letti in uno scope che non esistono ne' li' ne' a livello del modulo ne' fra i builtin."""
    mancanti = set()
    if tabella.get_type() == 'module':
        for s in tabella.get_symbols():
            nome = s.get_name()
            if s.is_referenced() and not s.is_assigned() and not s.is_imported() and nome not in definiti and nome not in BUILTIN:
                mancanti.add(nome)
    else:
        for s in tabella.get_symbols():
            nome = s.get_name()
            if s.is_referenced() and s.is_global() and nome not in definiti and nome not in BUILTIN:
                mancanti.add(nome)
    for figlio in tabella.get_children():
        mancanti |= nomi_non_definiti(figlio, definiti)
    return mancanti


def trova_modulo_locale(radice, cartella_file, nome, livello, pacchetto_file):
    """Percorso del modulo del progetto per 'import nome' o 'from ..nome import', o None."""
    parti = nome.split('.') if nome else []
    basi = []
    if livello > 0:
        base = cartella_file
        for _ in range(livello - 1):
            base = os.path.dirname(base)
        basi.append(base)
    else:
        # la cartella del file e quelle sopra fino alla radice: un'app si lancia di solito dalla sua cartella principale
        base = cartella_file
        while True:
            basi.append(base)
            if os.path.normcase(os.path.abspath(base)) == os.path.normcase(os.path.abspath(radice)) or os.path.dirname(base) == base:
                break
            base = os.path.dirname(base)
        if radice not in basi:
            basi.append(radice)
    for base in basi:
        percorso = os.path.join(base, *parti) if parti else base
        if os.path.isfile(percorso + '.py'):
            return percorso + '.py'
        if os.path.isfile(os.path.join(percorso, '__init__.py')):
            return os.path.join(percorso, '__init__.py')
        if parti and os.path.isdir(percorso):
            return percorso  # pacchetto senza __init__ (namespace)
    return None


PACCHETTI_PIP = {'cv2': 'opencv-python', 'PIL': 'pillow', 'yaml': 'pyyaml', 'sklearn': 'scikit-learn',
                 'bs4': 'beautifulsoup4', 'serial': 'pyserial', 'win32api': 'pywin32', 'win32con': 'pywin32',
                 'dotenv': 'python-dotenv', 'OpenGL': 'PyOpenGL', 'skimage': 'scikit-image', 'Crypto': 'pycryptodome',
                 'docx': 'python-docx', 'pptx': 'python-pptx', 'fitz': 'pymupdf', 'telegram': 'python-telegram-bot'}


def installato(nome, moduli_blender_veri):
    radice_nome = nome.split('.')[0]
    if radice_nome in MODULI_BLENDER or radice_nome in moduli_blender_veri:
        return True
    try:
        return importlib.util.find_spec(radice_nome) is not None
    except (ImportError, ValueError):
        return False


class Analisi:
    def __init__(self, radice, api_blender):
        self.radice = radice
        self.api = api_blender or {}
        self.moduli_blender = set(self.api.get('moduli') or [])
        self.cache_nomi = {}
        self._moduli_progetto = None
        self.ops_progetto = {}
        self.tipi_progetto = set()
        self.con_venv = any(os.path.isdir(os.path.join(radice, d)) for d in ('venv', '.venv', 'env'))

    def prescan(self, elenco):
        """Operatori e classi che il progetto registra in Blender (bl_idname): esisteranno a add-on attivo."""
        for percorso in elenco:
            try:
                albero = ast.parse(leggi_sorgente(percorso))
            except Exception:
                continue
            for n in ast.walk(albero):
                if not isinstance(n, ast.ClassDef):
                    continue
                self.tipi_progetto.add(n.name)
                for m in n.body:
                    bersaglio = m.targets[0] if isinstance(m, ast.Assign) and len(m.targets) == 1 else getattr(m, 'target', None)
                    valore = getattr(m, 'value', None)
                    if isinstance(bersaglio, ast.Name) and bersaglio.id == 'bl_idname' and isinstance(valore, ast.Constant) and isinstance(valore.value, str):
                        self.tipi_progetto.add(valore.value)
                        if '.' in valore.value:
                            categoria, nome = valore.value.split('.', 1)
                            self.ops_progetto.setdefault(categoria, set()).add(nome)

    def moduli_del_progetto(self):
        """Nomi di tutti i moduli e pacchetti Python che esistono in qualche cartella del progetto."""
        if self._moduli_progetto is None:
            nomi = set()
            for cartella, sotto, file in os.walk(self.radice):
                sotto[:] = [d for d in sotto if d not in CARTELLE_IGNORATE and not d.startswith('.')]
                nomi.update(f[:-3] for f in file if f.endswith('.py'))
                if '__init__.py' in file:
                    nomi.add(os.path.basename(cartella))
            self._moduli_progetto = nomi
        return self._moduli_progetto

    def modulo_mancante(self, problema, riga, testo_import, modulo, tocca_sys_path, usa_bpy=False):
        radice_nome = modulo.split('.')[0]
        altrove = radice_nome in self.moduli_del_progetto()
        # Una cartella con file .blend o script con bpy e' un progetto Blender: anche gli script che non
        # importano bpy (per esempio quelli di Sverchok) girano dentro Blender, con i suoi add-on.
        if getattr(self, '_progetto_blender', None) is None:
            self._progetto_blender = False
            for _cartella, sotto, file in os.walk(self.radice):
                sotto[:] = [d for d in sotto if d not in CARTELLE_IGNORATE and not d.startswith('.')]
                if any(f.lower().endswith('.blend') for f in file):
                    self._progetto_blender = True
                    break
        if (usa_bpy or self._progetto_blender) and not altrove:
            problema(riga, 'import:' + modulo, False, '%s: in uno script di Blender "%s" puo\' essere un add-on (va installato e '
                     'attivato in Blender, Preferenze > Add-on) o una libreria che manca al Python di Blender. Controlla '
                     'prima di usarlo.' % (testo_import, radice_nome))
        elif altrove or tocca_sys_path:
            problema(riga, 'import:' + modulo, False, '%s: il modulo "%s" non e\' accanto a questo file ne\' nelle cartelle sopra%s. '
                     'Se lo aggiungi a sys.path va bene, altrimenti il programma si ferma con ModuleNotFoundError.' % (
                         testo_import, radice_nome, ' (ce n\'e\' uno con questo nome in un\'altra cartella del progetto)' if altrove else ''))
        elif self.con_venv:
            problema(riga, 'import:' + modulo, False, '%s: "%s" non e\' installato nel Python di sistema. Il progetto ha un '
                     'ambiente virtuale: controlla che sia installato li\' (pip install %s).' % (
                         testo_import, radice_nome, PACCHETTI_PIP.get(radice_nome, radice_nome)))
        else:
            problema(riga, 'import:' + modulo, True, '%s: il modulo "%s" non esiste ne\' nel progetto ne\' fra quelli installati: '
                     'il programma si ferma con ModuleNotFoundError. Se e\' una libreria, installala con: pip install %s' % (
                         testo_import, radice_nome, PACCHETTI_PIP.get(radice_nome, radice_nome)))

    def nomi_del_modulo(self, percorso):
        if percorso in self.cache_nomi:
            return self.cache_nomi[percorso]
        risultato = None
        if percorso and os.path.isfile(percorso):
            try:
                albero = ast.parse(leggi_sorgente(percorso))
                nomi = nomi_di_primo_livello(albero)
                stella = any(isinstance(n, ast.ImportFrom) and any(a.name == '*' for a in n.names) for n in albero.body)
                dinamico = '__getattr__' in nomi or stella
                risultato = None if dinamico else set(nomi)
                if risultato is not None and os.path.basename(percorso) == '__init__.py':
                    cartella = os.path.dirname(percorso)
                    for voce in os.listdir(cartella):
                        if voce.endswith('.py'):
                            risultato.add(voce[:-3])
                        elif os.path.isdir(os.path.join(cartella, voce)):
                            risultato.add(voce)
            except Exception:
                risultato = None
        self.cache_nomi[percorso] = risultato
        return risultato

    def file(self, percorso):
        nome_rel = rel(self.radice, percorso)
        esito = {'file': nome_rel, 'righe': 0, 'dichiarazioni': [], 'import': [], 'problemi': [], 'blender': False,
                 'addon': False}
        problemi = esito['problemi']

        def problema(riga, tipo, grave, messaggio):
            chiave = nome_rel + '|' + tipo
            if any(p['chiave'] == chiave for p in problemi):
                return
            problemi.append({'file': nome_rel, 'riga': riga, 'grave': grave, 'messaggio': messaggio, 'chiave': chiave})

        try:
            sorgente = leggi_sorgente(percorso)
        except OSError as e:
            if getattr(e, 'errno', None) == 22 or getattr(e, 'winerror', None) in (362, 390, 395):
                problema(1, 'lettura', False, 'il file non si puo\' leggere: probabilmente e\' solo su OneDrive e non e\' scaricato '
                         'sul computer (aprilo in Esplora file o scegli "Mantieni sempre su questo dispositivo").')
            else:
                problema(1, 'lettura', False, 'non riesco a leggere il file: ' + str(e))
            return esito
        esito['righe'] = sorgente.count('\n') + 1
        try:
            albero = ast.parse(sorgente, filename=nome_rel)
        except SyntaxError as e:
            problema(e.lineno or 1, 'sintassi', True, 'errore di sintassi alla riga %s, colonna %s: %s. Finche\' non lo correggi '
                     'il file non parte per niente.' % (e.lineno, e.offset, e.msg))
            return esito

        definiti = nomi_di_primo_livello(albero)
        try:
            tabella = symtable.symtable(sorgente, nome_rel, 'exec')
        except SyntaxError:
            tabella = None

        # Dichiarazioni: funzioni con parametri, classi con metodi, variabili del modulo, import.
        for n in albero.body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                esito['dichiarazioni'].append({'nome': n.name, 'tipo': 'function', 'riga': n.lineno,
                                               'parametri': parametri_in_testo(n.args)})
            elif isinstance(n, ast.ClassDef):
                metodi = [m.name + '(' + parametri_in_testo(m.args) + ')' for m in n.body
                          if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef))]
                esito['dichiarazioni'].append({'nome': n.name, 'tipo': 'class', 'riga': n.lineno, 'metodi': metodi,
                                               'basi': [ast.unparse(b)[:40] for b in n.bases]})
        for nome, riga in definiti.items():
            if not any(d['nome'] == nome for d in esito['dichiarazioni']):
                esito['dichiarazioni'].append({'nome': nome, 'tipo': 'variable', 'riga': riga})

        tocca_sys_path = 'sys.path' in sorgente
        usa_bpy = re.search(r'^\s*(import bpy|from bpy)', sorgente, re.M) is not None
        dinamico = any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in ('exec', 'eval', 'globals', 'vars', 'locals')
                       for n in ast.walk(albero))
        stella = False
        cartella = os.path.dirname(percorso)
        for n in ast.walk(albero):
            if isinstance(n, ast.Import):
                for a in n.names:
                    locale = trova_modulo_locale(self.radice, cartella, a.name, 0, None)
                    esito['import'].append({'modulo': a.name, 'riga': n.lineno, 'locale': bool(locale)})
                    if a.name.split('.')[0] == 'bpy':
                        esito['blender'] = True
                    if not locale and not installato(a.name, self.moduli_blender):
                        self.modulo_mancante(problema, n.lineno, 'import ' + a.name, a.name, tocca_sys_path, usa_bpy)
            elif isinstance(n, ast.ImportFrom):
                modulo = n.module or ''
                if any(a.name == '*' for a in n.names):
                    stella = True
                if modulo.split('.')[0] == 'bpy':
                    esito['blender'] = True
                locale = trova_modulo_locale(self.radice, cartella, modulo, n.level, None)
                esito['import'].append({'modulo': '.' * n.level + modulo, 'nomi': [a.name for a in n.names], 'riga': n.lineno,
                                        'locale': bool(locale)})
                if locale:
                    nomi = self.nomi_del_modulo(locale if locale.endswith('.py') else os.path.join(locale, '__init__.py'))
                    if nomi is not None:
                        for a in n.names:
                            if a.name != '*' and a.name not in nomi:
                                s = simili(a.name, nomi)
                                problema(n.lineno, 'import-nome:' + a.name, True, 'from %s import %s: il file %s non ha "%s"%s. '
                                         'Il programma si ferma con ImportError.' % ('.' * n.level + modulo, a.name,
                                                                                   rel(self.radice, locale), a.name,
                                                                                   (': forse volevi "' + s[0] + '"') if s else ''))
                elif n.level == 0 and modulo and not installato(modulo, self.moduli_blender):
                    self.modulo_mancante(problema, n.lineno, 'from ' + modulo + ' import ...', modulo, tocca_sys_path, usa_bpy)

        # Nomi mai definiti.
        if tabella is not None and not stella and not dinamico:
            tutti_definiti = set(definiti) | globali_dichiarati(tabella)
            for nome in sorted(nomi_non_definiti(tabella, tutti_definiti)):
                righe = sorted({x.lineno for x in ast.walk(albero) if isinstance(x, ast.Name) and x.id == nome and isinstance(x.ctx, ast.Load)})
                if not righe:
                    continue
                candidati = list(tutti_definiti) + list(BUILTIN)
                s = simili(nome, candidati)
                extra = ''
                if nome in ('C', 'D') and esito['blender']:
                    extra = ' (C e D esistono solo nella console Python di Blender: negli script usa bpy.context e bpy.data)'
                problema(righe[0], 'nome:' + nome, True, 'usi "%s" ma non e\' definito da nessuna parte: il programma si ferma con '
                         'NameError%s%s%s.' % (nome, extra, ('. Forse volevi "' + s[0] + '"') if s else '',
                                               (' (righe ' + ', '.join(map(str, righe[:6])) + ')') if len(righe) > 1 else ''))

        self.controlla_chiamate(albero, definiti, problema)
        self.controlla_doppi(albero, problema)
        if esito['blender'] or self.api:
            self.controlla_blender(albero, sorgente, esito, problema)
        return esito

    def controlla_doppi(self, albero, problema):
        visti = {}
        for n in albero.body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if n.name in visti and not n.decorator_list:
                    problema(n.lineno, 'doppia:' + n.name, False, '%s e\' definita due volte (righe %s e %s): vale solo l\'ultima, '
                             'la prima e\' codice morto.' % (n.name, visti[n.name], n.lineno))
                visti[n.name] = n.lineno

    def controlla_chiamate(self, albero, definiti, problema):
        """Chiamate a funzioni del modulo con argomenti che Python rifiuta (TypeError)."""
        funzioni = {}
        conteggio = {}
        for n in albero.body:
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                conteggio[n.name] = conteggio.get(n.name, 0) + 1
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and not n.decorator_list:
                funzioni[n.name] = n
        # assegnati anche altrove: il nome potrebbe non essere piu' quella funzione
        riassegnati = {t.id for x in ast.walk(albero) if isinstance(x, ast.Assign) for t in x.targets if isinstance(t, ast.Name)}
        locali = set()
        for x in ast.walk(albero):
            if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                for a in list(x.args.posonlyargs) + list(x.args.args) + list(x.args.kwonlyargs):
                    locali.add(a.arg)
        for x in ast.walk(albero):
            if not isinstance(x, ast.Call) or not isinstance(x.func, ast.Name):
                continue
            nome = x.func.id
            f = funzioni.get(nome)
            if f is None or conteggio.get(nome, 0) > 1 or nome in riassegnati or nome in locali:
                continue
            if any(isinstance(a, ast.Starred) for a in x.args) or any(k.arg is None for k in x.keywords):
                continue
            args = f.args
            posizionali = [a.arg for a in list(args.posonlyargs) + list(args.args)]
            obbligatori = posizionali[:len(posizionali) - len(args.defaults)]
            kw_obbligatori = [a.arg for a, d in zip(args.kwonlyargs, args.kw_defaults) if d is None]
            usati_kw = [k.arg for k in x.keywords]
            firma = nome + '(' + parametri_in_testo(args) + ')'
            if len(x.args) > len(posizionali) and not args.vararg:
                problema(x.lineno, 'argomenti:' + nome, True, 'chiami %s con %d argomenti ma %s ne accetta al massimo %d '
                         '(riga %d): TypeError.' % (nome, len(x.args), firma, len(posizionali), f.lineno))
                continue
            validi = set(posizionali[len(args.posonlyargs):]) | {a.arg for a in args.kwonlyargs}
            for k in usati_kw:
                if k not in validi and not args.kwarg:
                    s = simili(k, validi)
                    problema(x.lineno, 'argomento-nome:' + nome + '.' + k, True, 'chiami %s con %s=... ma %s non ha questo '
                             'parametro%s: TypeError.' % (nome, k, firma, (' (forse "' + s[0] + '")') if s else ''))
            forniti = set(posizionali[:len(x.args)]) | set(usati_kw)
            mancano = [p for p in obbligatori + kw_obbligatori if p not in forniti]
            if mancano:
                problema(x.lineno, 'argomenti-mancanti:' + nome, True, 'chiami %s senza %s: %s li richiede (riga %d). '
                         'TypeError.' % (nome, ', '.join(mancano), firma, f.lineno))

    def controlla_blender(self, albero, sorgente, esito, problema):
        api = self.api
        ops = api.get('ops') or {}
        tipi = set(api.get('types') or [])
        dati = set(api.get('data') or [])
        versione = api.get('versione', '')

        def catena(nodo):
            parti = []
            while isinstance(nodo, ast.Attribute):
                parti.append(nodo.attr)
                nodo = nodo.value
            if isinstance(nodo, ast.Name):
                parti.append(nodo.id)
                return list(reversed(parti))
            return None

        if ops or tipi:
            for n in ast.walk(albero):
                if not isinstance(n, ast.Attribute):
                    continue
                c = catena(n)
                if not c or c[0] != 'bpy' or len(c) < 3:
                    continue
                if c[1] == 'ops' and ops:
                    if c[2] not in ops and c[2] not in self.ops_progetto:
                        s = simili(c[2], ops.keys())
                        problema(n.lineno, 'bpy.ops.' + c[2], True, 'bpy.ops.%s non esiste in Blender %s%s.' % (
                            c[2], versione, (': forse bpy.ops.' + s[0]) if s else ''))
                    elif len(c) >= 4 and c[3] not in ops.get(c[2], []) and c[3] not in self.ops_progetto.get(c[2], set()):
                        s = simili(c[3], list(ops.get(c[2], [])) + list(self.ops_progetto.get(c[2], set())))
                        problema(n.lineno, 'bpy.ops.%s.%s' % (c[2], c[3]), True, 'l\'operatore bpy.ops.%s.%s non esiste in '
                                 'Blender %s%s.' % (c[2], c[3], versione, (': forse bpy.ops.%s.%s' % (c[2], s[0])) if s else ''))
                elif c[1] == 'types' and tipi and c[2] not in tipi and c[2] not in self.tipi_progetto:
                    s = simili(c[2], tipi)
                    problema(n.lineno, 'bpy.types.' + c[2], True, 'bpy.types.%s non esiste in Blender %s%s.' % (
                        c[2], versione, (': forse bpy.types.' + s[0]) if s else ''))
                elif c[1] == 'data' and dati and c[2] not in dati:
                    s = simili(c[2], dati)
                    problema(n.lineno, 'bpy.data.' + c[2], True, 'bpy.data.%s non esiste in Blender %s%s.' % (
                        c[2], versione, (': forse bpy.data.' + s[0]) if s else ''))

        # Add-on: bl_info (vecchio stile) o blender_manifest.toml accanto (estensioni 4.2+).
        nomi = nomi_di_primo_livello(albero)
        manifest = os.path.isfile(os.path.join(os.path.dirname(os.path.join(self.radice, esito['file'])), 'blender_manifest.toml'))
        if 'bl_info' in nomi or (manifest and os.path.basename(esito['file']) == '__init__.py'):
            esito['addon'] = True
            for funzione in ('register', 'unregister'):
                if funzione not in nomi:
                    problema(1, 'addon:' + funzione, True, 'e\' un add-on di Blender ma manca la funzione %s(): Blender non '
                             'riesce ad attivarlo o disattivarlo.' % funzione)
        for n in albero.body:
            if not isinstance(n, ast.ClassDef):
                continue
            basi = [ast.unparse(b) for b in n.bases]
            assegnati = {}
            for m in n.body:
                if isinstance(m, ast.Assign) and len(m.targets) == 1 and isinstance(m.targets[0], ast.Name) and isinstance(m.value, ast.Constant):
                    assegnati[m.targets[0].id] = (m.value.value, m.lineno)
                elif isinstance(m, ast.AnnAssign) and isinstance(m.target, ast.Name) and isinstance(m.value, ast.Constant):
                    assegnati[m.target.id] = (m.value.value, m.lineno)
            if any(re.search(r'(^|\.)Operator$', b) for b in basi):
                idname = assegnati.get('bl_idname')
                if idname is None:
                    problema(n.lineno, 'bl_idname:' + n.name, True, 'l\'operatore %s non ha bl_idname: Blender rifiuta la '
                             'registrazione.' % n.name)
                elif isinstance(idname[0], str) and not re.match(r'^[a-z0-9_]+\.[a-z0-9_]+$', idname[0]):
                    problema(idname[1], 'bl_idname:' + n.name, True, 'bl_idname = "%s" non va bene: deve essere "categoria.nome" '
                             'tutto minuscolo (per esempio "object.sposta_su"), altrimenti Blender rifiuta la '
                             'registrazione.' % idname[0])
                if 'bl_label' not in assegnati:
                    problema(n.lineno, 'bl_label:' + n.name, False, 'l\'operatore %s non ha bl_label: nel menu e nella ricerca '
                             'comparira\' senza nome.' % n.name)
            if any(re.search(r'(^|\.)Panel$', b) for b in basi):
                for campo in ('bl_space_type', 'bl_region_type'):
                    if campo not in assegnati:
                        problema(n.lineno, campo + ':' + n.name, True, 'il pannello %s non ha %s: Blender rifiuta la '
                                 'registrazione.' % (n.name, campo))


def main():
    if len(sys.argv) < 2:
        print('Uso: python cervello-python.py <cartella> [--api-blender file.json] [--solo file.py]', file=sys.stderr)
        return 2
    radice = os.path.abspath(sys.argv[1])
    api = {}
    solo = None
    if '--api-blender' in sys.argv:
        try:
            with open(sys.argv[sys.argv.index('--api-blender') + 1], encoding='utf-8') as f:
                api = json.load(f)
        except Exception:
            api = {}
    if '--solo' in sys.argv:
        solo = os.path.abspath(sys.argv[sys.argv.index('--solo') + 1])
    analisi = Analisi(radice, api)
    tutti = elenca_file(radice)
    analisi.prescan(tutti)
    elenco = [solo] if solo else tutti
    risultati = []
    for percorso in elenco:
        try:
            risultati.append(analisi.file(percorso))
        except Exception as e:  # un file strano non deve fermare gli altri
            risultati.append({'file': rel(radice, percorso), 'righe': 0, 'dichiarazioni': [], 'import': [], 'blender': False,
                              'addon': False, 'problemi': [], 'interno': '%s: %s' % (type(e).__name__, e)})
    json.dump({'python': sys.version.split()[0], 'radice': radice, 'troncato': len(elenco) >= MAX_FILE,
               'pytest': importlib.util.find_spec('pytest') is not None, 'file': risultati},
              sys.stdout, ensure_ascii=False)
    return 0


if __name__ == '__main__':
    sys.exit(main())
