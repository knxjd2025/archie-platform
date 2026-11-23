/**
 * Unit tests for the HTML report generator
 * Tests: generateComprehensiveReportHTML output structure, CSS properties, sections
 */
import { describe, it, expect } from 'vitest';
import { generateComprehensiveReportHTML } from '../roof-analysis-report-html';
import { makeReport } from './fixtures/report';

describe('generateComprehensiveReportHTML', () => {
  it('returns valid HTML document', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('includes CSS custom properties', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('--brand-primary');
    expect(html).toContain('--brand-secondary');
    expect(html).toContain('--text-primary');
    expect(html).toContain('--severity-critical');
    expect(html).toContain('--shadow-card');
  });

  it('includes animation keyframes', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('@keyframes fadeSlideUp');
    expect(html).toContain('@keyframes drawCircle');
    expect(html).toContain('@keyframes growBar');
  });

  it('includes reduced-motion media query', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('prefers-reduced-motion');
  });

  it('includes print media query', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('@media print');
    expect(html).toContain('.no-print');
    expect(html).toContain('print-color-adjust: exact');
  });

  it('includes responsive media query', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('@media (max-width: 640px)');
    expect(html).toContain('.stat-grid');
    expect(html).toContain('.photo-grid');
  });

  it('includes print button', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('Print Report');
    expect(html).toContain('window.print()');
  });

  it('includes report title from property address', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('12 Elm Street');
    expect(html).toContain('Cedar Falls');
  });

  it('includes storm history section', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('Storm History');
    expect(html).toContain('Hail Events');
    expect(html).toContain('Wind Events');
  });

  it('includes condition score ring with animation class', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('score-ring');
    expect(html).toContain('score-arc');
  });

  it('includes damage analysis section', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('Damage Analysis');
    expect(html).toContain('Photos Analyzed');
  });

  it('includes repair estimate section', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('Repair Estimate');
    expect(html).toContain('Hail Damage Repair');
  });

  it('includes executive summary when provided', () => {
    const html = generateComprehensiveReportHTML(makeReport({
      executiveSummary: 'This roof has moderate storm damage.',
    }));
    expect(html).toContain('Executive Summary');
    expect(html).toContain('moderate storm damage');
  });

  it('omits executive summary when not provided', () => {
    const html = generateComprehensiveReportHTML(makeReport({ executiveSummary: undefined }));
    // Should not have executive summary heading if no text
    expect(html).not.toContain('Executive Summary');
  });

  it('uses brand colors from config', () => {
    const html = generateComprehensiveReportHTML(makeReport(), {
      brandPrimaryColor: '#ff5500',
      brandSecondaryColor: '#0055ff',
      companyName: 'Acme Roofing',
    });
    expect(html).toContain('#ff5500');
    expect(html).toContain('#0055ff');
    expect(html).toContain('Acme Roofing');
  });

  it('escapes HTML in property address', () => {
    const html = generateComprehensiveReportHTML(makeReport({
      property: {
        address: '123 <script>alert("xss")</script> St',
        city: 'Cedar Falls',
        state: 'IA',
        latitude: 35.12,
        longitude: -80.84,
      },
    }));
    // The raw XSS payload must not appear; escaped form must be present.
    // Note: the report legitimately contains <script> tags for GSAP motion runtime.
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes HTML in user-controlled damage labels (photo card + overlay)', () => {
    const xss = '<script>alert(1)</script>';
    const html = generateComprehensiveReportHTML(makeReport({
      damageAnalysis: {
        totalPhotosAnalyzed: 1,
        photosWithDamage: 1,
        overallSeverity: 'high',
        damageTypes: [{ type: 'hail_impact', count: 1, severity: 'high' }],
        photos: [
          {
            id: 'photo-xss',
            url: 'https://example.com/photo.jpg',
            overallSeverity: 'high',
            aiSummary: 'Damage found.',
            damages: [
              {
                id: 'dmg-1',
                type: 'hail_impact',
                label: xss,
                severity: 'high',
                confidence: 90,
                boundingBox: { x: 10, y: 10, width: 20, height: 20 },
              } as any,
            ],
          } as any,
        ],
        aiSummary: 'Damage detected.',
      } as any,
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML in company credential names', () => {
    const xss = '<script>alert(2)</script>';
    const html = generateComprehensiveReportHTML(makeReport(), {
      companyName: 'Acme Roofing',
      certifications: [{ name: xss, issuer: 'Example Issuer' }],
    } as any);
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });

  it('escapes HTML in repair estimate line-item name and notes', () => {
    const xss = '<script>alert(1)</script>';
    const html = generateComprehensiveReportHTML(makeReport({
      repairEstimate: {
        lineItems: [
          {
            repairTypeId: 'hail_repair',
            repairName: xss,
            quantity: 4,
            unit: 'each',
            baseCostPerUnit: 85,
            finalCostPerUnit: 85,
            totalBaseCost: 340,
            totalFinalCost: 340,
          },
        ],
        subtotal: 340,
        multiplierApplied: 1,
        total: 340,
        notes: [xss],
      },
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML in AI roof-age indicators', () => {
    const xss = '<script>alert(1)</script>';
    const html = generateComprehensiveReportHTML(makeReport({
      damageAnalysis: {
        totalPhotosAnalyzed: 1,
        photosWithDamage: 1,
        overallSeverity: 'medium',
        roofAge: {
          estimatedAgeYears: 12,
          expectedLifespanYears: 25,
          remainingLifeYears: 13,
          confidence: 'medium',
          indicators: [xss],
          roofMaterial: 'asphalt_shingle',
          materialCondition: 'fair',
        },
        damageTypes: [],
        photos: [],
        aiSummary: 'Damage detected.',
      } as any,
    }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders ordinary repair-item and indicator text without entity noise', () => {
    const html = generateComprehensiveReportHTML(makeReport({
      damageAnalysis: {
        totalPhotosAnalyzed: 1,
        photosWithDamage: 1,
        overallSeverity: 'medium',
        roofAge: {
          estimatedAgeYears: 12,
          expectedLifespanYears: 25,
          remainingLifeYears: 13,
          confidence: 'medium',
          indicators: ['Granule loss'],
          roofMaterial: 'asphalt_shingle',
          materialCondition: 'fair',
        },
        damageTypes: [],
        photos: [],
        aiSummary: 'Damage detected.',
      } as any,
    }));
    expect(html).toContain('Hail Damage Repair');
    expect(html).toContain('Granule loss');
    expect(html).not.toContain('&lt;');
  });

  it('includes data sources in footer', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('Groq Vision');
    expect(html).toContain('NOAA');
  });

  it('includes stat-card class for interactive hover', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('stat-card');
  });

  it('includes report-section class for staggered animations', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('report-section');
  });

  it('includes timeline-bar class for animated storm bars', () => {
    const html = generateComprehensiveReportHTML(makeReport());
    expect(html).toContain('timeline-bar');
  });
});
