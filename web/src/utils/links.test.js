// links.test.js — only http(s) addresses may become links.

import { describe, expect, it } from 'vitest';
import { isWebAddress } from './links.js';

describe('isWebAddress', () => {
  it('http and https are web addresses', () => {
    expect(isWebAddress('https://news.google.com/rss/articles/abc')).toBe(true);
    expect(isWebAddress('http://example.com/a?b=1')).toBe(true);
  });

  it('other schemes, relative or broken addresses are not', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/x.txt', 'vbscript:x', '/relative/path', 'not a url', '', null, undefined]) {
      expect(isWebAddress(url)).toBe(false);
    }
  });
});
