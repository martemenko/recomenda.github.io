// Edge Function: tvdb-search
// Resolve um id do TheTVDB direto pro id correspondente na TMDB, sem buscar por nome.
// Usado na importação de CSVs que vêm do TVDB (ex: exports do TV Time) -
// evita o desalinhamento de temporada/episódio entre as duas bases.
// Edge Function: tvdb-search
// Resolve um id externo (imdb_id e/ou tvdb_id) pro id correspondente na TMDB,
// sem precisar buscar por nome. Usado na importação de CSVs que vêm do
// TVDB/TV Time - evita o desalinhamento de temporada/episódio entre as bases.
//
// imdb_id é tentado primeiro quando disponível: a tabela de cross-reference
// da TMDB pra "tvdb_id" é bem populada pra séries, mas praticamente vazia pra
// filmes (o TheTVDB não cataloga filmes de forma consistente), então filmes
// que só mandam tvdb_id costumam voltar vazio no /find. imdb_id é confiável
// pros dois casos.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TMDB_TOKEN = Deno.env.get("TMDB_TOKEN")!;

async function buscarPorExternalId(externalId: string, externalSource: string) {
  const url = `https://api.themoviedb.org/3/find/${externalId}?external_source=${externalSource}&language=pt-BR`;
  const tmdbRes = await fetch(url, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
  });
  if (!tmdbRes.ok) return { erro: await tmdbRes.text(), status: tmdbRes.status };
  return { data: await tmdbRes.json() };
}

function temResultado(d: any) {
  return (d?.tv_results?.length ?? 0) > 0 || (d?.movie_results?.length ?? 0) > 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { tvdb_id, imdb_id, media_type } = await req.json();
    if (!tvdb_id && !imdb_id) {
      return new Response(JSON.stringify({ error: "tvdb_id ou imdb_id é obrigatório." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let data: any = null;

    if (imdb_id) {
      const res = await buscarPorExternalId(imdb_id, "imdb_id");
      if (res.erro) {
        return new Response(JSON.stringify({ error: "Erro ao consultar a TMDB", detail: res.erro }), {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      data = res.data;
    }

    if (!temResultado(data) && tvdb_id) {
      const res = await buscarPorExternalId(tvdb_id, "tvdb_id");
      if (res.erro) {
        return new Response(JSON.stringify({ error: "Erro ao consultar a TMDB", detail: res.erro }), {
          status: res.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      data = res.data;
    }

    const tv = (data?.tv_results ?? [])[0];
    const movie = (data?.movie_results ?? [])[0];

    // Quando o chamador já sabe o media_type (filme x série), prioriza o
    // resultado correspondente em vez de sempre preferir série.
    const encontrado = media_type === "movie" ? (movie ?? tv) : (tv ?? movie);

    if (!encontrado) {
      return new Response(JSON.stringify({ resultado: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        resultado: {
          tmdb_id: encontrado.id,
          media_type: encontrado === movie ? "movie" : "tv",
          nome: encontrado.name ?? encontrado.title,
          imagem: encontrado.poster_path,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
