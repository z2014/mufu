export {};

declare global {
  interface Window {
    mufu?: {
      pickDirectory: () => Promise<string | null>;
    };
  }
}
