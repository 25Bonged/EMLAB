import { contextBridge, ipcRenderer } from 'electron'

export interface EmlabBridge {
  base: string
  /** Shared secret for the local API. Reachable only through this bridge, so
   *  other processes on the machine cannot call the API. */
  token: string
}

contextBridge.exposeInMainWorld('emlab', {
  apiConfig: (): Promise<EmlabBridge> => ipcRenderer.invoke('emlab:api-config'),
})
