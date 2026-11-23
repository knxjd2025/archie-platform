/**
 * Unit tests for report editor utility functions
 * Tests: sortFindingsBySeverity, duplicateFinding, getWordCount, severityRank,
 *        FINDING_TEMPLATES, createFindingFromTemplate, getConditionBadge
 */
import { describe, it, expect } from 'vitest';
import {
  sortFindingsBySeverity,
  duplicateFinding,
  calculateFindingDelta,
  getWordCount,
  SEVERITY_RANK,
  FINDING_TEMPLATES,
  createFindingFromTemplate,
  getConditionBadge,
  getFindingStats,
  filterFindingsBySeverity,
  getInsuranceRelevantCount,
  getReportCompleteness,
  getNarrativeCharCount,
  getReportAtAGlance,
  createUndoStack,
  REWRITE_TONE_PRESETS,
  getRepairPrioritySummary,
  formatReportExportFilename,
  formatReportId,
} from '../report-editor-utils';
import type { NarrativeFinding, FindingSeverity } from '../comprehensive-roof-report';

function makeFinding(overrides: Partial<NarrativeFinding> = {}): NarrativeFinding {
  return {
    id: `finding-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'Test Finding',
    severity: 'moderate',
    narrative: 'Test narrative text.',
    relatedPhotoIds: [],
    repairAction: 'Test repair action',
    insuranceRelevant: false,
    ...overrides,
  };
}

// ─── SEVERITY_RANK ───────────────────────────────────────────────────────────

describe('SEVERITY_RANK', () => {
  it('should rank critical as highest (0)', () => {
    expect(SEVERITY_RANK.critical).toBe(0);
  });

  it('should rank cosmetic as lowest (5)', () => {
    expect(SEVERITY_RANK.cosmetic).toBe(5);
  });

  it('should have all 6 severity levels', () => {
    const severities: FindingSeverity[] = ['critical', 'high', 'moderate', 'minor', 'advisory', 'cosmetic'];
    for (const sev of severities) {
      expect(SEVERITY_RANK[sev]).toBeDefined();
    }
  });

  it('should be in strict descending severity order', () => {
    expect(SEVERITY_RANK.critical).toBeLessThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.moderate);
    expect(SEVERITY_RANK.moderate).toBeLessThan(SEVERITY_RANK.minor);
    expect(SEVERITY_RANK.minor).toBeLessThan(SEVERITY_RANK.advisory);
    expect(SEVERITY_RANK.advisory).toBeLessThan(SEVERITY_RANK.cosmetic);
  });
});

// ─── sortFindingsBySeverity ──────────────────────────────────────────────────

describe('sortFindingsBySeverity', () => {
  it('should sort findings from critical to cosmetic', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'minor' }),
      makeFinding({ id: 'f2', severity: 'critical' }),
      makeFinding({ id: 'f3', severity: 'moderate' }),
    ];

    const sorted = sortFindingsBySeverity(findings);

    expect(sorted[0].id).toBe('f2'); // critical
    expect(sorted[1].id).toBe('f3'); // moderate
    expect(sorted[2].id).toBe('f1'); // minor
  });

  it('should not mutate the original array', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'minor' }),
      makeFinding({ id: 'f2', severity: 'critical' }),
    ];
    const original = [...findings];

    sortFindingsBySeverity(findings);

    expect(findings[0].id).toBe(original[0].id);
    expect(findings[1].id).toBe(original[1].id);
  });

  it('should handle empty array', () => {
    expect(sortFindingsBySeverity([])).toEqual([]);
  });

  it('should sort unknown severity to the end', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'unknown_sev' as FindingSeverity }),
      makeFinding({ id: 'f2', severity: 'critical' }),
    ];
    const sorted = sortFindingsBySeverity(findings);
    expect(sorted[0].id).toBe('f2'); // critical first
    expect(sorted[1].id).toBe('f1'); // unknown goes to end
  });

  it('should preserve order for same severity', () => {
    const findings = [
      makeFinding({ id: 'f1', severity: 'high', title: 'First High' }),
      makeFinding({ id: 'f2', severity: 'high', title: 'Second High' }),
    ];

    const sorted = sortFindingsBySeverity(findings);

    expect(sorted[0].id).toBe('f1');
    expect(sorted[1].id).toBe('f2');
  });
});

// ─── duplicateFinding ────────────────────────────────────────────────────────

describe('duplicateFinding', () => {
  it('should create a copy with a new id', () => {
    const original = makeFinding({ id: 'original-id', title: 'Wind Damage' });

    const copy = duplicateFinding(original);

    expect(copy.id).not.toBe(original.id);
    expect(copy.title).toBe('Wind Damage (Copy)');
    expect(copy.severity).toBe(original.severity);
    expect(copy.narrative).toBe(original.narrative);
    expect(copy.repairAction).toBe(original.repairAction);
    expect(copy.insuranceRelevant).toBe(original.insuranceRelevant);
  });

  it('should create a fresh relatedPhotoIds array', () => {
    const original = makeFinding({ relatedPhotoIds: ['photo-1', 'photo-2'] });

    const copy = duplicateFinding(original);

    expect(copy.relatedPhotoIds).toEqual(['photo-1', 'photo-2']);
    expect(copy.relatedPhotoIds).not.toBe(original.relatedPhotoIds);
  });

  it('should not mutate the original finding', () => {
    const original = makeFinding({ title: 'Hail Impact' });
    const originalTitle = original.title;

    duplicateFinding(original);

    expect(original.title).toBe(originalTitle);
  });

  it('should generate unique ids for multiple duplicates', () => {
    const original = makeFinding();

    const copy1 = duplicateFinding(original);
    const copy2 = duplicateFinding(original);

    expect(copy1.id).not.toBe(copy2.id);
  });

  it('numbers a copy of an existing "(Copy)" as "(Copy 2)" instead of stacking', () => {
    const original = makeFinding({ title: 'Wind Damage (Copy)' });

    expect(duplicateFinding(original).title).toBe('Wind Damage (Copy 2)');
  });

  it('increments an existing numbered copy "(Copy 2)" to "(Copy 3)"', () => {
    const original = makeFinding({ title: 'Wind Damage (Copy 2)' });

    expect(duplicateFinding(original).title).toBe('Wind Damage (Copy 3)');
  });

  it('does not treat a title that merely contains "Copy" as a copy suffix', () => {
    const original = makeFinding({ title: 'Copper Flashing' });

    expect(duplicateFinding(original).title).toBe('Copper Flashing (Copy)');
  });
});

// ─── calculateFindingDelta ───────────────────────────────────────────────────

describe('calculateFindingDelta', () => {
  it('returns an empty array when nothing changed', () => {
    const f = makeFinding();

    expect(calculateFindingDelta(f, { ...f })).toEqual([]);
  });

  it('detects a single changed scalar field', () => {
    const f = makeFinding({ narrative: 'old text' });

    expect(calculateFindingDelta(f, { ...f, narrative: 'new text' })).toEqual(['narrative']);
  });

  it('lists multiple changed fields in field order', () => {
    const f = makeFinding({ title: 'A', severity: 'minor' });

    expect(calculateFindingDelta(f, { ...f, title: 'B', severity: 'critical' })).toEqual([
      'title',
      'severity',
    ]);
  });

  it('ignores id changes (identity, not content)', () => {
    const f = makeFinding();

    expect(calculateFindingDelta(f, { ...f, id: 'a-different-id' })).toEqual([]);
  });

  it('detects relatedPhotoIds content changes but ignores array identity', () => {
    const f = makeFinding({ relatedPhotoIds: ['a', 'b'] });

    // Same contents in a brand-new array → no change.
    expect(calculateFindingDelta(f, { ...f, relatedPhotoIds: ['a', 'b'] })).toEqual([]);
    // Different contents → change.
    expect(calculateFindingDelta(f, { ...f, relatedPhotoIds: ['a', 'c'] })).toEqual([
      'relatedPhotoIds',
    ]);
  });
});

// ─── getWordCount ────────────────────────────────────────────────────────────

describe('getWordCount', () => {
  it('should count words in a simple sentence', () => {
    expect(getWordCount('The roof has damage')).toBe(4);
  });

  it('should return 0 for empty string', () => {
    expect(getWordCount('')).toBe(0);
  });

  it('should return 0 for whitespace-only string', () => {
    expect(getWordCount('   ')).toBe(0);
  });

  it('should return 0 for undefined/null', () => {
    expect(getWordCount(undefined)).toBe(0);
    expect(getWordCount(null as unknown as string)).toBe(0);
  });

  it('should handle multiple spaces between words', () => {
    expect(getWordCount('word   one   two')).toBe(3);
  });

  it('should handle newlines and tabs', () => {
    expect(getWordCount('first line\nsecond line\tthird')).toBe(5);
  });
});

// ─── FINDING_TEMPLATES ───────────────────────────────────────────────────────

describe('FINDING_TEMPLATES', () => {
  it('should contain at least 5 common roofing damage templates', () => {
    expect(FINDING_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it('should have required fields on every template', () => {
    for (const tpl of FINDING_TEMPLATES) {
      expect(tpl.title).toBeTruthy();
      expect(tpl.severity).toBeTruthy();
      expect(tpl.narrative).toBeTruthy();
      expect(tpl.repairAction).toBeTruthy();
      expect(typeof tpl.insuranceRelevant).toBe('boolean');
    }
  });

  it('should use valid severity values', () => {
    const validSeverities = Object.keys(SEVERITY_RANK);
    for (const tpl of FINDING_TEMPLATES) {
      expect(validSeverities).toContain(tpl.severity);
    }
  });

  it('should have unique titles', () => {
    const titles = FINDING_TEMPLATES.map(t => t.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

// ─── createFindingFromTemplate ───────────────────────────────────────────────

describe('createFindingFromTemplate', () => {
  it('should create a finding with a unique ID', () => {
    const tpl = FINDING_TEMPLATES[0];
    const finding = createFindingFromTemplate(tpl);

    expect(finding.id).toMatch(/^finding-/);
    expect(finding.title).toBe(tpl.title);
    expect(finding.severity).toBe(tpl.severity);
    expect(finding.narrative).toBe(tpl.narrative);
    expect(finding.repairAction).toBe(tpl.repairAction);
    expect(finding.insuranceRelevant).toBe(tpl.insuranceRelevant);
    expect(finding.relatedPhotoIds).toEqual([]);
  });

  it('should generate unique IDs for repeated calls', () => {
    const tpl = FINDING_TEMPLATES[0];
    const f1 = createFindingFromTemplate(tpl);
    const f2 = createFindingFromTemplate(tpl);
    expect(f1.id).not.toBe(f2.id);
  });
});

// ─── getConditionBadge ───────────────────────────────────────────────────────

describe('getConditionBadge', () => {
  it('should return red badge for critical severity', () => {
    const badge = getConditionBadge('critical');
    expect(badge.label).toBe('Critical');
    expect(badge.color).toBe('#ef4444');
    expect(badge.score).toBeLessThanOrEqual(25);
  });

  it('should return orange badge for high severity', () => {
    const badge = getConditionBadge('high');
    expect(badge.label).toBe('Poor');
    expect(badge.color).toBe('#f97316');
  });

  it('should return yellow badge for medium severity', () => {
    const badge = getConditionBadge('medium');
    expect(badge.label).toBe('Fair');
    expect(badge.color).toBe('#eab308');
  });

  it('should return green badge for low or none severity', () => {
    const badgeLow = getConditionBadge('low');
    expect(badgeLow.label).toBe('Good');
    expect(badgeLow.color).toBe('#22c55e');

    const badgeNone = getConditionBadge('none');
    expect(badgeNone.label).toBe('Excellent');
    expect(badgeNone.color).toBe('#10b981');
    expect(badgeNone.score).toBe(100);
  });

  it('should return a score between 0 and 100', () => {
    for (const sev of ['none', 'low', 'medium', 'high', 'critical']) {
      const badge = getConditionBadge(sev);
      expect(badge.score).toBeGreaterThanOrEqual(0);
      expect(badge.score).toBeLessThanOrEqual(100);
    }
  });

  it('should handle unknown severity gracefully', () => {
    const badge = getConditionBadge('unknown');
    expect(badge.label).toBeTruthy();
    expect(badge.color).toBeTruthy();
  });
});

// ─── getFindingStats ─────────────────────────────────────────────────────────

describe('getFindingStats', () => {
  it('should count findings by severity', () => {
    const findings = [
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'critical' }),
      makeFinding({ severity: 'high' }),
      makeFinding({ severity: 'minor' }),
    ];

    const stats = getFindingStats(findings);

    expect(stats.critical).toBe(2);
    expect(stats.high).toBe(1);
    expect(stats.moderate).toBe(0);
    expect(stats.minor).toBe(1);
    expect(stats.advisory).toBe(0);
    expect(stats.cosmetic).toBe(0);
    expect(stats.total).toBe(4);
    expect(stats.insuranceRelevant).toBe(0);
  });

  it('should count insurance-relevant findings', () => {
    const findings = [
      makeFinding({ severity: 'high', insuranceRelevant: true }),
      makeFinding({ severity: 'moderate', insuranceRelevant: true }),
      makeFinding({ severity: 'minor', insuranceRelevant: false }),
    ];

    const stats = getFindingStats(findings);
    expect(stats.insuranceRelevant).toBe(2);
  });

  it('should handle unknown severity without crashing', () => {
    const findings = [
      makeFinding({ severity: 'unknown_sev' as FindingSeverity }),
    ];
    const stats = getFindingStats(findings);
    expect(stats.total).toBe(1);
    // Unknown severity doesn't increment any known counter
    expect(stats.critical).toBe(0);
    expect(stats.high).toBe(0);
  });

  it('should handle empty array', () => {
    const stats = getFindingStats([]);
    expect(stats.total).toBe(0);
    expect(stats.critical).toBe(0);
    expect(stats.insuranceRelevant).toBe(0);
  });
});

// ─── filterFindingsBySeverity ────────────────────────────────────────────────

describe('filterFindingsBySeverity', () => {
  const findings = [
    makeFinding({ id: 'f1', severity: 'critical' }),
    makeFinding({ id: 'f2', severity: 'high' }),
    makeFinding({ id: 'f3', severity: 'moderate' }),
    makeFinding({ id: 'f4', severity: 'minor' }),
  ];

  it('should filter to a single severity', () => {
    const filtered = filterFindingsBySeverity(findings, ['critical']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('f1');
  });

  it('should filter to multiple severities', () => {
    const filtered = filterFindingsBySeverity(findings, ['critical', 'high']);
    expect(filtered).toHaveLength(2);
  });

  it('should return all findings when filter is null', () => {
    const filtered = filterFindingsBySeverity(findings, null);
    expect(filtered).toHaveLength(4);
  });

  it('should return all findings when filter is empty array', () => {
    const filtered = filterFindingsBySeverity(findings, []);
    expect(filtered).toHaveLength(4);
  });

  it('should not mutate the original', () => {
    const filtered = filterFindingsBySeverity(findings, ['critical']);
    expect(findings).toHaveLength(4);
    expect(filtered).not.toBe(findings);
  });
});

// ─── getInsuranceRelevantCount ───────────────────────────────────────────────

describe('getInsuranceRelevantCount', () => {
  it('should count insurance-relevant findings', () => {
    const findings = [
      makeFinding({ insuranceRelevant: true }),
      makeFinding({ insuranceRelevant: false }),
      makeFinding({ insuranceRelevant: true }),
    ];
    expect(getInsuranceRelevantCount(findings)).toBe(2);
  });

  it('should return 0 when none are relevant', () => {
    const findings = [
      makeFinding({ insuranceRelevant: false }),
    ];
    expect(getInsuranceRelevantCount(findings)).toBe(0);
  });

  it('should return 0 for empty array', () => {
    expect(getInsuranceRelevantCount([])).toBe(0);
  });
});

// ─── getReportCompleteness ───────────────────────────────────────────────────

describe('getReportCompleteness', () => {
  it('should return 0% for completely empty report', () => {
    const result = getReportCompleteness({});
    expect(result.percentage).toBe(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every(i => !i.complete)).toBe(true);
  });

  it('should count executive summary as complete when present', () => {
    const result = getReportCompleteness({ executiveSummary: 'A summary of the roof condition.' });
    const summaryItem = result.items.find(i => i.key === 'executiveSummary');
    expect(summaryItem?.complete).toBe(true);
  });

  it('should not count empty string as complete', () => {
    const result = getReportCompleteness({ executiveSummary: '' });
    const summaryItem = result.items.find(i => i.key === 'executiveSummary');
    expect(summaryItem?.complete).toBe(false);
  });

  it('should count findings as complete when at least one exists', () => {
    const result = getReportCompleteness({ findings: [makeFinding()] });
    const findingsItem = result.items.find(i => i.key === 'findings');
    expect(findingsItem?.complete).toBe(true);
  });

  it('should count photos as complete when present', () => {
    const result = getReportCompleteness({ photoCount: 3 });
    const photosItem = result.items.find(i => i.key === 'photos');
    expect(photosItem?.complete).toBe(true);
  });

  it('should count inspector notes as complete when present', () => {
    const result = getReportCompleteness({ inspectorNotes: 'Some notes' });
    const notesItem = result.items.find(i => i.key === 'inspectorNotes');
    expect(notesItem?.complete).toBe(true);
  });

  it('should count customer info as complete when name exists', () => {
    const result = getReportCompleteness({ customerName: 'John Doe' });
    const customerItem = result.items.find(i => i.key === 'customerInfo');
    expect(customerItem?.complete).toBe(true);
  });

  it('should calculate correct percentage', () => {
    const result = getReportCompleteness({
      executiveSummary: 'Summary text here',
      findings: [makeFinding()],
      photoCount: 5,
      inspectorNotes: 'Notes here',
      customerName: 'Jane',
      stormData: true,
    });
    // All items should be complete
    const completedCount = result.items.filter(i => i.complete).length;
    expect(result.percentage).toBe(Math.round((completedCount / result.items.length) * 100));
  });

  it('should return percentage between 0 and 100', () => {
    const result = getReportCompleteness({ executiveSummary: 'Test' });
    expect(result.percentage).toBeGreaterThanOrEqual(0);
    expect(result.percentage).toBeLessThanOrEqual(100);
  });
});

// ─── getNarrativeCharCount ───────────────────────────────────────────────────

describe('getNarrativeCharCount', () => {
  it('should return character count', () => {
    expect(getNarrativeCharCount('Hello world')).toBe(11);
  });

  it('should return 0 for empty string', () => {
    expect(getNarrativeCharCount('')).toBe(0);
  });

  it('should return 0 for null/undefined', () => {
    expect(getNarrativeCharCount(undefined)).toBe(0);
    expect(getNarrativeCharCount(null as unknown as string)).toBe(0);
  });

  it('should include whitespace in count', () => {
    expect(getNarrativeCharCount('a b c')).toBe(5);
  });
});

// ─── getReportAtAGlance ──────────────────────────────────────────────────────

describe('getReportAtAGlance', () => {
  it('should extract key data points from a full report', () => {
    const glance = getReportAtAGlance({
      damageTypeCount: 5,
      photoCount: 10,
      stormEvents: 15,
      roofAgeYears: 12,
      overallSeverity: 'medium',
      repairEstimateRange: '$3,500 – $8,200',
      recommendedAction: 'Repair',
    });

    expect(glance).toHaveLength(7);
    expect(glance.find(g => g.label === 'Damage Types')?.value).toBe('5');
    expect(glance.find(g => g.label === 'Storm Events')?.value).toBe('15');
    expect(glance.find(g => g.label === 'Roof Age')?.value).toBe('12 years');
  });

  it('should omit items with zero/null values', () => {
    const glance = getReportAtAGlance({
      damageTypeCount: 0,
      photoCount: 3,
      stormEvents: 0,
      roofAgeYears: null,
      overallSeverity: 'low',
    });

    expect(glance.find(g => g.label === 'Damage Types')).toBeUndefined();
    expect(glance.find(g => g.label === 'Storm Events')).toBeUndefined();
    expect(glance.find(g => g.label === 'Roof Age')).toBeUndefined();
    expect(glance.find(g => g.label === 'Photos Analyzed')?.value).toBe('3');
  });

  it('should always include condition if severity is provided', () => {
    const glance = getReportAtAGlance({ overallSeverity: 'critical' });
    const condition = glance.find(g => g.label === 'Condition');
    expect(condition).toBeDefined();
    expect(condition?.value).toBe('Critical');
  });

  it('should return empty for no data', () => {
    const glance = getReportAtAGlance({});
    expect(glance).toHaveLength(0);
  });

  it('shows "New (< 1 year)" for a roof age of 0 (a real value, distinct from unknown)', () => {
    const glance = getReportAtAGlance({ roofAgeYears: 0 });
    expect(glance.find(g => g.label === 'Roof Age')?.value).toBe('New (< 1 year)');
  });

  it('uses singular/plural "year(s)" for positive ages', () => {
    expect(getReportAtAGlance({ roofAgeYears: 1 }).find(g => g.label === 'Roof Age')?.value).toBe('1 year');
    expect(getReportAtAGlance({ roofAgeYears: 5 }).find(g => g.label === 'Roof Age')?.value).toBe('5 years');
  });
});

// ─── createUndoStack ─────────────────────────────────────────────────────────

describe('createUndoStack', () => {
  it('should push and pop items', () => {
    const stack = createUndoStack<string>(5);
    stack.push('a');
    stack.push('b');

    expect(stack.canUndo()).toBe(true);
    expect(stack.pop()).toBe('b');
    expect(stack.pop()).toBe('a');
    expect(stack.canUndo()).toBe(false);
  });

  it('should return undefined when empty', () => {
    const stack = createUndoStack<string>(5);
    expect(stack.pop()).toBeUndefined();
    expect(stack.canUndo()).toBe(false);
  });

  it('should respect maxSize limit', () => {
    const stack = createUndoStack<number>(3);
    stack.push(1);
    stack.push(2);
    stack.push(3);
    stack.push(4); // should evict 1

    expect(stack.pop()).toBe(4);
    expect(stack.pop()).toBe(3);
    expect(stack.pop()).toBe(2);
    expect(stack.pop()).toBeUndefined(); // 1 was evicted
  });

  it('should clear all items', () => {
    const stack = createUndoStack<string>(5);
    stack.push('a');
    stack.push('b');
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.pop()).toBeUndefined();
  });

  it('should report correct size', () => {
    const stack = createUndoStack<string>(5);
    expect(stack.size()).toBe(0);
    stack.push('a');
    expect(stack.size()).toBe(1);
    stack.push('b');
    expect(stack.size()).toBe(2);
    stack.pop();
    expect(stack.size()).toBe(1);
  });
});

// ─── REWRITE_TONE_PRESETS ────────────────────────────────────────────────────

describe('REWRITE_TONE_PRESETS', () => {
  it('should have at least 4 tone presets', () => {
    expect(REWRITE_TONE_PRESETS.length).toBeGreaterThanOrEqual(4);
  });

  it('should have label and instruction on each preset', () => {
    for (const preset of REWRITE_TONE_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.instruction).toBeTruthy();
    }
  });

  it('should have unique labels', () => {
    const labels = REWRITE_TONE_PRESETS.map(p => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// ─── getRepairPrioritySummary ────────────────────────────────────────────────

describe('getRepairPrioritySummary', () => {
  it('should categorize findings into urgent, recommended, and optional', () => {
    const findings = [
      makeFinding({ severity: 'critical', title: 'Missing Shingles' }),
      makeFinding({ severity: 'high', title: 'Wind Damage' }),
      makeFinding({ severity: 'moderate', title: 'Granule Loss' }),
      makeFinding({ severity: 'minor', title: 'Moss Growth' }),
      makeFinding({ severity: 'cosmetic', title: 'Staining' }),
    ];

    const summary = getRepairPrioritySummary(findings);

    expect(summary.urgent).toHaveLength(2); // critical + high
    expect(summary.recommended).toHaveLength(1); // moderate
    expect(summary.optional).toHaveLength(2); // minor + cosmetic
  });

  it('should handle empty findings', () => {
    const summary = getRepairPrioritySummary([]);
    expect(summary.urgent).toHaveLength(0);
    expect(summary.recommended).toHaveLength(0);
    expect(summary.optional).toHaveLength(0);
  });

  it('should include finding titles in each category', () => {
    const findings = [
      makeFinding({ severity: 'critical', title: 'Leak Found' }),
    ];
    const summary = getRepairPrioritySummary(findings);
    expect(summary.urgent[0]).toBe('Leak Found');
  });
});

// ─── formatReportExportFilename ──────────────────────────────────────────────

describe('formatReportExportFilename', () => {
  it('should generate filename from address and date', () => {
    const result = formatReportExportFilename('123 Main St', '2026-03-15');
    expect(result).toBe('roof-report-123-main-st-2026-03-15');
  });

  it('should sanitize special characters from address', () => {
    const result = formatReportExportFilename('456 Oak Ave, Apt #2B', '2026-01-01');
    expect(result).toBe('roof-report-456-oak-ave-apt-2b-2026-01-01');
  });

  it('should handle missing date', () => {
    const result = formatReportExportFilename('789 Pine Rd');
    expect(result).toMatch(/^roof-report-789-pine-rd-\d{4}-\d{2}-\d{2}$/);
  });

  it('should handle missing address', () => {
    const result = formatReportExportFilename('', '2026-06-01');
    expect(result).toBe('roof-report-2026-06-01');
  });

  it('should handle both missing', () => {
    const result = formatReportExportFilename();
    expect(result).toMatch(/^roof-report-\d{4}-\d{2}-\d{2}$/);
  });

  it('should lowercase the output', () => {
    const result = formatReportExportFilename('123 UPPER ST', '2026-03-15');
    expect(result).toBe('roof-report-123-upper-st-2026-03-15');
  });

  it('should collapse multiple hyphens', () => {
    const result = formatReportExportFilename('100 --- Bad --- St', '2026-03-15');
    expect(result).toBe('roof-report-100-bad-st-2026-03-15');
  });

  it('should handle address with only special characters', () => {
    const result = formatReportExportFilename('###!!!', '2026-03-15');
    expect(result).toBe('roof-report-2026-03-15');
  });
});

// ─── formatReportId ──────────────────────────────────────────────────────────

describe('formatReportId', () => {
  it('should truncate long IDs to 8 chars with prefix', () => {
    const result = formatReportId('abc123def456ghi789');
    expect(result).toBe('RPT-ABC123DE');
  });

  it('should uppercase the output', () => {
    const result = formatReportId('test-id');
    expect(result).toMatch(/^RPT-[A-Z0-9]+$/);
  });

  it('should handle short IDs', () => {
    const result = formatReportId('ab');
    expect(result).toBe('RPT-AB');
  });

  it('should handle empty/undefined', () => {
    expect(formatReportId('')).toBe('RPT-UNKNOWN');
    expect(formatReportId(undefined as unknown as string)).toBe('RPT-UNKNOWN');
  });

  it('should strip hyphens from the ID portion', () => {
    const result = formatReportId('abc-def-ghi');
    expect(result).toBe('RPT-ABCDEFGH');
  });
});
