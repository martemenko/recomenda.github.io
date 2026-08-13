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
    // Chamada de sistema (ex: backfill em lote) autenticada com a service role key —
    // já é o nível de confiança máximo do projeto, então dispensa usuário logado.
    // Só serve pra ingestão (status "none"/ausente); a escrita em user_item abaixo
    // continua exigindo um userId real, que uma chamada de sistema nunca tem.
    const isChamadaDeSistema = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;

    let userId: string | undefined;
    if (!isChamadaDeSistema) {
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
      userId = userData.user.id;
    }

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
        `fields name,summary,first_release_date,cover.image_id,genres.name,platforms.name,involved_companies.company.name,involved_companies.developer,websites.url,websites.type.type,external_games.url,external_games.uid,external_games.external_game_source.name; where id = ${Number(igdb_id)};`,
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
      //
      // IMPORTANTE: os enums numéricos antigos (websites.category / external_games.category)
      // estão *deprecated* no schema oficial da IGDB (confirmado em api.igdb.com/v4/igdbapi.proto) —
      // por isso o mapeamento por número nunca batia com nada. A loja agora vem como texto
      // direto em external_games.external_game_source.name / websites.type.type, então só
      // reconhecemos pelo nome (sem precisar mapear código -> nome).
      const PALAVRAS_LOJA = ["steam", "gog", "epic", "itch", "playstation", "xbox", "microsoft", "amazon", "nintendo"];
      const comoNomeDeLoja = (nome: string | undefined | null): string | null => {
        if (!nome) return null;
        const lower = nome.toLowerCase();
        return PALAVRAS_LOJA.some((p) => lower.includes(p)) ? nome : null;
      };

      // A IGDB nem sempre preenche external_games.url, mas o uid (id do app na própria
      // loja) é confiável — pra Steam, o padrão de URL é estável, então reconstrói a
      // partir do uid quando a API não manda o link direto.
      const candidatosLoja = [
        ...(jogo.websites ?? []).map((w: any) => ({ nome: comoNomeDeLoja(w.type?.type), url: w.url })),
        ...(jogo.external_games ?? []).map((e: any) => {
          const nome = comoNomeDeLoja(e.external_game_source?.name);
          const url = e.url || (nome?.toLowerCase().includes("steam") && e.uid ? `https://store.steampowered.com/app/${e.uid}` : null);
          return { nome, url };
        }),
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
