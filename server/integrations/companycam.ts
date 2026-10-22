/**
 * CompanyCam Integration
 * API Docs: https://docs.companycam.com
 * Provides access to projects, photos, tags, users, and company data
 */

import { fetchWithTimeout } from '../lib/fetch-timeout';

const BASE_URL = 'https://api.companycam.com/v2';

/** One spelling for the street-type words people abbreviate inconsistently. */
const STREET_WORDS: Record<string, string> = {
  street: 'st', avenue: 'ave', av: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct',
  boulevard: 'blvd', circle: 'cir', place: 'pl', parkway: 'pkwy', highway: 'hwy', terrace: 'ter',
  trail: 'trl', way: 'way', square: 'sq', north: 'n', south: 's', east: 'e', west: 'w',
};

/** "550 Manning Drive." and "550 manning dr" are the same street. */
export function normalizeStreet(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(' ');
}

const normalizeCity = (raw: unknown) => String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
const zip5 = (raw: unknown) => (/\b(\d{5})(?:-\d{4})?\b/.exec(String(raw ?? '')) || [])[1] || '';

export interface AddressTarget {
  street: string;
  city?: string | null;
  postalCode?: string | null;
}

/**
 * The parts of "550 Manning Dr, Charlotte, NC 28209, USA" a match needs, with
 * the lead's own city/zip columns preferred over what is parsed from the string.
 */
export function addressTarget(address: string, hints: { city?: string | null; postalCode?: string | null } = {}): AddressTarget {
  const parts = String(address || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    street: parts[0] || '',
    city: hints.city || parts[1] || null,
    postalCode: zip5(hints.postalCode) || zip5(parts.slice(1).join(' ')) || null,
  };
}

/**
 * Whether a CompanyCam project is at this address.
 *
 * This used to accept a substring match either way on the street or the
 * project name, so "12 Oak St" matched "112 Oak St" and "12 Oak Street Apt 4"
 * in another town, and a job's photos were pushed into a different
 * customer's project. Now the street must be equal once normalised, and the
 * city or the zip must agree too.
 */
export function projectMatchesAddress(
  project: { address?: { street_address_1?: string; city?: string; postal_code?: string } | null },
  target: AddressTarget,
): boolean {
  const street = normalizeStreet(target.street);
  if (!street || normalizeStreet(project.address?.street_address_1) !== street) return false;
  const city = normalizeCity(target.city);
  const zip = zip5(target.postalCode);
  const cityMatch = !!city && normalizeCity(project.address?.city) === city;
  const zipMatch = !!zip && zip5(project.address?.postal_code) === zip;
  return cityMatch || zipMatch;
}

interface CompanyCamProject {
  id: string;
  name: string;
  address: { street_address_1?: string; city?: string; state?: string; postal_code?: string };
  status: string;
  created_at: number;
  updated_at: number;
  photos_count?: number;
  project_url?: string;
}

interface CompanyCamPhoto {
  id: string;
  uri: string[];
  urls?: { original?: string; web?: string; thumbnail?: string };
  created_at: number;
  creator?: { id: string; display_name: string };
  tags?: Array<{ id: string; display_value: string }>;
  project?: { id: string; name: string };
  coordinates?: { lat: number; lon: number };
}

interface CompanyCamUser {
  id: string;
  display_name: string;
  email_address: string;
  role: string;
  status: string;
}

export class CompanyCamClient {
  private apiToken: string;

  constructor(apiToken?: string) {
    this.apiToken = apiToken || process.env.COMPANYCAM_API_TOKEN || '';
  }

