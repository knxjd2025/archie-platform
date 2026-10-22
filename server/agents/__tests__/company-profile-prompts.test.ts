/**
 * Advisor prompts, the knowledge base seed and the drafting prompts are built
 * from the current company's profile. They must name that company, state only
 * what it entered, and carry nothing from any other company.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { withProfile, NEUTRAL_PROFILE } from '../../tenant/context';
import { TEST_PROFILE } from '../../__tests__/helpers/tenant';
import { resolveCompanyProfile, type CompanyProfile } from '../../../shared/company';
import { buildArchieForRole } from '../archie-agent';
import { SalesManagerAgent } from '../team-agents';
import { TEAM_ADVISORS } from '../team-advisors';
import { companyBrief, referenceIsHomeState } from '../advisor-knowledge';
import { serviceAreaMatch } from '../cmo-agent';
import { siteFromWebsite, toSiteUrl, isPrivateAddress, rankUrls } from '../website-tools';
import { knowledgeSeed } from '../../rag/seed-knowledge';
import { voiceSystem } from '../../ai/assist-service';
import { defaultAgents } from '../../seed';
import { REFINE_SYSTEM } from '../../reports/refine';

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY ||= 'test-key';
  process.env.FAL_AI_API_KEY ||= 'test-key';
});

/** Strings from the company this app was copied from; no prompt may carry them. */
const FOREIGN = ['Best Roofing', 'bestroofingnow', 'Turner', 'Charlotte'];
const expectClean = (text: string) => {
  for (const f of FOREIGN) expect(text, f).not.toContain(f);
};

const prompt = (agent: unknown): string => (agent as { getSystemPrompt(): string }).getSystemPrompt();
const EMPTY = resolveCompanyProfile({ id: '11111111-1111-4111-8111-111111111111', name: 'Bare Co' });
const NC: CompanyProfile = { ...TEST_PROFILE, state: 'NC', cityState: 'Springfield, NC' };

describe("Archie's system prompt", () => {
  it("names the current company and carries none of another company's identity", () => {
    const text = withProfile(TEST_PROFILE, () => prompt(buildArchieForRole('admin')));
    expect(text).toContain('Acme Roofing');
    expect(text).toContain('Springfield and nearby towns');
    expect(text).toContain('10-year workmanship warranty');
    expectClean(text);
  });

  it('labels the NC reference as North Carolina only for a company elsewhere', () => {
    const text = withProfile(TEST_PROFILE, () => prompt(buildArchieForRole('admin')));
    expect(text).toMatch(/North Carolina jobs only/);
    expect(text).not.toContain('NORTH CAROLINA ROOFING');
  });

  it("presents the NC reference as the company's own rules for an NC company", () => {
    expect(referenceIsHomeState(NC)).toBe(true);
    const text = withProfile(NC, () => prompt(buildArchieForRole('admin')));
    expect(text).toContain('NORTH CAROLINA ROOFING');
  });

  it('follows a profile edit without rebuilding anything', () => {
    const agent = withProfile(TEST_PROFILE, () => buildArchieForRole('admin'));
    const renamed = { ...TEST_PROFILE, displayName: 'Zenith Exteriors', legalName: 'Zenith Exteriors LLC' };
    expect(withProfile(renamed, () => prompt(agent))).toContain('Zenith Exteriors');
  });
});

describe('team and exec advisors', () => {
  it('stores prompts that name no company', () => {
    for (const def of [...TEAM_ADVISORS, ...defaultAgents]) {
      expectClean(`${def.persona}\n${def.systemPrompt}`);
    }
  });

  it("adds the current company's name and brief when a chat starts", () => {
    const def = TEAM_ADVISORS.find((d) => d.role === 'sales_manager')!;
    const agent = new SalesManagerAgent({ id: 1, name: def.name, role: def.role, title: def.title, persona: def.persona, systemPrompt: def.systemPrompt });
    const text = withProfile(TEST_PROFILE, () => prompt(agent));
    expect(text).toContain('Acme Test Roofing LLC');
    expect(text).toContain('Springfield, IL');
    expectClean(text);
  });
});

