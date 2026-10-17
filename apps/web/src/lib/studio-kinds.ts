import type { ComponentType, SVGProps } from 'react';
import { FilmIcon, ImageIcon, PaletteIcon, SparklesIcon, TypeIcon } from '@cgp/ui';

/**
 * What the Studio can make, in one place (WP53): Studio's own picker and Home's "what's on
 * your mind" cards both read this, so the six things a workspace can generate are named once
 * rather than twice and drifting apart.
 */
export interface StudioKind {
  key: string;
  label: string;
  hint: string;
  /** What this generator makes, which is how its templates are found. */
  outputType: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  soon?: boolean;
}

export const STUDIO_KINDS: StudioKind[] = [
  {
    key: 'script',
    label: 'Script',
    hint: 'The words to say on camera',
    outputType: 'script',
    Icon: TypeIcon,
  },
  {
    key: 'hook_title_set',
    label: 'Hooks & titles',
    hint: 'Openers that stop the scroll',
    outputType: 'hook',
    Icon: SparklesIcon,
  },
  {
    key: 'caption_set',
    label: 'Captions',
    hint: 'One caption per platform',
    outputType: 'caption',
    Icon: TypeIcon,
  },
  {
    key: 'image',
    label: 'Image',
    hint: 'A picture for the post',
    outputType: 'image',
    Icon: ImageIcon,
  },
  {
    key: 'thumbnail_set',
    label: 'Thumbnail',
    hint: 'Three to choose between',
    outputType: 'thumbnail',
    Icon: PaletteIcon,
  },
  {
    key: 'video',
    label: 'Video',
    hint: 'Up to three eight second scenes',
    outputType: 'video',
    Icon: FilmIcon,
  },
];