  private async request<T>(method: string, path: string, body?: any, params?: Record<string, string>): Promise<T> {
    if (!this.apiToken) throw new Error('CompanyCam API token not configured');

    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const response = await fetchWithTimeout(url.toString(), {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      ...(body && { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`CompanyCam API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  // ==================== COMPANY ====================

  async getCompany() {
    return this.request<any>('GET', '/company');
  }

  // ==================== PROJECTS ====================

  async getProjects(options: { page?: number; per_page?: number; status?: string; query?: string } = {}): Promise<CompanyCamProject[]> {
    const params: Record<string, string> = {};
    if (options.page) params.page = String(options.page);
    if (options.per_page) params.per_page = String(options.per_page || 50);
    if (options.status) params.status = options.status;
    if (options.query) params.query = options.query;
    return this.request<CompanyCamProject[]>('GET', '/projects', undefined, params);
  }

  async getProject(projectId: string): Promise<CompanyCamProject> {
    return this.request<CompanyCamProject>('GET', `/projects/${projectId}`);
  }

  async createProject(data: { name: string; address?: { street_address_1?: string; city?: string; state?: string; postal_code?: string } }): Promise<CompanyCamProject> {
    return this.request<CompanyCamProject>('POST', '/projects', data);
  }

  async updateProject(projectId: string, data: { name?: string; status?: string }): Promise<CompanyCamProject> {
    return this.request<CompanyCamProject>('PUT', `/projects/${projectId}`, data);
  }

  // ==================== PHOTOS ====================

  async getProjectPhotos(projectId: string, options: { page?: number; per_page?: number } = {}): Promise<CompanyCamPhoto[]> {
    const params: Record<string, string> = {};
    if (options.page) params.page = String(options.page);
    if (options.per_page) params.per_page = String(options.per_page || 50);
    return this.request<CompanyCamPhoto[]>('GET', `/projects/${projectId}/photos`, undefined, params);
  }

  async getPhoto(photoId: string): Promise<CompanyCamPhoto> {
    return this.request<CompanyCamPhoto>('GET', `/photos/${photoId}`);
  }

  /**
   * Add a photo to a project. CompanyCam pulls the image from a PUBLICLY
   * reachable `uri` (verified: JobTread's signed CDN links work), so app/JobTread
   * photos can be pushed across without re-uploading bytes.
   * POST /v2/projects/{id}/photos → 201
   */
  async addPhotoToProject(
    projectId: string,
    photo: { uri: string; capturedAt?: Date | number; tags?: string[] },
  ): Promise<{ id?: string }> {
    const captured = photo.capturedAt instanceof Date
      ? Math.floor(photo.capturedAt.getTime() / 1000)
      : typeof photo.capturedAt === 'number' ? photo.capturedAt : Math.floor(Date.now() / 1000);
    return this.request<any>('POST', `/projects/${projectId}/photos`, {
      photo: {
        uri: photo.uri,
        captured_at: captured,
        ...(photo.tags?.length ? { tags: photo.tags } : {}),
      },
    });
  }

  /**
   * Match a street address to an existing CompanyCam project — same street
   * once normalised, plus the same city or zip (see projectMatchesAddress).
   * "550 Manning Dr, Charlotte, NC 28209, USA" still matches a project stored
   * as "550 Manning Drive", Charlotte.
   */
  async findProjectByAddress(
    address: string,
    hints: { city?: string | null; postalCode?: string | null } = {},
  ): Promise<CompanyCamProject | null> {
    const target = addressTarget(address, hints);
    if (!target.street) return null;

    try {
      const projects = await this.getProjects({ query: target.street, per_page: 25 });
      return projects.find((p) => projectMatchesAddress(p, target)) || null;
    } catch {
      return null;
    }
  }

  async getPhotos(options: { page?: number; per_page?: number } = {}): Promise<CompanyCamPhoto[]> {
    const params: Record<string, string> = {};
    if (options.page) params.page = String(options.page);
    if (options.per_page) params.per_page = String(options.per_page || 50);
    return this.request<CompanyCamPhoto[]>('GET', '/photos', undefined, params);
  }

  // ==================== TAGS ====================

  async getTags(): Promise<Array<{ id: string; display_value: string }>> {
    return this.request<any[]>('GET', '/tags');
  }

  async addTagsToPhoto(photoId: string, tags: string[]): Promise<any> {
    return this.request<any>('POST', `/photos/${photoId}/tags`, tags.map(t => ({ display_value: t })));
  }

  // ==================== USERS ====================

  async getUsers(): Promise<CompanyCamUser[]> {
    return this.request<CompanyCamUser[]>('GET', '/users');
  }

  async getCurrentUser(): Promise<CompanyCamUser> {
    return this.request<CompanyCamUser>('GET', '/users/current');
  }

  // ==================== COMMENTS ====================

  async getProjectComments(projectId: string): Promise<any[]> {
    return this.request<any[]>('GET', `/projects/${projectId}/comments`);
  }

  async addProjectComment(projectId: string, content: string): Promise<any> {
    return this.request<any>('POST', `/projects/${projectId}/comments`, { content });
  }

  // ==================== DOCUMENTS ====================

  async getProjectDocuments(projectId: string): Promise<any[]> {
    return this.request<any[]>('GET', `/projects/${projectId}/documents`);
  }

  // ==================== LABELS ====================

  async getProjectLabels(projectId: string): Promise<any[]> {
    return this.request<any[]>('GET', `/projects/${projectId}/labels`);
  }

  // ==================== HEALTH CHECK ====================

  async healthCheck(): Promise<{ ok: boolean; company?: string; error?: string }> {
    try {
      const company = await this.getCompany();
      return { ok: true, company: company.name || company.id };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  }
}

export function getCompanyCamClient(): CompanyCamClient {
  return new CompanyCamClient();
}
