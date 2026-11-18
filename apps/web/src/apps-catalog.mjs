/** @typedef {import('./apps-catalog.d.mts').AppCategoryId} AppCategoryId */

/** @typedef {{ id: string, name: string, description: string, category: AppCategoryId, provider: string, capabilities: string[], featured: boolean, tags: string[], recommendation: { rank: number, reason: string }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' }} CatalogApp */

/** Marketplace categories observed in the audited Canva Apps shell. */
export const APP_CATEGORIES = Object.freeze([
  { id: 'for-you', label: 'Para você', route: '' },
  { id: 'audio-narration', label: 'Áudio e narração', route: 'audio-and-voiceover' },
  { id: 'communication', label: 'Comunicação', route: 'communication' },
  { id: 'graphic-design', label: 'Design gráfico', route: 'graphic-design' },
  { id: 'photo-editing', label: 'Edição de fotos', route: 'photo-editing' },
  { id: 'text-styling', label: 'Estilização de texto', route: 'text-styling' },
  { id: 'ai-generation', label: 'Geração por IA', route: 'ai-generation' },
  { id: 'file-data-management', label: 'Gerenciamento de arquivos e dados', route: 'file-and-data' },
  { id: 'project-management', label: 'Gestão de projetos', route: 'project-management' },
  { id: 'marketing', label: 'Marketing', route: 'marketing' },
  { id: 'video-animation', label: 'Vídeo e animação', route: 'video-and-animation' },
  { id: 'all-apps', label: 'Todos os apps', route: 'all-apps' },
]);
/** Ordered marketplace category list, as observed in the audited shell. */
export const AUDITED_APP_CATEGORIES = APP_CATEGORIES;

