import { describe, expect, it } from 'vitest';
import { composeLook, isLookOption, LOOK_KEYS, LOOK_VOCABULARY } from './look';

describe('the look (WP37)', () => {
  it('says the whole thing when every part was chosen', () => {
    expect(
      composeLook({
        camera: 'film-16mm',
        lens: 'vintage-prime',
        focalLength: '35mm',
        aperture: 'f1.4',
      }),
    ).toBe(
      'Shot on a classic 16mm film camera, with a vintage prime lens at 35mm, a natural perspective, wide open, the background falling away.',
    );
  });

  it('invents nothing to fill a gap', () => {
    // A default aperture nobody asked for is a decision made on the creator's behalf and then
    // hidden inside a prompt they are told is theirs.
    expect(composeLook({ camera: 'phone' })).toBe('Shot on a modern phone camera, handheld.');
    expect(composeLook({ lens: 'macro' })).toBe('Shot with a macro lens.');
    expect(composeLook({ focalLength: '85mm' })).toBe(
      'Shot at 85mm, a compressed portrait perspective.',
    );
  });

  it('is absent when nothing was chosen, so no line is added at all', () => {
    expect(composeLook({})).toBeUndefined();
    expect(composeLook({ camera: 'not-a-camera' })).toBeUndefined();
  });

  it('refuses an id this build does not know', () => {
    expect(isLookOption('camera', 'film-16mm')).toBe(true);
    expect(isLookOption('camera', 'imax')).toBe(false);
  });

  it('keeps every option pickable and sayable', () => {
    for (const key of LOOK_KEYS) {
      for (const option of LOOK_VOCABULARY[key]) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.phrase.length).toBeGreaterThan(0);
        // Nothing in here is a quality tag. The vocabulary describes how a thing was shot,
        // never how good it is: "award-winning" and "8K" are the filler WP37 left behind.
        expect(option.phrase).not.toMatch(/8K|award|ultra-detailed|masterpiece|best quality/i);
      }
    }
  });
});
