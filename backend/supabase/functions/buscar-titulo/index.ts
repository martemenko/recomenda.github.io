// Edge Function: buscar-titulo
// Proxy de busca ao vivo na TMDB. NÃO grava nada no banco.
// Usada pela aba "Explorar" e pela busca de "adicionar título".
//
// Deploy:  supabase functions deploy buscar-titulo
// Chamada (frontend): POST /functions/v1/buscar-titulo  { "query": "Breaking Bad" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const TMDB_TOKEN = Deno.env.get("TMDB_TOKEN")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Parâmetro 'query' é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = `https://api.themoviedb.org/3/search/multi?language=pt-BR&query=${encodeURIComponent(query)}`;
    const tmdbRes = await fetch(url, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
    });

    if (!tmdbRes.ok) {
      const detail = await tmdbRes.text();
      return new Response(
        JSON.stringify({ error: "Erro ao consultar a TMDB", detail }),
        { status: tmdbRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await tmdbRes.json();
    const results = (data.results ?? [])
      .filter((r: any) => r.media_type === "tv" || r.media_type === "movie")
      .map((r: any) => ({
        tmdb_id: r.id,
        media_type: r.media_type,
        nome: r.name ?? r.title,
        ano: (r.first_air_date ?? r.release_date ?? "").slice(0, 4),
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
