<!-- Modified by FirmaChain (2026-11-17, 2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE) -->
<template>
  <!-- footer -->
  <footer class="flex items-center h-12 mt-5 text-sm bg-base-200 py-2 px-4 z-10 w-full">
    <div class="flex flex-1">
      &copy;&nbsp;
      {{ new Date().getFullYear() }}&nbsp; Made With&nbsp; <img src="../../assets/images/heart.svg" />&nbsp; By&nbsp;
      <a class="link link-primary no-underline" href="https://ping.pub" target="_blank" rel="noopener noreferrer"
        >Ping.pub</a
      >
    </div>
    <div class="hidden md:!block">
      <a
        class="link link-primary no-underline mr-4"
        href="https://github.com/FirmaChain/explorer/blob/master/LICENSE"
        target="_blank"
        rel="noopener noreferrer"
        >License</a
      >
      <a
        class="link link-primary no-underline"
        href="https://github.com/FirmaChain/explorer"
        target="_blank"
        rel="noopener noreferrer"
        >Github</a
      >
    </div>
  </footer>
</template>
