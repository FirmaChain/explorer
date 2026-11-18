<!-- Modified by FirmaChain (2026-11-17) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<script lang="ts" setup>
import Countdown from '@chenfengyuan/vue-countdown';

defineProps({
  time: { type: Number },
  css: { type: String },
});
</script>
<template>
  <Countdown
    v-if="time"
    :time="time > 0 ? time : 0"
    v-slot="{ days, hours, minutes, seconds }"
    class="countdown-container"
  >
    <span class="text-primary font-bold" :class="css">{{ days }}</span> days
    <span class="text-primary font-bold" :class="css">{{ hours }}</span> hours
    <span class="text-primary font-bold" :class="css">{{ minutes }}</span> minutes
    <span class="text-primary font-bold countdown-seconds" :class="css">
      <Transition name="slide-up">
        <span v-if="seconds % 2 === 0" class="countdown-digit">{{ seconds }}</span>
        <span v-else class="countdown-digit">{{ seconds }}</span>
      </Transition>
    </span>
    seconds
  </Countdown>
</template>

<style scoped>
.countdown-seconds {
  display: inline-grid;
  min-width: 2ch;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.countdown-digit {
  grid-area: 1 / 1;
}
</style>
