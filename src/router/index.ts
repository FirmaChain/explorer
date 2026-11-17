import { useBlockchain, useDashboard } from '@/stores';
import { LoadingStatus } from '@/stores/useDashboard';
import { buildLegacyRedirect, matchLegacyPath, resolveLegacyTargetChain } from '@/libs/legacyRoutes';
import { createRouter, createWebHistory } from 'vue-router';
// @ts-ignore
import { setupLayouts } from 'virtual:generated-layouts';
// @ts-ignore
import routes from '~pages';

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
