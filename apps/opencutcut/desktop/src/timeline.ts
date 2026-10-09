/**
 * Các phép tính thuần cho timeline. Tách riêng khỏi React để test được và để
 * App chỉ lo phần hiển thị. Mọi hàm trả về mảng mới, không sửa input.
 */

export type TrackItem = {
  id: string;
  start: number;
  duration: number;
};

/**
 * Các hàm dưới đây là hàm đồng nhất theo `T extends TrackItem`, nên giữ nguyên
 * các trường riêng của từng loại mục (clip, chữ, audio) khi sắp xếp lại.
 */

/** Đóng lại các mục của một track cho sát nhau theo thứ tự start. */
export function pack<T extends TrackItem>(items: T[]): T[] {
  const sorted = [...items].sort((a, b) => a.start - b.start);
  let cursor = 0;
  return sorted.map((item) => {
    const next = { ...item, start: cursor };
    cursor += item.duration;
    return next;
  });
}

/**
 * Chuyển một mục sang vị trí mới (kéo trên timeline). `targetStart` là thời điểm
 * người dùng thả chuột, `duration` là thời lượng sau khi cắt/kéo.
 */
export function moveItem<T extends TrackItem>(
  items: T[],
  id: string,
  targetStart: number
): T[] {
  const target = items.find((i) => i.id === id);
  if (!target) return items;
  const start = Math.max(0, targetStart);
  const rest = items
    .filter((i) => i.id !== id)
    .sort((a, b) => a.start - b.start);
  const idx = rest.findIndex((i) => i.start + i.duration > start);
  const insertAt = idx === -1 ? rest.length : idx;
  return pack([...rest.slice(0, insertAt), { ...target, start }, ...rest.slice(insertAt)]);
}

/**
 * Kéo một mục sang vị trí bất kỳ, giữ nguyên vị trí của các mục khác nên tạo
 * được khoảng trống. Đây là hành vi kéo trên timeline.
 */
export function moveItemFree<T extends TrackItem>(
  items: T[],
  id: string,
  targetStart: number
): T[] {
  const start = Math.max(0, targetStart);
  return items.map((item) => (item.id === id ? { ...item, start } : item));
}

/** Khoảng cách (giây) giữa vùng đang kéo và mép gần nhất của mục khác. */
export function gapToNearestEdge<T extends TrackItem>(
  items: T[],
  id: string,
  start: number,
  duration: number
): number | null {
  let best: number | null = null;
  for (const item of items) {
    if (item.id === id) continue;
    for (const edge of [item.start, item.start + item.duration]) {
      const d = Math.min(Math.abs(edge - start), Math.abs(edge - (start + duration)));
      if (best === null || d < best) best = d;
    }
  }
  return best;
}

/**
 * Thả một mục tại vị trí chuột. Thả sát mép mục khác (mặc định 0,35 giây) thì
 * chèn xen vào giữa và đóng các mục phía sau lại liền mạch; xa hơn thì đặt tự do
 * và giữ khoảng trống.
 */
export function dropItem<T extends TrackItem>(
  items: T[],
  item: T,
  cursor: number,
  snapThreshold = 0.35
): T[] {
  const start = Math.max(0, cursor);
  const gap = gapToNearestEdge(items, item.id, start, item.duration);
  if (gap !== null && gap <= snapThreshold) {
    return insertItem(items, item, start);
  }
  // Thả xa mép: đặt tự do. Mục chưa tồn tại thì thêm mới vào danh sách.
  const existing = items.some((i) => i.id === item.id);
  const moved = existing ? moveItemFree(items, item.id, start) : [...items, { ...item, start }];
  return moved.sort((a, b) => a.start - b.start);
}

/**
 * Dán vị trí thả vào mép gần nhất của clip khác nếu đang ở trong ngưỡng.
 *
 * Khi kéo clip trên timeline, CapCut bám vào mép của clip lân nận. Hàm trả về
 * vị trí đã dán, hoặc nguyên `start` nếu không clip nào đủ gần.
 */
export function snapToEdge(
  items: TrackItem[],
  id: string,
  start: number,
  threshold = 0.25
): number {
  let best: number | null = null;
  for (const item of items) {
    if (item.id === id) continue;
    for (const edge of [item.start, item.start + item.duration]) {
      // Mép nào thì dán mép đối diện của clip đang kéo vào đó.
      const candidate = edge;
      const d = Math.abs(candidate - start);
      if (d <= threshold && (best === null || d < Math.abs(best - start))) best = candidate;
    }
  }
  return best ?? start;
}

/**
 * Kéo mép trái/phải để cắt. Trả về start/duration mới; bên trái giữ đuôi cố
 * định, bên phải giữ đầu cố định.
 */
