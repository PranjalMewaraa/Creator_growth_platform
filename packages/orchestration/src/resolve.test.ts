import { PRECEDENCE, type Directive } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { deriveSettings, resolveSettings, settingValue } from './resolve';

// FR-PO-06: safety > platform > user > template > profile, resolved in code.
describe('precedence', () => {
  it('lets each source beat every source below it, whatever order they arrive in', () => {
    for (const [i, higher] of PRECEDENCE.entries()) {
      for (const lower of PRECEDENCE.slice(i + 1)) {
        const directives: Directive[] = [
          { key: 'k', value: lower, source: lower },
          { key: 'k', value: higher, source: higher },
        ];
        const [setting] = resolveSettings(directives);
        expect(setting, `${higher} over ${lower}`).toMatchObject({
          value: higher,
          source: higher,
          overridden: [{ source: lower, value: lower }],
        });
      }
    }
  });

  it('keeps every overridden value, in precedence order', () => {
    const [tone] = resolveSettings([
      { key: 'tone', value: 'warm', source: 'profile' },
      { key: 'tone', value: 'playful', source: 'user' },
      { key: 'tone', value: 'authoritative', source: 'template' },
    ]);
    expect(tone).toEqual({
      key: 'tone',
      value: 'playful',
      source: 'user',
      overridden: [
        { source: 'template', value: 'authoritative' },
        { source: 'profile', value: 'warm' },
      ],
    });
  });

  it('never lets a user instruction lift a platform constraint', () => {
    const settings = resolveSettings([
      { key: 'aspectRatio', value: '16:9', source: 'user' },
      { key: 'aspectRatio', value: '4:5', source: 'platform' },
    ]);
    expect(settingValue(settings, 'aspectRatio')).toBe('4:5');
  });

  it('derives the word budget from the winning duration, with its source', () => {
    const settings = deriveSettings(
      resolveSettings([
        { key: 'durationSeconds', value: 30, source: 'template' },
        { key: 'durationSeconds', value: 60, source: 'user' },
      ]),
    );
    expect(settings.find((s) => s.key === 'wordBudget')).toMatchObject({
      value: 150,
      source: 'user',
    });
  });
});

describe('the look, derived from its parts (WP37)', () => {
  const directive = (key: string, value: string, source: Directive['source']): Directive => ({
    key,
    value,
    source,
  });

  it('composes one line from whichever parts won', () => {
    const settings = deriveSettings(
      resolveSettings([
        directive('camera', 'film-16mm', 'template'),
        directive('lens', 'vintage-prime', 'template'),
        directive('aperture', 'f1.4', 'user'),
      ]),
    );

    expect(settingValue(settings, 'look')).toBe(
      'Shot on a classic 16mm film camera, with a vintage prime lens, wide open, the background falling away.',
    );
  });

  it('lets a creator change one part without restating the rest', () => {
    const settings = deriveSettings(
      resolveSettings([
        directive('camera', 'film-16mm', 'template'),
        directive('camera', 'phone', 'user'),
        directive('lens', 'macro', 'template'),
      ]),
    );

    // The template's house look, with the one part the creator overrode.
    expect(settingValue(settings, 'look')).toBe(
      'Shot on a modern phone camera, handheld, with a macro lens.',
    );
    // And the disclosure can still show what the override beat.
    expect(settings.find((s) => s.key === 'camera')?.overridden).toEqual([
      { source: 'template', value: 'film-16mm' },
    ]);
  });

  it('takes the source of the most specific part, so the line reads as whose it is', () => {
    const settings = deriveSettings(
      resolveSettings([
        directive('camera', 'film-16mm', 'template'),
        directive('aperture', 'f11', 'user'),
      ]),
    );
    expect(settings.find((s) => s.key === 'look')?.source).toBe('user');
  });

  it('adds nothing when nobody chose a look', () => {
    const settings = deriveSettings(resolveSettings([directive('tone', 'warm', 'profile')]));
    expect(settingValue(settings, 'look')).toBeUndefined();
  });
});
