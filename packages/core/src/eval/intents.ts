import type { OutputType, TargetPlatform } from '@cgp/contracts';

// The evaluation set (WP20, plan section 11): twenty intents in the words a creator would
// actually type, not prompt engineering. They are deliberately uneven: some are one line and
// vague, some carry a fact to keep, a few are awkward. The engine is worth what it adds to
// these, not to a well written prompt.

export interface EvalIntent {
  id: string;
  outputType: Extract<OutputType, 'script' | 'hook' | 'caption'>;
  /** The template to compile with. Absent means the plain one for the output type. */
  templateSlug?: string;
  targetPlatform: TargetPlatform | null;
  text: string;
}

export const EVAL_INTENTS: EvalIntent[] = [
  {
    id: 'cold-brew-delivery',
    outputType: 'script',
    targetPlatform: 'instagram',
    text: 'we deliver cold brew across jaipur now, same morning',
  },
  {
    id: 'cold-brew-myth',
    outputType: 'script',
    templateSlug: 'myth-buster',
    targetPlatform: 'instagram',
    text: 'people think cold brew is just iced coffee. it is not, it steeps 16 hours',
  },
  {
    id: 'studio-setup',
    outputType: 'script',
    templateSlug: 'how-i-do-it',
    targetPlatform: 'instagram',
    text: 'how i set up my shoot corner in a 1bhk',
  },
  {
    id: 'first-thousand',
    outputType: 'script',
    templateSlug: 'behind-the-scenes',
    targetPlatform: 'instagram',
    text: 'took me 14 months to get to 1000 followers and i almost quit twice',
  },
  {
    id: 'bakery-customer',
    outputType: 'script',
    templateSlug: 'customer-story',
    targetPlatform: 'linkedin',
    text: 'a bakery in jodhpur used our beans and their cold coffee sales doubled',
  },
  {
    id: 'festival-orders',
    outputType: 'script',
    targetPlatform: 'instagram',
    text: 'diwali gift boxes, orders close on the 20th',
  },
  {
    id: 'why-expensive',
    outputType: 'script',
    templateSlug: 'myth-buster',
    targetPlatform: 'instagram',
    text: 'why our coffee costs more than the supermarket one',
  },
  {
    id: 'hiring-barista',
    outputType: 'script',
    targetPlatform: 'linkedin',
    text: 'we are hiring a barista, no experience needed, we train',
  },
  {
    id: 'monsoon-storage',
    outputType: 'hook',
    templateSlug: 'listicle-hooks',
    targetPlatform: 'instagram',
    text: 'how to store coffee beans in humid weather',
  },
  {
    id: 'grinder-question',
    outputType: 'hook',
    templateSlug: 'question-hooks',
    targetPlatform: 'instagram',
    text: 'does the grinder matter more than the beans',
  },
  {
    id: 'morning-routine',
    outputType: 'hook',
    targetPlatform: 'instagram',
    text: 'my 5am routine before the shop opens',
  },
  {
    id: 'price-rise',
    outputType: 'hook',
    templateSlug: 'question-hooks',
    targetPlatform: 'linkedin',
    text: 'coffee prices went up 30 percent this year, here is what we did instead of raising ours',
  },
  {
    id: 'new-roast',
    outputType: 'caption',
    templateSlug: 'launch-captions',
    targetPlatform: 'instagram',
    text: 'new single origin roast from chikmagalur, 250g bags, live today',
  },
  {
    id: 'sunday-market',
    outputType: 'caption',
    templateSlug: 'story-captions',
    targetPlatform: 'instagram',
    text: 'sunday market stall, sold out by 11, the rain helped somehow',
  },
  {
    id: 'thank-you',
    outputType: 'caption',
    targetPlatform: 'instagram',
    text: '500 orders this month, thank you',
  },
  {
    id: 'b2b-supply',
    outputType: 'caption',
    templateSlug: 'launch-captions',
    targetPlatform: 'linkedin',
    text: 'we now supply cafes in jaipur and ajmer, wholesale pricing from 5kg',
  },
  {
    id: 'brewing-mistake',
    outputType: 'caption',
    templateSlug: 'story-captions',
    targetPlatform: 'instagram',
    text: 'i ruined a whole batch by grinding too fine, telling on myself',
  },
  {
    id: 'subscription',
    outputType: 'caption',
    targetPlatform: 'instagram',
    text: 'monthly subscription, 2 bags, cancel anytime, 15 percent off',
  },
  {
    id: 'cafe-partner',
    outputType: 'script',
    templateSlug: 'customer-story',
    targetPlatform: 'linkedin',
    text: 'our first cafe partner said yes after we brought them a sample at 7am',
  },
  {
    id: 'water-matters',
    outputType: 'hook',
    templateSlug: 'listicle-hooks',
    targetPlatform: 'instagram',
    text: 'water quality changes the taste more than people think',
  },
];
