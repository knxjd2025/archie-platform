import { describe, it, expect } from 'vitest';
import { decodeImagePayload, MAX_UPLOAD_BYTES } from '../routes';

describe('photo upload payload', () => {
  it('decodes plain base64', () => {
    const buf = decodeImagePayload(Buffer.from('hello').toString('base64'));
    expect(buf?.toString()).toBe('hello');
  });

  it('strips a data-URL prefix (what the browser canvas produces)', () => {
    const b64 = Buffer.from('jpegbytes').toString('base64');
    const buf = decodeImagePayload(`data:image/jpeg;base64,${b64}`);
    expect(buf?.toString()).toBe('jpegbytes');
  });

  it('rejects empty input', () => {
    expect(decodeImagePayload('')).toBeNull();
    expect(decodeImagePayload('   ')).toBeNull();
    expect(decodeImagePayload('data:image/jpeg;base64,')).toBeNull();
  });

  it('caps uploads at a sane size', () => {
    expect(MAX_UPLOAD_BYTES).toBeGreaterThan(1024 * 1024);
    expect(MAX_UPLOAD_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });
});
