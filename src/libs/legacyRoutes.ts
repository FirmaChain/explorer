export interface LegacyRouteMatch {
  targetSuffix: string;
}

const STATIC_LEGACY_MAP: Record<string, string> = {
  '/blocks': '/block',
  '/transactions': '/tx',
  '/proposals': '/gov',
  '/validators': '/staking',
  '/params': '/params',
};

const PARAM_LEGACY_PREFIXES: { prefix: string; targetPrefix: string }[] = [
  { prefix: '/blocks/', targetPrefix: '/block/' },
  { prefix: '/transactions/', targetPrefix: '/tx/' },
  { prefix: '/transaction/', targetPrefix: '/tx/' },
  { prefix: '/proposals/', targetPrefix: '/gov/' },
  { prefix: '/validators/', targetPrefix: '/staking/' },
  { prefix: '/validator/', targetPrefix: '/staking/' },
  { prefix: '/accounts/', targetPrefix: '/account/' },
  { prefix: '/account/', targetPrefix: '/account/' },
];

export function matchLegacyPath(rawPath: string): LegacyRouteMatch | null {
  const clean =
    rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
  if (Object.prototype.hasOwnProperty.call(STATIC_LEGACY_MAP, clean)) {
    return { targetSuffix: STATIC_LEGACY_MAP[clean] };
  }
  for (const rule of PARAM_LEGACY_PREFIXES) {
    if (clean.startsWith(rule.prefix)) {
      const rest = clean.slice(rule.prefix.length);
      if (rest && !rest.includes('/')) {
        return { targetSuffix: `${rule.targetPrefix}${rest}` };
      }
    }
  }
  return null;
}

export function resolveLegacyTargetChain(
  chains: Record<string, { chainName?: string; bech32Prefix?: string }>,
  configuredChain?: string
): string | null {
  const keys = Object.keys(chains || {});
  if (keys.length === 0) return null;

  const preferred = (configuredChain || '').trim();
  if (preferred && Object.prototype.hasOwnProperty.call(chains, preferred)) {
    return preferred;
  }

  if (keys.length === 1) {
    return keys[0];
  }

  const firmaMatches = keys.filter((k) => {
    const c = chains[k];
    return c?.chainName === 'firmachain' || c?.bech32Prefix === 'firma';
  });
  if (firmaMatches.length === 1) {
    return firmaMatches[0];
  }

  return null;
}

export function buildLegacyRedirect(
  to: { path: string; query?: Record<string, any>; hash?: string },
  chains: Record<string, { chainName?: string; bech32Prefix?: string }>,
  configuredChain?: string
):
  | { path: string; query?: Record<string, any>; hash?: string; replace: true }
  | null {
  const matched = matchLegacyPath(to.path);
  if (!matched) return null;

  const targetChain = resolveLegacyTargetChain(chains, configuredChain);
  if (!targetChain) return null;

  const nextPath = `/${targetChain}${matched.targetSuffix}`;
  if (nextPath === to.path) return null;

  return {
    path: nextPath,
    query: to.query,
    hash: to.hash,
    replace: true,
  };
}
