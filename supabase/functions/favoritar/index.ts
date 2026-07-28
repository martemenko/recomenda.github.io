// Edge Function: favoritar
// Chamada quando o usuário clica no coraçãozinho na página do título.
// Marca/desmarca o titulo_id como favorito para o usuário autenticado,
// criando a linha em user_item se ela ainda não existir (o usuário pode
// favoritar um título antes de tê-lo adicionado a qualquer status).
//
// Deploy: colar este código na função "favoritar" no editor do Supabase e clicar Deploy
// Chamada (frontend, autenticado): POST /functions/v1/favoritar
//   { "titulo_id": 1396, "favorito": true }

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

    const { titulo_id, favorito } = await req.json();
    if (!titulo_id || typeof favorito !== "boolean") {
      return new Response(
        JSON.stringify({ error: "titulo_id e favorito (bool) são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Preserva o status atual se a linha já existir; se não existir ainda
    // (usuário favoritou antes de adicionar o título a qualquer lista/status),
    // cria com o status padrão "quero_ver".
    const { data: existente, error: erroExistente } = await db
      .from("user_item")
      .select("status")
      .eq("user_id", userId)
      .eq("titulo_id", titulo_id)
      .maybeSingle();
    if (erroExistente) throw erroExistente;

    const { error: erroUpsert } = await db.from("user_item").upsert({
      user_id: userId,
      titulo_id,
      status: existente?.status ?? "quero_ver",
      favorito,
    });
    if (erroUpsert) throw erroUpsert;

    return new Response(JSON.stringify({ ok: true, favorito }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});