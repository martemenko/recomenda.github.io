// Edge Function: avaliar
// Usuário autenticado envia uma nota (1-10) pra um título OU um episódio.
// Nota: usa o cliente autenticado como o PRÓPRIO usuário (não service_role) -
// a política de RLS de user_rating/user_rating_episode já garante, por conta
// própria, que ninguém consegue gravar avaliação em nome de outra pessoa.
// A média exibida (titulo.media_rating / episode.media_rating) é recalculada
// automaticamente pelo trigger do banco - não precisa fazer nada extra aqui.
//
// Deploy: criar função "avaliar" e colar este código
// Chamada (frontend, autenticado):
//   POST /functions/v1/avaliar   { "titulo_id": 1396, "rating_score": 9 }
//   POST /functions/v1/avaliar   { "episode_id": 62085, "rating_score": 8 }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

    const { titulo_id, episode_id, rating_score } = await req.json();

    if (!Number.isInteger(rating_score) || rating_score < 1 || rating_score > 10) {
      return new Response(
        JSON.stringify({ error: "rating_score deve ser um número inteiro entre 1 e 10." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!titulo_id && !episode_id) {
      return new Response(
        JSON.stringify({ error: "Informe titulo_id ou episode_id." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (titulo_id && episode_id) {
      return new Response(
        JSON.stringify({ error: "Informe apenas um: titulo_id OU episode_id, não os dois." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tabela = titulo_id ? "user_rating" : "user_rating_episode";
    const payload = titulo_id
      ? { user_id: userId, titulo_id, rating_score, rated_at: new Date().toISOString() }
      : { user_id: userId, episode_id, rating_score, rated_at: new Date().toISOString() };

    const { error } = await userClient.from(tabela).upsert(payload);
    if (error) throw error;

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
