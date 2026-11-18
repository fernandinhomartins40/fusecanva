export class AppAdapterError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AppAdapterError';
    this.code = code;
  }
}

/** Deterministic offline adapter. No network APIs are used. */
export class LocalSandboxAdapter {
  state = 'disconnected';
  granted = new Set();

  async connect(manifest, consent) {
    this.granted.clear();
    if (!consent.accepted) return (this.state = 'cancelled');
    for (const cap of manifest.requestedCapabilities) {
      if (consent.capabilities.includes(cap)) this.granted.add(cap);
    }
    return (this.state = 'connected');
  }

  async perform(action, input, context) {
    if (this.state !== 'connected') throw new AppAdapterError('App is not connected', 'not-connected');
    if (!context.consent.accepted) throw new AppAdapterError('Consent is required', 'consent-required');
    if (!this.granted.has(context.capability) || !context.consent.capabilities.includes(context.capability)) {
      throw new AppAdapterError(`Capability denied: ${context.capability}`, 'capability-denied');
    }
    if (action === 'catalog.search' && context.capability === 'media.read') {
      const query = typeof input === 'string' ? input.trim().toLowerCase() : '';
      return ['local-photo-sample', 'local-shape-sample'].filter((item) => item.includes(query));
    }
    if (action === 'content.insert' && context.capability === 'content.insert') {
      return { inserted: true, source: 'local-sandbox', content: input };
    }
    throw new AppAdapterError(`Unsupported sandbox action: ${action}`, 'unknown-action');
  }

  async disconnect() {
    this.granted.clear();
    this.state = 'disconnected';
  }
}

/** Config is injected at construction; missing configuration denies by default. */
export class AppAdapterRegistry {
  instances = new Map();

  constructor(configs = {}) {
    this.configs = configs;
  }

  state(appId) {
    return this.instances.get(appId)?.state ?? 'disconnected';
  }

  async connect(manifest, consent) {
    const config = this.configs[manifest.id];
    if (!config?.enabled || config.adapter !== 'sandbox-local') {
      this.instances.set(manifest.id, { adapter: new LocalSandboxAdapter(), state: 'error' });
      throw new AppAdapterError(`No explicit adapter configuration for ${manifest.id}`, 'not-configured');
    }
    if (!consent.accepted) {
      this.instances.set(manifest.id, { adapter: new LocalSandboxAdapter(), state: 'cancelled' });
      return 'cancelled';
    }
    const requested = new Set(manifest.requestedCapabilities);
    const granted = new Set(consent.capabilities);
    const configured = new Set(config.allowedCapabilities);
    const effective = {
      accepted: true,
      capabilities: [...requested].filter((cap) => granted.has(cap) && configured.has(cap)),
    };
    const adapter = new LocalSandboxAdapter();
    const state = await adapter.connect(manifest, effective);
    this.instances.set(manifest.id, { adapter, state });
    return state;
  }

  async perform(appId, action, input, context) {
    const entry = this.instances.get(appId);
    if (!entry || entry.state !== 'connected') throw new AppAdapterError('App is not connected', 'not-connected');
    const config = this.configs[appId];
    if (!config?.enabled || !config.allowedCapabilities.includes(context.capability)) {
      throw new AppAdapterError(`Capability denied: ${context.capability}`, 'capability-denied');
    }
    return entry.adapter.perform(action, input, context);
  }

  async revoke(appId) {
    const entry = this.instances.get(appId);
    await entry?.adapter.disconnect();
    this.instances.delete(appId);
  }
}
