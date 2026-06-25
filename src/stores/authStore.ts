import { create } from 'zustand';

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
};

type AuthState = {
  user: AuthUser | null;
  checked: boolean;
  setUser: (user: AuthUser | null) => void;
  setChecked: (checked: boolean) => void;
  isAdmin: () => boolean;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  checked: false,
  setUser: (user) => set({ user }),
  setChecked: (checked) => set({ checked }),
  isAdmin: () => get().user?.role === 'admin',
}));
