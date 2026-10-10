import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('mufu', {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('pick-directory'),
});
