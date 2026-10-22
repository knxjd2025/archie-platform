/**
 * Type shims for optional, dynamically-imported engine dependencies.
 *
 * `@google/genai` is only pulled in as a Gemini *fallback* for photo analysis
 * (Groq is primary), via `await import(...)` guarded by GEMINI_API_KEY — so the
 * package doesn't need to be installed for the engine to build or run.
 * `pdf-parse` ships without types.
 */
declare module '@google/genai' {
  export const GoogleGenAI: any;
  const _default: any;
  export default _default;
}
declare module 'pdf-parse' {
  const parse: (data: Buffer | Uint8Array) => Promise<{ text: string; numpages?: number; info?: any }>;
  export default parse;
}

// Only used by the (disabled) R2 upload path for roof colour renders; report
// HTML is stored in our own database instead.
declare module '@aws-sdk/client-s3' {
  export const S3Client: any;
  export const PutObjectCommand: any;
}
