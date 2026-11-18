import { useBlockchain, useDashboard } from '@/stores';
import { LoadingStatus } from '@/stores/useDashboard';
import {
  buildLegacyRedirect,
  matchLegacyPath,
  resolveLegacyTargetChain,
} from '@/libs/legacyRoutes';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
// @ts-ignore
import routes from '~pages';

const layoutComponents = {
  default: () => import('@/layouts/default.vue'),
  blank: () => import('@/layouts/blank.vue'),
} as const;

type LayoutName = keyof typeof layoutComponents;

function resolveLayout(layout: unknown) {
  if (typeof layout === 'string' && layout in layoutComponents) {
    return layoutComponents[layout as LayoutName];
  }
  return layoutComponents.default;
}

/**
 * Wrap a route with its layout component so routing does not depend on
 * vite-plugin-vue-layouts.
 */
function wrapWithLayout(
  route: RouteRecordRaw,
  layout: unknown
): RouteRecordRaw {
  return {
    path: route.path,
    component: resolveLayout(layout),
    children:
      route.path === '/' ? [route] : [{ ...route, path: '' } as RouteRecordRaw],
    meta: {
      isLayout: true,
    },
  };
}

function setupLayouts(
  rawRoutes: RouteRecordRaw[],
  top = true
): RouteRecordRaw[] {
  return rawRoutes.map((route) => {
    const normalizedRoute = route.children?.length
      ? ({
          ...route,
          children: setupLayouts(route.children, false),
        } as RouteRecordRaw)
      : route;

    const shouldWrap = top
      ? normalizedRoute.meta?.layout !== false
      : Boolean(normalizedRoute.meta?.layout);

    return shouldWrap
      ? wrapWithLayout(normalizedRoute, normalizedRoute.meta?.layout)
      : normalizedRoute;
  });
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [...setupLayouts(routes)],
});

router.beforeEach(async (to) => {
  if (to.path === '/') {
    const dashboard = useDashboard();
    if (dashboard.status !== LoadingStatus.Loaded) {
      await dashboard.initial();
    }
    const targetChain = resolveLegacyTargetChain(
      dashboard.chains,
      import.meta.env.VITE_CHAIN
    );
    if (targetChain) {
      return {
        path: `/${targetChain}`,
        query: to.query,
        hash: to.hash,
        replace: true,
      };
    }
  }

  if (matchLegacyPath(to.path)) {
    const dashboard = useDashboard();
    if (dashboard.status !== LoadingStatus.Loaded) {
      await dashboard.initial();
    }
    const redirect = buildLegacyRedirect(
      to,
      dashboard.chains,
      import.meta.env.VITE_CHAIN
    );
    if (redirect) {
      return redirect;
    }
    // Ambiguous multi-chain or unconfigured chains: avoid treating legacy segment as :chain
    return { path: '/', replace: true };
  }

  const { chain } = to.params;
  if (chain) {
    const blockchain = useBlockchain();
    if (chain !== blockchain.chainName) {
      blockchain.setCurrent(chain.toString());
    }
  }
});

// Docs: https://router.vuejs.org/guide/advanced/navigation-guards.html#global-before-guards

export default router;
