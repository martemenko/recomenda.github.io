// Edge Function: adicionar-titulo
// Chamada quando o usuário clica em "Adicionar" num resultado de busca.
// 1. Identifica o usuário autenticado (via JWT do header Authorization).
// 2. Se o título ainda não existe no banco, busca detalhes + elenco na TMDB e ingere.
// 3. Cria/atualiza o user_item ligando aquele usuário àquele título.
//
// Deploy:  supabase functions deploy adicionar-titulo
// Chamada (frontend, autenticado): POST /functions/v1/adicionar-titulo
//   { "tmdb_id": 1396, "media_type": "tv", "status": "quero_ver" }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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
    // 1. Identifica o usuário a partir do JWT enviado pelo frontend
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

    const { tmdb_id, media_type, status = "quero_ver" } = await req.json();
    if (!tmdb_id || !["tv", "movie"].includes(media_type)) {
      return new Response(
        JSON.stringify({ error: "tmdb_id e media_type ('tv'|'movie') são obrigatórios." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cliente com service_role: ignora RLS, só usado aqui dentro do backend
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: existente } = await db
      .from("titulo")
      .select("id")
      .eq("id", tmdb_id)
      .maybeSingle();

    if (!existente) {
      const detalhes = await tmdbGet(`/${media_type}/${tmdb_id}?language=pt-BR`);
      const credits = await tmdbGet(`/${media_type}/${tmdb_id}/credits?language=pt-BR`);

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

        // Cria o esqueleto dos episódios de cada temporada.
        // Elenco pontual por episódio (guest stars) fica pra uma função separada,
        // buscado sob demanda quando o usuário abrir aquele episódio específico.
        for (const temporada of detalhes.seasons ?? []) {
          if (temporada.season_number === 0) continue; // pula "specials"
          const seasonData = await tmdbGet(
            `/tv/${tmdb_id}/season/${temporada.season_number}?language=pt-BR`,
          );
          const episodios = (seasonData.episodes ?? []).map((ep: any) => ({
            id: ep.id,
            titulo_id: detalhes.id,
            episode_name: ep.name,
            duration: ep.runtime,
            launch_date: ep.air_date || null,
          }));
          if (episodios.length) await db.from("episode").upsert(episodios);
        }

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

    // Vincula (ou atualiza o status de) esse título na lista do usuário
    await db.from("user_item").upsert({
      user_id: userId,
      titulo_id: tmdb_id,
      status,
      favorito: false,
    });

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
