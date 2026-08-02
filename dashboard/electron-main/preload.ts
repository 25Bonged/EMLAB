import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('emlab', {
  apiBase: (): Promise<string> => ipcRenderer.invoke('emlab:api-base'),
})
