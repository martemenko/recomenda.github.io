"""
Backfill único de `titulo.nota_externa` (TMDB vote_average / IGDB total_rating,
ver migração 20260828050000_nota_externa.sql) para títulos que já existiam no
catálogo ANTES dessa coluna existir -- adicionar-titulo/adicionar-jogo só
preenchem esse campo na primeira ingestão (ou num forceUpdate), então quem já
estava no banco fica com nota_externa NULL até rodar isso uma vez.

Diferente de sync_diario.py (que roda todo dia via GitHub Actions e reingere
o que a TMDB reportou como alterado nas últimas 24h): este é um script
avulso, rodado manualmente uma vez, que varre SÓ os títulos com
nota_externa IS NULL -- não reingere elenco/episódios/provedores, só busca
e grava a nota externa, então é bem mais leve.

Rodar manualmente:
  python scripts/backfill_nota_externa.py
Variáveis de ambiente esperadas: TMDB_TOKEN, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET,
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (mesmas do sync_diario.py + as duas da IGDB).
"""

import os
import time

import requests
from supabase import create_client

TMDB_TOKEN = os.environ["TMDB_TOKEN"]
IGDB_CLIENT_ID = os.environ["IGDB_CLIENT_ID"]
IGDB_CLIENT_SECRET = os.environ["IGDB_CLIENT_SECRET"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

TMDB_HEADERS = {"Authorization": f"Bearer {TMDB_TOKEN}", "accept": "application/json"}
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

PAGE_SIZE = 1000


def tmdb_get(path):
    r = requests.get(f"https://api.themoviedb.org/3{path}", headers=TMDB_HEADERS, params={"language": "pt-BR"})
    r.raise_for_status()
    return r.json()


def igdb_token():
    r = requests.post(
        "https://id.twitch.tv/oauth2/token",
        params={
            "client_id": IGDB_CLIENT_ID,
            "client_secret": IGDB_CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
    )
    r.raise_for_status()
    return r.json()["access_token"]


def igdb_query(token, endpoint, apicalypse_query):
    r = requests.post(
        f"https://api.igdb.com/v4/{endpoint}",
        headers={
            "Client-ID": IGDB_CLIENT_ID,
            "Authorization": f"Bearer {token}",
            "Content-Type": "text/plain",
        },
        data=apicalypse_query,
    )
    r.raise_for_status()
    return r.json()


def pendentes_tmdb(tabela_filha):
    """{external_id: titulo_id} pra títulos fonte=tmdb, na tabela filha dada
    (series/movies), com nota_externa ainda NULL."""
    mapa = {}
    start = 0
    while True:
        resp = (
            supabase.table("titulo")
            .select(f"id, external_id, {tabela_filha}!inner(titulo_id)")
            .eq("fonte", "tmdb")
            .is_("nota_externa", "null")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        data = resp.data
        if not data:
            break
        mapa.update((row["external_id"], row["id"]) for row in data)
        if len(data) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return mapa


def pendentes_igdb():
    """{external_id: titulo_id} pra jogos (fonte=igdb) com nota_externa ainda NULL."""
    mapa = {}
    start = 0
    while True:
        resp = (
            supabase.table("titulo")
            .select("id, external_id, games!inner(titulo_id)")
            .eq("fonte", "igdb")
            .is_("nota_externa", "null")
            .range(start, start + PAGE_SIZE - 1)
            .execute()
        )
        data = resp.data
        if not data:
            break
        mapa.update((row["external_id"], row["id"]) for row in data)
        if len(data) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return mapa


def backfill_tmdb(media_type, tabela_filha):
    mapa = pendentes_tmdb(tabela_filha)
    print(f"{len(mapa)} título(s) TMDB ({media_type}) sem nota_externa.")
    for tmdb_id, titulo_id in mapa.items():
        try:
            detalhes = tmdb_get(f"/{media_type}/{tmdb_id}")
            nota = detalhes.get("vote_average")
            if nota is not None:
                supabase.table("titulo").update({"nota_externa": nota}).eq("id", titulo_id).execute()
                print(f"  - {detalhes.get('name') or detalhes.get('title')} ({tmdb_id}): {nota}")
        except Exception as err:
            print(f"  - falhou tmdb_id={tmdb_id}: {err}")


def backfill_igdb():
    mapa = pendentes_igdb()
    print(f"{len(mapa)} jogo(s) IGDB sem nota_externa.")
    if not mapa:
        return

    token = igdb_token()
    # IGDB aceita "where id = (a,b,c)" em lote -- bem mais rápido que 1 chamada por jogo,
    # respeitando o limite de taxa da API (4 req/s no free tier).
    ids = list(mapa.keys())
    for i in range(0, len(ids), 200):
        lote = ids[i : i + 200]
        ids_str = ",".join(str(x) for x in lote)
        try:
            jogos = igdb_query(token, "games", f"fields id,name,total_rating; where id = ({ids_str}); limit 200;")
            for jogo in jogos:
                nota = jogo.get("total_rating")
                if nota is None:
                    continue
                titulo_id = mapa[jogo["id"]]
                supabase.table("titulo").update({"nota_externa": nota}).eq("id", titulo_id).execute()
                print(f"  - {jogo.get('name')} ({jogo['id']}): {round(nota)}")
        except Exception as err:
            print(f"  - falhou lote {i}-{i + len(lote)}: {err}")
        time.sleep(0.3)  # margem de segurança pro limite de 4 req/s da IGDB


def main():
    backfill_tmdb("tv", "series")
    backfill_tmdb("movie", "movies")
    backfill_igdb()
    print("Backfill de nota_externa concluído.")


if __name__ == "__main__":
    main()
