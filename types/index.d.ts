export type PrState = 'running' | 'failed' | 'ready'
export type Pr = { repo: string; number: number; title: string; url: string; state: PrState }
export type Deploy = { repo: string; target: string; state: 'deploying' | 'failed'; url: string | null }
export type Feed = { prs: Pr[]; deploys: Deploy[]; down: string[] }

declare module 'claude-code' {
  interface PluginState {
    'ship-mod': { feed: Shaped<Feed> }
  }
}
