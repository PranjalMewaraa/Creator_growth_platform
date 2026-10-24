'use client';

import { Badge, Button, CloseIcon, PlusIcon, Toggle, cx, useToast } from '@cgp/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SceneReference {
  key: string;
  url: string;
  mimeType: string;
}

type SceneStatus = 'draft' | 'generating' | 'complete' | 'failed';

interface SceneView {
  id: string;
  index: number;
  prompt: string;
  references: SceneReference[];
  status: SceneStatus;
  jobId: string | null;
  videoUrl: string | null;
  error: string | null;
}

interface BoardSummary {
  id: string;
  name: string;
  sceneCount: number;
  createdAt: string;
}

interface BoardDetail {
  id: string;
  name: string;
  scenes: SceneView[];
}

const VIDEO_REFERENCE_CAP = 10;

/** Omni's 8-second atomic unit, the same one Studio's own Video kind uses. One board scene is
 *  one clip; there is no multi-beat planning here, each scene is its own film. */
const SCENE_DURATION_SECONDS = 8;

export function StoryboardWorkspace({
  workspaceId,
  initialBoards,
}: {
  workspaceId: string;
  initialBoards: Array<{ id: string; name: string; sceneCount: number; createdAt: Date | string }>;
}) {
  const base = `/api/w/${workspaceId}`;
  const show = useToast();

  const [boards, setBoards] = useState<BoardSummary[]>(
    initialBoards.map((b) => ({ ...b, createdAt: String(b.createdAt) })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [collapseAll, setCollapseAll] = useState(false);
  const [costPerScene, setCostPerScene] = useState<number | null>(null);
  const [newBoardName, setNewBoardName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadBoard = useCallback(
    async (id: string) => {
      setLoadingBoard(true);
      const r = await fetch(`${base}/storyboards/${id}`).catch(() => null);
      setLoadingBoard(false);
      if (r?.ok) {
        const { storyboard } = (await r.json()) as { storyboard: BoardDetail };
        setBoard(storyboard);
      }
    },
    [base],
  );

  function selectBoard(id: string | null) {
    setSelectedId(id);
    if (id) void loadBoard(id);
    else setBoard(null);
  }

  // The per-scene cost, so "Generate all" can show a total without a new estimate endpoint.
  useEffect(() => {
    void fetch(`${base}/generate/video/estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intentText: 'placeholder',
        targetPlatform: 'instagram',
        aspectRatio: '16:9',
        targetDurationSeconds: SCENE_DURATION_SECONDS,
        voiceover: true,
        videoModel: 'gemini-omni-1.1-flash',
      }),
    })
      .then(async (r) =>
        r.ok ? ((await r.json()) as { estimate: { videoSeconds: number } }) : null,
      )
      .then((body) => setCostPerScene(body?.estimate.videoSeconds ?? null))
      .catch(() => setCostPerScene(null));
  }, [base]);

  async function createBoard() {
    const name = newBoardName.trim();
    if (!name || creating) return;
    setCreating(true);
    const r = await fetch(`${base}/storyboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    setCreating(false);
    if (!r?.ok) {
      show({ tone: 'bad', message: 'Could not create the board. Try again.' });
      return;
    }
    const { storyboard } = (await r.json()) as { storyboard: { id: string; name: string } };
    setBoards((current) => [
      { id: storyboard.id, name: storyboard.name, sceneCount: 0, createdAt: new Date().toISOString() },
      ...current,
    ]);
    setNewBoardName('');
    selectBoard(storyboard.id);
  }

  async function deleteBoard(id: string) {
    await fetch(`${base}/storyboards/${id}`, { method: 'DELETE' }).catch(() => null);
    setBoards((current) => current.filter((b) => b.id !== id));
    if (selectedId === id) selectBoard(null);
  }

  async function addScene() {
    if (!board) return;
    const r = await fetch(`${base}/storyboards/${board.id}/scenes`, { method: 'POST' }).catch(
      () => null,
    );
    if (!r?.ok) return;
    const { scene } = (await r.json()) as { scene: SceneView };
    setBoard((current) => (current ? { ...current, scenes: [...current.scenes, scene] } : current));
    setBoards((current) =>
      current.map((b) => (b.id === board.id ? { ...b, sceneCount: b.sceneCount + 1 } : b)),
    );
  }

  async function removeScene(sceneId: string) {
    if (!board) return;
    await fetch(`${base}/storyboards/${board.id}/scenes/${sceneId}`, { method: 'DELETE' }).catch(
      () => null,
    );
    setBoard((current) =>
      current ? { ...current, scenes: current.scenes.filter((s) => s.id !== sceneId) } : current,
    );
    setBoards((current) =>
      current.map((b) =>
        b.id === board.id ? { ...b, sceneCount: Math.max(0, b.sceneCount - 1) } : b,
      ),
    );
  }

  function patchSceneLocal(sceneId: string, patch: Partial<SceneView>) {
    setBoard((current) =>
      current
        ? {
            ...current,
            scenes: current.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)),
          }
        : current,
    );
  }

  async function saveScenePrompt(sceneId: string, prompt: string) {
    if (!board) return;
    await fetch(`${base}/storyboards/${board.id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }).catch(() => null);
  }

  async function uploadReference(sceneId: string, file: File) {
    const scene = board?.scenes.find((s) => s.id === sceneId);
    if (!scene || scene.references.length >= VIDEO_REFERENCE_CAP) return;
    const form = new FormData();
    form.set('file', file);
    const r = await fetch(`${base}/references`, { method: 'POST', body: form }).catch(() => null);
    if (!r?.ok) {
      show({ tone: 'bad', message: 'That image could not be uploaded.' });
      return;
    }
    const { reference } = (await r.json()) as { reference: SceneReference };
    const references = [...scene.references, reference];
    patchSceneLocal(sceneId, { references });
    if (board) {
      await fetch(`${base}/storyboards/${board.id}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ references }),
      }).catch(() => null);
    }
  }

  async function removeReference(sceneId: string, key: string) {
    const scene = board?.scenes.find((s) => s.id === sceneId);
    if (!scene || !board) return;
    const references = scene.references.filter((r) => r.key !== key);
    patchSceneLocal(sceneId, { references });
    await fetch(`${base}/storyboards/${board.id}/scenes/${sceneId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ references }),
    }).catch(() => null);
  }

  async function generateScene(sceneId: string) {
    if (!board) return;
    patchSceneLocal(sceneId, { status: 'generating', error: null });
    const r = await fetch(`${base}/storyboards/${board.id}/scenes/${sceneId}/generate`, {
      method: 'POST',
    }).catch(() => null);
    const body = (await r?.json().catch(() => ({}))) as {
      job?: { id: string };
      error?: { code: string };
    };
    if (!r?.ok || !body.job) {
      patchSceneLocal(sceneId, {
        status: 'failed',
        error: body.error?.code ?? 'Could not start generation',
      });
      return;
    }
    patchSceneLocal(sceneId, { jobId: body.job.id });
  }

  async function generateAll() {
    if (!board) return;
    const pending = board.scenes.filter(
      (s) => s.status !== 'complete' && s.status !== 'generating' && s.prompt.trim(),
    );
    if (pending.length === 0) return;
    for (const scene of pending) patchSceneLocal(scene.id, { status: 'generating', error: null });
    await fetch(`${base}/storyboards/${board.id}/generate-all`, { method: 'POST' }).catch(
      () => null,
    );
    // The route persists each scene's jobId; reload to pick them up and start watching.
    await loadBoard(board.id);
  }

  async function onSceneComplete(sceneId: string, jobId: string) {
    const r = await fetch(`${base}/jobs/${jobId}/outputs`).catch(() => null);
    const body = (await r?.json().catch(() => ({}))) as {
      outputs?: Array<{ id: string; media: { url: string } | null }>;
    };
    const output = body.outputs?.[0];
    if (!r?.ok || !output?.media) {
      patchSceneLocal(sceneId, { status: 'failed', error: 'No clip came back' });
      return;
    }
    patchSceneLocal(sceneId, { status: 'complete', videoUrl: output.media.url, error: null });
    if (board) {
      await fetch(`${base}/storyboards/${board.id}/scenes/${sceneId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outputId: output.id, videoUrl: output.media.url, status: 'complete' }),
      }).catch(() => null);
    }
  }

  function onSceneFailed(sceneId: string) {
    patchSceneLocal(sceneId, { status: 'failed', error: 'Generation failed' });
  }

  const readyCount = board?.scenes.filter((s) => s.status === 'complete').length ?? 0;
  const totalScenes = board?.scenes.length ?? 0;
  const pendingCount =
    board?.scenes.filter((s) => s.status !== 'complete' && s.status !== 'generating' && s.prompt.trim())
      .length ?? 0;
  const generateAllCost =
    costPerScene !== null && pendingCount > 0 ? costPerScene * pendingCount : null;

  return (
    <div className="flex gap-6">
      <aside className="w-56 shrink-0">
        <div className="flex items-center justify-between px-1">
          <span className="text-label font-medium text-muted">Storyboards</span>
        </div>
        <div className="mt-2 flex flex-col gap-1">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBoard(b.id)}
              className={cx(
                'group flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                b.id === selectedId
                  ? 'bg-raised text-ink'
                  : 'text-muted hover:bg-raised/60 hover:text-ink',
              )}
            >
              <span className="truncate">{b.name}</span>
              <span className="flex items-center gap-1">
                <Badge tone="neutral">{b.sceneCount}</Badge>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteBoard(b.id);
                  }}
                  className="hidden cursor-pointer text-faint hover:text-bad group-hover:inline-flex"
                  aria-label={`Delete ${b.name}`}
                >
                  <CloseIcon width={14} height={14} />
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-1.5 px-1">
          <input
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createBoard();
            }}
            placeholder="New board name"
            className="h-9 w-full rounded-lg border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-faint focus:border-accent/70"
          />
          <Button
            variant="secondary"
            className="h-9 w-9 shrink-0 px-0"
            onClick={() => void createBoard()}
            disabled={creating || !newBoardName.trim()}
            aria-label="Create board"
          >
            <PlusIcon width={16} height={16} />
          </Button>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        {!board ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-line text-sm text-muted">
            {loadingBoard
              ? 'Loading…'
              : boards.length === 0
                ? 'Name a board on the left to start your first storyboard.'
                : 'Pick a board on the left.'}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-title font-semibold text-ink">{board.name}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">16:9</Badge>
                <Badge tone="neutral">{SCENE_DURATION_SECONDS}s</Badge>
                <Badge tone="accent">Gemini Omni</Badge>
                <Badge tone="accent">Cinematic voiceover</Badge>
                <Button
                  variant="secondary"
                  onClick={() => void generateAll()}
                  disabled={pendingCount === 0}
                >
                  Generate all {pendingCount > 0 ? pendingCount : ''}
                  {generateAllCost !== null ? (
                    <span className="font-mono text-caption text-muted">
                      &nbsp;· {generateAllCost}s
                    </span>
                  ) : null}
                </Button>
                <div className="flex items-center gap-2">
                  <span className="text-caption text-muted">Collapse all</span>
                  <Toggle on={collapseAll} onChange={setCollapseAll} label="Collapse all scene cards" />
                </div>
                <Button
                  variant="quiet"
                  onClick={() =>
                    show({
                      tone: 'neutral',
                      message:
                        readyCount > 0
                          ? `${readyCount} finished clip${readyCount === 1 ? '' : 's'} already saved to Assets.`
                          : 'Generate at least one scene before sending it on.',
                    })
                  }
                >
                  Send to Timeline
                </Button>
              </div>
            </div>

            <div className="mt-5 flex gap-4 overflow-x-auto pb-2">
              {board.scenes.map((scene) => (
                <SceneCard
                  key={scene.id}
                  base={base}
                  scene={scene}
                  collapsed={collapseAll}
                  onPromptChange={(prompt) => patchSceneLocal(scene.id, { prompt })}
                  onPromptSave={(prompt) => void saveScenePrompt(scene.id, prompt)}
                  onUploadReference={(file) => void uploadReference(scene.id, file)}
                  onRemoveReference={(key) => void removeReference(scene.id, key)}
                  onGenerate={() => void generateScene(scene.id)}
                  onRemove={() => void removeScene(scene.id)}
                  onComplete={(jobId) => void onSceneComplete(scene.id, jobId)}
                  onFailed={() => onSceneFailed(scene.id)}
                />
              ))}
              <button
                type="button"
                onClick={() => void addScene()}
                className="flex h-64 w-40 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-muted transition-colors hover:border-faint hover:text-ink"
              >
                <PlusIcon width={20} height={20} />
                <span className="text-sm">Add scene</span>
              </button>
            </div>

            {totalScenes > 0 ? (
              <p className="mt-3 text-caption text-faint">
                {readyCount} of {totalScenes} scenes filmed.
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function SceneCard({
  base,
  scene,
  collapsed,
  onPromptChange,
  onPromptSave,
  onUploadReference,
  onRemoveReference,
  onGenerate,
  onRemove,
  onComplete,
  onFailed,
}: {
  base: string;
  scene: SceneView;
  collapsed: boolean;
  onPromptChange: (prompt: string) => void;
  onPromptSave: (prompt: string) => void;
  onUploadReference: (file: File) => void;
  onRemoveReference: (key: string) => void;
  onGenerate: () => void;
  onRemove: () => void;
  onComplete: (jobId: string) => void;
  onFailed: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobId = scene.jobId;

  useEffect(() => {
    if (!jobId || scene.status !== 'generating') return;
    const events = new EventSource(`${base}/jobs/${jobId}/events`);
    events.addEventListener('status', (e) => {
      const { job } = JSON.parse((e as MessageEvent<string>).data) as {
        job: { status: string };
      };
      if (job.status === 'COMPLETE') {
        events.close();
        onComplete(jobId);
      } else if (['BLOCKED', 'FAILED', 'CANCELLED'].includes(job.status)) {
        events.close();
        onFailed();
      }
    });
    return () => events.close();
    // onComplete/onFailed close over scene.id and are re-created each render; fine, the
    // EventSource itself only keys off jobId/status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, jobId, scene.status]);

  return (
    <div
      className={cx(
        'flex shrink-0 flex-col gap-2 rounded-2xl border border-line bg-raised p-2.5',
        collapsed ? 'w-40' : 'w-72',
      )}
    >
      <div className="flex items-center justify-between">
        <Badge tone="neutral">Scene {scene.index + 1}</Badge>
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer text-faint hover:text-bad"
          aria-label="Remove this scene"
        >
          <CloseIcon width={14} height={14} />
        </button>
      </div>

      <div
        className={cx(
          'relative flex items-center justify-center overflow-hidden rounded-xl bg-canvas',
          collapsed ? 'aspect-video' : 'aspect-video',
        )}
      >
        {scene.videoUrl ? (
          <video src={scene.videoUrl} controls className="size-full object-cover" />
        ) : (
          <span className="text-caption text-faint">
            {scene.status === 'generating' ? 'Filming…' : 'No clip yet'}
          </span>
        )}
      </div>

      {!collapsed ? (
        <>
          <textarea
            value={scene.prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onBlur={(e) => onPromptSave(e.target.value)}
            placeholder="What happens in this scene…"
            rows={2}
            className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-caption text-ink outline-none placeholder:text-faint focus:border-accent/70"
          />

          <div className="flex flex-wrap gap-1.5">
            {scene.references.map((ref) => (
              <div key={ref.key} className="group relative size-9 overflow-hidden rounded-md border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ref.url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveReference(ref.key)}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 text-canvas opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Remove this reference image"
                >
                  <CloseIcon width={12} height={12} />
                </button>
              </div>
            ))}
            {scene.references.length < VIDEO_REFERENCE_CAP ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Add a reference image"
                className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-dashed border-line text-faint hover:border-faint hover:text-ink"
              >
                <PlusIcon width={14} height={14} />
              </button>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadReference(file);
                e.target.value = '';
              }}
            />
          </div>
        </>
      ) : null}

      <Button
        variant={scene.status === 'complete' ? 'secondary' : 'primary'}
        onClick={onGenerate}
        disabled={scene.status === 'generating' || !scene.prompt.trim()}
        className="h-8 w-full text-caption"
      >
        {scene.status === 'generating'
          ? 'Filming…'
          : scene.status === 'complete'
            ? 'Regenerate'
            : 'Generate'}
      </Button>
      {scene.error ? <p className="text-caption text-bad">{scene.error}</p> : null}
    </div>
  );
}