export function trimItem<T extends TrackItem>(
  items: T[],
  id: string,
  edge: "start" | "end",
  delta: number,
  minDuration = 0.1
): T[] {
  const trimmed = items.map((item) => {
    if (item.id !== id) return item;
    if (edge === "start") {
      // Mép trái giữ đuôi cố định nên vị trí các mục sau không đổi, không pack lại.
      const maxDelta = item.duration - minDuration;
      const shift = clamp(delta, -item.start, maxDelta);
      return {
        ...item,
        start: item.start + shift,
        duration: item.duration - shift,
      };
    }
    const nextDuration = Math.max(minDuration, item.duration + delta);
    return { ...item, duration: nextDuration };
  });
  return edge === "end" ? pack(trimmed) : trimmed;
}

/**
 * Thêm mục mới tại vị trí thả. `cursor` là thời điểm bắt đầu của mục mới; các
 * mục phía sau được dồn sang phải nếu chỗ trống không đủ.
 */
export function insertItem<T extends TrackItem>(items: T[], item: T, cursor: number): T[] {
  const start = Math.max(0, cursor);
  const rest = items.filter((i) => i.id !== item.id).sort((a, b) => a.start - b.start);
  if (rest.length === 0) return [{ ...item, start }];
  const idx = rest.findIndex((i) => i.start + i.duration > start);
  const insertAt = idx === -1 ? rest.length : idx;
  return pack([...rest.slice(0, insertAt), { ...item, start }, ...rest.slice(insertAt)]);
}

/**
 * Nối một dự án khác vào cuối dự án đang có, dịch mọi mục sang sau cho khớp.
 *
 * Dùng cho "Ghép nhiều dự án": bản nguồn được đặt nối tiếp, không lẫn vào
 * dòng thời hiện tại nên vẫn sửa được từng clip như cũ.
 */
export function noiDuAn<T extends TrackItem>(
  hienTai: T[],
  nguon: T[],
  taoId: () => string = () => crypto.randomUUID()
): T[] {
  if (nguon.length === 0) return hienTai;
  const lech = hienTai.reduce((max, i) => Math.max(max, i.start + i.duration), 0);
  // Sinh id mới: id cũ đã nằm trong dự án đích, trùng id làm React báo lỗi
  // và thao tác chỉnh sửa sẽ nhắm nhầm mục.
  return [
    ...hienTai,
    ...nguon.map((i) => ({ ...i, id: taoId(), start: i.start + lech })),
  ];
}

/**
 * Tốc độ của một mục tại thời điểm tuyệt đối `t`.
 *
 * Mục không có keyframe tốc độ thì trả `speed`. Có thì nội suy tuyến tính giữa
 * các mốc, và ngoài khoảng mốc đầu/cuối thì giữ nguyên tốc độ ở hai biên —
 * giống cách ffmpeg dựng video, để xem trước khớp với kết quả xuất.
 */
export function tocDoTai<T extends { speed: number; start: number; duration: number; keyframes: Array<{ time: number; prop: string; value: number }> }>(
  item: T,
  t: number
): number {
  const moc = item.keyframes
    .filter((k) => k.prop === "speed")
    .map((k) => ({ t: k.time - item.start, v: k.value }))
    .sort((a, b) => a.t - b.t);
  if (moc.length === 0) return item.speed;
  const goc = moc[0].t <= 0.001 ? moc : [{ t: 0, v: moc[0].v }, ...moc];
  const cuoi = goc[goc.length - 1].t >= item.duration - 0.001
    ? goc
    : [...goc, { t: item.duration, v: goc[goc.length - 1].v }];
  const x = t - item.start;
  if (x <= cuoi[0].t) return cuoi[0].v;
  for (let i = 0; i < cuoi.length - 1; i++) {
    const a = cuoi[i];
    const b = cuoi[i + 1];
    if (x < b.t) {
      const span = b.t - a.t;
      // Hai mốc trùng thời điểm thì lấy mốc sau, khớp với lúc dựng video.
      return span <= 1e-6 ? b.v : a.v + (b.v - a.v) * ((x - a.t) / span);
    }
  }
  return cuoi[cuoi.length - 1].v;
}

/**
 * Lặp lại một mục `soLan` lần liên tiếp.
 *
 * Mọi mục nằm sau đoạn lặp bị dời sang phải cho vừa. Chuyển cảnh của mục gốc
 * chuyển sang bản lặp cuối cùng để mối nối với mục kế tiếp giữ nguyên như cũ;
 * các bản lặp ở giữa không có chuyển cảnh để tránh dồn hiệu ứng.
 */