describe('companyBrief', () => {
  it('lists only what the company entered', () => {
    const brief = companyBrief(EMPTY);
    expect(brief).toContain('Bare Co');
    expect(brief).not.toMatch(/warranty:|Certifications:|Service area:|since \d{4}/i);
    expect(brief).toMatch(/do not state it/);
  });

  it('is neutral with no company at all', () => {
    expect(companyBrief(NEUTRAL_PROFILE)).toContain('Your Company');
  });
});

describe('knowledge base seed', () => {
  it("writes the company's documents from its profile", () => {
    const docs = knowledgeSeed(TEST_PROFILE);
    const all = docs.map((d) => `${d.title}\n${d.content}`).join('\n');
    expect(all).toContain('Acme Roofing');
    expect(all).toContain('(555) 010-2030');
    expect(all).toContain('Springfield and nearby towns');
    expectClean(all);
  });

  it('claims nothing for a company that has entered nothing', () => {
    const all = knowledgeSeed(EMPTY).map((d) => d.content).join('\n');
    expectClean(all);
    expect(all).toMatch(/has not described its service area/);
    expect(all).toMatch(/has not entered its workmanship warranty/);
    expect(all).not.toMatch(/\d+-year workmanship/);
  });

  it('adds trade knowledge only for the trade it is about', () => {
    const titles = (p: CompanyProfile) => knowledgeSeed(p).map((d) => d.title);
    expect(titles(TEST_PROFILE)).toContain('Roofing Materials Guide');
    expect(titles({ ...TEST_PROFILE, trade: 'hvac' })).not.toContain('Roofing Materials Guide');
  });
});

describe('drafting prompts', () => {
  it("speak in the current company's name", () => {
    const text = withProfile(TEST_PROFILE, () => voiceSystem());
    expect(text).toContain('Acme Roofing');
    expectClean(text);
    expectClean(REFINE_SYSTEM);
  });
});

describe('serviceAreaMatch', () => {
  const co = { city: 'Springfield', zip: '62701', serviceArea: 'Springfield, Chatham and Rochester' };

  it('matches the company city, a town named in its area, or its ZIP region', () => {
    expect(serviceAreaMatch({ city: 'Springfield' }, co)).toBe('in');
    expect(serviceAreaMatch({ city: 'chatham' }, co)).toBe('in');
    expect(serviceAreaMatch({ zip: '62704' }, co)).toBe('in');
  });

  it('rules a lead out only when the company said where it works', () => {
    expect(serviceAreaMatch({ city: 'Denver', zip: '80202' }, co)).toBe('out');
    expect(serviceAreaMatch({ city: 'Denver' }, { city: 'Springfield', zip: '', serviceArea: '' })).toBe('unknown');
    expect(serviceAreaMatch({ city: 'Denver' }, { city: '', zip: '', serviceArea: '' })).toBe('unknown');
    expect(serviceAreaMatch({}, co)).toBe('unknown');
  });
});

describe('company website tools', () => {
  it("lock reads to the company's own site", () => {
    const site = siteFromWebsite('https://www.acme-roofing.com/home')!;
    expect(site.origin).toBe('https://www.acme-roofing.com');
    expect(toSiteUrl('/faq', site)).toBe('https://www.acme-roofing.com/faq');
    expect(toSiteUrl('acme-roofing.com/about', site)).toBe('https://www.acme-roofing.com/about');
    expect(toSiteUrl('https://evil.example.org/x', site)).toBeNull();
    expect(toSiteUrl('/faq', null)).toBeNull();
  });

  it('refuse a website that is not a public https address', () => {
    for (const w of ['', 'http://localhost/x', 'https://127.0.0.1', 'https://10.0.0.5', 'https://[::1]', 'https://intranet', 'https://site.internal', 'https://acme.test', 'https://acme.com:8443']) {
      expect(siteFromWebsite(w), w).toBeNull();
    }
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
  });

  it("ignores the company's own town when ranking pages", () => {
    const urls = ['https://acme-roofing.com/springfield-metal-roofing', 'https://acme-roofing.com/springfield-gutters'];
    expect(rankUrls(urls, 'springfield gutters', 8, ['springfield'])).toEqual(['https://acme-roofing.com/springfield-gutters']);
  });
});
