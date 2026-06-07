/// <reference types="vite/client" />
/// <reference types="svelte" />

interface Window {
  electron: {
    send: (channel: string, data?: any) => void;
    on: (channel: string, func: (...args: any[]) => void) => () => void;
    invoke: (channel: string, data?: any) => Promise<any>;
  };
}
