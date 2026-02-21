export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeMode = 'light' | 'dark';

export interface Palette {
  background: string;
  surface: string;
  surfaceSubtle: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
  successSoft: string;
  warningSoft: string;
  errorSoft: string;
  shadow: string;
  shimmer: string;
}

export const lightPalette: Palette = {
  background: '#F6F6F6',
  surface: '#FFFFFF',
  surfaceSubtle: '#EFEFEF',
  border: '#D8D8D8',
  textPrimary: '#101010',
  textSecondary: '#2C2C2C',
  textMuted: '#6B6B6B',
  accent: '#111111',
  accentSoft: '#E8E8E8',
  successSoft: '#EFEFEF',
  warningSoft: '#EFEFEF',
  errorSoft: '#EFEFEF',
  shadow: '#000000',
  shimmer: 'rgba(255, 255, 255, 0.5)',
};

export const darkPalette: Palette = {
  background: '#0F0F10',
  surface: '#171717',
  surfaceSubtle: '#222222',
  border: '#343434',
  textPrimary: '#F2F2F2',
  textSecondary: '#D2D2D2',
  textMuted: '#A3A3A3',
  accent: '#E8E8E8',
  accentSoft: '#2A2A2A',
  successSoft: '#222222',
  warningSoft: '#222222',
  errorSoft: '#222222',
  shadow: '#000000',
  shimmer: 'rgba(255, 255, 255, 0.26)',
};

// Backward-compatible static light palette reference.
export const palette = lightPalette;

export const typography = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  display: 'SpaceGrotesk_600SemiBold',
  mono: 'JetBrainsMono_500Medium',
};

export const CONNECTION_COLORS: Record<string, string> = {
  connecting: '#6B6B6B',
  connected: '#111111',
  disconnected: '#3D3D3D',
};

export const STATUS_COLORS: Record<string, string> = {
  initializing: '#6B6B6B',
  ready: '#111111',
  working: '#2F2F2F',
  error: '#3D3D3D',
  stopped: '#8A8A8A',
};

const CONNECTION_COLORS_DARK: Record<string, string> = {
  connecting: '#A3A3A3',
  connected: '#F2F2F2',
  disconnected: '#C8C8C8',
};

const STATUS_COLORS_DARK: Record<string, string> = {
  initializing: '#AFAFAF',
  ready: '#F2F2F2',
  working: '#D8D8D8',
  error: '#BEBEBE',
  stopped: '#8E8E8E',
};

export function resolveThemeMode(preference: ThemePreference, systemScheme: 'light' | 'dark' | null | undefined): ThemeMode {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function getPalette(mode: ThemeMode): Palette {
  return mode === 'dark' ? darkPalette : lightPalette;
}

export function getConnectionColors(mode: ThemeMode): Record<string, string> {
  return mode === 'dark' ? CONNECTION_COLORS_DARK : CONNECTION_COLORS;
}

export function getStatusColors(mode: ThemeMode): Record<string, string> {
  return mode === 'dark' ? STATUS_COLORS_DARK : STATUS_COLORS;
}
