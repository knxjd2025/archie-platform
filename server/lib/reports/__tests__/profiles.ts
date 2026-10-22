/**
 * Company profiles for report tests. Documents read the company from its
 * profile (company-brand.ts), so a test renders inside withProfile(...) to
 * say whose document it is.
 */
import { resolveCompanyProfile } from '../../../../shared/company';
import { TEST_COMPANY_ID } from '../../../__tests__/helpers/tenant';

export { TEST_PROFILE } from '../../../__tests__/helpers/tenant';

/** A company that has entered nothing but its name: no claims, no contact details. */
export const BARE_PROFILE = resolveCompanyProfile({ id: TEST_COMPANY_ID, name: 'Bare Roofing' });

/** A company that holds a CertainTeed credential, with a workmanship warranty and a lender. */
export const CREDENTIALED_PROFILE = resolveCompanyProfile({
  id: TEST_COMPANY_ID,
  slug: 'shingle-co',
  name: 'Shingle Co Roofing',
  trade: 'roofing',
  branding: {
    legalName: 'Shingle Co Roofing LLC', shortName: 'Shingle Co', phone: '(555) 020-3040', email: 'office@shingle.test',
    website: 'https://shingle.test', city: 'Springfield', state: 'IL', primaryColor: '#336699', logoUrl: 'https://shingle.test/logo.png',
  },
  settings: {
    credentials: ['CertainTeed ShingleMaster', 'Fully insured'], trustStats: ['4.8★ on Google · 80 reviews'],
    workmanshipYears: 15, workmanshipWarranty: '15-year workmanship warranty',
    financing: { partner: 'Test Lender', applyUrl: 'https://lender.test/apply' }, financingLine: 'Financing available',
    story: { heading: 'Who we are', paragraphs: ['Shingle Co is a family business.'] },
  },
});

/** The company this code was first written for. None of it may reach another company's document. */
export const FORMER_COMPANY = /Best Roofing|bestroof|Charlotte|Turner|Mallard Creek|\(704\)|C8102E|hfsfinancial/i;
