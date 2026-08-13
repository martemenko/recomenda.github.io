// Edge Function: adicionar-titulo
// Chamada quando o usuário clica em "Adicionar/Seguir" ou para ingerir metadados base de forma paralela.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TMDB_TOKEN = Deno.env.get("TMDB_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function tmdbGet(path: string) {
  const res = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`TMDB ${path} -> HTTP ${res.status}`);
  return res.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // Chamada de sistema (ex: backfill em lote) autenticada com a service role key —
    // já é o nível de confiança máximo do projeto, então dispensa usuário logado.
    // Só serve pra ingestão (status "none"/ausente); a escrita em user_item abaixo
    // continua exigindo um userId real, que uma chamada de sistema nunca tem.
    // .trim() nos dois lados: a service role key é um JWT longo, fácil de acabar com
    // espaço/quebra de linha sobrando ao colar num secret do GitHub/Supabase — isso
    // quebraria a comparação exata sem ser um problema real de autenticação.
    const isChamadaDeSistema = authHeader.trim() === `Bearer ${SERVICE_ROLE_KEY.trim()}`;

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

    const { tmdb_id, media_type, status } = await req.json();
    if (!tmdb_id || !["tv", "movie"].includes(media_type)) {
      return new Response(
        JSON.stringify({ error: "tmdb_id e media_type ('tv'|'movie') são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // titulo_id interno é resolvido via (fonte, external_id) — nunca mais assumido como == tmdb_id,
    // já que a PK de `titulo` agora é sintética (gerada pela sequence) para conviver com outras fontes (ex: IGDB).
    const { data: existente } = await db
      .from("titulo")
      .select("id")
      .eq("fonte", "tmdb")
      .eq("external_id", tmdb_id)
      .maybeSingle();

    // Correção: Se for uma chamada de background síncrona (status === "none"), forçamos a atualização dos episódios [2]
    const forceUpdate = status === "none";

    let tituloId: number | undefined = existente?.id;

    if (!existente || forceUpdate) {
      // Carrega os detalhes do título, os créditos/elenco e onde assistir (streaming) em paralelo
      const [detalhes, credits, providers] = await Promise.all([
        tmdbGet(`/${media_type}/${tmdb_id}?language=pt-BR`),
        tmdbGet(`/${media_type}/${tmdb_id}/credits?language=pt-BR`),
        tmdbGet(`/${media_type}/${tmdb_id}/watch/providers`).catch(() => null),
      ]);

      // Onde assistir (TMDB/JustWatch) — região fixada em BR, já que o app é 100% PT-BR.
      // ToS da JustWatch não permite link individual por provedor, só um link combinado
      // de atribuição por título+região (results.BR.link).
      const regiaoProvedores = providers?.results?.BR;
      const watchProvidersLink = regiaoProvedores?.link ?? null;

      const { data: tituloRow, error: tituloErr } = await db
        .from("titulo")
        .upsert(
          {
            fonte: "tmdb",
            external_id: tmdb_id,
            nome: detalhes.name ?? detalhes.title,
            sinopse: detalhes.overview,
            genero: (detalhes.genres ?? []).map((g: any) => g.name).join(", "),
            imagem: detalhes.poster_path,
          },
          { onConflict: "fonte,external_id" },
        )
        .select("id")
        .single();
      if (tituloErr) throw tituloErr;
      tituloId = tituloRow.id;

      // Upsert dos provedores de streaming (logos/nomes) — o link único de atribuição
      // fica na coluna watch_providers_link de series/movies, gravado abaixo.
      // Dedup por (tipo, provider_name): a TMDB às vezes lista o mesmo provedor duas
      // vezes na mesma categoria (ex: "HBO Max"/"Max" no meio de rebranding) — duas
      // linhas com o mesmo conflict target no mesmo upsert fazem o Postgres rejeitar
      // a operação inteira ("ON CONFLICT DO UPDATE command cannot affect row a second
      // time"), o que apagava silenciosamente TODOS os provedores daquele título.
      const provedoresPorChave = new Map<string, any>();
      for (const tipo of ["flatrate", "rent", "buy"]) {
        for (const p of regiaoProvedores?.[tipo] ?? []) {
          provedoresPorChave.set(`${tipo}::${p.provider_name}`, {
            titulo_id: tituloId,
            tipo,
            provider_name: p.provider_name,
            logo_path: p.logo_path,
            display_priority: p.display_priority ?? null,
          });
        }
      }
      const linhasProvedores = Array.from(provedoresPorChave.values());
      if (linhasProvedores.length) {
        const { error: provedorErr } = await db
          .from("titulo_provedor")
          .upsert(linhasProvedores, { onConflict: "titulo_id,tipo,provider_name" });
        if (provedorErr) console.error(`Erro ao gravar provedores de ${tmdb_id}:`, provedorErr);
      }

      if (media_type === "tv") {
        await db.from("series").upsert({
          titulo_id: tituloId,
          launch_date: detalhes.first_air_date || null,
          end_date: detalhes.last_air_date || null,
          temporadas: detalhes.number_of_seasons,
          watch_providers_link: watchProvidersLink,
        });

        // Otimização de concorrência: Dispara todas as requisições de temporadas em paralelo para máxima velocidade
        const seasonPromises = (detalhes.seasons ?? [])
          .filter((t: any) => t.season_number !== 0) // pula specials
          .map(async (temporada: any) => {
            try {
              const seasonData = await tmdbGet(
                `/tv/${tmdb_id}/season/${temporada.season_number}?language=pt-BR`
              );
              const episodios = (seasonData.episodes ?? []).map((ep: any) => ({
                id: ep.id,
                titulo_id: tituloId,
                episode_name: ep.name,
                sinopse: ep.overview,
                duration: ep.runtime,
                launch_date: ep.air_date || null,
                season_number: ep.season_number,
                episode_number: ep.episode_number,
              }));
              if (episodios.length) {
                await db.from("episode").upsert(episodios);
              }
            } catch (err) {
              console.error(`Erro ao ingerir temporada ${temporada.season_number}:`, err);
            }
          });

        await Promise.all(seasonPromises);

        for (const membro of (credits.cast ?? []).slice(0, 15)) {
          await db.from("ator").upsert({ id: membro.id, name: membro.name, image: membro.profile_path });
          await db.from("elenco_serie").upsert({
            actor_id: membro.id,
            titulo_id: tituloId,
            personagem: membro.character,
          });
        }
      } else {
        await db.from("movies").upsert({
          titulo_id: tituloId,
          duration: detalhes.runtime,
          launch_date: detalhes.release_date || null,
          watch_providers_link: watchProvidersLink,
        });

        for (const membro of (credits.cast ?? []).slice(0, 15)) {
          await db.from("ator").upsert({ id: membro.id, name: membro.name, image: membro.profile_path });
          await db.from("elenco_movie").upsert({
            actor_id: membro.id,
            titulo_id: tituloId,
            personagem: membro.character,
          });
        }
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
