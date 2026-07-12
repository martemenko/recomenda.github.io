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


def ids_no_banco(tabela):
    resp = supabase.table(tabela).select("titulo_id").execute()
    return {row["titulo_id"] for row in resp.data}


def atualizar_serie(tmdb_id):
    detalhes = tmdb_get(f"/tv/{tmdb_id}", {"language": "pt-BR"})

    supabase.table("titulo").upsert({
        "id": detalhes["id"],
        "nome": detalhes.get("name"),
        "sinopse": detalhes.get("overview"),
        "genero": ", ".join(g["name"] for g in detalhes.get("genres", [])),
        "imagem": detalhes.get("poster_path"),
    }).execute()

    supabase.table("series").upsert({
        "titulo_id": detalhes["id"],
        "launch_date": detalhes.get("first_air_date"),
        "end_date": detalhes.get("last_air_date"),
        "temporadas": detalhes.get("number_of_seasons"),
    }).execute()

    # Re-busca episódios de cada temporada (pega episódios novos automaticamente)
    for temporada in detalhes.get("seasons", []):
        if temporada["season_number"] == 0:
            continue
        season_data = tmdb_get(f"/tv/{tmdb_id}/season/{temporada['season_number']}", {"language": "pt-BR"})
        episodios = [{
            "id": ep["id"],
            "titulo_id": detalhes["id"],
            "episode_name": ep.get("name"),
            "duration": ep.get("runtime"),
            "launch_date": ep.get("air_date"),
        } for ep in season_data.get("episodes", [])]
        if episodios:
            supabase.table("episode").upsert(episodios).execute()

    print(f"  - série atualizada: {detalhes.get('name')} ({tmdb_id})")


def atualizar_filme(tmdb_id):
    detalhes = tmdb_get(f"/movie/{tmdb_id}", {"language": "pt-BR"})

    supabase.table("titulo").upsert({
        "id": detalhes["id"],
        "nome": detalhes.get("title"),
        "sinopse": detalhes.get("overview"),
        "genero": ", ".join(g["name"] for g in detalhes.get("genres", [])),
        "imagem": detalhes.get("poster_path"),
    }).execute()

    supabase.table("movies").upsert({
        "titulo_id": detalhes["id"],
        "duration": detalhes.get("runtime"),
        "launch_date": detalhes.get("release_date"),
    }).execute()

    print(f"  - filme atualizado: {detalhes.get('title')} ({tmdb_id})")


def main():
    print("Consultando ids alterados nas últimas 24h na TMDB...")
    alteradas_tv = ids_alterados("tv")
    alteradas_movie = ids_alterados("movie")

    minhas_series = ids_no_banco("series")
    meus_filmes = ids_no_banco("movies")

    para_atualizar_tv = alteradas_tv & minhas_series
    para_atualizar_movie = alteradas_movie & meus_filmes

    print(f"{len(para_atualizar_tv)} série(s) do banco precisam de atualização.")
    for tmdb_id in para_atualizar_tv:
        atualizar_serie(tmdb_id)

    print(f"{len(para_atualizar_movie)} filme(s) do banco precisam de atualização.")
    for tmdb_id in para_atualizar_movie:
        atualizar_filme(tmdb_id)

    print("Sync diário concluído.")


if __name__ == "__main__":
    main()
