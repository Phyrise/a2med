// Sources (0.9, 29/10/2026): the SPILF pack (pack-007, with the search model) and the SFAR and SRLF packages (releases/sfar-001,
// releases/srlf-002: same format, no model). Each package is an optional block of the data manifest,
// stored under pack/<prefix>. Its documents get ids offset by `offset` in the app, so a saved page keeps its id whatever is installed.
// 0.9.1 (29/10): srlf-002 = srlf-001 + 2 SRLF articles added by hand (CC BY, collecte/srlf/manuel/ajouts.py).
// fingerprint: the corpus fingerprint each pack must have (as engine.js FINGERPRINT for the SPILF pack).
export const SOURCES=[
  {id:'spilf',label:'SPILF',name:'Infectiologie (SPILF)',prefix:'',offset:0,fingerprint:'45e2c39e21ac7764151a9d98b67ca6aa6302cc2282acd0b9dacb44b38fb01e67'},
  {id:'sfar',label:'SFAR',name:'Anesthésie-réanimation (SFAR)',prefix:'sfar/',offset:1000,fingerprint:'6d7a00d5644ed206ad858078ca75aa78e57d1cccb2601f469b2f695b2617644f'},
  {id:'srlf',label:'SRLF',name:'Réanimation (SRLF)',prefix:'srlf/',offset:2000,fingerprint:'b8c4b5b4c81d38359ad90eb8d1d79d0313dcce058269606e07132ebde2cb4ddf'}];
export const sourceOf=doc=>[...SOURCES].reverse().find(s=>doc>=s.offset);
// The SPILF pack is always there (it carries the model); the others when installed (data.js writes them into the local manifest).
export const installedSources=ids=>SOURCES.filter(s=>s.id==='spilf'||ids?.includes(s.id));
