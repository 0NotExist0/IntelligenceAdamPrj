// Prova il cervello per Unity su un progetto finto: messaggi di MonoBehaviour scritti male o con il
// parametro sbagliato, classe con nome diverso dal file, GetComponent in Update, impostazioni
// Android da sistemare prima di pubblicare, errori letti dalla Console (Editor.log). E i casi che
// NON devono dare allarmi: nomi giusti, metodi chiamati dal proprio codice, testo nei commenti.
// La compilazione vera si prova a mano sui progetti dell'utente: serve Unity installato.
const fs = require('fs');
const os = require('os');
const path = require('path');
const unity = require('../strumenti/cervello-unity');

let pass = 0;
let fail = 0;
function check(nome, condizione, dettaglio) {
  if (condizione) { pass++; console.log('  ok   ' + nome); }
  else { fail++; console.log('  FAIL ' + nome + (dettaglio !== undefined ? '  -> ' + dettaglio : '')); }
}

const cartelle = [];
function progetto(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prova-unity-'));
  cartelle.push(dir);
  const tutti = Object.assign({ 'ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 6000.2.2f1\n' }, file);
  Object.keys(tutti).forEach(function (nome) {
    const completo = path.join(dir, nome);
    fs.mkdirSync(path.dirname(completo), { recursive: true });
    fs.writeFileSync(completo, tutti[nome]);
  });
  fs.mkdirSync(path.join(dir, 'Assets'), { recursive: true });
  return dir;
}
function trova(lista, testo) { return lista.find(function (p) { return p.messaggio.indexOf(testo) !== -1; }); }
function elenco(lista) {
  return lista.map(function (p) { return (p.grave ? 'GRAVE ' : '') + p.file + ':' + p.riga + ' ' + p.messaggio; }).join(' | ') || '(nessuno)';
}

