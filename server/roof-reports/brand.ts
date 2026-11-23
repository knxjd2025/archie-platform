/**
 * The company's own look for a report: its name, phone, email, website, logo
 * and colours, as the renderers read them. Everything comes from the
 * company's profile (shared/company.ts) that was resolved from its own
 * settings. Nothing here matches on a company's name, email domain or
 * website to decide what to show: a company with nothing entered simply gets
 * the plain look.
 */
import type { CompanyProfile } from '../../shared/company';
import type { CompanyHeaderOptions } from '../lib/roof-reports/company-header-html.js';

export interface ReportBrandColors {
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyLogo: string;
  companyAddress: string;
}

export interface ReportBrand {
  brandColors: ReportBrandColors;
  companyHeader: CompanyHeaderOptions;
  contact: { company: string; phone: string };
}

export function brandFor(profile: CompanyProfile): ReportBrand {
  const address = [profile.address, profile.cityState, profile.zip].filter(Boolean).join(', ');
  return {
    brandColors: {
      brandPrimaryColor: profile.colors.primary,
      brandSecondaryColor: profile.colors.accent,
      companyName: profile.displayName,
      companyPhone: profile.phone,
      companyEmail: profile.email,
      companyWebsite: profile.websiteLabel,
      // The renderers draw it only when it is an http(s) address.
      companyLogo: profile.logoUrl,
      companyAddress: address,
    },
    companyHeader: {
      name: profile.displayName,
      phone: profile.phone || undefined,
      email: profile.email || undefined,
      website: profile.websiteLabel || undefined,
      address: address || undefined,
      brandPrimaryColor: profile.colors.primary,
      tagline: profile.tagline || undefined,
    },
    contact: { company: profile.displayName, phone: profile.phone },
  };
}
