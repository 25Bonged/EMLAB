export {}

declare global {
  interface Window {
    emlab?: {
      apiConfig(): Promise<{ base: string; token: string }>
    }
  }
}
