// Edge Function: em-breve-filmes
// Proxy ao vivo pra lançamentos futuros de filmes (cinema/streaming), com filtro opcional de gênero.
// NÃO grava nada no banco - mesma categoria da buscar-titulo.
//
// Deploy: criar função "em-breve-filmes" e colar este código
// Chamada: POST /functions/v1/em-breve-filmes   { "genre_id": 27, "page": 1 }
//   genre_id é opcional (omitir = todos os gêneros). Ids de gênero vêm de /genre/movie/list na TMDB.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TMDB_TOKEN = Deno.env.get("TMDB_TOKEN")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { genre_id, page = 1 } = await req.json().catch(() => ({}));

    const hoje = new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({
      language: "pt-BR",
      region: "BR",
      sort_by: "popularity.desc",
      "primary_release_date.gte": hoje,
      page: String(page),
    });
    if (genre_id) params.set("with_genres", String(genre_id));

    const tmdbRes = await fetch(`https://api.themoviedb.org/3/discover/movie?${params}`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
    });

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
      nome: r.title,
      data_lancamento: r.release_date,
      imagem: r.poster_path,
      sinopse: r.overview,
      generos_ids: r.genre_ids,
    }));

    return new Response(JSON.stringify({ results, total_pages: data.total_pages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});