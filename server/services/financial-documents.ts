import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Financials folder lives at the project root
const FINANCIALS_ROOT = path.resolve(process.cwd(), 'Financials');

export interface FinancialDocument {
  name: string;
  path: string;
  folder: string;
  date: string | null;
  type: 'bank_statement' | 'tax_filing' | 'w2' | '1099' | 'other';
  size: number;
}

/**
 * List all financial documents, optionally filtered by folder or type.
 */
export function listFinancialDocuments(opts?: {
  folder?: string;
  type?: FinancialDocument['type'];
  year?: string;
}): FinancialDocument[] {
  const documents: FinancialDocument[] = [];

  if (!fs.existsSync(FINANCIALS_ROOT)) {
    return documents;
  }

  const folders = opts?.folder
    ? [opts.folder]
    : fs.readdirSync(FINANCIALS_ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

  for (const folder of folders) {
    const folderPath = path.join(FINANCIALS_ROOT, folder);
    if (!fs.existsSync(folderPath)) continue;

    scanDirectory(folderPath, folder, documents);
  }

  let filtered = documents;

  if (opts?.type) {
    filtered = filtered.filter(d => d.type === opts.type);
  }
  if (opts?.year) {
    filtered = filtered.filter(d =>
      d.name.includes(opts.year!) || d.path.includes(opts.year!)
    );
  }

  return filtered.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}

function scanDirectory(dirPath: string, rootFolder: string, docs: FinancialDocument[]) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, rootFolder, docs);
      continue;
    }

    if (!entry.name.toLowerCase().endsWith('.pdf') && !entry.name.toLowerCase().endsWith('.zip')) {
      continue;
    }

    const stats = fs.statSync(fullPath);
    docs.push({
      name: entry.name,
      path: fullPath,
      folder: rootFolder,
      date: extractDate(entry.name),
      type: classifyDocument(entry.name, rootFolder),
      size: stats.size,
    });
  }
}

function extractDate(filename: string): string | null {
  // Match YYYY-MM-DD at start
  const isoMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Match YYYYMMDD in EStatement format
  const estMatch = filename.match(/(\d{8})/);
  if (estMatch) {
    const d = estMatch[1];
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }

  // Match year from filenames like acmeroofingllc_Q1_2025
  const qMatch = filename.match(/Q(\d)_(\d{4})/);
  if (qMatch) {
    const quarter = parseInt(qMatch[1]);
    const year = qMatch[2];
    const month = String((quarter - 1) * 3 + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  }

  // Match just year
  const yearMatch = filename.match(/(\d{4})/);
  if (yearMatch) return `${yearMatch[1]}-01-01`;

  return null;
}

function classifyDocument(filename: string, folder: string): FinancialDocument['type'] {
  const lower = filename.toLowerCase();
  const folderLower = folder.toLowerCase();

  if (folderLower.includes('bank') || folderLower.includes('first bank')) {
    return 'bank_statement';
  }
  if (lower.includes('statement') || lower.includes('estatement')) {
    return 'bank_statement';
  }
  if (lower.includes('w2') || lower.includes('w-2')) {
    return 'w2';
  }
  if (lower.includes('1099')) {
    return '1099';
  }
  if (folderLower.includes('tax') || lower.includes('941') || lower.includes('940') || lower.includes('sit') || lower.includes('suta')) {
    return 'tax_filing';
  }
  return 'other';
}

/**
 * Read and parse a PDF document, returning its text content.
 * Uses a child process to avoid ESM/CJS compatibility issues with pdf-parse.
 */
export async function readPdfDocument(filePath: string): Promise<string> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Ensure file is within Financials directory
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(FINANCIALS_ROOT))) {
    throw new Error('Access denied: file must be within Financials directory');
  }

  // Use child process to parse PDF in CJS context (pdf-parse is CJS-only)
  const script = `
    const pdfParse = require('pdf-parse');
    const fs = require('fs');
    const buf = fs.readFileSync(process.argv[1]);
    pdfParse(buf).then(d => {
      // Filter out barcode/binary lines (rows of just 0s and 1s)
      const lines = d.text.split('\\n');
      const cleaned = lines.filter(l => !l.match(/^[01\\s]*$/) || l.trim().length === 0);
      process.stdout.write(cleaned.join('\\n'));
    }).catch(e => {
      process.stderr.write(e.message);
      process.exit(1);
    });
  `;

  try {
    const result = execFileSync('node', ['-e', script, resolved], {
      maxBuffer: 10 * 1024 * 1024, // 10MB
      timeout: 30000,
      encoding: 'utf-8',
      cwd: path.resolve(process.cwd()),
    });
    return result;
  } catch (err: any) {
    throw new Error(`Failed to parse PDF: ${err.stderr || err.message}`);
  }
}

/**
 * Get a summary of what's in the Financials folder.
 */
export function getFinancialsSummary(): {
  folders: { name: string; fileCount: number; dateRange: string }[];
  totalFiles: number;
  types: Record<string, number>;
} {
  const docs = listFinancialDocuments();
  const folders = new Map<string, FinancialDocument[]>();
  const types: Record<string, number> = {};

  for (const doc of docs) {
    if (!folders.has(doc.folder)) folders.set(doc.folder, []);
    folders.get(doc.folder)!.push(doc);
    types[doc.type] = (types[doc.type] || 0) + 1;
  }

  return {
    folders: Array.from(folders.entries()).map(([name, files]) => {
      const dates = files.map(f => f.date).filter(Boolean) as string[];
      dates.sort();
      return {
        name,
        fileCount: files.length,
        dateRange: dates.length
          ? `${dates[0]} to ${dates[dates.length - 1]}`
          : 'unknown',
      };
    }),
    totalFiles: docs.length,
    types,
  };
}
