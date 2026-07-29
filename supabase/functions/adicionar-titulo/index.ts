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

    const { tmdb_id, media_type, status } = await req.json();
    if (!tmdb_id || !["tv", "movie"].includes(media_type)) {
      return new Response(
        JSON.stringify({ error: "tmdb_id e media_type ('tv'|'movie') são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: existente } = await db
      .from("titulo")
      .select("id")
      .eq("id", tmdb_id)
      .maybeSingle();

    // Correção: Se for uma chamada de background síncrona (status === "none"), forçamos a atualização dos episódios [2]
    const forceUpdate = status === "none";

    if (!existente || forceUpdate) {
      // Carrega os detalhes do título e os créditos/elenco em paralelo
      const [detalhes, credits] = await Promise.all([
        tmdbGet(`/${media_type}/${tmdb_id}?language=pt-BR`),
        tmdbGet(`/${media_type}/${tmdb_id}/credits?language=pt-BR`)
      ]);

      await db.from("titulo").upsert({
        id: detalhes.id,
        nome: detalhes.name ?? detalhes.title,
        sinopse: detalhes.overview,
        genero: (detalhes.genres ?? []).map((g: any) => g.name).join(", "),
        imagem: detalhes.poster_path,
      });

      if (media_type === "tv") {
        await db.from("series").upsert({
          titulo_id: detalhes.id,
          launch_date: detalhes.first_air_date || null,
          end_date: detalhes.last_air_date || null,
          temporadas: detalhes.number_of_seasons,
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
                titulo_id: detalhes.id,
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
            titulo_id: detalhes.id,
            personagem: membro.character,
          });
        }
      } else {
        await db.from("movies").upsert({
          titulo_id: detalhes.id,
          duration: detalhes.runtime,
          launch_date: detalhes.release_date || null,
        });

        for (const membro of (credits.cast ?? []).slice(0, 15)) {
          await db.from("ator").upsert({ id: membro.id, name: membro.name, image: membro.profile_path });
          await db.from("elenco_movie").upsert({
            actor_id: membro.id,
            titulo_id: detalhes.id,
            personagem: membro.character,
          });
        }
      }
    }

    if (status && status !== "none") {
      const { error: userItemErr } = await db.from("user_item").upsert({
        user_id: userId,
        titulo_id: tmdb_id,
        status,
        favorito: false,
      });
      if (userItemErr) throw userItemErr;
    }

    return new Response(JSON.stringify({ ok: true, ja_existia: !!existente }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
