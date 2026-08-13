"""
Sync diário: consulta a Changes API da TMDB (últimas 24h) e re-busca só os
títulos que já estão no nosso banco e que mudaram - não varre o catálogo inteiro.

Rodado 1x/dia pelo GitHub Actions (.github/workflows/sync-diario.yml).
Variáveis de ambiente esperadas: TMDB_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""

import os
from datetime import datetime, timedelta, timezone

import requests
from supabase import create_client

TMDB_TOKEN = os.environ["TMDB_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

HEADERS = {"Authorization": f"Bearer {TMDB_TOKEN}", "accept": "application/json"}
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


def tmdb_get(path, params=None):
    r = requests.get(f"https://api.themoviedb.org/3{path}", headers=HEADERS, params=params or {})
    r.raise_for_status()
    return r.json()


def ids_alterados(tipo):
    """tipo: 'tv' ou 'movie'. Retorna o conjunto de ids alterados nas últimas 24h."""
    ontem = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    hoje = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ids, page, total_pages = set(), 1, 1
    while page <= total_pages:
        data = tmdb_get(f"/{tipo}/changes", {"start_date": ontem, "end_date": hoje, "page": page})
        ids.update(item["id"] for item in data.get("results", []))
        total_pages = data.get("total_pages", 1)
        page += 1
    return ids


def mapa_tmdb_para_titulo(tabela_filha):
    """Retorna {tmdb_id: titulo_id} para os títulos (fonte=tmdb) que têm linha na tabela filha
    (series/movies). A PK de `titulo` é sintética desde a migração para múltiplas fontes
    (ex: IGDB) — o vínculo com o id da TMDB é sempre via (fonte, external_id), nunca via id."""
    mapa = {}
    start, page_size = 0, 1000
    while True:
        resp = (
            supabase.table("titulo")
            .select(f"id, external_id, {tabela_filha}!inner(titulo_id)")
            .eq("fonte", "tmdb")
            .range(start, start + page_size - 1)
            .execute()
        )
        data = resp.data
        if not data:
            break
        mapa.update((row["external_id"], row["id"]) for row in data)
        if len(data) < page_size:
            break
        start += page_size
    return mapa


def atualizar_provedores(titulo_id, media_type, tmdb_id, tabela_filha):
    """Re-busca onde assistir (TMDB/JustWatch, região BR) e atualiza titulo_provedor +
    o link único de atribuição em series/movies.watch_providers_link."""
    dados = tmdb_get(f"/{media_type}/{tmdb_id}/watch/providers")
    regiao = dados.get("results", {}).get("BR", {})

    linhas = [
        {
            "titulo_id": titulo_id,
            "tipo": tipo,
            "provider_name": p["provider_name"],
            "logo_path": p.get("logo_path"),
            "display_priority": p.get("display_priority"),
        }
        for tipo in ("flatrate", "rent", "buy")
        for p in regiao.get(tipo, [])
    ]
    if linhas:
        supabase.table("titulo_provedor").upsert(linhas, on_conflict="titulo_id,tipo,provider_name").execute()

    supabase.table(tabela_filha).update({"watch_providers_link": regiao.get("link")}).eq("titulo_id", titulo_id).execute()


def atualizar_serie(tmdb_id, titulo_id):
    detalhes = tmdb_get(f"/tv/{tmdb_id}", {"language": "pt-BR"})

    supabase.table("titulo").upsert({
        "fonte": "tmdb",
        "external_id": tmdb_id,
        "nome": detalhes.get("name"),
        "sinopse": detalhes.get("overview"),
        "genero": ", ".join(g["name"] for g in detalhes.get("genres", [])),
        "imagem": detalhes.get("poster_path"),
    }, on_conflict="fonte,external_id").execute()

    supabase.table("series").upsert({
        "titulo_id": titulo_id,
        "launch_date": detalhes.get("first_air_date"),
        "end_date": detalhes.get("last_air_date"),
        "temporadas": detalhes.get("number_of_seasons"),
    }).execute()

    atualizar_provedores(titulo_id, "tv", tmdb_id, "series")

    # Re-busca episódios de cada temporada (pega episódios novos automaticamente)
    for temporada in detalhes.get("seasons", []):
        if temporada["season_number"] == 0:
            continue
        season_data = tmdb_get(f"/tv/{tmdb_id}/season/{temporada['season_number']}", {"language": "pt-BR"})
        episodios = [{
            "id": ep["id"],
            "titulo_id": titulo_id,
            "episode_name": ep.get("name"),
            "sinopse": ep.get("overview"),
            "duration": ep.get("runtime"),
            "launch_date": ep.get("air_date"),
            "season_number": ep.get("season_number"),
            "episode_number": ep.get("episode_number"),
        } for ep in season_data.get("episodes", [])]
        if episodios:
            supabase.table("episode").upsert(episodios).execute()

    print(f"  - série atualizada: {detalhes.get('name')} ({tmdb_id})")


def atualizar_filme(tmdb_id, titulo_id):
    detalhes = tmdb_get(f"/movie/{tmdb_id}", {"language": "pt-BR"})

    supabase.table("titulo").upsert({
        "fonte": "tmdb",
        "external_id": tmdb_id,
        "nome": detalhes.get("title"),
        "sinopse": detalhes.get("overview"),
        "genero": ", ".join(g["name"] for g in detalhes.get("genres", [])),
        "imagem": detalhes.get("poster_path"),
    }, on_conflict="fonte,external_id").execute()

    supabase.table("movies").upsert({
        "titulo_id": titulo_id,
        "duration": detalhes.get("runtime"),
        "launch_date": detalhes.get("release_date"),
    }).execute()

    atualizar_provedores(titulo_id, "movie", tmdb_id, "movies")

    print(f"  - filme atualizado: {detalhes.get('title')} ({tmdb_id})")


def main():
    print("Consultando ids alterados nas últimas 24h na TMDB...")
    alteradas_tv = ids_alterados("tv")
    alteradas_movie = ids_alterados("movie")

    mapa_series = mapa_tmdb_para_titulo("series")
    mapa_filmes = mapa_tmdb_para_titulo("movies")

    para_atualizar_tv = alteradas_tv & mapa_series.keys()
    para_atualizar_movie = alteradas_movie & mapa_filmes.keys()

    print(f"{len(para_atualizar_tv)} série(s) do banco precisam de atualização.")
    for tmdb_id in para_atualizar_tv:
        atualizar_serie(tmdb_id, mapa_series[tmdb_id])

    print(f"{len(para_atualizar_movie)} filme(s) do banco precisam de atualização.")
    for tmdb_id in para_atualizar_movie:
        atualizar_filme(tmdb_id, mapa_filmes[tmdb_id])

    print("Sync diário concluído.")


if __name__ == "__main__":
    main()
