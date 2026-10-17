'use client';

import { Dialog } from '@cgp/ui';
import { TemplatePicker, type TemplateCard } from './template-picker';

/**
 * Templates, in a dialog rather than always on screen (WP56): the grid used to sit permanently
 * under the kind cards, which was most of the left pane's height spent on a choice most
 * generations never touch (the plain default). Opening it is one click; picking one closes it.
 */
export function TemplatesDialog({
  open,
  onClose,
  templates,
  selected,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  templates: TemplateCard[];
  selected: string | null;
  onSelect: (templateId: string | null) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Templates" className="max-w-2xl">
      <TemplatePicker
        templates={templates}
        selected={selected}
        onSelect={(id) => {
          onSelect(id);
          onClose();
        }}
      />
    </Dialog>
  );
}
