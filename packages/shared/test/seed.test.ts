import { describe, expect, it } from 'vitest';
import { parseSeed } from '../src/index.js';

describe('parseSeed', () => {
  it('parses canonical safe base-10 integers into numbers', () => {
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed('  42  ')).toBe(42);
    expect(parseSeed('0')).toBe(0);
    expect(Object.is(parseSeed('-0'), -0)).toBe(false);
    expect(parseSeed('-0')).toBe(0);
    expect(parseSeed('-123')).toBe(-123);
  });

  it('keeps non-canonical or non-integer inputs as trimmed strings', () => {
    expect(parseSeed('007')).toBe('007');
    expect(parseSeed('42.5')).toBe('42.5');
    expect(parseSeed('island-alpha')).toBe('island-alpha');
    expect(parseSeed('  my seed  ')).toBe('my seed');
    expect(parseSeed('99999999999999999999')).toBe('99999999999999999999');
  });

  it('returns the fallback for empty or whitespace-only strings', () => {
    expect(parseSeed('')).toBe(42);
    expect(parseSeed('   ')).toBe(42);
    expect(parseSeed('   ', 'default-seed')).toBe('default-seed');
  });
});
