import { ref } from 'vue';

const KEYBASE_UPLOAD_PREFIX =
  'https://s3.amazonaws.com/keybase_processed_uploads/';

export function readCachedValidatorAvatars(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem('avatars') || '{}') || {};
  } catch {
    return {};
  }
}

export function resolveValidatorAvatarUrl(
  avatars: Record<string, string>,
  identity?: string
): string {
  if (!identity || !avatars[identity]) return '';
  const url = avatars[identity];
  return url.startsWith('http') ? url : `${KEYBASE_UPLOAD_PREFIX}${url}`;
}

/**
 * Loads and caches Keybase validator avatars keyed by validator identity.
 */
export function useValidatorAvatars(
  fetchKeybase?: (identity: string) => Promise<any>
) {
  const avatars = ref<Record<string, string>>(readCachedValidatorAvatars());
  const loadingIdentities = new Set<string>();

  function logoUrl(identity?: string): string {
    return resolveValidatorAvatarUrl(avatars.value, identity);
  }

  function loadAvatar(identity?: string) {
    if (
      !identity ||
      avatars.value[identity] ||
      loadingIdentities.has(identity) ||
      typeof fetchKeybase !== 'function'
    ) {
      return;
    }
    loadingIdentities.add(identity);
    Promise.resolve(fetchKeybase(identity))
      .then((d) => {
        const url = d?.them?.[0]?.pictures?.primary?.url;
        if (!url) return;
        const uri = String(url).replace(KEYBASE_UPLOAD_PREFIX, '');
        avatars.value = { ...avatars.value, [identity]: uri };
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('avatars', JSON.stringify(avatars.value));
        }
      })
      .catch(() => {
        // Fallback icon remains rendered when Keybase lookup fails
      })
      .finally(() => {
        loadingIdentities.delete(identity);
      });
  }

  return { avatars, logoUrl, loadAvatar };
}
