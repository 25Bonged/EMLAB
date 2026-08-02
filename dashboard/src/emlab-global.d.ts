export {}

declare global {
  interface Window {
    emlab?: {
      apiBase(): Promise<string>
    }
  }
}
