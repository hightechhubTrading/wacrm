import { Capacitor, registerPlugin } from '@capacitor/core';
interface SecureSessionPlugin {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
const vault = registerPlugin<SecureSessionPlugin>('SecureSession');
export const nativePersistence = Capacitor.getPlatform() === 'android';
export const sessionStorage = {
  getItem: async (key: string) => (await vault.get({ key })).value,
  setItem: async (key: string, value: string) => {
    await vault.set({ key, value });
  },
  removeItem: async (key: string) => {
    await vault.remove({ key });
  },
};
