// Edge Function: adicionar-jogo
// Equivalente a adicionar-titulo, mas para a fonte IGDB. Mantida separada porque o
// formato de resposta da IGDB (Apicalypse) não tem nada a ver com o da TMDB.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { igdbQuery, igdbCoverUrl } from "../_shared/igdb.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Usuário não autenticado." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { igdb_id, status } = await req.json();
    if (!igdb_id) {
      return new Response(JSON.stringify({ error: "igdb_id é obrigatório." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: existente } = await db
      .from("titulo")
      .select("id")
      .eq("fonte", "igdb")
      .eq("external_id", igdb_id)
      .maybeSingle();

    const forceUpdate = status === "none";
    let tituloId: number | undefined = existente?.id;

    if (!existente || forceUpdate) {
      const [jogo] = await igdbQuery(
        "games",
        `fields name,summary,first_release_date,cover.image_id,genres.name,platforms.name,involved_companies.company.name,involved_companies.developer,websites.category,websites.url,external_games.category,external_games.url; where id = ${Number(igdb_id)};`,
      );

      if (!jogo) {
        return new Response(JSON.stringify({ error: "Jogo não encontrado na IGDB." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const imagem = igdbCoverUrl(jogo.cover?.image_id);

      const launchDate = jogo.first_release_date
        ? new Date(jogo.first_release_date * 1000).toISOString().slice(0, 10)
        : null;

      const developer = (jogo.involved_companies ?? []).find((c: any) => c.developer)?.company?.name ?? null;
      const platforms = (jogo.platforms ?? []).map((p: any) => p.name);

      const { data: tituloRow, error: tituloErr } = await db
        .from("titulo")
        .upsert(
          {
            fonte: "igdb",
            external_id: igdb_id,
            nome: jogo.name,
            sinopse: jogo.summary,
            genero: (jogo.genres ?? []).map((g: any) => g.name).join(", "),
            imagem,
          },
          { onConflict: "fonte,external_id" },
        )
        .select("id")
        .single();
      if (tituloErr) throw tituloErr;
      tituloId = tituloRow.id;

      await db.from("games").upsert({
        titulo_id: tituloId,
        launch_date: launchDate,
        platforms,
        developer,
      });

      // Onde jogar/comprar: IGDB não tem "watch/providers" como a TMDB, então junta duas
      // fontes — "websites" (raramente tem loja, mas às vezes é a única com o link) e
      // "external_games" (cobre bem mais lojas, incluindo consoles). IGDB não dá logo
      // pra loja (diferente da TMDB), por isso só nome + link direto.
      const lojasPorWebsite: Record<number, string> = {
        13: "Steam",
        15: "itch.io",
        16: "Epic Games Store",
        17: "GOG",
      };
      const lojasPorExternalGame: Record<number, string> = {
        1: "Steam",
        5: "GOG",
        11: "Microsoft Store",
        24: "Epic Games Store",
        27: "itch.io",
        28: "Xbox",
        30: "PlayStation Store",
      };

      const candidatosLoja = [
        ...(jogo.websites ?? []).map((w: any) => ({ nome: lojasPorWebsite[w.category], url: w.url })),
        ...(jogo.external_games ?? []).map((e: any) => ({ nome: lojasPorExternalGame[e.category], url: e.url })),
      ].filter((c) => c.nome && c.url);

      // Dedup por nome de loja (o mesmo storefront pode aparecer nas duas fontes acima) —
      // upsert não aceita duas linhas com o mesmo conflict target na mesma chamada.
      const urlPorLoja = new Map<string, string>();
      for (const c of candidatosLoja) urlPorLoja.set(c.nome, c.url);

      const linhasLojas = Array.from(urlPorLoja, ([provider_name, url]) => ({
        titulo_id: tituloId,
        tipo: "loja",
        provider_name,
        url,
      }));
      if (linhasLojas.length) {
        await db.from("titulo_provedor").upsert(linhasLojas, { onConflict: "titulo_id,tipo,provider_name" });
      }
    }

    if (status && status !== "none") {
      const { error: userItemErr } = await db.from("user_item").upsert({
        user_id: userId,
        titulo_id: tituloId,
        status,
        favorito: false,
      });
      if (userItemErr) throw userItemErr;
    }

    return new Response(JSON.stringify({ ok: true, ja_existia: !!existente, titulo_id: tituloId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