/** Small local demonstration catalog. Names/examples are drawn from audited marketplace listings; no entry implies a live integration. @type {readonly CatalogApp[]} */
export const DEMO_APPS = Object.freeze([
  { id: 'qr-codes-dinamicos', name: 'QR codes dinâmicos', provider: 'QR Code', description: 'Crie códigos QR dinâmicos para seus designs', category: 'marketing', capabilities: ['criação de códigos QR'], featured: true, tags: ['qr', 'qr code', 'dynamic qr'], recommendation: { rank: 1, reason: 'Primeiro resultado observado para “QR Code”' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'me-qr-codes', name: 'ME-QR Codes', provider: 'ME-QR', description: 'Explore uma integração de códigos QR', category: 'marketing', capabilities: ['criação de códigos QR'], featured: false, tags: ['qr', 'qr code'], recommendation: { rank: 2, reason: 'Resultado observado para “QR Code”' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'dynamic-qr-codes', name: 'Dynamic QR Codes', provider: 'Dynamic QR Codes', description: 'Explore uma integração de códigos QR dinâmicos', category: 'marketing', capabilities: ['criação de códigos QR'], featured: false, tags: ['qr', 'qr code', 'dynamic qr'], recommendation: { rank: 3, reason: 'Resultado observado para “QR Code”' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'qr-code-scanner', name: 'QR Code Scanner', provider: 'QR Code Scanner', description: 'Explore uma integração de leitura de códigos QR', category: 'marketing', capabilities: ['leitura de códigos QR'], featured: false, tags: ['qr', 'qr code', 'scanner'], recommendation: { rank: 4, reason: 'Resultado observado para “QR Code”' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'youtube', name: 'YouTube', provider: 'YouTube', description: 'Publique vídeos do Canva direto no YouTube', category: 'marketing', capabilities: ['publicação de vídeo'], featured: true, tags: ['vídeo', 'publicação', 'social'], recommendation: { rank: 2, reason: 'Popular para publicação de vídeo' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'later', name: 'Later', provider: 'Later', description: 'Agende conteúdo para plataformas sociais', category: 'marketing', capabilities: ['agendamento de conteúdo'], featured: false, tags: ['social', 'agendamento'], recommendation: { rank: 4, reason: 'Ajuda a organizar conteúdo social' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'sprout-social', name: 'Sprout Social', provider: 'Sprout Social', description: 'Exporte designs para o Sprout Social', category: 'marketing', capabilities: ['exportação de designs'], featured: false, tags: ['social', 'exportação'], recommendation: { rank: 7, reason: 'Fluxo de publicação social observado' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'google-calendar', name: 'Google Calendar', provider: 'Google', description: 'Conecte agenda e planejamento de conteúdo', category: 'project-management', capabilities: ['conexão de agenda'], featured: false, tags: ['agenda', 'planejamento'], recommendation: { rank: 3, reason: 'Complementa o planejamento de projetos' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'hootsuite', name: 'Hootsuite', provider: 'Hootsuite', description: 'Crie e agende publicações sociais', category: 'marketing', capabilities: ['criação e agendamento de posts'], featured: true, tags: ['social', 'agendamento'], recommendation: { rank: 1, reason: 'Destaque local do catálogo de demonstração' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'mailchimp', name: 'Mailchimp', provider: 'Mailchimp', description: 'Publique imagens do Canva no Mailchimp', category: 'communication', capabilities: ['publicação de imagens'], featured: false, tags: ['email', 'campanha'], recommendation: { rank: 5, reason: 'Útil para fluxos de comunicação' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'shopify-connect', name: 'Shopify Connect', provider: 'Shopify', description: 'Adicione arquivos e produtos do Shopify a um design', category: 'file-data-management', capabilities: ['importação de arquivos e produtos'], featured: false, tags: ['comércio', 'produtos'], recommendation: { rank: 8, reason: 'Conecta conteúdo a dados de produto' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
  { id: 'giphy', name: 'GIPHY', provider: 'GIPHY', description: 'Encontre GIFs para usar em criações', category: 'video-animation', capabilities: ['busca de GIFs'], featured: true, tags: ['gif', 'animação', 'mídia'], recommendation: { rank: 6, reason: 'Recurso visual observado nos exemplos' }, source: 'audit-example', catalogStatus: 'demo-only', integrationStatus: 'not-connected' },
]);
/** Alias shaped for marketplace card and filter consumers. */
export const MARKETPLACE_APP_CATALOG = DEMO_APPS;

/** Bounded evidence metadata from the retained Apps marketplace inventory; these are listing occurrences, not integrations. */
export const APPS_AUDIT_COVERAGE = Object.freeze({
  observedCategoryRoutes: 10,
  listedCardOccurrences: 544,
  normalizedLabels: 457,
  fullScrollInventories: 1,
  allAppsViewportNames: 99,
  uniqueIdentityResolved: false,
});

const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
const categoryById = new Map(APP_CATEGORIES.map((category) => [category.id, category]));
const categoryByRoute = new Map(APP_CATEGORIES.map((category) => [category.route, category]));

/** @param {unknown} value @returns {AppCategoryId} */
export function normalizeCategory(value) {
  return categoryById.has(value) ? /** @type {AppCategoryId} */ (value) : 'for-you';
}

/** @param {readonly CatalogApp[]} apps @param {{ category?: AppCategoryId | string, query?: string, sort?: 'recommended' | 'name' }} [options] @returns {CatalogApp[]} */
export function filterApps(apps, { category = 'for-you', query = '', sort = 'recommended' } = {}) {
  const normalizedCategory = normalizeCategory(category);
  const queryTerms = normalize(query).split(/\s+/).filter(Boolean);
  const result = apps.filter((app) => {
    const inCategory = normalizedCategory === 'all-apps' || normalizedCategory === 'for-you' || app.category === normalizedCategory;
    const haystack = normalize([app.name, app.provider, app.description, ...app.tags].join(' '));
    return inCategory && queryTerms.every((term) => haystack.includes(term));
  });
  return result.sort(sort === 'name'
    ? (a, b) => a.name.localeCompare(b.name, 'pt-BR')
    : (a, b) => a.recommendation.rank - b.recommendation.rank || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Parse the app discovery URL into serializable UI state. Unknown routes fall back to the observed default. @param {string | URL} input */
export function parseAppsRoute(input) {
  const url = input instanceof URL ? input : new URL(input, 'https://fuse.invalid');
  const segments = url.pathname.split('/').filter(Boolean);
  const routeSegment = segments[0] === 'your-apps' ? segments[1] : undefined;
  const category = categoryByRoute.get(routeSegment ?? '')?.id ?? 'for-you';
  return Object.freeze({ category, query: url.searchParams.get('q') ?? '', sort: url.searchParams.get('sort') === 'name' ? 'name' : 'recommended' });
}

/** Build a canonical local route while retaining query/sort state. @param {{ category?: AppCategoryId | string, query?: string, sort?: 'recommended' | 'name' }} state */
export function buildAppsRoute({ category = 'for-you', query = '', sort = 'recommended' } = {}) {
  const selected = categoryById.get(normalizeCategory(category)) ?? APP_CATEGORIES[0];
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  if (sort !== 'recommended') params.set('sort', sort);
  const suffix = params.size ? `?${params}` : '';
  return `/your-apps${selected.route ? `/${selected.route}` : ''}${suffix}`;
}
