// Helper compartilhado de autenticação e consulta à IGDB.
// Usado por qualquer Edge Function que precise falar com a IGDB
// (adicionar-jogo, soon-games, e futuramente a busca combinada em buscar-titulo).
// Pasta prefixada com "_" não é publicada como function própria pelo Supabase CLI —
// só serve de módulo importado via caminho relativo.

const IGDB_CLIENT_ID = Deno.env.get("IGDB_CLIENT_ID")!;
const IGDB_CLIENT_SECRET = Deno.env.get("IGDB_CLIENT_SECRET")!;

// Cacheado no módulo: como a Edge Function reaproveita a instância entre
// invocações "quentes", isso evita pagar o round-trip de OAuth em toda chamada.
let tokenCache: { token: string; expiraEm: number } | null = null;

export async function getIgdbToken(): Promise<string> {
  if (tokenCache && tokenCache.expiraEm > Date.now()) {
    return tokenCache.token;
  }
  const url = `https://id.twitch.tv/oauth2/token?client_id=${IGDB_CLIENT_ID}&client_secret=${IGDB_CLIENT_SECRET}&grant_type=client_credentials`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Twitch OAuth -> HTTP ${res.status}`);
  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    // Renova 60s antes do vencimento real, por margem de segurança
    expiraEm: Date.now() + (data.expires_in - 60) * 1000,
  };
  return tokenCache.token;
}

export async function igdbQuery(endpoint: string, apicalypseQuery: string) {
  const token = await getIgdbToken();
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: "POST",
    headers: {
      "Client-ID": IGDB_CLIENT_ID,
      Authorization: `Bearer ${token}`,
      "Content-Type": "text/plain",
    },
    body: apicalypseQuery,
  });
  if (!res.ok) throw new Error(`IGDB ${endpoint} -> HTTP ${res.status}`);
  return res.json();
}

export function igdbCoverUrl(imageId: string | undefined | null, size = "t_cover_big"): string | null {
  return imageId ? `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg` : null;
}
