/**
 * Reusable company header HTML block for branded documents.
 * Used across: insurance claims, estimates, storm reports, measurement reports, PDF exports.
 * All CSS is inline for print/PDF compatibility.
 */

export interface CompanyHeaderOptions {
  name: string;
  logoData?: string | null;
  logoMimeType?: string | null;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  licenseNumber?: string;
  certifications?: Array<{ name: string; issuingBody?: string }>;
  compact?: boolean;
  brandPrimaryColor?: string;
  tagline?: string;
}

/**
 * Generate a branded HTML header block with company logo, name, and contact info.
 * Returns empty string if no company name is provided.
 */
export function companyHeaderHTML(opts: CompanyHeaderOptions): string {
  if (!opts.name) return '';

  const brandColor = opts.brandPrimaryColor || '#ea580c';

  const logoHTML = opts.logoData && opts.logoMimeType
    ? `<img src="data:${opts.logoMimeType};base64,${opts.logoData}" alt="${opts.name}" style="max-height:${opts.compact ? '40px' : '60px'};max-width:${opts.compact ? '120px' : '180px'};object-fit:contain;" />`
    : '';

  // Structured contact layout: each on its own line with label
  const contactLines: string[] = [];
  const fontSize = opts.compact ? '11px' : '13px';
  if (opts.phone) contactLines.push(`<div style="font-size:${fontSize};color:#6b7280;margin-top:2px;"><span style="font-weight:600;color:#9ca3af;margin-right:4px;">P</span>${opts.phone}</div>`);
  if (opts.email) contactLines.push(`<div style="font-size:${fontSize};color:#6b7280;margin-top:1px;"><span style="font-weight:600;color:#9ca3af;margin-right:4px;">E</span>${opts.email}</div>`);
  if (opts.website) contactLines.push(`<div style="font-size:${fontSize};color:#6b7280;margin-top:1px;"><span style="font-weight:600;color:#9ca3af;margin-right:4px;">W</span>${opts.website}</div>`);
  const contactBlock = contactLines.join('');

  const addressLine = opts.address
    ? `<div style="font-size:${opts.compact ? '11px' : '13px'};color:#6b7280;margin-top:3px;">${opts.address}</div>`
    : '';

  // License as pill badge
  const licenseLine = opts.licenseNumber
    ? `<div style="display:inline-block;font-size:11px;font-weight:600;color:#6b7280;background:#f3f4f6;padding:2px 10px;border-radius:10px;margin-top:6px;">License #${opts.licenseNumber}</div>`
    : '';

  // Certifications as brand-tinted pills
  const certBadges = !opts.compact && opts.certifications && opts.certifications.length > 0
    ? `<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">${opts.certifications.map(c =>
        `<span style="font-size:10px;background:${brandColor}12;color:${brandColor};padding:3px 10px;border-radius:10px;border:1px solid ${brandColor}30;font-weight:500;">${c.name}</span>`
      ).join('')}</div>`
    : '';

  // Full-width accent bar + header
  const accentBar = `<div style="width:100%;height:8px;background:${brandColor};margin-bottom:0;"></div>`;

  return `
    ${accentBar}
    <div style="display:flex;align-items:center;justify-content:space-between;padding:${opts.compact ? '12px 0' : '16px 0'};border-bottom:4px solid ${brandColor};margin-bottom:${opts.compact ? '16px' : '24px'};">
      <div style="display:flex;align-items:center;gap:${opts.compact ? '10px' : '16px'};">
        ${logoHTML}
        <div>
          <div style="font-size:${opts.compact ? '16px' : '22px'};font-weight:700;color:#111827;letter-spacing:0.3px;">${opts.name}</div>
          ${opts.tagline ? `<div style="font-size:${opts.compact ? '10px' : '12px'};color:#6b7280;font-style:italic;margin-top:1px;">${opts.tagline}</div>` : ''}
          ${contactBlock}
          ${addressLine}
        </div>
      </div>
      <div style="text-align:right;">
        ${licenseLine}
        ${certBadges}
      </div>
    </div>
  `.trim();
}

/**
 * Extract header options from a full CompanyProfile object.
 * Convenience function to bridge the CompanyProfile interface to CompanyHeaderOptions.
 */
export function profileToHeaderOptions(profile: {
  name: string;
  logoData?: string | null;
  logoMimeType?: string | null;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  licenseNumber?: string;
  certifications?: Array<{ name: string; issuingBody?: string }>;
  brandPrimaryColor?: string;
  tagline?: string;
}): CompanyHeaderOptions {
  return {
    name: profile.name,
    logoData: profile.logoData,
    logoMimeType: profile.logoMimeType,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    address: profile.address,
    licenseNumber: profile.licenseNumber,
    certifications: profile.certifications,
    brandPrimaryColor: profile.brandPrimaryColor,
    tagline: profile.tagline,
  };
}

/**
 * Generate a simple text letterhead (for plain-text documents like insurance claim letters).
 * Returns empty string if no company name is provided.
 */
export function companyLetterhead(opts: CompanyHeaderOptions): string {
  if (!opts.name) return '';

  const lines: string[] = [];
  lines.push(opts.name.toUpperCase());
  if (opts.address) lines.push(opts.address);

  const contactParts: string[] = [];
  if (opts.phone) contactParts.push(`Phone: ${opts.phone}`);
  if (opts.email) contactParts.push(`Email: ${opts.email}`);
  if (opts.website) contactParts.push(opts.website);
  if (contactParts.length > 0) lines.push(contactParts.join(' | '));

  if (opts.licenseNumber) lines.push(`License #${opts.licenseNumber}`);

  lines.push('─'.repeat(60));
  lines.push('');

  return lines.join('\n');
}
