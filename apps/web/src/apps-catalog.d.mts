export type AppCategoryId =
  | 'for-you'
  | 'audio-narration'
  | 'communication'
  | 'graphic-design'
  | 'photo-editing'
  | 'text-styling'
  | 'ai-generation'
  | 'file-data-management'
  | 'project-management'
  | 'marketing'
  | 'video-animation'
  | 'all-apps';

export interface AppCategory {
  readonly id: AppCategoryId;
  readonly label: string;
  readonly route: string;
}

export interface CatalogApp {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: Exclude<AppCategoryId, 'for-you' | 'all-apps'>;
  readonly provider: string;
  readonly capabilities: readonly string[];
  readonly featured: boolean;
  readonly tags: readonly string[];
  readonly recommendation: { readonly rank: number; readonly reason: string };
  readonly source: 'audit-example';
  readonly catalogStatus: 'demo-only';
  readonly integrationStatus: 'not-connected';
}

/** Strongly typed card/catalog contract used by the Apps marketplace. */
export type MarketplaceApp = CatalogApp;

export interface AppsRouteState {
  readonly category: AppCategoryId;
  readonly query: string;
  readonly sort: 'recommended' | 'name';
}

export const APP_CATEGORIES: readonly AppCategory[];
export const AUDITED_APP_CATEGORIES: readonly AppCategory[];
export const DEMO_APPS: readonly CatalogApp[];
export const MARKETPLACE_APP_CATALOG: readonly CatalogApp[];
export const APPS_AUDIT_COVERAGE: Readonly<{
  observedCategoryRoutes: number;
  listedCardOccurrences: number;
  normalizedLabels: number;
  fullScrollInventories: number;
  allAppsViewportNames: number;
  uniqueIdentityResolved: boolean;
}>;
export function normalizeCategory(value: unknown): AppCategoryId;
export function filterApps(
  apps: readonly CatalogApp[],
  options?: { category?: AppCategoryId | string; query?: string; sort?: 'recommended' | 'name' },
): CatalogApp[];
export function parseAppsRoute(input: string | URL): AppsRouteState;
export function buildAppsRoute(state?: { category?: AppCategoryId | string; query?: string; sort?: 'recommended' | 'name' }): string;
