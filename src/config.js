// Ranking online (opcional). Con estos campos vacíos el juego anda igual,
// pero sin ranking ni ligas.
//
// Dónde están: Supabase → Project Settings → API Keys.
//   supabaseUrl: "Project URL", por ejemplo https://abcdefgh.supabase.co
//   supabaseKey: la clave "Publishable" (sb_publishable_...) o la "anon" legacy.
//
// La clave publishable es pública por diseño y puede ir en el código: con
// supabase/schema.sql sólo permite usar las funciones del ranking.
// NUNCA pongas acá la secret key (sb_secret_...) ni la service_role:
// el juego la detecta y desactiva el ranking.
export const CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
