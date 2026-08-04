// Edge Function: buscar-jogo
// Proxy de busca ao vivo na IGDB. NÃO grava nada no banco — mesma categoria de buscar-titulo.
// Mantida separada de buscar-titulo porque essa é consumida também por ListaDetalhe.jsx
// e pelo importador CSV, que assumem resultado só da TMDB (campo tmdb_id); misturar fontes
// ali quebraria esses dois consumidores de forma sutil.
//
// Chamada: POST /functions/v1/buscar-jogo   { "query": "The Witcher" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { igdbQuery, igdbCoverUrl } from "../_shared/igdb.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Parâmetro 'query' é obrigatório." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const queryEscapada = query.replace(/"/g, '\\"');
    // Busca um pouco mais do que precisamos (20 em vez de 10) porque edições especiais
    // (Launch Edition, Ultimate Edition, Digital Deluxe...) consomem posições do resultado
    // bruto antes da deduplicação abaixo.
    const jogosBrutos = await igdbQuery(
      "games",
      `search "${queryEscapada}"; fields id,name,summary,first_release_date,cover.image_id,version_parent; limit 20;`,
    );

    // Edições especiais aparecem na IGDB como jogos separados, ligados ao jogo "canônico"
    // via version_parent — sem isso, "Miles Morales", "Miles Morales Launch Edition" e
    // "Miles Morales Ultimate Edition" viram 3 resultados do mesmo jogo. Agrupa por
    // (version_parent ?? id) e prefere manter a versão canônica (sem version_parent) em cada grupo.
    const porGrupo = new Map<number, any>();
    for (const j of jogosBrutos ?? []) {
      const chave = j.version_parent ?? j.id;
      const existente = porGrupo.get(chave);
      if (!existente || (existente.version_parent && !j.version_parent)) {
        porGrupo.set(chave, j);
      }
    }
    const jogos = [...porGrupo.values()].slice(0, 10);

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
