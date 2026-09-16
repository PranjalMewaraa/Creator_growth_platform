'use client';

import { Button, ChevronDownIcon, Field, Input, Select } from '@cgp/ui';
import { useActionState } from 'react';
import { createWorkspaceAction, type SetupState } from './actions';

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'];

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(createWorkspaceAction, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Workspace name" htmlFor="name">
        <Input id="name" name="name" required maxLength={80} placeholder="Studio name" />
      </Field>
      <Field label="Timezone" htmlFor="timezone" hint="Scheduling and the calendar follow this.">
        <div className="relative">
          <Select id="timezone" name="timezone" defaultValue="Asia/Kolkata" className="pr-10">
            {TIMEZONES.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
          <ChevronDownIcon className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-faint" />
        </div>
      </Field>
      {state.error ? <p className="text-sm text-bad">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="mt-2 w-full">
        {pending ? 'Creating workspace' : 'Create workspace'}
      </Button>
    </form>
  );
}
