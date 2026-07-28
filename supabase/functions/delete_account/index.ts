// Edge Function: excluir-conta
// Usuário autenticado exclui a própria conta (LGPD).
// 1. Identifica o usuário pelo JWT.
// 2. Deleta a linha em "usuarios" (o ON DELETE CASCADE do schema já limpa
//    user_item, watched_episode, user_rating, user_rating_episode, lista, lista_item).
// 3. Deleta o login em si (auth.users) via API admin - só dá pra fazer com service_role.
//
// Deploy:  criar função "excluir-conta" e colar este código
// Chamada (frontend, autenticado): POST /functions/v1/excluir-conta   (sem body)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // 1. Identifica o usuário chamador pelo JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Usuário não autenticado." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    // Cliente com service_role: ignora RLS e tem acesso à API admin de Auth
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 2. Deleta o perfil (cascata limpa o resto dos dados do usuário)
    const { error: dbErr } = await admin.from("usuarios").delete().eq("id", userId);
    if (dbErr) throw dbErr;

    // 3. Deleta o login/credencial em si
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
