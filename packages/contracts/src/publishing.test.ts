import { describe, expect, it } from 'vitest';
import { countHashtags, PLATFORM_HASHTAG_LIMITS, PLATFORM_TEXT_LIMITS } from './publishing';

// The length indicators, the compiler's requirement lines and the publish checks all read
// these, so a wrong count here shows up as a post the platform refuses.
describe('platform limits', () => {
  it('states a text limit for every platform we publish to', () => {
    expect(PLATFORM_TEXT_LIMITS).toEqual({ instagram: 2200, linkedin: 3000 });
    expect(PLATFORM_HASHTAG_LIMITS).toEqual({ instagram: 30 });
  });
});

describe('countHashtags', () => {
  it('counts tags, not the words around them', () => {
    expect(countHashtags('Cold brew #coffee #ColdBrew2026 is here')).toBe(2);
  });

  it('counts a repeated tag each time, and needs a word right after the hash', () => {
    expect(countHashtags('#a #a')).toBe(2);
    expect(countHashtags('number # 1, C# too')).toBe(0);
  });

  it('counts tags in any script, since captions are not only English', () => {
    expect(countHashtags('#कोल्डब्रू #जयपुर')).toBe(2);
  });

  it('stops a tag at punctuation, as the platforms do', () => {
    expect(countHashtags('#coffee, #brew. #one-two')).toBe(3);
  });

  it('counts nothing in text with no tags', () => {
    expect(countHashtags('no tags at all')).toBe(0);
  });
});
