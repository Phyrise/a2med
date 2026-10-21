// Where the app lives: every URL of the app and of its data is relative to this folder, so the same files work at the root of
// the local server (http://localhost:8790/) and under a sub-path on GitHub Pages (https://phyrise.github.io/a2med/).
export const BASE=new URL('./',import.meta.url).href;
// The « Sur Sparka » search test only exists on the local server (server.py relays /api/ to Sparka); never on the published site.
export const DEV=/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
