// Edge Function: soon-games
// Proxy ao vivo pra lançamentos futuros de jogos, com filtro opcional de gênero.
// NÃO grava nada no banco — mesma categoria de soon-movies/buscar-titulo.
//
// Chamada: POST /functions/v1/soon-games   { "genre_id": 5, "page": 1 }
//   genre_id é opcional (omitir = todos os gêneros). Ids de gênero vêm do endpoint
//   /genres da IGDB — NÃO são compatíveis com os ids de gênero da TMDB usados em soon-movies.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { igdbQuery, igdbCoverUrl } from "../_shared/igdb.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PAGE_SIZE = 20;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { genre_id, page = 1 } = await req.json().catch(() => ({}));

    const agoraUnix = Math.floor(Date.now() / 1000);
    // category = 0 -> "jogo principal", exclui DLC/expansão/remaster/port/etc,
    // que na IGDB ficam misturados na mesma tabela `games`.
    const filtros = [`first_release_date > ${agoraUnix}`, "category = 0"];
    if (genre_id) filtros.push(`genres = ${Number(genre_id)}`);
    const where = filtros.join(" & ");

    const offset = (Number(page) - 1) * PAGE_SIZE;

    // hypes = contagem de antecipação; é o proxy de relevância da IGDB pra algo
    // que ainda não saiu (rating/popularidade real só existem pós-lançamento).
    const [jogos, contagem] = await Promise.all([
      igdbQuery(
        "games",
        `fields id,name,summary,first_release_date,cover.image_id,genres.id; where ${where}; sort hypes desc; limit ${PAGE_SIZE}; offset ${offset};`,
      ),
      igdbQuery("games/count", `where ${where};`),
    ]);

    const results = (jogos ?? []).map((j: any) => ({
      igdb_id: j.id,
      nome: j.name,
      data_lancamento: j.first_release_date
        ? new Date(j.first_release_date * 1000).toISOString().slice(0, 10)
        : null,
      imagem: igdbCoverUrl(j.cover?.image_id),
      sinopse: j.summary,
      generos_ids: (j.genres ?? []).map((g: any) => g.id),
    }));

    const total = contagem?.count ?? 0;
    const total_pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return new Response(JSON.stringify({ results, total_pages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
