import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemePreference } from '../theme';

const THEME_PREFERENCE_KEY = 'codex_theme_preference';

interface ThemeStore {
  preference: ThemePreference;
  loaded: boolean;
  setPreference: (preference: ThemePreference) => void;
  loadPreference: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  preference: 'system',
  loaded: false,

  setPreference: (preference) => {
    AsyncStorage.setItem(THEME_PREFERENCE_KEY, preference).catch(() => {});
    set({ preference });
  },

  loadPreference: async () => {
    try {
      const saved = await AsyncStorage.getItem(THEME_PREFERENCE_KEY);
      if (saved === 'system' || saved === 'light' || saved === 'dark') {
        set({ preference: saved, loaded: true });
        return;
      }
    } catch {
      // Ignore and fall back to default
    }
    set({ loaded: true });
  },
}));
