// import 'ping-widget';
import App from '@/App.vue';
import i18n from '@/plugins/i18n';
import 'md-editor-v3/lib/style.css';
import '@/style.css';
import { createApp, watch } from 'vue';
import { createPinia } from 'pinia';
import LazyLoad from 'lazy-load-vue3';

import router from './router';
import { useBaseStore } from '@/stores';

const MIN_LOADER_DURATION_MS = 1200;
const MAX_LOADER_WAIT_MS = 2500;

function waitForInitialConnection(
  baseStore: ReturnType<typeof useBaseStore>
): Promise<void> {
  if (baseStore.connectionChecked) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stop();
      resolve();
    }, MAX_LOADER_WAIT_MS);
    const stop = watch(
      () => baseStore.connectionChecked,
      (checked) => {
        if (checked) {
          window.clearTimeout(timer);
          stop();
          resolve();
        }
      }
    );
  });
}

async function dismissInitialLoader(
  baseStore: ReturnType<typeof useBaseStore>
) {
  const loader = document.getElementById('loading-bg');
  if (!loader) return;

  const minDelay = new Promise<void>((resolve) => {
    const remaining = Math.max(400, MIN_LOADER_DURATION_MS - performance.now());
    window.setTimeout(resolve, remaining);
  });

  try {
    await Promise.all([
      router.isReady().catch(() => undefined),
      waitForInitialConnection(baseStore),
      minDelay,
    ]);
  } finally {
    loader.classList.add('is-hidden');
    window.setTimeout(() => {
      loader.remove();
    }, 350);
  }
}

// Create vue app
const app = createApp(App);
// Use plugins
app.use(i18n);
app.use(createPinia());
app.use(router);
app.use(LazyLoad, { component: true });
// Mount vue app
app.mount('#app');

dismissInitialLoader(useBaseStore());
