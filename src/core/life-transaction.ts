const originals = new WeakMap<object, object>()

// Life state consists only of JSON values. Detach proxy values before retaining or cloning them.
export function plainLifeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const original = originals.get(value) ?? value
  if (Array.isArray(original)) return original.map(plainLifeValue) as T
  return Object.fromEntries(Object.entries(original).map(([key, item]) => [key, plainLifeValue(item)])) as T
}

export function lifeTransaction<T extends object>(current: T): { draft: T; value: T; changed: Set<string> } {
  const value = structuredClone(current)
  const changed = new Set<string>()
  const proxies = new WeakMap<object, object>()
  const wrap = (target: object, root: string): object => {
    const existing = proxies.get(target)
    if (existing) return existing
    const proxy = new Proxy(target, {
      get(object, key) {
        const result = Reflect.get(object, key)
        return result !== null && typeof result === 'object' ? wrap(result, root || String(key)) : result
      },
      set(object, key, item) {
        const original = item !== null && typeof item === 'object' ? originals.get(item) ?? item : item
        if (Reflect.get(object, key) === original) return true
        changed.add(root || String(key))
        return Reflect.set(object, key, plainLifeValue(item))
      },
      deleteProperty(object, key) {
        if (Object.hasOwn(object, key)) changed.add(root || String(key))
        return Reflect.deleteProperty(object, key)
      }
    })
    proxies.set(target, proxy); originals.set(proxy, target)
    return proxy
  }
  return { draft: wrap(value, '') as T, value, changed }
}
