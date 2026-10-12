import { Trouble } from '@/components/trouble';

export const metadata = { title: 'Not found' };

export default function NotFound() {
  return (
    <main className="min-h-screen bg-canvas">
      <Trouble title="There is nothing at this address">
        <p>
          The link may be old, or it may point to a workspace you are not a member of. Nothing has
          been lost; it is simply not here.
        </p>
      </Trouble>
    </main>
  );
}
