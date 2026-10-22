import { describe, it, expect } from 'vitest';
import { fullAddress } from '../playbook/routes';

describe('fullAddress', () => {
  it('keeps a complete JobTread address and drops the country', () => {
    expect(fullAddress('14509 Farmleigh Ave, Charlotte, NC 28273, USA', 'Charlotte', 'NC', '28273')).toBe('14509 Farmleigh Ave, Charlotte, NC 28273');
  });
  it('adds the city to a bare street', () => {
    expect(fullAddress('12 Oak St', 'Charlotte', 'NC', '28205')).toBe('12 Oak St, Charlotte, NC 28205');
  });
  it('is null with no street', () => {
    expect(fullAddress(null, 'Charlotte', 'NC', null)).toBeNull();
  });
});
