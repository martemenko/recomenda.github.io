// Gerenciador central de cache em memória com estratégia Stale-While-Revalidate
const cacheStore = new Map()
const INVALIDATE_LISTENERS = new Set()

/**
 * Obtém dados em cache para uma determinada chave.
 * Retorna { data, isStale } se existir, ou null se não houver cache.
 */
export function getCache(key) {
  const item = cacheStore.get(key)
  if (!item) return null

  const isStale = Date.now() > item.expiresAt
  return { data: item.data, isStale }
}

/**
 * Grava dados no cache com TTL (tempo de vida) configurável (padrão: 5 minutos).
 */
export function setCache(key, data, ttlMs = 5 * 60 * 1000) {
  cacheStore.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    updatedAt: Date.now(),
  })
}

/**
 * Invalida o cache. Pode receber uma string, um array de padrões ou nada (limpa tudo).
 */
export function invalidateCache(keys) {
  if (!keys) {
    cacheStore.clear()
  } else {
    const keysArray = Array.isArray(keys) ? keys : [keys]
    for (const keyPattern of keysArray) {
      for (const key of cacheStore.keys()) {
        if (key.includes(keyPattern)) {
          cacheStore.delete(key)
        }
      }
    }
  }

  // Notifica componentes ativos sobre a invalidação
  INVALIDATE_LISTENERS.forEach((cb) => cb(keys))
}

/**
 * Inscreve um callback para escutar invalidações de cache
 */
export function onCacheInvalidate(callback) {
  INVALIDATE_LISTENERS.add(callback)
  return () => INVALIDATE_LISTENERS.delete(callback)
}
