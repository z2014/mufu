import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Preferences = {
  repoPath: string;
  setRepoPath: (repoPath: string) => void;
};

export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      repoPath: '',
      setRepoPath: (repoPath) => set({ repoPath }),
    }),
    { name: 'mufu-preferences' },
  ),
);
