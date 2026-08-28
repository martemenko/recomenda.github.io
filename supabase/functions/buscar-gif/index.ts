// Edge Function: buscar-gif
// Proxy de busca de GIFs no GIPHY pro seletor de GIF dos comentários. NÃO
// grava nada no banco -- a chave fica só aqui no servidor (GIPHY_API_KEY),
// nunca exposta no client, mesmo padrão de TMDB_TOKEN/IGDB_CLIENT_ID.
//
// Deploy:  supabase functions deploy buscar-gif
// Chamada (frontend): POST /functions/v1/buscar-gif  { "query": "comemorando" }
// Sem "query" (ou vazia) devolve os GIFs em alta do GIPHY, pro seletor
// já abrir com algo pra mostrar antes da pessoa digitar.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GIPHY_API_KEY = Deno.env.get("GIPHY_API_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query } = await req.json().catch(() => ({ query: null }));

    const url = query && typeof query === "string" && query.trim()
      ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query.trim())}&limit=24&rating=pg-13&lang=pt`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`;

    const giphyRes = await fetch(url);

    if (!giphyRes.ok) {
      const detail = await giphyRes.text();
      return new Response(
        JSON.stringify({ error: "Erro ao consultar o GIPHY", detail }),
        { status: giphyRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await giphyRes.json();
    const results = (data.data ?? []).map((g: any) => ({
      id: g.id,
      preview_url: g.images?.fixed_width_small?.url ?? g.images?.fixed_width?.url,
      url: g.images?.fixed_width?.url ?? g.images?.original?.url,
      width: Number(g.images?.fixed_width?.width) || null,
      height: Number(g.images?.fixed_width?.height) || null,
    })).filter((g: any) => g.preview_url && g.url);

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
