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
