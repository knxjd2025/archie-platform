/**
 * Type-only shapes the moved report library took from the old program's front
 * end. Copied as types and nothing else: no functions, no values.
 */

export interface ReportFeatures {
  includeMaterialTakeoff: boolean;
  includeLaborBreakdown: boolean;
  includeMoistureData: boolean;
  includePhotoAnnotations: boolean;
  includeWarrantyInfo: boolean;
  includeCertifications: boolean;
  includeInsurance: boolean;
  includeStructuralAssessment: boolean;
  includeInteriorInspection: boolean;
  includeDetailedMeasurements: boolean;
  includeDamageInventory: boolean;
  includeStormHistory: boolean;
}

export interface CompanyProfile {
  name: string;
  services: string;
  pricing: string;
  logoData: string | null;
  logoMimeType: string | null;
  repairItems: RepairItem[];
  productItems: ProductItem[];
  // Enhanced fields
  phone: string;
  email: string;
  website: string;
  address: string;
  licenseNumber: string;
  components: ComponentItem[];
  systemPackages: SystemPackage[];
  warranties: WarrantyInfo[];
  certifications: CertificationItem[];
  insurance: InsuranceInfo[];
  laborRates: LaborRate[];
  defaultMarkup: number;
  defaultWarrantyLabor: number;
  taxRate: number;
  paymentTerms: string;
  reportFeatures?: ReportFeatures;
  brandPrimaryColor: string;
  brandSecondaryColor: string;
  tagline: string;
  brandFontFamily: string;
  coverHeroImage: string | null;
  coverHeroImageMimeType: string | null;
  customDisclaimer: string;
  /** Reusable Terms & Conditions templates selectable from estimates, proposals, and presentations. */
  termsTemplates?: TermsTemplate[];
}

export type TermsTemplateType = 'estimate' | 'proposal' | 'presentation' | 'invoice' | 'general';

export interface TermsTemplate {
  id: string;
  name: string;
  type: TermsTemplateType;
  body: string;
  /** When true, this template is auto-selected for new documents of its type. */
  isDefault?: boolean;
  /**
   * When true, this template is appended VERBATIM as the final/back page of
   * every generated document (estimate, proposal, invoice, presentation, report).
   * The text is never modified by AI or the system, exactly as entered.
   */
  useOnAllDocs?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RepairItem {
  id: string;
  name: string;
}

export interface ProductItem {
  id: string;
  name: string;
  pricePerSq: number;
}

export interface ComponentItem {
  id: string;
  category: string;
  name: string;
  manufacturer: string;
  model: string;
  unit: string;
  pricePerUnit: number;
  laborPerUnit: number;
  description: string;
}

export interface SystemPackage {
  id: string;
  name: string;
  tier: 'good' | 'better' | 'best' | 'custom';
  description: string;
  components: string[];
  laborMultiplier: number;
  markupPercent: number;
  warrantyYears: number;
}

export interface WarrantyInfo {
  id: string;
  manufacturer: string;
  productLine: string;
  warrantyName: string;
  durationYears: number;
  coverage: string;
  requirements: string;
  transferable: boolean;
}

export interface CertificationItem {
  id: string;
  name: string;
  issuingBody: string;
  certificationNumber: string;
  expirationDate: string;
  logoData: string | null;
  logoMimeType: string | null;
}

export interface InsuranceInfo {
  id: string;
  type: string;
  provider: string;
  policyNumber: string;
  coverageAmount: string;
  expirationDate: string;
}

export interface LaborRate {
  id: string;
  category: string;
  description: string;
  ratePerSq: number;
  ratePerHour: number;
  crewSize: number;
}

export interface RoofAnalysisRecord {
  id: string;
  user_id: string;
  project_id?: string;
  job_id?: string;
  analysis_type: 'satellite' | 'photo';
  address?: string;
  latitude?: number;
  longitude?: number;
  satellite_image_url?: string;
  source_photo_urls?: string[];
  detected_features: any[];
  feature_summary: Record<string, any>;
  raw_model_output: Record<string, any>;
  model_provider?: string;
  model_version?: string;
  processing_time_ms?: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'mock';
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export interface LineItem {
  description: string;
  details?: string;
  category?: string;
  brand?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
}

export interface EstimateTierData {
  tier: string;
  name: string;
  tagline: string;
  total: number;
  warranty_years: number;
  warranty_description: string;
  features: string[];
  recommended?: boolean;
  materials: LineItem[];
  labor: LineItem[];
  other_costs: Array<{ item: string; description: string; amount: number }>;
  subtotal: number;
  tax: number;
}
