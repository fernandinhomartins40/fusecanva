export type PageEventStream = { close(): void }
export function createPageEventStream(url: string, handlers: {
  onMessage: (event: MessageEvent<string>) => void
  onOpen?: (event: Event) => void
  onError?: (event: Event) => void
  onResume?: () => void
  isTerminal?: (event: MessageEvent<string>) => boolean
}): PageEventStream
