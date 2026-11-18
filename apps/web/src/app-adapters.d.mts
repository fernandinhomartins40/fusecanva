export class AppAdapterError extends Error { code: string }
export class AppAdapterRegistry {
  constructor(configs?: Record<string, { enabled: boolean; adapter: 'sandbox-local'; allowedCapabilities: string[] }>)
  state(appId: string): string
  connect(manifest: { id: string; requestedCapabilities: string[] }, consent: { accepted: boolean; capabilities: string[] }): Promise<string>
  perform(appId: string, action: string, input: unknown, context: { consent: { accepted: boolean; capabilities: string[] }; capability: string }): Promise<unknown>
  revoke(appId: string): Promise<void>
}
