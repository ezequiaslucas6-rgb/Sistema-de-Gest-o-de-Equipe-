import { createClient } from "@supabase/supabase-js";

// Chave publicável: pode ficar no código do programa. Quem protege os dados são as regras RLS
// das tabelas escala_* (só usuários logados cujo e-mail está em escala_usuarios).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://iimteizyruollpwyqusq.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable__aMmYbfrIgafUt2Jhq6UzQ_oVUQ4nxA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
