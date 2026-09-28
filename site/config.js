/* Configuration des débats (valeurs publiques). En local : Worker « wrangler dev » et clé de test Turnstile. */
window.QF = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? { API: "http://localhost:8787", TS_KEY: "1x00000000000000000000AA" }
  : { API: "https://qui-finance-debats.dowdow27.workers.dev", TS_KEY: "0x4AAAAAAFGVYVyB8h41tE3f",
      CF_TOKEN: "" };  // Cloudflare Web Analytics (sans cookie) : jeton du site « dowdow27.github.io », vide = pas de mesure
