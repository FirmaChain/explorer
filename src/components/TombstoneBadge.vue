<script lang="ts" setup>
import { Icon } from '@iconify/vue';

defineProps<{
  tombstoned?: boolean;
}>();
</script>

<template>
  <div
    v-if="tombstoned === true"
    class="tooltip tooltip-left"
    :data-tip="$t('uptime.tombstoned_true_tip')"
  >
    <span class="badge badge-error badge-sm gap-1 text-white whitespace-nowrap">
      <Icon icon="mdi-alert-circle-outline" class="w-3.5 h-3.5 shrink-0" />
      {{ $t('uptime.tombstoned') }}
    </span>
  </div>
  <div
    v-else-if="tombstoned === false"
    class="tooltip tooltip-left"
    :data-tip="$t('uptime.tombstoned_false_tip')"
  >
    <span
      class="badge badge-sm gap-1 bg-success/15 text-success border-0 whitespace-nowrap"
    >
      <Icon icon="mdi-check-circle-outline" class="w-3.5 h-3.5 shrink-0" />
      {{ $t('uptime.normal') }}
    </span>
  </div>
  <span v-else class="text-base-content/50">-</span>
</template>
