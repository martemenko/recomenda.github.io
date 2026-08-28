// Edge Function: popular-games
// Proxy ao vivo pros jogos mais populares (já lançados) da IGDB, ordenados por
// total_rating_count -- usado na seção "Popular"/Top 10 Jogos da aba Explorar.
// Diferente de soon-games (que ordena por "hypes" porque o jogo ainda nem
// saiu): aqui o jogo já foi lançado, então total_rating_count (quantas
// pessoas avaliaram) é o proxy de popularidade real. NÃO grava nada no banco.
//
// Chamada: POST /functions/v1/popular-games   { "page": 1 }

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
    const { page = 1 } = await req.json().catch(() => ({}));

    const agoraUnix = Math.floor(Date.now() / 1000);
    const where = `first_release_date < ${agoraUnix} & total_rating_count > 0`;
    const offset = (Number(page) - 1) * PAGE_SIZE;

    const jogos = await igdbQuery(
      "games",
      `fields id,name,summary,first_release_date,cover.image_id,total_rating; where ${where}; sort total_rating_count desc; limit ${PAGE_SIZE}; offset ${offset};`,
    );

    const results = (jogos ?? []).map((j: any) => ({
      igdb_id: j.id,
      fonte: "igdb",
      media_type: "game",
      nome: j.name,
      ano: j.first_release_date ? new Date(j.first_release_date * 1000).getFullYear().toString() : "",
      imagem: igdbCoverUrl(j.cover?.image_id),
      sinopse: j.summary,
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
