// Edge Function: obter-episodio-traduzido
// Mesma lógica da obter-titulo-traduzido, só que pro episódio:
// - idioma = "pt-BR" -> lê direto de "episode" (idioma padrão da ingestão)
// - outro idioma -> confere cache em "episode_traducao"; se faltar, busca na TMDB;
//   se a TMDB não tiver tradução pra esse idioma (sinopse vazia), cai pra inglês.
//
// Deploy: criar função "obter-episodio-traduzido" e colar este código
// Chamada: POST /functions/v1/obter-episodio-traduzido  { "episode_id": 62085, "idioma": "en-US" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TMDB_TOKEN = Deno.env.get("TMDB_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { episode_id, idioma } = await req.json();
    if (!episode_id || !idioma) {
      return new Response(
        JSON.stringify({ error: "episode_id e idioma são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (idioma === "pt-BR") {
      const { data, error } = await db
        .from("episode")
        .select("episode_name, sinopse")
        .eq("id", episode_id)
        .single();
      if (error) throw error;
      return new Response(JSON.stringify({ ...data, idioma, fonte: "padrao" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cache } = await db
      .from("episode_traducao")
      .select("episode_name, sinopse")
      .eq("episode_id", episode_id)
      .eq("idioma", idioma)
      .maybeSingle();

    if (cache) {
      return new Response(JSON.stringify({ ...cache, idioma, fonte: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Precisa de titulo_id + season_number + episode_number pra montar a URL da TMDB
    const { data: ep, error: epErr } = await db
      .from("episode")
      .select("titulo_id, season_number, episode_number")
      .eq("id", episode_id)
      .single();
    if (epErr) throw epErr;

    const buscaTmdb = async (lang: string) => {
      const url = `https://api.themoviedb.org/3/tv/${ep.titulo_id}/season/${ep.season_number}/episode/${ep.episode_number}?language=${lang}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error(`TMDB respondeu ${res.status}`);
      return res.json();
    };

    let detalhes = await buscaTmdb(idioma);
    let idiomaFinal = idioma;

    if (!detalhes.overview) {
      detalhes = await buscaTmdb("en-US");
      idiomaFinal = "en-US";
    }

    const traducao = {
      episode_id,
      idioma, // cache guardado com a chave do idioma PEDIDO, mesmo se o conteúdo é fallback
      episode_name: detalhes.name,
      sinopse: detalhes.overview,
    };

    await db.from("episode_traducao").upsert(traducao);

    return new Response(JSON.stringify({ ...traducao, idioma_conteudo: idiomaFinal, fonte: "tmdb" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});