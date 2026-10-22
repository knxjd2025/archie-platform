import { describe, it, expect } from 'vitest';
import { withProfile } from '../../../tenant/context';
import { resolveCompanyProfile } from '../../../../shared/company';
import { TEST_PROFILE } from '../../../__tests__/helpers/tenant';
import {
  brandStyleTag, companyTel, contactLine, credentialMarkers, documentMetaTags, ownersStory, trustStats,
} from '../company-brand';
import { warranty, isCertainTeedCredentialed } from '../certainteed-data';
import { warrantyFor } from '../product-warranty';
import { productByKey } from '../roofing-products';

/** A company that has entered nothing but its name. */
const BARE = resolveCompanyProfile({ id: '11111111-1111-4111-8111-111111111111', name: 'Bare Roofing' });
/** A company that holds a CertainTeed credential. */
const CT = resolveCompanyProfile({
  id: '22222222-2222-4222-8222-222222222222', name: 'Shingle Co',
  settings: { credentials: ['CertainTeed ShingleMaster'], workmanshipYears: 12 },
});

describe('the company on documents comes from its profile', () => {
  it('a company that entered nothing makes no claims', () => {
    withProfile(BARE, () => {
      expect(credentialMarkers()).toEqual([]);
      expect(trustStats()).toEqual([]);
      expect(ownersStory()).toBeNull();
      expect(companyTel()).toBe('');
      expect(contactLine()).toBe('Bare Roofing');
      expect(documentMetaTags('Proposal')).not.toContain('og:image');
    });
  });

  it('a company with a story, claims and contact details shows them', () => {
    withProfile(TEST_PROFILE, () => {
      expect(credentialMarkers()).toEqual(['Acme Credential One', 'Fully insured']);
      expect(trustStats()).toEqual(['4.9★ on Google · 50 reviews']);
      expect(ownersStory()?.paragraphs).toEqual(['Acme started in a garage.']);
      expect(companyTel()).toBe('tel:+15550102030');
      expect(contactLine()).toContain('Acme Test Roofing LLC');
      expect(contactLine()).toContain('Springfield, IL');
      expect(documentMetaTags('Proposal')).toContain('https://acme.test/logo.png');
    });
  });

  it("paints documents in the company's own color", () => {
    withProfile(TEST_PROFILE, () => expect(brandStyleTag()).toContain('--brand:#225588'));
    withProfile(BARE, () => expect(brandStyleTag()).toContain('--brand:#1F3A5F'));
  });
});

describe('warranty claims follow the credential', () => {
  const landmark = productByKey('landmark')!;

  it('the 50-year SureStart PLUS line only for a CertainTeed-credentialed company', () => {
    withProfile(CT, () => {
      expect(isCertainTeedCredentialed()).toBe(true);
      const w = warrantyFor(landmark);
      expect(w.manufacturerYears).toBe(50);
      expect(w.manufacturerLine).toContain('registered by Shingle Co');
      expect(w.workmanshipYears).toBe(12);
      expect(warranty().certificationCopy).toContain('CertainTeed-credentialed');
    });
    withProfile(BARE, () => {
      expect(isCertainTeedCredentialed()).toBe(false);
      const w = warrantyFor(landmark);
      expect(w.manufacturerYears).toBeNull();
      expect(w.workmanshipYears).toBeNull();
      expect(warranty().certificationCopy).not.toMatch(/credentialed/i);
    });
  });

  it('a tune-up is backed by the company doing it, by name', () => {
    withProfile(TEST_PROFILE, () => {
      expect(warrantyFor({ key: 'tune_up', manufacturer: '', name: 'Tune-up', category: 'service' }).manufacturer).toBe('Acme Roofing');
    });
  });

  it('a product with no named maker never prints an abbreviation as its manufacturer', () => {
    withProfile(BARE, () => {
      expect(warrantyFor(productByKey('standing_seam_metal')!).manufacturer).toBe('Metal system manufacturer');
    });
  });
});
