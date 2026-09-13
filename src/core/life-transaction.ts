const originals = new WeakMap<object, object>()

// Life state consists only of JSON values. Detach proxy values before retaining or cloning them.
export function plainLifeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  const original = originals.get(value) ?? value
  if (Array.isArray(original)) return original.map(plainLifeValue) as T
  return Object.fromEntries(Object.entries(original).map(([key, item]) => [key, plainLifeValue(item)])) as T
}

export function lifeTransaction<T extends object>(current: T): { draft: T; value: T; changed: Set<string> } {
  const value = { ...current }
  const changed = new Set<string>()
  const proxies = new WeakMap<object, object>()
  const wrap = (target: object, root: string, replace: (copy: object) => void): object => {
    const existing = proxies.get(target)
    if (existing) return existing
    let copy: object | undefined = target === value ? value : undefined
    const source = () => copy ?? target
    const writable = () => {
      if (!copy) {
        copy = Array.isArray(target) ? target.slice() : { ...target }
        proxies.set(copy, proxy)
        originals.set(proxy, copy)
        replace(copy)
      }
      return copy
    }
    const proxy = new Proxy(Array.isArray(target) ? [] : {}, {
      get(_object, key) {
        const result = Reflect.get(source(), key)
        return result !== null && typeof result === 'object' ? wrap(result, root || String(key), child => {
          if (Reflect.get(source(), key) === result) Reflect.set(writable(), key, child)
        }) : result
      },
      set(_object, key, item) {
        const original = item !== null && typeof item === 'object' ? originals.get(item) ?? item : item
        if (Reflect.get(source(), key) === original) return true
        changed.add(root || String(key))
        return Reflect.set(writable(), key, plainLifeValue(item))
      },
      deleteProperty(_object, key) {
        if (!Object.hasOwn(source(), key)) return true
        changed.add(root || String(key))
        return Reflect.deleteProperty(writable(), key)
      },
      ownKeys: () => Reflect.ownKeys(source()),
      has: (_object, key) => Reflect.has(source(), key),
      getOwnPropertyDescriptor: (_object, key) => Object.getOwnPropertyDescriptor(source(), key)
    })
    proxies.set(target, proxy); originals.set(proxy, target)
    return proxy
  }
  return { draft: wrap(value, '', () => undefined) as T, value, changed }
}
