/* Configuration des débats (valeurs publiques). En local : Worker « wrangler dev » et clé de test Turnstile. */
window.QF = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? { API: "http://localhost:8787", TS_KEY: "1x00000000000000000000AA" }
  : { API: "", TS_KEY: "" };  // à remplir après le déploiement du Worker et la création du widget Turnstile