export function lapLai<T extends TrackItem & { transition?: string }>(
  items: T[],
  id: string,
  soLan: number,
  taoId: () => string = () => crypto.randomUUID()
): T[] {
  const goc = items.find((i) => i.id === id);
  const lan = Math.max(1, Math.floor(soLan));
  if (!goc || lan === 1) return items;
  const dich = goc.duration * (lan - 1);
  const cuoi = goc.start + goc.duration;
  return items.flatMap((i) => {
    if (i.id === id) {
      return Array.from({ length: lan }, (_, k) => {
        const ban = k === 0 ? { ...i } : { ...i, id: taoId() };
        if (k > 0) ban.start = goc.start + goc.duration * k;
        // Chuyển cảnh gốc vốn nối mục này với mục kế tiếp; sau khi lặp thì mục
        // kế tiếp là bản lặp kế, nên chỉ bản cuối mới giữ chuyển cảnh.
        ban.transition = k === lan - 1 ? i.transition : "none";
        return ban;
      });
    }
    return i.start >= cuoi ? [{ ...i, start: i.start + dich }] : [i];
  });
}

/** Chia một mục tại thời điểm tuyệt đối `at`, trả về id của mảnh mới. */
export function splitItem<T extends TrackItem>(
  items: T[],
  id: string,
  at: number
): { items: T[]; newId: string | null } {
  const target = items.find((i) => i.id === id);
  if (!target) return { items, newId: null };
  const offset = at - target.start;
  if (offset <= 0.001 || offset >= target.duration - 0.001) {
    return { items, newId: null };
  }
  const newId = `${id}-split-${Math.round(offset * 1000)}`;
  const next = items.flatMap((item) =>
    item.id === id
      ? [
          { ...item, duration: offset },
          { ...item, id: newId, start: target.start + offset, duration: target.duration - offset },
        ]
      : [item]
  );
  return { items: next, newId };
}

/** Xóa một mục và đóng lại khoảng trống còn lại (ripple delete). */
export function removeItem<T extends TrackItem>(items: T[], id: string): T[] {
  return pack(items.filter((i) => i.id !== id));
}

/** Xóa một mục rồi dồn mọi mục phía sau về trước đúng bằng độ dài bị xóa. */
export function rippleDelete<T extends TrackItem>(items: T[], id: string): T[] {
  const target = items.find((i) => i.id === id);
  if (!target) return items;
  const gap = target.duration;
  const rest = items
    .filter((i) => i.id !== id)
    .sort((a, b) => a.start - b.start)
    .map((item) =>
      item.start >= target.start ? { ...item, start: Math.max(0, item.start - gap) } : item
    );
  return pack(rest);
}

/** Đổi chỗ hai mục (nhấn phím hoặc kéo chéo). */
export function reorderItem<T extends TrackItem>(items: T[], fromId: string, toId: string): T[] {
  const from = items.find((i) => i.id === fromId);
  const to = items.find((i) => i.id === toId);
  if (!from || !to || fromId === toId) return items;
  const swapped = items.map((item) => {
    if (item.id === fromId) return { ...item, start: to.start };
    if (item.id === toId) return { ...item, start: from.start };
    return item;
  });
  return pack(swapped);
}

/**
 * Tổng thời lượng của track.
 */
export function totalDuration(items: TrackItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.start + item.duration), 0);
}

