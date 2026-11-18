// Modified by FirmaChain (2026-11-18) | Licensed under GNU GPL v2.0 (see LICENSE)
// Derived from src/components/charts/apexChartConfig.ts
import { useBlockchain } from '@/stores';

export const getPrimaryChartColor = (): string => {
  const chainStore = useBlockchain();
  return chainStore.current?.themeColor || '#666CFF';
};

export const colorVariables = (theme: string) => {
  if (theme === 'light') {
    return {
      themeSecondaryTextColor: 'rgba(76,78,100,0.6)',
      themeDisabledTextColor: 'rgba(76,78,100,0.38)',
      themeBorderColor: 'rgba(76,78,100,0.12)',
      themePrimaryTextColor: 'rgba(76,78,100,0.87)',
    };
  }
  return {
    themeSecondaryTextColor: 'rgba(234,234,255,0.6)',
    themeDisabledTextColor: 'rgba(234,234,255,0.38)',
    themeBorderColor: 'rgba(234,234,255,0.12)',
    themePrimaryTextColor: 'rgba(234,234,255,0.87)',
  };
};

export const donutColors = [
  '#bbe81a',
  '#ff5f0b',
  '#43ebef',
  '#1999e5',
  '#230b2c',
  '#628be8',
  '#aa5343',
  '#c9fa89',
  '#e88ea8',
  '#72e4a2',
  '#38cd87',
  '#515e13',
  '#7bf8f5',
  '#83dd6e',
  '#e8b203',
  '#7d11d5',
  '#3e4927',
  '#f303e2',
  '#249493',
  '#50e5e6',
  '#11deb2',
  '#a2f9c7',
  '#2a7bdc',
  '#47383a',
  '#226da4',
  '#966319',
  '#1bdf99',
  '#f3ab0c',
  '#961f50',
  '#832efd',
  '#875287',
  '#4bebe7',
  '#1d3d2e',
  '#9caea4',
  '#2772f5',
  '#938bf1',
  '#6228a5',
  '#24fea5',
  '#c9bbc8',
  '#e27225',
  '#54bd9f',
  '#babb2d',
  '#bcf591',
  '#803b36',
  '#124f03',
];
