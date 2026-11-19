import { afterEach, describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { isPhotoObjectKey, photoObjectKey, photoStore, photoStoreConfigured, setPhotoStoreForTests, describeStoreError, type PhotoStore } from '../store';

const all = {
  ARCHIE_PHOTOS_ACCOUNT_ID: 'acct',
  ARCHIE_PHOTOS_ACCESS_KEY_ID: 'key',
  ARCHIE_PHOTOS_SECRET_ACCESS_KEY: 'secret',
  ARCHIE_PHOTOS_BUCKET: 'bucket',
};
const company = '0b9f6a52-6c1e-4d55-9a57-3c0a8c2f1e11';
const photo = '7d3e2c10-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('the photo store settings', () => {
  it('is on only when all four settings are there', () => {
    expect(photoStoreConfigured(all)).toBe(true);
    for (const name of Object.keys(all)) {
      expect(photoStoreConfigured({ ...all, [name]: undefined }), name).toBe(false);
      expect(photoStoreConfigured({ ...all, [name]: '  ' }), name).toBe(false);
    }
    expect(photoStoreConfigured({})).toBe(false);
  });

  it('has no store to hand out when it is off', () => {
    const saved = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
    try {
      for (const k of Object.keys(all)) delete process.env[k];
      expect(photoStore()).toBeNull();
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
    }
  });
});

describe('where a photo is kept', () => {
  afterEach(() => setPhotoStoreForTests(null));

  it('is under its own company\'s prefix, named by the photo', () => {
    expect(photoObjectKey(company, photo, 'working')).toBe(`c/${company}/p/${photo}/working.jpg`);
    expect(photoObjectKey(company, photo, 'thumb')).toBe(`c/${company}/p/${photo}/thumb.jpg`);
  });

  it('refuses anything that is not a company id and a photo id', () => {
    expect(() => photoObjectKey('../other', photo, 'working')).toThrow();
    expect(() => photoObjectKey(company, '../../x', 'thumb')).toThrow();
    expect(() => photoObjectKey(company, photo, 'original' as any)).toThrow();
    expect(isPhotoObjectKey(`c/${company}/p/${photo}/working.jpg`)).toBe(true);
    expect(isPhotoObjectKey(`c/${company}/p/${photo}/../working.jpg`)).toBe(false);
    expect(isPhotoObjectKey(`x/${company}/p/${photo}/working.jpg`)).toBe(false);
  });

  it('uses the store a test hands in, and never makes a real one for it', () => {
    const fake: PhotoStore = { put: async () => {}, get: async () => ({ body: Readable.from(Buffer.alloc(1)), length: 1 }) };
    setPhotoStoreForTests(fake);
    expect(photoStore()).toBe(fake);
  });

  it('describes a failure by its name and status only', () => {
    const e = Object.assign(new Error('signature for secret xyz at https://acct.r2.cloudflarestorage.com/bucket/c/...'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    expect(describeStoreError(e)).toBe('AccessDenied 403');
    expect(describeStoreError(null)).toBe('Error');
  });
});
