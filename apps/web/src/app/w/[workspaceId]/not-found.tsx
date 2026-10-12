import { Trouble } from '@/components/trouble';

export const metadata = { title: 'Not found' };

/** A workspace path that leads nowhere: a job, an output or a workspace that is not yours. */
export default function WorkspaceNotFound() {
  return (
    <Trouble title="There is nothing at this address">
      <p>
        The link may be old, or it may point to something in a workspace you are not a member of.
        Nothing has been lost; it is simply not here.
      </p>
    </Trouble>
  );
}
