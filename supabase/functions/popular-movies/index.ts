// Edge Function: popular-movies
// Proxy ao vivo pro "populares" da TMDB (já lançados, ordenados por popularidade) --
// usado na seção "Popular"/Top 10 Filmes da aba Explorar. NÃO grava nada no banco,
// mesma categoria de buscar-titulo/soon-movies.
//
// Chamada: POST /functions/v1/popular-movies   { "page": 1 }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TMDB_TOKEN = Deno.env.get("TMDB_TOKEN")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { page = 1 } = await req.json().catch(() => ({}));

    const tmdbRes = await fetch(
      `https://api.themoviedb.org/3/movie/popular?language=pt-BR&region=BR&page=${page}`,
      { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" } },
    );

    if (!tmdbRes.ok) {
      const detail = await tmdbRes.text();
      return new Response(JSON.stringify({ error: "Erro ao consultar a TMDB", detail }), {
        status: tmdbRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await tmdbRes.json();
    const results = (data.results ?? []).map((r: any) => ({
      tmdb_id: r.id,
      media_type: "movie",
      nome: r.title,
      ano: (r.release_date ?? "").slice(0, 4),
      imagem: r.poster_path,
      sinopse: r.overview,
    }));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
