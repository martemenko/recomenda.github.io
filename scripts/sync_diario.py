"""
Sync diário: consulta a Changes API da TMDB (últimas 24h) e re-busca por completo só os
títulos que já estão no nosso banco e que mudaram - não varre o catálogo inteiro com a
ingestão pesada (detalhes/elenco/episódios).

Onde assistir/loja é diferente: disponibilidade de streaming pode mudar sem a TMDB marcar
o título como "alterado", então provedores são atualizados pra TODO o catálogo todo dia -
via só o endpoint de watch/providers (leve) pra série/filme, e via a Edge Function
adicionar-jogo (chamada de sistema, sem usuário) pra jogo, já que a IGDB não tem um
endpoint de provedores separado do resto do jogo. Isso substitui refazer essa ingestão a
cada visita de usuário na tela do título, que era caro à toa.

nota_externa (TMDB vote_average / IGDB total_rating, ver migração
20260828050000_nota_externa.sql) segue regras diferentes por fonte:
- Jogos (IGDB): já vem de graça no loop de loja acima (adicionar-jogo reingere o jogo
  inteiro todo dia, então a nota atualiza junto sem custo extra de chamada).
- Séries/filmes (TMDB): só atualiza pra quem está no re-sync completo de hoje
  (atualizar_serie/atualizar_filme, que já buscam `detalhes` mesmo assim -- sem
  chamada extra). TMDB não tem um endpoint leve só de nota como tem de
  watch/providers, então NÃO replicamos aqui o padrão "resto do catálogo todo dia"
  usado pra provedores -- isso significaria 1 chamada de detalhes por título do
  catálogo, todo santo dia, só pra um campo. Título fora do changes de hoje fica com
  a nota de quando foi ingerido/backfilled (ver scripts/backfill_nota_externa.py)
  até a TMDB reportar alguma mudança nele ou até rodar o backfill de novo manualmente.

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

FUNCTIONS_URL = f"{SUPABASE_URL}/functions/v1"
# Mesma service role key também autoriza a chamada de sistema nas Edge Functions
# (adicionar-titulo/adicionar-jogo aceitam isso sem exigir usuário logado).
FUNCTION_HEADERS = {
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "apikey": SUPABASE_KEY,
    "Content-Type": "application/json",
}


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

    # Dedup por (tipo, provider_name): a TMDB às vezes lista o mesmo provedor duas vezes
    # na mesma categoria (ex: "HBO Max"/"Max" durante rebranding) — duas linhas com o
    # mesmo conflict target no mesmo upsert fazem o Postgres rejeitar a operação inteira.
    provedores_por_chave = {
        (tipo, p["provider_name"]): {
            "titulo_id": titulo_id,
            "tipo": tipo,
            "provider_name": p["provider_name"],
            "logo_path": p.get("logo_path"),
            "display_priority": p.get("display_priority"),
        }
        for tipo in ("flatrate", "rent", "buy")
        for p in regiao.get(tipo, [])
    }
    linhas = list(provedores_por_chave.values())
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
        "nota_externa": detalhes.get("vote_average"),
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
        "nota_externa": detalhes.get("vote_average"),
    }, on_conflict="fonte,external_id").execute()

    supabase.table("movies").upsert({
        "titulo_id": titulo_id,
        "duration": detalhes.get("runtime"),
        "launch_date": detalhes.get("release_date"),
    }).execute()

    atualizar_provedores(titulo_id, "movie", tmdb_id, "movies")

    print(f"  - filme atualizado: {detalhes.get('title')} ({tmdb_id})")


def atualizar_provedores_restantes(mapa, media_type, tabela_filha, ja_atualizados):
    """Atualiza só o endpoint de watch/providers (bem mais leve que a re-ingestão
    completa) dos títulos que não entraram no re-sync de hoje, pra manter streaming
    fresco no catálogo inteiro sem repetir o fetch pesado de detalhes/episódios."""
    pendentes = mapa.keys() - ja_atualizados
    print(f"Atualizando só provedores de {len(pendentes)} título(s) ({tabela_filha}) fora do sync de hoje.")
    for tmdb_id in pendentes:
        try:
            atualizar_provedores(mapa[tmdb_id], media_type, tmdb_id, tabela_filha)
        except Exception as err:
            print(f"  - falhou provedor de {tmdb_id}: {err}")


def atualizar_lojas_jogos():
    """A IGDB não tem um endpoint de 'onde comprar' separado do resto do jogo como a
    TMDB tem — pra atualizar loja é preciso reingerir o jogo inteiro mesmo. Chama a
    Edge Function adicionar-jogo (autenticada como chamada de sistema, sem usuário)
    pra cada jogo do catálogo, uma vez por dia — nunca a cada visita de usuário."""
    jogos = []
    start, page_size = 0, 1000
    while True:
        resp = (
            supabase.table("titulo")
            .select("external_id, nome, games!inner(titulo_id)")
            .eq("fonte", "igdb")
            .range(start, start + page_size - 1)
            .execute()
        )
        data = resp.data
        if not data:
            break
        jogos.extend(data)
        if len(data) < page_size:
            break
        start += page_size

    print(f"{len(jogos)} jogo(s) pra atualizar loja.")
    for jogo in jogos:
        try:
            resp = requests.post(
                f"{FUNCTIONS_URL}/adicionar-jogo",
                headers=FUNCTION_HEADERS,
                json={"igdb_id": jogo["external_id"], "status": "none"},
                timeout=60,
            )
            if resp.status_code != 200:
                # Corpo da resposta é essencial pra diferenciar "nossa função recusou"
                # de "o gateway do Supabase recusou antes de chegar na função" —
                # raise_for_status() sozinho engole isso e só diz "401 Unauthorized".
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:500]}")
            corpo = resp.json()
            if corpo.get("error"):
                raise RuntimeError(corpo["error"])
        except Exception as err:
            print(f"  - falhou loja de {jogo.get('nome')}: {err}")


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

    # Provedores (streaming/loja) do resto do catálogo, que não passou pela re-ingestão
    # completa acima — ver docstring do módulo.
    atualizar_provedores_restantes(mapa_series, "tv", "series", para_atualizar_tv)
    atualizar_provedores_restantes(mapa_filmes, "movie", "movies", para_atualizar_movie)
    atualizar_lojas_jogos()

    print("Sync diário concluído.")


if __name__ == "__main__":
    main()
