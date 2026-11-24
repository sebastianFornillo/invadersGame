// Acceso seguro a localStorage: si el navegador lo bloquea (modo privado,
// iframes con sandbox) el juego sigue funcionando sin guardar nada.
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* sin almacenamiento disponible */
    }
  },
};