(async function () {
  console.log('\n=== Script C# di Unity ===');
  const dir = progetto({
    'Assets/Scripts/Giocatore.cs': [
      'using UnityEngine;',
      '',
      'public class Giocatore : MonoBehaviour',
      '{',
      '    private Rigidbody corpo;',
      '    // void update() in un commento non conta',
      '    private string testo = "void start() dentro una stringa";',
      '    void Awake() { corpo = GetComponent<Rigidbody>(); }',
      '    void update()',
      '    {',
      '        var r = GetComponent<Renderer>();',
      '    }',
      '    void OnTriggerEnter(Collision urto) { }',
      '    void OnCollisionEnter(Collision urto) { }',
      '    void Updte() { }',
      '    void Salta() { }',
      '}'
    ].join('\n'),
    'Assets/Scripts/Nemico.cs': [
      'using UnityEngine;',
      'public class Zombie : MonoBehaviour',
      '{',
      '    void Update() { var t = GameObject.Find("Giocatore"); }',
      '}'
    ].join('\n'),
    'Assets/Scripts/Boss.cs': [
      'public class Boss : Zombie',
      '{',
      '    void start() { }',
      '    void fixedUpdate() { }',
      '    void Attacca() { fixedUpdate(); }',
      '}'
    ].join('\n'),
    'ProjectSettings/ProjectSettings.asset': [
      'PlayerSettings:',
      '  companyName: DefaultCompany',
      '  productName: Prova',
      '  applicationIdentifier:',
      '    Android: com.UnityTechnologies.com.unity.template.urpblank',
      '    Standalone: com.Unity-Technologies.com.unity.template.urp-blank',
      '  AndroidMinSdkVersion: 23',
      '  AndroidTargetArchitectures: 1',
      '  androidUseCustomKeystore: 0',
      '  scriptingBackend:',
      '    Android: 0'
    ].join('\n')
  });
  const r = await unity.analizzaUnity(dir, { compila: false, console: false });
  const lista = r.problemi;
  check('update() minuscolo: GRAVE, Unity non lo chiama', !!trova(lista, 'update() non viene mai chiamato') && trova(lista, 'update() non viene mai chiamato').riga === 9, elenco(lista));
  check('OnTriggerEnter(Collision): parametro sbagliato GRAVE, con consiglio OnCollisionEnter', !!trova(lista, 'OnTriggerEnter(Collision) ha il parametro sbagliato') &&
    trova(lista, 'OnTriggerEnter(Collision)').grave && trova(lista, 'OnTriggerEnter(Collision)').messaggio.indexOf('OnCollisionEnter(Collision)') !== -1, elenco(lista));
  check('OnCollisionEnter(Collision) giusto: nessun errore', !trova(lista, 'OnCollisionEnter(Collision) ha'), elenco(lista));
  check('Updte(): somiglia a Update, da controllare', !!trova(lista, 'Updte() somiglia') && !trova(lista, 'Updte() somiglia').grave, elenco(lista));
  check('commenti e stringhe non contano', lista.filter(function (p) { return /start\(\)/.test(p.messaggio) && p.file === 'Assets/Scripts/Giocatore.cs'; }).length === 0, elenco(lista));
  check('Salta() e Awake(): nessun problema', !trova(lista, 'Salta') && !trova(lista, 'Awake()'), elenco(lista));
  check('GameObject.Find in Update: da controllare per il telefono', !!trova(lista, 'Zombie.Update() c\'e\' GetComponent o Find'), elenco(lista));
  check('GetComponent in update() minuscolo non e\' contato come Update', !trova(lista, 'Giocatore.update() c\'e\''), elenco(lista));
  check('classe Zombie nel file Nemico.cs: da controllare', !!trova(lista, 'il file si chiama Nemico.cs'), elenco(lista));
  check('ereditarieta\': Boss deriva da Zombie, start() minuscolo e\' GRAVE', !!lista.find(function (p) { return p.file === 'Assets/Scripts/Boss.cs' && /start\(\) non viene mai chiamato/.test(p.messaggio); }), elenco(lista));
  check('fixedUpdate() chiamato dal proprio codice: non segnalato', !trova(lista, 'fixedUpdate() non viene'), elenco(lista));

  console.log('\n=== App Android ===');
  check('identificativo del modello di Unity', !!trova(lista, 'identificativo Android e\' ancora quello del modello'), elenco(lista));
  check('DefaultCompany', !!trova(lista, 'DefaultCompany'), elenco(lista));
  check('firma di debug', !!trova(lista, 'chiave di debug'), elenco(lista));
  check('backend Mono: serve IL2CPP', !!trova(lista, 'non e\' IL2CPP'), elenco(lista));
  check('solo ARMv7: manca ARM64', !!trova(lista, 'ARM64 non e\' selezionata'), elenco(lista));
  check('le impostazioni sono solo avvisi, mai GRAVI', lista.filter(function (p) { return p.file === 'ProjectSettings/ProjectSettings.asset'; }).every(function (p) { return !p.grave; }));

  console.log('\n=== Assembly di un file ===');
  const conAsmdef = progetto({
    'Assets/Gioco/Runtime/Gioco.Runtime.asmdef': JSON.stringify({ name: 'Gioco.Runtime' }),
    'Assets/Gioco/Runtime/Armi/Pistola.cs': 'class Pistola {}',
    'Assets/Scripts/Editor/Strumento.cs': 'class Strumento {}',
    'Assets/Plugins/Libreria.cs': 'class Libreria {}'
  });
  check('file sotto un .asmdef: il suo assembly', unity.assemblyDelFile(conAsmdef, 'Assets/Gioco/Runtime/Armi/Pistola.cs') === 'Gioco.Runtime');
  check('cartella Editor: Assembly-CSharp-Editor', unity.assemblyDelFile(conAsmdef, 'Assets/Scripts/Editor/Strumento.cs') === 'Assembly-CSharp-Editor');
  check('cartella Plugins: Assembly-CSharp-firstpass', unity.assemblyDelFile(conAsmdef, 'Assets/Plugins/Libreria.cs') === 'Assembly-CSharp-firstpass');
  check('trova il progetto salendo da una sottocartella', unity.trovaProgettoUnity(path.join(conAsmdef, 'Assets', 'Gioco')) === conAsmdef);

  console.log('\n=== Uscita del compilatore ===');
  const errori = unity.leggiErroriCompilatore(dir, [
    path.join(dir, 'Assets', 'Scripts', 'Giocatore.cs') + '(12,9): error CS0103: The name \'transfrom\' does not exist in the current context',
    'Assets/Scripts/Giocatore.cs(12,9): error CS0103: The name \'transfrom\' does not exist in the current context',
    'Assets/Scripts/Nemico.cs(3,1): warning CS0168: The variable \'e\' is declared but never used'
  ].join('\n'));
  check('errore con percorso assoluto riportato come percorso del progetto', errori.length === 1 && errori[0].file === 'Assets/Scripts/Giocatore.cs' && errori[0].riga === 12 && errori[0].codice === 'CS0103', JSON.stringify(errori));

  console.log('\n=== Console di Unity (Editor.log) ===');
  const log = path.join(dir, 'Editor.log');
  fs.writeFileSync(log, [
    'Command Line: Unity.exe -projectpath ' + dir.split(path.sep).join('/'),
    'Reloading assemblies after forced synchronous recompile.',
    'Assets/Scripts/Nemico.cs(7,13): error CS1002: ; expected',
    'NullReferenceException: Object reference not set to an instance of an object',
    'Giocatore.Update () (at Assets/Scripts/Giocatore.cs:42)',
    '',
    'UnityEngine.Debug:LogException(Exception)',
    'UnityEngine.Advertisements.Editor.AdsService:OnRequestGameIdsCompletedError(Exception) (at Library/PackageCache/ads/AdsService.cs:42)',
    'Strumento:Ricompila () (at Assets/Editor/RecompileButton.cs:29)',
    ''
  ].join('\n'));
  const c = unity.erroriDellaConsole(dir, log);
  check('errore di compilazione dalla Console', c.compilazione.length === 1 && c.compilazione[0].file === 'Assets/Scripts/Nemico.cs' && c.compilazione[0].codice === 'CS1002', JSON.stringify(c.compilazione));
  check('NullReferenceException con file e riga del progetto', c.runtime.length === 1 && c.runtime[0].file === 'Assets/Scripts/Giocatore.cs' && c.runtime[0].riga === 42 &&
    /NullReferenceException/.test(c.runtime[0].messaggio), JSON.stringify(c.runtime));
  const altro = unity.erroriDellaConsole(conAsmdef, log);
  check('log di un altro progetto: non si usa', altro.altroProgetto === true);

  cartelle.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
  console.log('\n' + '='.repeat(50));
  console.log('CERVELLO UNITY: ' + pass + ' passati, ' + fail + ' falliti');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.log('  FAIL eccezione: ' + (e && e.stack || e));
  process.exit(1);
});
