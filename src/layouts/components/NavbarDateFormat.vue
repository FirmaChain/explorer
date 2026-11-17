<script lang="ts" setup>
import { useFormatter } from '@/stores';

const format = useFormatter();
</script>
<template>
  <button
    type="button"
    class="btn btn-ghost btn-sm mx-1 text-xs font-mono"
    :aria-label="`Date display timezone: ${format.dateFormat === 'utc' ? 'UTC' : 'Local'}`"
    :title="`Switch date display to ${format.dateFormat === 'utc' ? 'Local' : 'UTC'}`"
    @click="format.toggleDateFormat()"
  >
    {{ format.dateFormat === 'utc' ? 'UTC' : 'Local' }}
  </button>
</template>
