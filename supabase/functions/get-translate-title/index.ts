// Edge Function: obter-titulo-traduzido (get-translate-title)
// Retorna nome/sinopse/gênero de um título no idioma pedido.

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
    const { titulo_id, idioma, media_type: mediaTypeParam } = await req.json();
    if (!titulo_id || !idioma) {
      return new Response(
        JSON.stringify({ error: "titulo_id e idioma são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Idioma padrão -> tenta ler de "titulo" de forma segura
    if (idioma === "pt-BR") {
      const { data, error } = await db
        .from("titulo")
        .select("nome, sinopse, genero")
        .eq("id", titulo_id)
        .maybeSingle(); // alterado para maybeSingle para não gerar erro 500 se não existir

      if (error) console.error("Erro ao buscar titulo local:", error);

      if (data) {
        return new Response(JSON.stringify({ ...data, idioma, fonte: "padrao" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Já está no cache de tradução?
    const { data: cache } = await db
      .from("titulo_traducao")
      .select("nome, sinopse, genero")
      .eq("titulo_id", titulo_id)
      .eq("idioma", idioma)
      .maybeSingle();

    if (cache) {
      return new Response(JSON.stringify({ ...cache, idioma, fonte: "cache" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve o tipo de mídia de forma dinâmica e segura
    let media_type = mediaTypeParam;
    if (!media_type || !["tv", "movie"].includes(media_type)) {
      const { data: seriesRow } = await db
        .from("series").select("titulo_id").eq("titulo_id", titulo_id).maybeSingle();
      media_type = seriesRow ? "tv" : "movie";
    }

    const buscaTmdb = async (lang: string) => {
      const res = await fetch(
        `https://api.themoviedb.org/3/${media_type}/${titulo_id}?language=${lang}`,
        { headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`TMDB respondeu ${res.status}`);
      return res.json();
    };

    let detalhes = await buscaTmdb(idioma);
    let idiomaFinal = idioma;

    // TMDB não tem tradução pra esse idioma nesse título -> cai pra inglês
    if (!detalhes.overview) {
      detalhes = await buscaTmdb("en-US");
      idiomaFinal = "en-US";
    }

    const traducao = {
      titulo_id,
      idioma, // guarda no cache com a chave do idioma PEDIDO, mesmo se o conteúdo é o fallback
      nome: detalhes.name ?? detalhes.title,
      sinopse: detalhes.overview,
      genero: (detalhes.genres ?? []).map((g: any) => g.name).join(", "),
    };

    // Tenta gravar no cache. Se o título não estiver gravado localmente na tabela 'titulo' ainda, pulamos para evitar conflito de FK
    try {
      await db.from("titulo_traducao").upsert(traducao);
    } catch (e) {
      console.warn("Mapeamento de cache pulado temporariamente:", e);
    }

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
