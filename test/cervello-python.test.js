// Prova il cervello per Python e Blender su progetti finti costruiti al volo: gli errori veri
// (visti nelle cartelle dell'utente: operatori di Blender inventati, nomi mai definiti, un "1"
// di troppo a inizio file) e i casi che NON devono dare allarmi (operatori registrati dal
// proprio add-on, moduli aggiunti a sys.path, add-on di Blender come Sverchok).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'strumenti', 'cervello-python.py');
const API = path.join(__dirname, '..', 'strumenti', 'vendor', 'blender-api.json');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

let python = null;
for (const comando of ['python', 'py']) {
  try { execFileSync(comando, ['--version'], { stdio: 'ignore' }); python = comando; break; } catch (e) { /* prossimo */ }
}

const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-python-'));
  cartelle.push(dir);
  Object.keys(file).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, file[nome]);
  });
  return dir;
}
function analizza(dir) {
  const args = [SCRIPT, dir];
  if (fs.existsSync(API)) args.push('--api-blender', API);
  const j = JSON.parse(execFileSync(python, args, { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
  return [].concat.apply([], j.file.map(function (f) { return f.problemi; }));
}
function trova(lista, testo) { return lista.find(function (p) { return p.messaggio.indexOf(testo) !== -1; }); }
function elenco(lista) {
  return lista.map(function (p) { return (p.grave ? 'GRAVE ' : '') + p.file + ':' + p.riga + ' ' + p.messaggio; }).join(' | ') || '(nessuno)';
}
function fine() {
  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  console.log('\n' + '='.repeat(50));
  console.log('CERVELLO PYTHON: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
}

if (!python) {
  console.log('  (Python non installato: prove saltate)');
  fine();
}

console.log('\n=== Errori di Python ===');
let lista = analizza(progetto({
  'main.py': [
    'import os',
    'from utili import somma, sottrai',
    '',
    'def saluta(nome, saluto="ciao"):',
    '    return saluto + " " + nome',
    '',
    'print(saluta("Pietro", salutto="ehi"))',
    'print(saluta())',
    'print(saluta("a", "b", "c"))',
    'print(risultatto)',
    'risultato = somma(1, 2)',
    'print(os.getcwd(), len(risultato))'
  ].join('\n'),
  'utili.py': 'def somma(a, b):\n    return a + b\n',
  'rotto.py': '1from os import path\n'
}));
check('from utili import sottrai: il file non ha quel nome (GRAVE)', !!trova(lista, 'import sottrai') && trova(lista, 'import sottrai').grave, elenco(lista));
check('parametro con nome sbagliato, con suggerimento', !!trova(lista, 'salutto=') && trova(lista, 'salutto=').messaggio.indexOf('"saluto"') !== -1, elenco(lista));
check('argomento obbligatorio mancante', !!trova(lista, 'senza nome'), elenco(lista));
check('troppi argomenti', !!trova(lista, 'con 3 argomenti'), elenco(lista));
const nome = trova(lista, 'usi "risultatto"');
check('nome mai definito (NameError) con il nome giusto', !!nome && nome.grave && nome.riga === 10 && nome.messaggio.indexOf('"risultato"') !== -1, elenco(lista));
check('un "1" di troppo a inizio file: errore di sintassi alla riga 1', !!lista.find(function (p) { return p.file === 'rotto.py' && p.riga === 1 && /sintassi/.test(p.messaggio); }), elenco(lista));
check('os, len e print non sono errori', !trova(lista, '"os"') && !trova(lista, '"len"') && !trova(lista, '"print"'), elenco(lista));

console.log('\n=== Moduli: installati, locali, aggiunti a sys.path ===');
lista = analizza(progetto({
  'app/main.py': 'import json\nimport modulo_che_non_esiste_davvero\nfrom modelli import Utente\n',
  'app/modelli.py': 'class Utente:\n    pass\n',
  'strumenti/cli.py': 'import sys, os\nsys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "app"))\nfrom modelli import Utente\n'
}));
check('modulo inesistente: GRAVE con il comando pip', !!trova(lista, 'modulo_che_non_esiste_davvero') && trova(lista, 'modulo_che_non_esiste_davvero').grave &&
  trova(lista, 'modulo_che_non_esiste_davvero').messaggio.indexOf('pip install') !== -1, elenco(lista));
check('json installato e modelli accanto al file: nessun errore', !lista.some(function (p) { return p.file === 'app/main.py' && /json|modelli/.test(p.messaggio); }), elenco(lista));
const syspath = lista.find(function (p) { return p.file === 'strumenti/cli.py'; });
check('modulo raggiunto con sys.path: solo da controllare', !!syspath && !syspath.grave, elenco(lista));

console.log('\n=== Blender ===');
if (!fs.existsSync(API)) {
  console.log('  (elenco dell\'API di Blender assente: prove sugli operatori saltate)');
} else {
  lista = analizza(progetto({
    '__init__.py': [
      'import bpy',
      'bl_info = {"name": "Prova", "blender": (4, 4, 0)}',
      '',
      'class OGGETTO_OT_sposta(bpy.types.Operator):',
      '    bl_idname = "Oggetto.Sposta"',
      '    bl_label = "Sposta"',
      '    def execute(self, context):',
      '        bpy.ops.mesh.primitive_cube_add()',
      '        bpy.ops.mesh.add_cube()',
      '        bpy.ops.mioaddon.genera()',
      '        return {"FINISHED"}',
      '',
      'class MIOADDON_OT_genera(bpy.types.Operator):',
      '    bl_idname = "mioaddon.genera"',
      '    bl_label = "Genera"',
      '',
      'class PANNELLO_PT_prova(bpy.types.Panel):',
      '    bl_label = "Prova"',
      '',
      'def register():',
      '    bpy.utils.register_class(OGGETTO_OT_sposta)'
    ].join('\n'),
    'scena.blend': 'finto',
    'labirinto.py': 'from sverchok.data_structure import updateNode\n'
  }));
  check('bpy.ops.mesh.add_cube non esiste in Blender 4.4 (GRAVE)', !!trova(lista, 'bpy.ops.mesh.add_cube') && trova(lista, 'bpy.ops.mesh.add_cube').grave, elenco(lista));
  check('bpy.ops.mesh.primitive_cube_add esiste: nessun errore', !trova(lista, 'primitive_cube_add non'), elenco(lista));
  check('operatore registrato dal proprio add-on (mioaddon.genera): nessun errore', !trova(lista, 'mioaddon'), elenco(lista));
  check('bl_idname con maiuscole: GRAVE', !!trova(lista, 'bl_idname = "Oggetto.Sposta"') && trova(lista, 'bl_idname = "Oggetto.Sposta"').grave, elenco(lista));
  check('add-on senza unregister(): GRAVE', !!trova(lista, 'manca la funzione unregister()'), elenco(lista));
  check('pannello senza bl_space_type: GRAVE', !!trova(lista, 'non ha bl_space_type'), elenco(lista));
  const sverchok = trova(lista, 'sverchok');
  check('Sverchok in un progetto Blender: solo da controllare (e\' un add-on)', !!sverchok && !sverchok.grave, elenco(lista));
}

fine();
