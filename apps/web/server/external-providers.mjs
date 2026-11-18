import { lookup as dnsLookup } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'

const PROVIDERS = Object.freeze({
  sitePublication: Object.freeze({ env: Object.freeze({ endpoint: 'SITE_PUBLISHER_URL', token: 'SITE_PUBLISHER_TOKEN' }) }),
  printCheckout: Object.freeze({ env: Object.freeze({ endpoint: 'PRINT_CHECKOUT_URL', token: 'PRINT_CHECKOUT_TOKEN' }) }),
})

function ipv4IsPublic(address) {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = octets
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113)
  )
}

function ipv6Words(address) {
  let source = address.toLowerCase()
  if (source.includes('.')) {
    const splitAt = source.lastIndexOf(':')
    const ipv4 = source.slice(splitAt + 1)
    if (!ipv4IsValid(ipv4)) return null
    const octets = ipv4.split('.').map(Number)
    source = `${source.slice(0, splitAt)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const [leftRaw, rightRaw = ''] = source.split('::')
  const left = leftRaw ? leftRaw.split(':') : []
  const right = rightRaw ? rightRaw.split(':') : []
  if (source.includes('::') ? left.length + right.length >= 8 : left.length !== 8) return null
  const words = source.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null
  return words.map(word => Number.parseInt(word, 16))
}

function ipv4IsValid(address) {
  return isIP(address) === 4
}

export function isPublicProviderAddress(address) {
  const family = isIP(address)
  if (family === 4) return ipv4IsPublic(address)
  if (family !== 6) return false
  const words = ipv6Words(address)
  if (!words) return false
  if (words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff) {
    const ipv4 = `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
    return ipv4IsPublic(ipv4)
  }
  const first = words[0]
  const isGlobalUnicast = (first & 0xe000) === 0x2000
  const isSpecialUse = first === 0x2001 && (words[1] === 0x0000 || words[1] === 0x0002 || words[1] === 0x0010 || words[1] === 0x0db8)
    || first === 0x2002 || first === 0x3fff
  return isGlobalUnicast && !isSpecialUse
}

function readProviderConfig(env, names) {
  const endpoint = typeof env[names.endpoint] === 'string' ? env[names.endpoint].trim() : ''
  const token = typeof env[names.token] === 'string' ? env[names.token].trim() : ''
  const missing = [!endpoint && names.endpoint, !token && names.token].filter(Boolean)
  let validEndpoint = false
  if (endpoint) {
    try {
      const parsed = new URL(endpoint)
      const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
      const isLocalHostname = hostname === 'localhost' || ['.localhost', '.local', '.internal', '.lan', '.home.arpa'].some(suffix => hostname.endsWith(suffix))
      const literalAddressIsPublic = isIP(hostname) === 0 || isPublicProviderAddress(hostname)
      validEndpoint = parsed.protocol === 'https:' && !parsed.username && !parsed.password && !isLocalHostname && literalAddressIsPublic
    } catch {}
    if (!validEndpoint) missing.push(`${names.endpoint} (HTTPS URL to a public host required)`)
  }
  return { endpoint, token, ready: missing.length === 0, missing }
}

function createPublicLookup() {
  return (hostname, options, callback) => {
    const host = hostname.replace(/^\[|\]$/g, '')
    const family = isIP(host)
    if (family) {
      if (!isPublicProviderAddress(host)) return callback(new Error('provider endpoint resolved to a non-public address'))
      return callback(null, host, family)
    }
    dnsLookup(host, { all: true, verbatim: true }, (error, records) => {
      if (error) return callback(error)
      if (!records?.length || records.some(record => !isPublicProviderAddress(record.address))) return callback(new Error('provider endpoint resolved to a non-public address'))
      const selected = records[0]
      if (options?.all) return callback(null, records)
      return callback(null, selected.address, selected.family)
    })
  }
}

function requestJson(endpoint, token, payload) {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve(value)
    }
    const request = httpsRequest(endpoint, {
      method: 'POST',
      lookup: createPublicLookup(),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    }, response => {
      if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
        response.resume()
        return finish(new Error('external-provider-rejected-request'))
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 1_000_000) request.destroy(new Error('external-provider-response-too-large'))
      })
      response.on('end', () => {
        try { finish(null, JSON.parse(body)) }
        catch { finish(new Error('external-provider-invalid-response')) }
      })
    })
    request.setTimeout(15_000, () => request.destroy(new Error('external-provider-timeout')))
    request.on('error', error => finish(error))
    request.end(JSON.stringify(payload))
  })
}

function createHttpProvider(endpoint, token, request = requestJson) {
  return async payload => {
    try { return await request(endpoint, token, payload) }
    catch { throw new Error('external-provider-unavailable') }
  }
}

export function createExternalProviderClients(env = process.env, request = requestJson) {
  const siteConfig = readProviderConfig(env, PROVIDERS.sitePublication.env)
  const printConfig = readProviderConfig(env, PROVIDERS.printCheckout.env)
  return {
    sitePublisher: siteConfig.ready ? { publish: createHttpProvider(siteConfig.endpoint, siteConfig.token, request) } : null,
    printCheckoutProvider: printConfig.ready ? { createCheckout: createHttpProvider(printConfig.endpoint, printConfig.token, request) } : null,
    status: {
      sitePublication: { configured: siteConfig.ready, missing: siteConfig.missing },
      printCheckout: { configured: printConfig.ready, missing: printConfig.missing },
    },
  }
}

export const EXTERNAL_PROVIDER_CONTRACTS = Object.freeze({
  sitePublication: Object.freeze({
    requiredEnv: Object.freeze([PROVIDERS.sitePublication.env.endpoint, PROVIDERS.sitePublication.env.token]),
    input: 'publish({ documentId, slug, site })',
    output: 'Promise<{ url: HTTPS URL, deploymentId: non-empty string }>',
  }),
  printCheckout: Object.freeze({
    requiredEnv: Object.freeze([PROVIDERS.printCheckout.env.endpoint, PROVIDERS.printCheckout.env.token]),
    input: 'createCheckout({ documentId, product, options, document })',
    output: 'Promise<{ checkoutUrl: HTTPS URL, sessionId: non-empty string }>',
  }),
})
