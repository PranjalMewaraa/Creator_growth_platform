// Reading an MP4's own header, because a clip that comes back from a long running operation
// has to describe itself: the poll response does not echo the request, the adapter instance is
// shared by every job, and a worker that restarts mid render has forgotten what it asked for.
//
// Only the two boxes that matter are read: mvhd for the duration, tkhd for the frame.

export interface Mp4Info {
  width: number;
  height: number;
  durationSeconds: number;
}

interface Box {
  type: string;
  start: number;
  end: number;
}

/** The boxes directly inside the given range. MP4 is a tree of length-prefixed boxes. */
function boxes(view: DataView, from: number, to: number): Box[] {
  const found: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(
      view.getUint8(at + 4),
      view.getUint8(at + 5),
      view.getUint8(at + 6),
      view.getUint8(at + 7),
    );
    // 0 means the box runs to the end of the file; 1 means a 64 bit size follows the type.
    const length = size === 0 ? to - at : size === 1 ? Number(view.getBigUint64(at + 8)) : size;
    if (length < 8) return found;
    found.push({ type, start: at + (size === 1 ? 16 : 8), end: Math.min(at + length, to) });
    at += length;
  }
  return found;
}

function find(view: DataView, list: Box[], type: string): Box | undefined {
  return list.find((box) => box.type === type);
}

/** The frame and duration of an MP4, or nothing when the bytes are not one. */
export function mp4Info(data: Uint8Array): Mp4Info | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 16) return undefined;

  const top = boxes(view, 0, data.byteLength);
  if (!find(view, top, 'ftyp')) return undefined;
  const moov = find(view, top, 'moov');
  if (!moov) return undefined;

  const inMoov = boxes(view, moov.start, moov.end);
  const mvhd = find(view, inMoov, 'mvhd');
  let durationSeconds = 0;
  if (mvhd) {
    const version = view.getUint8(mvhd.start);
    const at = mvhd.start + 4; // after version and flags
    const timescale = version === 1 ? view.getUint32(at + 16) : view.getUint32(at + 8);
    const duration = version === 1 ? Number(view.getBigUint64(at + 20)) : view.getUint32(at + 12);
    if (timescale > 0) durationSeconds = Number((duration / timescale).toFixed(3));
  }

  // The first track with a frame is the video; audio tracks carry zeroes here.
  for (const trak of inMoov.filter((box) => box.type === 'trak')) {
    const tkhd = find(view, boxes(view, trak.start, trak.end), 'tkhd');
    if (!tkhd) continue;
    const version = view.getUint8(tkhd.start);
    // width and height are the last two fields, as 16.16 fixed point.
    const width = view.getUint32(tkhd.end - 8) / 65_536;
    const height = view.getUint32(tkhd.end - 4) / 65_536;
    if (width > 0 && height > 0) {
      return { width: Math.round(width), height: Math.round(height), durationSeconds };
    }
    void version;
  }
  return undefined;
}
