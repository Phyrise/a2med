// Where the app lives: every URL of the app and of its data is relative to this folder, so the same files work at the root of
// the local server (http://localhost:8790/) and under a sub-path on GitHub Pages (https://phyrise.github.io/a2med/).
export const BASE=new URL('./',import.meta.url).href;
// Name of this app's storage (Cache Storage, localStorage). Apps of one origin share it, so phyrise.github.io/a2med/ and
// phyrise.github.io/a2med-test/ must not read or delete each other's data and shell: the app at / or /a2med/ keeps the plain
// 'a2med' names of 0.6 (an update keeps the installed data), any other folder gets its own ('a2med@a2med-test'). Same rule in sw.js.
export const NS=(p=>p==='/'||p==='/a2med/'?'a2med':'a2med@'+p.replace(/^\/|\/$/g,'').replace(/[^a-z0-9]+/gi,'-'))(new URL(BASE).pathname);