/** Chuyển pixel trên timeline thành giây. */
export function pixelToTime(px: number, pxPerSecond: number): number {
  if (pxPerSecond <= 0) return 0;
  return Math.max(0, px / pxPerSecond);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Keyframe
// ---------------------------------------------------------------------------

/** Thuộc tính nào chạy được keyframe. */
export type KeyframableProp =
  | "brightness"
  | "contrast"
  | "saturation"
  | "scale"
  | "x"
  | "y"
  | "opacity"
  | "speed";

export type Keyframe = {
  id: string;
  /** Thời điểm tuyệt đối trên timeline (giây), không phải offset trong clip. */
  time: number;
  prop: KeyframableProp;
  value: number;
};

export type KeyframeTarget = {
  start: number;
  duration: number;
  keyframes: Keyframe[];
};

/** Thêm keyframe, nếu đã có keyframe đúng thời điểm thì cập nhật giá trị. */
export function addKeyframe(
  keyframes: Keyframe[],
  time: number,
  prop: KeyframableProp,
  value: number
): Keyframe[] {
  const existing = keyframes.find((k) => k.prop === prop && Math.abs(k.time - time) < 0.001);
  if (existing) {
    return keyframes.map((k) => (k.id === existing.id ? { ...k, value } : k));
  }
  return [...keyframes, { id: crypto.randomUUID(), time, prop, value }];
}

/** Bỏ keyframe gần thời điểm nhất trong khoảng 1 khung hình. */
export function removeKeyframe(
  keyframes: Keyframe[],
  time: number,
  prop: KeyframableProp,
  epsilon = 0.05
): Keyframe[] {
  const target = keyframes.find((k) => k.prop === prop && Math.abs(k.time - time) <= epsilon);
  if (!target) return keyframes;
  return keyframes.filter((k) => k.id !== target.id);
}

/**
 * Nội suy giá trị tại thời điểm tuyệt đối `time`. Ngoài khoảng đầu-cuối thì giữ
 * giá trị ở hai đầu, đúng như hành vi keyframe của CapCut.
 */
export function valueAtTime(
  target: KeyframeTarget,
  prop: KeyframableProp,
  time: number,
  fallback = 0
): number {
  const points = target.keyframes
    .filter((k) => k.prop === prop)
    .sort((a, b) => a.time - b.time);
  if (points.length === 0) return fallback;
  const first = points[0];
  const last = points[points.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (time >= a.time && time <= b.time) {
      const span = b.time - a.time;
      if (span <= 0.0001) return b.value;
      const ratio = (time - a.time) / span;
      return a.value + (b.value - a.value) * ratio;
    }
  }
  return last.value;
}

/** Các thời điểm có keyframe của một thuộc tính, đã sắp xếp. */
export function keyframeTimes(target: KeyframeTarget, prop?: KeyframableProp): number[] {
  return target.keyframes
    .filter((k) => (prop ? k.prop === prop : true))
    .map((k) => k.time)
    .sort((a, b) => a - b);
}

/**
 * Dựng biểu thức ffmpeg (biến `t`) từ các keyframe, nội suy tuyến tính từng đoạn.
 * Trả về biểu thức để dán vào filter, hoặc null nếu dưới 2 điểm.
 */
export function keyframeExpression(points: Array<{ time: number; value: number }>): string | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.time - b.time);
  let expr = String(round6(sorted[sorted.length - 1].value));
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const span = b.time - a.time;
    if (span <= 0.0001) {
      expr = String(round6(a.value));
      continue;
    }
    const slope = (b.value - a.value) / span;
    const ramp = `${round6(a.value)}+(${round6(slope)})*(t-${round6(a.time)})`;
    expr = `if(lt(t\\,${round6(b.time)})\\,${ramp}\\,${expr})`;
  }
  return expr;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Đồng bộ theo nhịp
// ---------------------------------------------------------------------------

export type BeatGrid = {
  /** Nhịp đầu tiên (giây). */
  firstBeat: number;
  /** Khoảng cách giữa hai nhịp (giây). */
  interval: number;
};

/** Các vạch nhịp từ thời điểm bắt đầu cho tới hết dự án. */
export function beatMarkers(grid: BeatGrid, duration: number): number[] {
  if (grid.interval <= 0) return [];
  const markers: number[] = [];
  for (let t = grid.firstBeat; t <= duration + 1e-6; t += grid.interval) {
    markers.push(round6(t));
  }
  return markers;
}

/**
 * Ước lượng nhịp từ khoảng cách giữa các đỉnh năng lượng đã phát hiện.
 * Bỏ các đỉnh bị lệch quá 15% so với trung bình rồi tính lại trung bình.
 */
export function estimateBeatGrid(onsets: number[]): BeatGrid {
  if (onsets.length < 2) return { firstBeat: onsets[0] ?? 0, interval: 0 };
  const sorted = [...onsets].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  let interval = median(gaps);
  const kept = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap >= interval * 0.85) kept.push(sorted[i]);
  }
  const refined: number[] = [];
  for (let i = 1; i < kept.length; i++) refined.push(kept[i] - kept[i - 1]);
  if (refined.length > 0) interval = median(refined);
  return { firstBeat: kept[0], interval };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

/** Vùng cắt chuẩn hoá 0..1 so với khung hình gốc. */
export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const fullCrop = (): CropRect => ({ x: 0, y: 0, width: 1, height: 1 });

/** Đưa vùng cắt về trong khung, luôn giữ diện tích tối thiểu. */
export function normalizeCrop(crop: CropRect): CropRect {
  const width = clamp(crop.width, 0.05, 1);
  const height = clamp(crop.height, 0.05, 1);
  return {
    width,
    height,
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
  };
}

/** Tỉ lệ khung sau khi cắt. */
export function cropAspect(crop: CropRect, sourceAspect: number): number {
  return (crop.width * sourceAspect) / crop.height;
}