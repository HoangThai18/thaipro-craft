import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { hieuUng, idHieuUngHopLe, timHieuUng } from "./effects";
import {
  addKeyframe,
  beatMarkers,
  cropAspect,
  dropItem,
  estimateBeatGrid,
  fullCrop,
  keyframeTimes,
  lapLai,
  mocNoiKeNhau,
  tocDoTai,
  noiDuAn,
  normalizeCrop,
  pack,
  pixelToTime,
  snapToEdge,
  removeKeyframe,
  rippleDelete,
  splitItem,
  trimItem,
  valueAtTime,
  type BeatGrid,
  type CropRect,
  type Keyframe,
  type KeyframeTarget,
  type KeyframableProp,
} from "./timeline";
import {
  canRedo,
  canUndo,
  coalesce,
  commit,
  commitFrom,
  commitMerge,
  createHistory,
  redo,
  replace,
  undo,
} from "./history";

type Asset = {
  id: string;
  name: string;
  path: string;
  duration: number;
  /** Ghim lên đầu thư viện vì hay dùng. */
  pinned?: boolean;
};

type Adjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  highlights: number;
  shadows: number;
  fade: number;
  sharpen: number;
  vignette: number;
  blackWhite: boolean;
  /** Bảng HSL: mỗi dải màu một bộ ba số, sắc độ (-180..180), bão hoà, độ sáng. */
  hsl: Hsl;
};

/** Sáu dải màu, đúng thứ tự Rust dùng để ghép `huesaturation`. */
type DaiMau = "do" | "vang" | "luc" | "cyan" | "xanh" | "tim";

const DAI_MAU: Array<{ ten: DaiMau; nhan: string; mau: string }> = [
  { ten: "do", nhan: "Đỏ", mau: "#e23c3c" },
  { ten: "vang", nhan: "Vàng", mau: "#e2c53c" },
  { ten: "luc", nhan: "Lục", mau: "#3ce23c" },
  { ten: "cyan", nhan: "Xanh lá chàm", mau: "#3ce2e2" },
  { ten: "xanh", nhan: "Xanh dương", mau: "#3c5ce2" },
  { ten: "tim", nhan: "Tím", mau: "#c23ce2" },
];

const defaultDaiMau = (): DaiMauHsl => ({ hue: 0, sat: 0, lum: 0 });

const defaultHsl = (): Hsl => ({
  do: defaultDaiMau(),
  vang: defaultDaiMau(),
  luc: defaultDaiMau(),
  cyan: defaultDaiMau(),
  xanh: defaultDaiMau(),
  tim: defaultDaiMau(),
});

/** Bảng HSL lấy từ tệp dự án, bù mọi dải còn thiếu bằng 0. */
const doiHslDayDu = (raw: Partial<Hsl> | undefined): Hsl => {
  const goc = defaultHsl();
  if (!raw) return goc;
  const ra = {} as Hsl;
  for (const d of DAI_MAU) {
    ra[d.ten] = { ...goc[d.ten], ...(raw[d.ten] ?? {}) };
  }
  return ra;
};

type ChromaKey = {
  enabled: boolean;
  color: string;
  similarity: number;
  smoothness: number;
  spill: number;
};

type Curves = { master: string; red: string; green: string; blue: string };

type Lut = { path: string; strength: number };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|heic|bmp|tiff?)$/i;
const isImagePath = (p: string) => IMAGE_EXT.test(p);

/**
 * Đọc số từ ô nhập, chặn giá trị rỗng/NaN và ép về khoảng hợp lệ.
 *
 * Ô nhập cho phép gõ tạm ("", "-", "1.") nên không thể chặn ở tầng DOM; nếu để
 * giá trị âm lọt vào timeline, clip sẽ nằm ngoài khung và biến mất khỏi màn
 * hình. Vì vậy luôn chuẩn hoá khi đọc.
 */
const readNumber = (
  raw: string,
  fallback: number,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY
): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
};

type Clip = {
  id: string;
  name: string;
  path: string;
  /** Ảnh thì không có dòng thời gian, dùng `kind` để biết hiển thị thế nào. */
  kind: "video" | "image";
  duration: number;
  seekTo: number;
  start: number;
  track: number;
  speed: number;
  volume: number;
  muted: boolean;
  locked: boolean;
  mixMode: string;
  /** Hiệu ứng đang bật (id trong kho `effects.ts`), rỗng = không áp. */
  effect: string;
  /** Bật bản mạnh của hiệu ứng. */
  effectStrong: boolean;
  adjust: Adjust;
  crop: CropRect;
  chroma: ChromaKey;
  curves: Curves;
  lut: Lut;
  keyframes: Keyframe[];
  /** Đảo ngược thứ tự khung hình của clip. */
  reverse: boolean;
  /** Giữ nguyên một khung hình cuối clip trong suốt thời lượng clip. */
  freeze: boolean;
  /** Nội suy thêm khung hình khi giảm tốc, cho chuyển động mượt. */
  smooth: boolean;
  /** Chuyển cảnh ở mép phải của clip, nối sang clip kế tiếp. */
  transition: string;
  transitionDuration: number;
};

type TextLayer = {
  id: string;
  text: string;
  kind: "text" | "sticker";
  start: number;
  duration: number;
  x: number;
  y: number;
  size: number;
  color: string;
  align: "left" | "center";
  bold: boolean;
};

type AudioClip = {
  id: string;
  name: string;
  path: string;
  duration: number;
  start: number;
  volume: number;
  muted: boolean;
  beats: number[];
  waveform: number[];
  beatGrid: BeatGrid | null;
};

type Project = {
  clips: Clip[];
  texts: TextLayer[];
  audios: AudioClip[];
};

/** Một dải màu trong bảng HSL. */
type DaiMauHsl = { hue: number; sat: number; lum: number };

/** Bảng HSL của clip. */
type Hsl = Record<DaiMau, DaiMauHsl>;

const defaultAdjust = (): Adjust => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  highlights: 0,
  shadows: 0,
  fade: 0,
  sharpen: 0,
  vignette: 0,
  blackWhite: false,
  hsl: defaultHsl(),
});

const defaultChroma = (): ChromaKey => ({
  enabled: false,
  color: "#00FF00",
  similarity: 0.3,
  smoothness: 0.1,
  spill: 0.2,
});

const defaultCurves = (): Curves => ({ master: "", red: "", green: "", blue: "" });
const defaultLut = (): Lut => ({ path: "", strength: 1 });

/** Biểu tượng SVG gọn cho thanh công cụ dọc, vẽ tay để không cần thư viện. */
const Icon = ({ d, className = "h-5 w-5" }: { d: string; className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
  >
    <path d={d} />
  </svg>
);

const icons = {
  media: "M3 5h18v14H3zM3 15l5-4 4 3 3-2 6 5",
  audio: "M9 18V5l10-2v13M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0m10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0",
  text: "M5 5h14M12 5v14M9 19h6",
  sticker: "M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 2-2c0-1.1-.9-2-2-2h-1a2 2 0 0 1 0-4h4a5 5 0 0 0 5-5c0-3-4-5-9-5Z",
  effect: "M12 3v18M5 8l14 8M19 8 5 16",
  transition: "M4 8h11M4 16h11M17 5l3 3-3 3M17 13l3 3-3 3",
  canvas: "M4 7h16v10H4zM9 7v10M15 7v10",
  adjust: "M12 4v6m0 4v6M4 12h6m4 0h6M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4m8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  crop: "M6 2v16h16M2 6h16v16",
  chroma: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 3v18",
  curves: "M3 20C8 20 8 4 21 4",
  lut: "M3 17l5-6 4 4 4-7 5 5",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  mix: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 3v18",
  keyframe: "M12 4l3 4H9zM9 16h6l-3 4zM12 8v8",
} as const;

const tools = [
  { id: "media", label: "Phương tiện" },
  { id: "adjust", label: "Điều chỉnh" },
  { id: "crop", label: "Cắt ảnh" },
  { id: "chroma", label: "Nền xanh" },
  { id: "curves", label: "Đường cong" },
  { id: "lut", label: "LUT" },
  { id: "filters", label: "Bộ lọc" },
  { id: "mix", label: "Hòa trộn" },
  { id: "audio", label: "Âm thanh" },
  { id: "text", label: "Văn bản" },
  { id: "sticker", label: "Nhãn dán" },
  { id: "effect", label: "Hiệu ứng" },
  { id: "transition", label: "Chuyển cảnh" },
  { id: "canvas", label: "Khung hình" },
];

const filters = [
  { id: "none", label: "Tất cả" },
  { id: "grayscale", label: "Đen trắng" },
  { id: "warm", label: "Ấm" },
  { id: "cool", label: "Lạnh" },
  { id: "vintage", label: "Hoài niệm" },
  { id: "film", label: "Phim" },
  { id: "sepia", label: "Nâu sepia" },
  { id: "invert", label: "Đảo màu" },
  { id: "noir", label: "Tương phản mạnh" },
];

const mixModes = [
  { id: "normal", label: "Bình thường" },
  { id: "multiply", label: "Nhân" },
  { id: "screen", label: "Phóng sáng" },
  { id: "overlay", label: "Phủ" },
  { id: "soft_light", label: "Ánh sáng mềm" },
  { id: "hard_light", label: "Ánh sáng mạnh" },
  { id: "lighten", label: "Làm sáng" },
  { id: "darken", label: "Làm tối" },
  { id: "difference", label: "Hiệu ứng lệch" },
];

const transitions = [
  { id: "none", label: "Không" },
  { id: "fade", label: "Mờ dần" },
  { id: "fadeblack", label: "Mờ đen" },
  { id: "fadewhite", label: "Mờ trắng" },
  { id: "slideleft", label: "Trượt trái" },
  { id: "slideright", label: "Trượt phải" },
  { id: "slideup", label: "Trượt lên" },
  { id: "slidedown", label: "Trượt xuống" },
  { id: "wipeleft", label: "Quét trái" },
  { id: "wiperight", label: "Quét phải" },
  { id: "smoothleft", label: "Mượt trái" },
  { id: "smoothright", label: "Mượt phải" },
  { id: "circleopen", label: "Mở vòng" },
  { id: "circleclose", label: "Đóng vòng" },
  { id: "radial", label: "Toả tròn" },
  { id: "dissolve", label: "Hòa tan" },
  { id: "pixelize", label: "Pixel hoá" },
  { id: "distance", label: "Thu xa" },
  { id: "rectcrop", label: "Cắt chữ nhật" },
  { id: "circlecrop", label: "Cắt vòng" },
  { id: "vertopen", label: "Mở dọc" },
  { id: "vertclose", label: "Đóng dọc" },
  { id: "horzopen", label: "Mở ngang" },
  { id: "horzclose", label: "Đóng ngang" },
  { id: "smoothup", label: "Mượt lên" },
  { id: "smoothdown", label: "Mượt xuống" },
  { id: "hblur", label: "Mờ hình" },
  { id: "fadegrays", label: "Mờ xám" },
  { id: "fadefast", label: "Mờ nhanh" },
  { id: "fadeslow", label: "Mờ chậm" },
  { id: "hlslice", label: "Cắt ngang dọc" },
  { id: "hrslice", label: "Cắt ngang phải" },
  { id: "vuslice", label: "Cắt dọc trên" },
  { id: "vdslice", label: "Cắt dọc dưới" },
  { id: "wipetl", label: "Quét chéo trên" },
  { id: "wipetr", label: "Quét chéo phải" },
  { id: "wipebl", label: "Quét chéo dưới" },
  { id: "wipebr", label: "Quét chéo phải dưới" },
  { id: "squeezeh", label: "Bóp ngang" },
  { id: "squeezev", label: "Bóp dọc" },
  { id: "zoomin", label: "Thu vào" },
  { id: "diagbl", label: "Chéo dưới trái" },
  { id: "diagbr", label: "Chéo dưới phải" },
  { id: "hlwind", label: "Gió trái" },
  { id: "hrwind", label: "Gió phải" },
  { id: "vuwind", label: "Gió trên" },
  { id: "vdwind", label: "Gió dưới" },
  { id: "coverleft", label: "Che trái" },
  { id: "coverright", label: "Che phải" },
  { id: "coverup", label: "Che lên" },
  { id: "coverdown", label: "Che xuống" },
  { id: "revealleft", label: "Lộ trái" },
  { id: "revealright", label: "Lộ phải" },
  { id: "revealup", label: "Lộ lên" },
  { id: "revealdown", label: "Lộ xuống" },
];

const stickers = ["⭐", "❤️", "🔥", "😂", "👍", "🎉", "✨", "💯", "🎬", "📍", "🌈", "🚀"];

const ratios = [
  { id: "16:9", label: "16:9", w: 1280, h: 720 },
  { id: "9:16", label: "9:16", w: 720, h: 1280 },
  { id: "1:1", label: "1:1", w: 1080, h: 1080 },
  { id: "4:3", label: "4:3", w: 1024, h: 768 },
];

const curvePresets: Array<[string, string]> = [
  ["Tuyến tính", ""],
  ["Tương phản cao", "0/0 0.25/0.1 0.75/0.9 1/1"],
  ["Tràn sáng", "0/0 0.4/0.55 0.7/0.95 1/1"],
  ["Phim mờ", "0/0.06 0.5/0.5 1/0.94"],
  ["Ấm", "0/0.05 0.5/0.52 1/0.92"],
];

/** Mặc định và giới hạn của mức phóng timeline (pixel cho mỗi giây). */
const PX_DEFAULT = 40;
const PX_MIN = 4;
const PX_MAX = 240;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function cssFilter(clip: Clip | undefined, global: string): string {
  if (!clip) return "none";
  const a = clip.adjust;
  const parts: string[] = [];
  parts.push(`brightness(${(1 + a.brightness * 0.4).toFixed(3)})`);
  parts.push(`contrast(${(1 + a.contrast * 0.8).toFixed(3)})`);
  parts.push(`saturate(${clamp(1 + a.saturation, 0, 3).toFixed(3)})`);
  const temp = a.temperature;
  if (Math.abs(temp) > 0.001) {
    parts.push(
      temp > 0
        ? `sepia(${(temp * 0.5).toFixed(3)}) hue-rotate(${(-temp * 20).toFixed(1)}deg)`
        : `hue-rotate(${(-temp * 30).toFixed(1)}deg)`
    );
  }
  if (a.blackWhite) parts.push("grayscale(1)");
  if (a.sharpen > 0.001) parts.push(`contrast(${1 + a.sharpen * 0.15})`);
  if (global === "grayscale") parts.push("grayscale(1)");
  else if (global === "warm") parts.push("sepia(0.35) saturate(1.3)");
  else if (global === "cool") parts.push("saturate(0.8) hue-rotate(15deg)");
  else if (global === "vintage") parts.push("sepia(0.45) contrast(0.95)");
  else if (global === "film") parts.push("contrast(1.1) saturate(0.85)");
  parts.push(...cssHieuUng(clip));
  return parts.join(" ");
}

/**
 * Gần đúng hiệu ứng bằng CSS cho khung xem.
 *
 * ffmpeg làm hiệu ứng chính xác; CSS chỉ để người dùng thấy được ngay mà không
 * phải xuất video. Những hiệu ứng theo thời gian (lắc, chớp, xoay) không có
 * bản CSS nên preview tạm không đổi gì.
 */
function cssHieuUng(clip: Clip | undefined): string[] {
  if (!clip || !clip.effect) return [];
  const manh = clip.effectStrong;
  const p: Record<string, string[]> = {
    zoom_vao: ["contrast(1.05) saturate(1.05)"],
    zoom_ra: ["contrast(1.05)"],
    zoom_3d_vao: ["contrast(1.1)"],
    phim: ["sepia(0.2) contrast(1.05) saturate(0.85)"],
    truyen_anh: ["grayscale(1)"],
    sepia: ["sepia(0.7) saturate(1.1)"],
    vhs: ["contrast(1.2) saturate(1.5)"],
    retro_zoom: ["contrast(1.1) saturate(1.15)"],
    crt: ["saturate(1.15) contrast(1.1)"],
    loa_sieu: ["brightness(1.08) saturate(1.3)"],
    neon: ["saturate(1.6) contrast(1.2)"],
    trieu_luong: ["saturate(1.25) brightness(1.04)"],
    mo_man: ["blur(2px) brightness(1.05)"],
    doi_mau: ["invert(1)"],
    am_bao: ["grayscale(1) contrast(1.7)"],
    am: ["sepia(0.35) saturate(1.3)"],
    lanh: ["saturate(0.8) hue-rotate(15deg)"],
    hoai_niem: ["sepia(0.45) contrast(0.95)"],
    pixel: [manh ? "contrast(1.6) saturate(1.3)" : "contrast(1.3)"],
    guong: ["hue-rotate(180deg)"],
    phat_sang: [manh ? "brightness(1.3) saturate(1.4)" : "brightness(1.15)"],
    lam_mo: [`blur(${manh ? 8 : 3}px)`],
    tang_net: ["contrast(1.15)"],
    vien_toi: ["contrast(1.05)"],
  };
  return p[clip.effect] ?? [];
}

/**
 * Thước thời gian phía trên timeline: vạch chẻ và nhãn thời gian.
 *
 * Bước vạch chọn sao cho nhãn không dính nhau ở mọi mức phóng: 10px/giây thì vạch
 * mỗi 5 giây, 40px/giây thì mỗi giây, phóng to hơn thì chia thêm 1/2 và 1/4 giây.
 */
function TimeRuler({
  duration,
  pxPerSecond,
  onSeek,
}: {
  duration: number;
  pxPerSecond: number;
  onSeek: (t: number) => void;
}) {
  const major = useMemo(() => {
    for (const step of [0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]) {
      if (step * pxPerSecond >= 56) return step;
    }
    return 600;
  }, [pxPerSecond]);
  const minor = major / (major * pxPerSecond >= 160 ? 5 : 2);

  const marks: number[] = [];
  for (let t = 0; t <= duration + major; t += minor) {
    marks.push(Number(t.toFixed(4)));
  }

  const fmt = (t: number) => {
    if (t >= 60) {
      const m = Math.floor(t / 60);
      const s = t - m * 60;
      return `${m}:${s.toFixed(s % 1 ? 2 : 0).padStart(2, "0")}`;
    }
    return `${t.toFixed(t % 1 ? 2 : 0)}s`;
  };

  return (
    <div
      className="relative h-5 cursor-pointer select-none border-b border-[#2a2d33] bg-[#1a1c21]"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const at = clamp((e.clientX - rect.left) / pxPerSecond, 0, duration);
        onSeek(at);
      }}
      title="Bấm để nhảy tới vị trí"
    >
      {marks.map((t) => {
        const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
        return (
          <div key={t} className="absolute top-0 bottom-0" style={{ left: t * pxPerSecond }}>
            <div
              className={isMajor ? "h-2.5 w-px bg-[#5a5f6b]" : "h-1.5 w-px bg-[#3a3e47]"}
            />
            {isMajor && (
              <span className="absolute top-0.5 left-1 text-[9px] tabular-nums text-[#7b808b]">
                {fmt(t)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Định dạng tệp dự án.
 *
 * Chỉ lưu phần người dùng chỉnh được; mọi thứ suy ra từ media (dạng ảnh/video,
 * thời lượng thật) được tính lại khi mở để không lệch với tệp gốc.
 */
type ProjectFile = {
  /** Định dạng, để sau này đổi cấu trúc còn nhận biết được. */
  version: 1;
  ratio: string;
  filter: string;
  fps: number;
  quality: string;
  assets: Asset[];
  project: Project;
};

/** Clip tối thiểu, dùng làm nền khi bổ sung trường còn thiếu cho tệp cũ. */
const clipRong = (name: string, path: string): Clip => ({
  id: crypto.randomUUID(),
  name,
  path,
  kind: isImagePath(path) ? "image" : "video",
  duration: 5,
  seekTo: 0,
  start: 0,
  track: 0,
  speed: 1,
  volume: 1,
  muted: false,
  locked: false,
  mixMode: "normal",
  effect: "",
  effectStrong: false,
  adjust: defaultAdjust(),
  crop: fullCrop(),
  chroma: defaultChroma(),
  curves: defaultCurves(),
  lut: defaultLut(),
  keyframes: [],
  reverse: false,
  smooth: false,
  freeze: false,
  transition: "none",
  transitionDuration: 0.5,
});

/** Bổ sung trường còn thiếu cho clip cũ khi mở tệp dự án. */
const khoiPhucClip = (raw: any): Clip => {
  const path = String(raw?.path ?? "");
  return {
    ...clipRong(String(raw?.name ?? "clip"), path),
    ...raw,
    kind: isImagePath(path) ? "image" : "video",
    duration: Math.max(0.1, Number(raw?.duration ?? 5)),
    speed: clamp(Number(raw?.speed ?? 1), 0.1, 8),
    volume: clamp(Number(raw?.volume ?? 1), 0, 2),
    // Dự án cũ chưa có bảng HSL, và bảng cũ có thể thiếu dải, nên phải chộn
    // từng dải với giá trị mặc định thay vì chỉ ghi đè cả khối.
    adjust: {
      ...defaultAdjust(),
      ...(raw?.adjust ?? {}),
      hsl: doiHslDayDu(raw?.adjust?.hsl),
    },
    crop: { ...fullCrop(), ...(raw?.crop ?? {}) },
    chroma: { ...defaultChroma(), ...(raw?.chroma ?? {}) },
    curves: { ...defaultCurves(), ...(raw?.curves ?? {}) },
    lut: { ...defaultLut(), ...(raw?.lut ?? {}) },
    keyframes: Array.isArray(raw?.keyframes) ? raw.keyframes : [],
    reverse: Boolean(raw?.reverse),
    freeze: Boolean(raw?.freeze),
    smooth: Boolean(raw?.smooth),
    transition: typeof raw?.transition === "string" ? raw.transition : "none",
    effect: idHieuUngHopLe(String(raw?.effect ?? "")) ? String(raw.effect) : "",
    effectStrong: Boolean(raw?.effectStrong),
  };
};

const khoiPhucLopChu = (raw: any): TextLayer => ({
  id: String(raw?.id ?? crypto.randomUUID()),
  text: String(raw?.text ?? "Chữ"),
  kind: raw?.kind === "sticker" ? "sticker" : "text",
  start: Number(raw?.start ?? 0),
  duration: Math.max(0.1, Number(raw?.duration ?? 3)),
  x: clamp(Number(raw?.x ?? 50), 0, 100),
  y: clamp(Number(raw?.y ?? 50), 0, 100),
  size: clamp(Number(raw?.size ?? 48), 6, 400),
  color: String(raw?.color ?? "#ffffff"),
  align: raw?.align === "left" ? "left" : "center",
  bold: Boolean(raw?.bold),
});

const khoiPhucAm = (raw: any): AudioClip => ({
  id: String(raw?.id ?? crypto.randomUUID()),
  name: String(raw?.name ?? "Âm thanh"),
  path: String(raw?.path ?? ""),
  duration: Math.max(0.1, Number(raw?.duration ?? 5)),
  start: Number(raw?.start ?? 0),
  volume: clamp(Number(raw?.volume ?? 1), 0, 2),
  muted: Boolean(raw?.muted),
  beats: Array.isArray(raw?.beats) ? raw.beats : [],
  waveform: Array.isArray(raw?.waveform) ? raw.waveform : [],
  beatGrid: raw?.beatGrid ?? null,
});

export default function App() {
  const [history, setHistory] = useState(() =>
    createHistory<Project>({ clips: [], texts: [], audios: [] })
  );
  const project = history.present;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState("media");
  const [filter, setFilter] = useState("none");
  const [ratio, setRatio] = useState("16:9");
  const [quality, setQuality] = useState("medium");
  const [fps, setFps] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  /** Mức phóng timeline: pixel cho mỗi giây. */
  const [pxPerSecond, setPxPerSecond] = useState(PX_DEFAULT);
  /** Dải thumbnail của clip, cache theo đường dẫn + độ dài để không gọi lại. */
  const [thumbStrips, setThumbStrips] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const need = project.clips.filter(
      (c) => c.kind === "video" && !thumbStrips[c.id] && c.duration > 0.4
    );
    if (need.length === 0) return;
    for (const clip of need) {
      void invoke<string>("clip_thumbnails", {
        path: clip.path,
        seekTo: clip.seekTo,
        duration: clip.duration,
        count: Math.min(12, Math.max(2, Math.round(clip.duration))),
        height: 44,
      })
        .then((p) => {
          if (cancelled) return;
          setThumbStrips((m) => (m[clip.id] === p ? m : { ...m, [clip.id]: p }));
        })
        .catch(() => {
          // Không lấy được thumbnail thì để trống, clip vẫn dùng được.
        });
    }
    return () => {
      cancelled = true;
    };
    // Chỉ nạp lại khi danh sách clip đổi; `thumbStrips` cố ý không phải phụ thuộc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.clips.map((c) => `${c.id}:${c.duration.toFixed(2)}`).join(",")]);

  /** Dải thumbnail cho media trong thư viện, cache theo đường dẫn. */
  const [assetThumbs, setAssetThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const need = assets.filter((a) => !assetThumbs[a.id] && a.duration > 0.4);
    if (need.length === 0) return;
    for (const asset of need) {
      void invoke<string>("clip_thumbnails", {
        path: asset.path,
        seekTo: 0,
        duration: asset.duration,
        count: 3,
        height: 96,
      })
        .then((p) => {
          if (cancelled) return;
          setAssetThumbs((m) => (m[asset.id] === p ? m : { ...m, [asset.id]: p }));
        })
        .catch(() => {
          // Bỏ qua: ô media hiển thị biểu tượng thay cho ảnh.
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets.map((a) => `${a.id}:${a.duration.toFixed(2)}`).join(",")]);

  const assetThumb = (asset: Asset) => assetThumbs[asset.id];

  const [playing, setPlaying] = useState(false);
  /** Bám mép khi kéo clip trên timeline. */
  const [snapEnabled, setSnapEnabled] = useState(true);
  /** Độ dài khung hình đứng yên khi chèn, tính bằng giây. */
  const [dungKhung, setDungKhung] = useState(2);
  /** Số lần lặp của nút "Lặp". */
  const [soLanLap, setSoLanLap] = useState(3);
  /** Vùng cuộn chung của thước thời gian và các track. */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState("");
  const [dropHint, setDropHint] = useState<number | null>(null);
  const [cropAspectRatio, setCropAspectRatio] = useState<string | null>(null);
  const [keyframeProp, setKeyframeProp] = useState<KeyframableProp>("scale");
  const [beatingAudioId, setBeatingAudioId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoTrackRef = useRef<HTMLDivElement>(null);

  const canvas = ratios.find((r) => r.id === ratio) ?? ratios[0];

  /** Ghi một bước vào lịch sử (có thể undo). Nhận trạng thái mới hoặc hàm biến đổi. */
  const push = useCallback(
    (next: Project | ((p: Project) => Project)) =>
      setHistory((h) => commit(h, typeof next === "function" ? next(h.present) : next)),
    []
  );

  const edit = push;

  // Gõ chữ hay kéo thanh trượt sinh hàng chục thay đổi liên tiếp. Mỗi lần gọi
  // `gossip` với cùng một nhãn sẽ ghi đè lên bước undo hiện có thay vì tạo
  // bước mới, để một lần chỉnh sửa gọn lại thành đúng một bước hoàn tác.
  const lastGroup = useRef<string | null>(null);
  const gossip = useCallback(
    (key: string, next: Project | ((p: Project) => Project)) => {
      const merged = coalesce(lastGroup.current, key);
      lastGroup.current = key;
      setHistory((h) => {
        const value = typeof next === "function" ? next(h.present) : next;
        if (Object.is(value, h.present)) return h;
        return merged ? commitMerge(h, value) : commit(h, value);
      });
    },
    []
  );

  // Trong lúc kéo chuột, cập nhật tạm để không spam lịch sử; khi thả chuột mới
  // ghi đúng một bước undo với trạng thái trước khi bắt đầu kéo.
  const dragStart = useRef<Project | null>(null);
  const beginDrag = () => {
    dragStart.current = project;
  };
  const transient = (fn: (p: Project) => Project) =>
    setHistory((h) => replace(h, fn(h.present)));
  const endDrag = () => {
    const before = dragStart.current;
    dragStart.current = null;
    if (!before) return;
    setHistory((h) => (Object.is(before, h.present) ? h : commitFrom(h, before, h.present)));
  };

  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);

  /** Dải màu đang chỉnh trong bảng HSL. */
  const [daiHsl, setDaiHsl] = useState<DaiMau>("do");

  // --- Kho hiệu ứng: tìm kiếm và nhớ hiệu ứng vừa dùng ---
  /** Từ khoá lọc kho hiệu ứng; rỗng là hiện tất cả. */
  const [tucKhoaHieuUng, setTucKhoaHieuUng] = useState("");
  /** Hiệu ứng vừa dùng, mới nhất trước. */
  const [hieuUngDaDung, setHieuUngDaDung] = useState<string[]>([]);

  /** Ghi nhớ hiệu ứng vừa chọn vào đầu danh sách, tối đa 8 mục. */
  const nhoHieuUng = useCallback((id: string) => {
    setHieuUngDaDung((x) => [id, ...x.filter((y) => y !== id)].slice(0, 8));
  }, []);

  /** Kho hiệu ứng đã lọc theo từ khoá, rồi chia lại theo nhóm. */
  const khoHieuUngHienThi = useMemo(() => {
    const q = tucKhoaHieuUng.trim().toLowerCase();
    const loc = q
      ? hieuUng.filter(
          (h) =>
            h.ten.toLowerCase().includes(q) ||
            h.nhom.toLowerCase().includes(q) ||
            h.loi?.toLowerCase().includes(q)
        )
      : hieuUng;
    const nhom: string[] = [];
    for (const h of loc) if (!nhom.includes(h.nhom)) nhom.push(h.nhom);
    return nhom.map((n) => ({ nhom: n, items: loc.filter((h) => h.nhom === n) }));
  }, [tucKhoaHieuUng]);

// --- Danh sách dự án mở gần đây ---
  /** Từ khoá lọc thư viện phương tiện; rỗng là hiện tất cả. */
  const [timKhoa, setTimKhoa] = useState("");
  const hienThi = useMemo(() => {
    // Ghim luôn nằm trên cùng, giữ nguyên thứ tự thêm của phần còn lại.
    const xep = [...assets].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
    const q = timKhoa.trim().toLowerCase();
    return q ? xep.filter((a) => a.name.toLowerCase().includes(q)) : xep;
  }, [assets, timKhoa]);
  const [ganDay, setGanDay] = useState<{ path: string; ten: string }[]>([]);
  const [hienDanhSach, setHienDanhSach] = useState(false);
  useEffect(() => {
    void invoke<{ path: string; ten: string }[]>("recent_projects")
      .then(setGanDay)
      .catch(() => setGanDay([]));
  }, []);

  const gomDuAn = useCallback(
    (): ProjectFile => ({
      version: 1,
      ratio,
      filter,
      fps,
      quality,
      assets,
      project,
    }),
    [ratio, filter, fps, quality, assets, project]
  );

  /** Nạp một tệp dự án vào ứng dụng, dùng chung cho "Mở" và bản nháp. */
  const napTuTep = useCallback(
    async (duongDan: string, thongBao: boolean) => {
      const raw = JSON.parse(await invoke<string>("load_project", { path: duongDan }));
      const parsed = raw as Partial<ProjectFile>;
      const source = parsed.project ?? ({ clips: [], texts: [], audios: [] } as Project);
      const restored: Project = {
        clips: (source.clips ?? []).map(khoiPhucClip),
        texts: (source.texts ?? []).map(khoiPhucLopChu),
        audios: (source.audios ?? []).map(khoiPhucAm),
      };
      // Hỏi lại thời lượng thật vì media có thể đã thay đổi ngoài ứng dụng.
      await Promise.all(
        restored.clips.map(async (clip) => {
          const measured = await probeDuration(clip.path, clip.duration);
          if (measured > 0 && Math.abs(measured - clip.duration) > 0.05) {
            restored.clips = restored.clips.map((c) =>
              c.id === clip.id ? { ...c, duration: measured } : c
            );
          }
        })
      );
      setRatio(parsed.ratio ?? "16:9");
      setFilter(parsed.filter ?? "none");
      setFps(parsed.fps ?? 30);
      setQuality(parsed.quality ?? "medium");
      setAssets(parsed.assets ?? []);
      setHistory(createHistory(restored));
      setSelectedId(null);
      // Nạp lại waveform/nhịp cho các tệp âm thanh trong dự án.
      for (const audio of restored.audios) void analyzeAudio(audio.id, audio.path);
      if (thongBao) setExportMsg(`Đã mở: ${duongDan}`);
    },
    []
  );

  /** Ghi toàn bộ dự án ra tệp `.occut`. */
  const saveProjectFile = async () => {
    try {
      const target = await save({
        title: "Lưu dự án",
        defaultPath: "du-an.occut",
        filters: [{ name: "Dự án OpenCutCut", extensions: ["occut"] }],
      });
      if (!target) return;
      const saved = await invoke<string>("save_project", {
        path: target,
        data: JSON.stringify(gomDuAn(), null, 2),
      });
      await nhoDuan(saved);
      setHienDanhSach(false);
      setExportMsg(`Đã lưu: ${saved}`);
    } catch (e: any) {
      setExportMsg(String(e));
    }
  };

  /** Ghi một dự án vào danh sách mở gần đây. */
  const nhoDuan = useCallback(async (duongDan: string) => {
    const ten = duongDan.split("/").pop() ?? duongDan;
    const ds = await invoke<{ path: string; ten: string }[]>("recent_push", {
      path: duongDan,
      ten,
    });
    setGanDay(ds);
    return ds;
  }, []);

  /** Mở một dự án từ danh sách gần đây, tự bỏ mục nếu tệp không còn. */
  const moDuanGanDay = useCallback(
    async (duongDan: string) => {
      try {
        await napTuTep(duongDan, true);
        setCoBanNhap(false);
        setHienDanhSach(false);
      } catch (e: any) {
        const ds = await invoke<{ path: string; ten: string }[]>("recent_remove", {
          path: duongDan,
        });
        setGanDay(ds);
        setExportMsg(`Không mở được dự án: ${e}`);
      }
    },
    [napTuTep]
  );

  /** Đọc dự án từ tệp do người dùng chọn. */
  const openProjectFile = async () => {
    try {
      const picked = await open({
        title: "Mở dự án",
        multiple: false,
        filters: [{ name: "Dự án OpenCutCut", extensions: ["occut"] }],
      });
      if (typeof picked !== "string" || !picked) return;
      await napTuTep(picked, true);
      setCoBanNhap(false);
      await nhoDuan(picked);
    } catch (e: any) {
      setExportMsg(`Không mở được dự án: ${e}`);
    }
  };

  // --- Bản nháp tự lưu ---
  //
  // Ghi xuống một tệp cố định sau mỗi lần ngừng thao tác, để đóng app hay mất
  // điện vẫn còn dự án. Lúc mở app sẽ hỏi có khôi phục không.
  const banNhapPath = useRef<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  /** Có bản nháp cũ đang chờ người dùng khôi phục không. */
  const [coBanNhap, setCoBanNhap] = useState(false);
  const dongBo = useRef(gomDuAn);
  dongBo.current = gomDuAn;
  const soViec = project.clips.length + project.texts.length + project.audios.length;

  // Đọc bản nháp ngay khi khởi động; chỉ hỏi nếu dự án không rỗng.
  useEffect(() => {
    let huy = false;
    void (async () => {
      try {
        const duongDan = await invoke<string | null>("draft_path");
        if (huy) return;
        banNhapPath.current = duongDan;
        setDraftReady(Boolean(duongDan));
        if (!duongDan) return;
        const noiDung = await invoke<string | null>("load_project", { path: duongDan });
        if (huy || !noiDung || noiDung.trim() === "") return;
        const thu = JSON.parse(noiDung) as Partial<ProjectFile>;
        const p = thu.project;
        const coViec =
          (p?.clips?.length ?? 0) + (p?.texts?.length ?? 0) + (p?.audios?.length ?? 0);
        if (coViec > 0) setCoBanNhap(true);
      } catch {
        // Chưa có bản nháp hoặc đọc lỗi: coi như dự án mới.
      }
    })();
    return () => {
      huy = true;
    };
  }, []);

  const ghiBanNhap = useCallback(() => {
    const duongDan = banNhapPath.current;
    if (!duongDan) return;
    void invoke("save_project", {
      path: duongDan,
      data: JSON.stringify(dongBo.current()),
    }).catch(() => {
      // Hết chỗ trống hoặc lỗi quyền: bỏ qua, lần ghi sau sẽ thử lại.
    });
  }, []);

  // Lưu danh sách hiệu ứng vừa dùng riêng, để mở app sau vẫn thấy.
  useEffect(() => {
    if (hieuUngDaDung.length === 0) return;
    try {
      localStorage.setItem("opencutcut_hieu_ung_da_dung", JSON.stringify(hieuUngDaDung));
    } catch {
      // Hết chỗ trong bộ nhớ tạm thì bỏ qua, không ảnh hưởng dự án.
    }
  }, [hieuUngDaDung]);

  // Đọc lại danh sách này lúc khởi động, bỏ qua id không còn trong kho.
  useEffect(() => {
    try {
      const luu = JSON.parse(localStorage.getItem("opencutcut_hieu_ung_da_dung") ?? "[]");
      if (Array.isArray(luu)) {
        setHieuUngDaDung(luu.filter((id) => idHieuUngHopLe(String(id))).slice(0, 8));
      }
    } catch {
      // Dữ liệu hỏng thì coi như chưa dùng hiệu ứng nào.
    }
  }, []);

  // Ghi bản nháp sau khi ngừng thay đổi 1.5 giây, chỉ khi dự án đã có nội dung.
  useEffect(() => {
    if (!draftReady || soViec === 0) return;
    const id = window.setTimeout(ghiBanNhap, 1500);
    return () => window.clearTimeout(id);
  }, [draftReady, soViec, project, ratio, filter, fps, quality, assets, ghiBanNhap]);

  // Ghi ngay khi đóng cửa sổ, không chờ debounce.
  useEffect(() => {
    const ghi = () => {
      if (soViec > 0) ghiBanNhap();
    };
    window.addEventListener("beforeunload", ghi);
    return () => window.removeEventListener("beforeunload", ghi);
  }, [soViec, ghiBanNhap]);

  /** Bỏ bản nháp và bắt đầu dự án trống. */
  const boBanNhap = async () => {
    setCoBanNhap(false);
    setHistory(createHistory({ clips: [], texts: [], audios: [] }));
    setAssets([]);
    setSelectedId(null);
    const duongDan = banNhapPath.current;
    if (duongDan) {
      await invoke("save_project", {
        path: duongDan,
        data: JSON.stringify(dongBo.current()),
      }).catch(() => {});
    }
  };

  /** Nối một dự án khác vào sau dự án hiện tại. */
  const mergeProjectFile = async () => {
    try {
      const picked = await open({
        title: "Ghép dự án",
        multiple: false,
        filters: [{ name: "Dự án OpenCutCut", extensions: ["occut"] }],
      });
      if (typeof picked !== "string" || !picked) return;
      const raw = JSON.parse(await invoke<string>("load_project", { path: picked }));
      const parsed = raw as Partial<ProjectFile>;
      const source = parsed.project;
      if (!source) throw new Error("Tệp không có dự án");
      const clips = (source.clips ?? []).map(khoiPhucClip);
      const texts = (source.texts ?? []).map(khoiPhucLopChu);
      const audios = (source.audios ?? []).map(khoiPhucAm);
      if (clips.length + texts.length + audios.length === 0) {
        setExportMsg("Dự án nguồn trống, không có gì để ghép.");
        return;
      }
      const leCh = project.clips.reduce(
        (max, c) => Math.max(max, c.start + c.duration),
        0
      );
      push({
        clips: noiDuAn(project.clips, clips),
        texts: noiDuAn(project.texts, texts.map((t) => ({ ...t, start: t.start + leCh }))),
        audios: noiDuAn(project.audios, audios.map((a) => ({ ...a, start: a.start + leCh }))),
      });
      // Tệp nguồn cũng cung cấp media, đưa vào thư viện cho kéo dùng tiếp.
      setAssets((hienTai) => {
        const co = new Set(hienTai.map((a) => a.path));
        return [...hienTai, ...(parsed.assets ?? []).filter((a) => !co.has(a.path))];
      });
      for (const audio of audios) void analyzeAudio(audio.id, audio.path);
      setExportMsg(
        `Đã ghép ${clips.length} clip, ${texts.length} lớp chữ, ${audios.length} âm thanh.`
      );
    } catch (e: any) {
      setExportMsg(`Không ghép được dự án: ${e}`);
    }
  };

  const totalDuration = useMemo(() => {
    const values = [
      ...project.clips.map((c) => c.start + c.duration),
      ...project.texts.map((t) => t.start + t.duration),
      ...project.audios.map((a) => a.start + a.duration),
      0,
    ];
    return Math.max(...values);
  }, [project]);

  const activeClip = project.clips.find(
    (c) => currentTime >= c.start && currentTime < c.start + c.duration
  );
  const activeTexts = project.texts.filter(
    (t) => currentTime >= t.start && currentTime < t.start + t.duration
  );
  const selected = project.clips.find((c) => c.id === selectedId) ?? activeClip;

  const keyframeTarget: KeyframeTarget | null = selected
    ? { start: selected.start, duration: selected.duration, keyframes: selected.keyframes }
    : null;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 0.05;
        if (next >= totalDuration) {
          setPlaying(false);
          return totalDuration;
        }
        return next;
      });
    }, 50);
    return () => window.clearInterval(id);
  }, [playing, totalDuration]);

  useEffect(() => {
    const video = videoRef.current;
    // Clip ảnh không có phát video, bỏ qua.
    if (!video || !activeClip || activeClip.kind === "image") return;
    const src = convertFileSrc(activeClip.path);
    if (video.src !== src) video.src = src;
    const target = activeClip.seekTo + (currentTime - activeClip.start);
    if (Math.abs(video.currentTime - target) > 0.3) video.currentTime = target;
    // Clip có đường cong tốc độ thì tốc độ đổi theo con trỏ phát.
    video.playbackRate = clamp(
      tocDoTai(activeClip, currentTime),
      0.1,
      8
    );
    if (playing) video.play().catch(() => {});
    else video.pause();
  }, [activeClip?.id, playing, currentTime]);

  const trackLeft = () =>
    (videoTrackRef.current?.getBoundingClientRect().left ?? 0) + 4;

  // -------------------------------------------------------------------------
  // Clip
  // -------------------------------------------------------------------------

  const newClip = (name: string, path: string, duration: number): Clip => ({
    id: crypto.randomUUID(),
    name,
    path,
    kind: isImagePath(path) ? "image" : "video",
    duration,
    seekTo: 0,
    start: 0,
    track: 0,
    speed: 1,
    volume: 1,
    muted: false,
    locked: false,
    mixMode: "normal",
    effect: "",
    effectStrong: false,
    adjust: defaultAdjust(),
    crop: fullCrop(),
    chroma: defaultChroma(),
    curves: defaultCurves(),
    lut: defaultLut(),
    keyframes: [],
    reverse: false,
    freeze: false,
    smooth: false,
    transition: "none",
    transitionDuration: 0.5,
  });

  /** Hỏi ffprobe thời lượng của tệp, không được thì dùng giá trị mặc định. */
  const probeDuration = async (path: string, fallback = 5): Promise<number> => {
    // Ảnh không có dòng thời gian: mặc định 5 giây cho clip ảnh.
    if (isImagePath(path)) return 5;
    try {
      return await invoke<number>("probe_media", { path, fallback });
    } catch {
      return fallback;
    }
  };

  /** Tạo clip từ danh sách đường dẫn tệp thật do hộp thoại chọn. */
  const buildClipsFromPaths = async (paths: string[]): Promise<Clip[]> => {
    const built: Clip[] = [];
    for (const path of paths) {
      const name = path.split("/").pop() ?? path;
      const duration = await probeDuration(path, 5);
      built.push(newClip(name, path, duration));
    }
    return built;
  };

  const addMedia = async () => {
    const picked = await open({
      multiple: true,
      filters: [
        {
          name: "Video và ảnh",
          extensions: [
            "mp4", "mov", "m4v", "mkv", "avi", "webm",
            "png", "jpg", "jpeg", "webp", "gif", "heic", "bmp",
          ],
        },
      ],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const clips = await buildClipsFromPaths(paths);
    push((p) => ({ ...p, clips: pack([...p.clips, ...clips]) }));
    setAssets((prev) => [
      ...prev,
      ...clips.map((c) => ({ id: c.id, name: c.name, path: c.path, duration: c.duration })),
    ]);
    if (clips[0]) setSelectedId(clips[0].id);
  };

  const onFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    // Tauri trả đường dẫn thật qua `dataTransfer.files[i].path`.
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as any).path as string | undefined)
      .filter((p): p is string => Boolean(p));
    if (!paths.length) return;
    const clips = await buildClipsFromPaths(paths);
    push((p) => ({ ...p, clips: pack([...p.clips, ...clips]) }));
    setAssets((prev) => [
      ...prev,
      ...clips.map((c) => ({ id: c.id, name: c.name, path: c.path, duration: c.duration })),
    ]);
    if (clips[0]) setSelectedId(clips[0].id);
  };

  const dropAsset = (assetId: string, at: number) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return;
    const clip = newClip(asset.name, asset.path, asset.duration);
    edit((p) => ({ ...p, clips: dropItem(p.clips, clip, at) }));
    setSelectedId(clip.id);
  };

  const moveClip = (clipId: string, at: number) => {
    edit((p) => {
      const clip = p.clips.find((c) => c.id === clipId);
      if (!clip) return p;
      // Khi bật bám mép, kéo tới sát mép clip khác thì dán vào luôn.
      const landing = snapEnabled ? snapToEdge(p.clips, clipId, at) : at;
      return { ...p, clips: dropItem(p.clips, clip, landing) };
    });
  };

  const startTrim = (e: React.PointerEvent, clipId: string, edge: "start" | "end") => {
    const base = project.clips.find((c) => c.id === clipId);
    if (!base || base.locked) return;
    beginDrag();
    let lastX = e.clientX;
    const onMove = (ev: PointerEvent) => {
      const delta = (ev.clientX - lastX) / pxPerSecond;
      lastX = ev.clientX;
      transient((p) => ({ ...p, clips: trimItem(p.clips, clipId, edge, delta) }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const patchClip = (id: string, patch: Partial<Clip>) => {
    edit((p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));
  };

  /** Đổi một thuộc tính của clip, gom nhiều lần kéo thanh trượt thành 1 bước undo. */
  const tuneClip = (id: string, key: keyof Clip, value: Clip[keyof Clip]) => {
    gossip(`clip:${id}:${String(key)}`, (p) => ({
      ...p,
      clips: p.clips.map((c) => (c.id === id ? { ...c, [key]: value } : c)),
    }));
  };

  const splitAtPlayhead = () => {
    const clip = project.clips.find(
      (c) => currentTime > c.start + 0.05 && currentTime < c.start + c.duration - 0.05
    );
    if (!clip || clip.locked) return;
    const result = splitItem(project.clips, clip.id, currentTime);
    if (!result.newId) return;
    push({ ...project, clips: result.items });
    setSelectedId(result.newId);
  };

  /**
 * Chèn một khung hình đứng yên tại vị trí con trỏ phát.
   *
   * Giống CapCut: chia clip tại con trỏ, chèn thêm một đoạn đứng yên giữ khung
   * hình tại con trỏ trong `soGiay` giây, rồi dời toàn bộ phần sau sang phải
   * đúng bằng độ dài đoạn vừa thêm. Tiếng của clip gốc vẫn chạy.
   */
  const themKhungDungYen = (soGiay: number) => {
    const clip = project.clips.find(
      (c) => currentTime > c.start + 0.05 && currentTime < c.start + c.duration - 0.05
    );
    if (!clip || clip.locked || clip.kind !== "video") return;
    const at = currentTime;
    const dai = clamp(soGiay, 0.1, 30);
    const cuoi = clip.start + clip.duration;

    const trai: Clip = { ...clip, duration: at - clip.start, transition: "none" };
    const giữ: Clip = {
      ...clip,
      id: crypto.randomUUID(),
      start: at,
      duration: dai,
      freeze: true,
      transition: "none",
      // Keyframe và hiệu ứng theo thời gian không có ý nghĩa trên ảnh tĩnh.
      keyframes: [],
      effect: "",
      effectStrong: false,
      transitionDuration: clip.transitionDuration,
    };
    const phai: Clip = {
      ...clip,
      id: crypto.randomUUID(),
      start: at + dai,
      duration: cuoi - at,
      freeze: false,
    };

    push({
      ...project,
      clips: project.clips.flatMap((c) => {
        if (c.id === clip.id) return [trai, giữ, phai];
        // Mọi clip nằm sau điểm chèn phải dời sang phải cho vừa.
        return c.start >= at ? [{ ...c, start: c.start + dai }] : [c];
      }),
    });
    setSelectedId(giữ.id);
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    if (project.texts.some((t) => t.id === selectedId)) {
      push({ ...project, texts: project.texts.filter((t) => t.id !== selectedId) });
      setSelectedId(null);
      return;
    }
    push({ ...project, clips: pack(project.clips.filter((c) => c.id !== selectedId)) });
    setSelectedId(null);
  };

  /** Xóa clip và dồn phần sau lên, giữ tổng thời lượng các đoạn còn lại. */
  const rippleDeleteSelected = () => {
    if (!selectedId) return;
    if (project.texts.some((t) => t.id === selectedId)) {
      push({ ...project, texts: project.texts.filter((t) => t.id !== selectedId) });
      setSelectedId(null);
      return;
    }
    push({ ...project, clips: rippleDelete(project.clips, selectedId) });
    setSelectedId(null);
  };

  const duplicateSelected = () => {
    if (!selected || project.texts.some((t) => t.id === selected.id)) return;
    const copy: Clip = {
      ...selected,
      id: crypto.randomUUID(),
      start: selected.start + selected.duration,
      keyframes: selected.keyframes.map((k) => ({ ...k, id: crypto.randomUUID() })),
    };
    push({
      ...project,
      clips: pack([...project.clips, copy]),
    });
    setSelectedId(copy.id);
  };

  /** Lặp lại đoạn đang chọn n lần, dồn các clip phía sau sang phải. */
  const lapDaDungChon = () => {
    if (!selected || project.texts.some((t) => t.id === selected.id)) return;
    const clips = lapLai(project.clips, selected.id, soLanLap);
    if (clips.length === project.clips.length) return;
    // Bản lặp cuối cùng được chọn để bấm Lặp tiếp sẽ nối tiếp từ đó.
    const ban = clips.filter((c) => c.start >= selected.start).pop();
    push({ ...project, clips });
    if (ban) setSelectedId(ban.id);
  };

/** Clip có keyframe tốc độ không. */
  const coCungTocDo = (clip: Clip) =>
    clip.keyframes.some((k) => k.prop === "speed");

  /** Số mốc tốc độ của clip. */
  const soMocTocDo = (clip: Clip) =>
    clip.keyframes.filter((k) => k.prop === "speed").length;

  /** Thêm mốc tốc độ tại thời điểm tuyệt đối `at` (ngoài clip thì bỏ qua). */
  const themMocTocDo = (clip: Clip, at: number, heSo: number) => {
    const t = clamp(at, clip.start + 0.01, clip.start + clip.duration - 0.01);
    const giu = clip.keyframes.filter(
      (k) => k.prop !== "speed" || Math.abs(k.time - t) > 0.01
    );
    const moi = {
      id: crypto.randomUUID(),
      time: t,
      prop: "speed" as const,
      value: clamp(heSo, 0.05, 20),
    };
    // Hai mốc trùng thời điểm là vô nghĩa, nên chỉ giữ mốc mới.
    patchClip(clip.id, {
      keyframes: [...giu.filter((k) => k.prop !== "speed"), moi, ...giu.filter((k) => k.prop === "speed")],
    });
  };

  /** Đổi hệ số tốc độ của một mốc. */
  const suaMocTocDo = (clipId: string, kfId: string, heSo: number) =>
    patchClip(clipId, {
      keyframes: project.clips
        .find((c) => c.id === clipId)!
        .keyframes.map((k) =>
          k.id === kfId ? { ...k, value: clamp(heSo, 0.05, 20) } : k
        ),
    });

  /** Đổi thời điểm của một mốc, tính theo đầu clip. */
  const doiMocTocDo = (clipId: string, kfId: string, giay: number) => {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const t = clamp(
      clip.start + giay,
      clip.start + 0.01,
      clip.start + clip.duration - 0.01
    );
    patchClip(clipId, {
      keyframes: clip.keyframes.map((k) => (k.id === kfId ? { ...k, time: t } : k)),
    });
  };

  /** Xóa một mốc tốc độ. */
  const xoaMocTocDo = (clipId: string, kfId: string) => {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return;
    patchClip(clipId, { keyframes: clip.keyframes.filter((k) => k.id !== kfId) });
  };

  /** Xóa sạch keyframe tốc độ, trả về tốc độ cố định của clip. */
  const xoaHetMocTocDo = (clip: Clip) =>
    patchClip(clip.id, {
      keyframes: clip.keyframes.filter((k) => k.prop !== "speed"),
    });

/** Thay toàn bộ keyframe tốc độ của clip bằng đường cong có sẵn. */
  const apDungDuongCong = (clip: Clip, mau: { ten: string; moc: Array<[number, number]> }) => {
    const giu = clip.keyframes.filter((k) => k.prop !== "speed");
    const moi = mau.moc
      .map(([phan, heSo]) => {
        // Mốc phải nằm trong clip và không chồng nhau ở hai đầu.
        const t = clip.start + (phan / 100) * clip.duration;
        return {
          id: crypto.randomUUID(),
          time: clamp(t, clip.start + 0.01, clip.start + clip.duration - 0.01),
          prop: "speed" as const,
          value: clamp(heSo, 0.05, 20),
        };
      })
      // Hai mốc trùng thời điểm (clip quá ngắn) thì chỉ giữ mốc sau.
      .filter((k, i, all) => i === 0 || k.time - all[i - 1].time > 0.01);
    patchClip(clip.id, { keyframes: [...giu, ...moi] });
    setExportMsg(`Đã áp đường cong tốc độ "${mau.ten}".`);
  };

  const toggleLock = (id: string) => {
    const clip = project.clips.find((c) => c.id === id);
    if (!clip) return;
    patchClip(id, { locked: !clip.locked });
  };

  // -------------------------------------------------------------------------
  // Keyframe
  // -------------------------------------------------------------------------

  /** Giá trị mặc định hợp lý khi thuộc tính chưa có keyframe nào. */
  const keyframeDefault = useCallback((prop: KeyframableProp): number => {
    switch (prop) {
      case "scale":
        return 100;
      case "x":
      case "y":
        return 50;
      case "opacity":
        return 1;
      case "speed":
        return 1;
      default:
        return 0;
    }
  }, []);

  const keyframeValueNow = useCallback(
    (clip: Clip, prop: KeyframableProp): number => {
      const target: KeyframeTarget = {
        start: clip.start,
        duration: clip.duration,
        keyframes: clip.keyframes,
      };
      return valueAtTime(target, prop, currentTime, keyframeDefault(prop));
    },
    [currentTime, keyframeDefault]
  );

  const addKeyframeAtPlayhead = () => {
    if (!selected) return;
    const value = keyframeValueNow(selected, keyframeProp);
    const inside =
      currentTime > selected.start + 0.001 &&
      currentTime < selected.start + selected.duration - 0.001;
    if (!inside) return;
    patchClip(selected.id, {
      keyframes: addKeyframe(selected.keyframes, currentTime, keyframeProp, value),
    });
  };

  const removeKeyframeAtPlayhead = () => {
    if (!selected) return;
    patchClip(selected.id, {
      keyframes: removeKeyframe(selected.keyframes, currentTime, keyframeProp),
    });
  };

  /** Số mối nối hợp lệ trong dự án: hai clip bám sát nhau, chỉ lấy clip trước. */
  const soMoiNoi = useMemo(
    () => mocNoiKeNhau(project.clips).length,
    [project.clips]
  );

  /** Đặt cùng một loại chuyển cảnh lên mọi mối nối. */
  const apChuyenCanhMoiNoi = (loai: string) => {
    const canDoi = new Set(mocNoiKeNhau(project.clips).map((c) => c.id));
    if (canDoi.size === 0) {
      setExportMsg("Không có mối nối bám sát nào để áp chuyển cảnh.");
      return;
    }
    push({
      ...project,
      clips: project.clips.map((c) =>
        canDoi.has(c.id) ? { ...c, transition: loai } : c
      ),
    });
    setExportMsg(`Đã áp chuyển cảnh cho ${canDoi.size} mối nối.`);
  };

  /** Thêm một mốc của thuộc tính `prop` cho clip tại thời điểm tuyệt đối. */
  const themKeyframe = (
    clipId: string,
    prop: KeyframableProp,
    at: number,
    gia: number
  ) => {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return;
    // Mốc phải nằm trong clip, lền vài khung hình cho mỗi đầu.
    const t = clamp(
      at,
      clip.start + 0.01,
      clip.start + clip.duration - 0.01
    );
    patchClip(clipId, { keyframes: addKeyframe(clip.keyframes, t, prop, gia) });
  };

  /** Xóa sạch mọi mốc của một thuộc tính. */
  const xoaKeyframeCuaClip = (clipId: string, prop: KeyframableProp) => {
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip) return;
    patchClip(clipId, {
      keyframes: clip.keyframes.filter((k) => k.prop !== prop),
    });
  };

  // -------------------------------------------------------------------------
  // Âm thanh
  // -------------------------------------------------------------------------

  const addAudio = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
    });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    const tracks: AudioClip[] = [];
    for (const path of paths) {
      const name = path.split("/").pop() ?? path;
      tracks.push({
        id: crypto.randomUUID(),
        name,
        path,
        duration: await probeDuration(path, 10),
        start: currentTime,
        volume: 1,
        muted: false,
        beats: [],
        waveform: [],
        beatGrid: null,
      });
    }
    push((p) => ({ ...p, audios: [...p.audios, ...tracks] }));
    for (const t of tracks) void analyzeAudio(t.id, t.path);
  };

  /** Lấy waveform và nhịp cho một track âm thanh. */
  const analyzeAudio = async (id: string, path: string) => {
    try {
      const [waveform, beats] = await Promise.all([
        invoke<number[]>("audio_waveform", { path, buckets: 600 }),
        invoke<number[]>("detect_beats", { path, sensitivity: 0.5 }),
      ]);
      push((p) => ({
        ...p,
        audios: p.audios.map((a) =>
          a.id === id ? { ...a, waveform, beats, beatGrid: estimateBeatGrid(beats) } : a
        ),
      }));
    } catch {
      push((p) => ({
        ...p,
        audios: p.audios.map((a) => (a.id === id ? { ...a, waveform: [], beats: [] } : a)),
      }));
    }
  };

  /** Dựng lưới nhịp đồng đều từ các mốc đã phát hiện. */
  const rebuildBeatGrid = (id: string) => {
    const audio = project.audios.find((a) => a.id === id);
    if (!audio) return;
    push((p) => ({
      ...p,
      audios: p.audios.map((a) =>
        a.id === id ? { ...a, beatGrid: estimateBeatGrid(a.beats) } : a
      ),
    }));
  };

  /**
   * Căn thời điểm bắt đầu của mỗi clip về mốc nhịp gần nhất. Không `pack` lại vì
   * pack sẽ ép các clip sát nhau và phá mất khoảng trống đã căn theo nhịp.
   */
  const snapToBeat = () => {
    const audio = project.audios.find((a) => a.beatGrid && a.beatGrid.interval > 0);
    if (!audio?.beatGrid) return;
    const grid = audio.beatGrid;
    const base = audio.start;
    const snaps = beatMarkers(grid, 60).map((t) => t + base);
    const snapTo = (t: number) => {
      let best = snaps[0] ?? t;
      for (const s of snaps) {
        if (Math.abs(s - t) < Math.abs(best - t)) best = s;
      }
      return Math.max(0, best);
    };
    push((p) => ({
      ...p,
      clips: p.clips
        .map((c) => ({ ...c, start: snapTo(c.start) }))
        .sort((a, b) => a.start - b.start),
    }));
  };

  // -------------------------------------------------------------------------
  // Văn bản
  // -------------------------------------------------------------------------

  const addText = (kind: "text" | "sticker", value?: string) => {
    const layer: TextLayer = {
      id: crypto.randomUUID(),
      text: value ?? (kind === "text" ? "Văn bản mới" : "⭐"),
      kind,
      start: currentTime,
      duration: kind === "text" ? 3 : 2,
      x: 50,
      y: 50,
      size: kind === "text" ? 32 : 64,
      color: "#ffffff",
      align: "center",
      bold: kind === "text",
    };
    push((p) => ({ ...p, texts: [...p.texts, layer] }));
    setSelectedId(layer.id);
  };

  const updateText = (id: string, patch: Partial<TextLayer>) => {
    push((p) => ({
      ...p,
      texts: p.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  // -------------------------------------------------------------------------
  // Crop
  // -------------------------------------------------------------------------

  /** Cập nhật crop; `smooth` dùng cho kéo thanh trượt để gom thành 1 bước undo. */
  const updateCrop = (patch: Partial<CropRect>, smooth = false) => {
    if (!selected) return;
    const id = selected.id;
    const next = normalizeCrop({ ...selected.crop, ...patch });
    if (smooth) {
      gossip(`crop:${id}`, (p) => ({
        ...p,
        clips: p.clips.map((c) => (c.id === id ? { ...c, crop: next } : c)),
      }));
    } else {
      patchClip(id, { crop: next });
    }
  };

  /** Khoanh vùng crop bằng cách kéo chuột trên khung xem. */
  const startCropDrag = (e: React.PointerEvent) => {
    if (!selected) return;
    const clipId = selected.id;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const startY = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    beginDrag();
    // Gom nhiều sự kiện chuột thành một lần cập nhật mỗi khung hình để kéo mượt.
    let pending: { x: number; y: number } | null = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (!pending) return;
      const { x, y } = pending;
      pending = null;
      const left = Math.min(startX, x);
      const top = Math.min(startY, y);
      const right = Math.max(startX, x);
      const bottom = Math.max(startY, y);
      const crop = normalizeCrop({ x: left, y: top, width: right - left, height: bottom - top });
      transient((p) => ({
        ...p,
        clips: p.clips.map((c) => (c.id === clipId ? { ...c, crop } : c)),
      }));
    };
    const onMove = (ev: PointerEvent) => {
      pending = {
        x: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((ev.clientY - rect.top) / rect.height, 0, 1),
      };
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (frame) cancelAnimationFrame(frame);
      apply();
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // -------------------------------------------------------------------------
  // Xuất
  // -------------------------------------------------------------------------

  const renderLayerToPng = async (layer: TextLayer): Promise<string | null> => {
    const scale = 2;
    const fontSize = Math.max(12, Math.round(layer.size * 1.6));
    const padding = 24;
    const measure = document.createElement("canvas").getContext("2d")!;
    const family = "-apple-system, 'Helvetica Neue', sans-serif";
    const weight = layer.bold ? "700" : "400";
    measure.font = `${weight} ${fontSize}px ${family}`;
    const metrics = measure.measureText(layer.text);
    const w = Math.ceil(metrics.width) + padding * 2;
    const h = Math.ceil(fontSize * 1.4) + padding;
    const c = document.createElement("canvas");
    c.width = w * scale;
    c.height = h * scale;
    const ctx = c.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.font = `${weight} ${fontSize}px ${family}`;
    ctx.textAlign = layer.align;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 6;
    const x = layer.align === "center" ? w / 2 : padding;
    ctx.strokeText(layer.text, x, h / 2);
    ctx.fillStyle = layer.color;
    ctx.fillText(layer.text, x, h / 2);
    try {
      return await invoke<string>("save_overlay_image", {
        name: layer.id,
        base64Data: c.toDataURL("image/png"),
      });
    } catch {
      return null;
    }
  };

  const exportVideo = async () => {
    if (project.clips.length === 0) return;
    // Hỏi nơi lưu trước kì làm việc tốn thời gian.
    const target = await save({
      defaultPath: `${Date.now()}_opencutcut.mp4`,
      filters: [{ name: "MP4", extensions: ["mp4"] }],
    });
    if (!target) return;

    setExporting(true);
    setExportMsg("");
    try {
      const layers: Array<Record<string, unknown>> = [];
      for (const layer of project.texts) {
        const path = await renderLayerToPng(layer);
        if (!path) continue;
        layers.push({
          imagePath: path,
          start: layer.start,
          duration: layer.duration,
          x: layer.x,
          y: layer.y,
        });
      }

      const req = {
        clips: project.clips.map((c) => ({
          path: c.path,
          kind: c.kind,
          start: c.start,
          duration: c.duration,
          seekTo: c.seekTo,
          speed: c.speed,
          volume: c.volume,
          muted: c.muted,
          locked: c.locked,
          mixMode: c.mixMode,
          adjust: c.adjust,
          crop: c.crop,
          chroma: c.chroma,
          curves: c.curves,
          lut: c.lut,
          keyframes: c.keyframes,
          transition: c.transition,
          transitionDuration: c.transitionDuration,
          effect: c.effect || null,
          effectStrong: c.effectStrong,
          reverse: c.reverse,
          freeze: c.freeze,
          smooth: c.smooth,
        })),
        texts: layers,
        audios: project.audios.map((a) => ({
          path: a.path,
          start: a.start,
          duration: a.duration,
          volume: a.volume,
          muted: a.muted,
        })),
        output: target,
        width: canvas.w,
        height: canvas.h,
        fps,
        filter: filter === "none" ? null : filter,
        quality,
      };
      setExportMsg(await invoke<string>("export_video", { req }));
    } catch (e: any) {
      setExportMsg(String(e));
    } finally {
      setExporting(false);
    }
  };

  // Phím tắt theo kiểu CapCut: Cmd/Ctrl+Z hoàn tác, Cmd/Ctrl+Shift+Z làm lại,
  // Cmd+B chia, Cmd+D nhân bản, Delete xóa, Space phát/dừng, mũi tên di chuyển
  // playhead theo khung hình, Cmd+A chọn hết.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (meta && key === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
        return;
      }
      if (meta && key === "y") {
        e.preventDefault();
        doRedo();
        return;
      }
      if (meta && key === "b") {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (meta && key === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (e.shiftKey) rippleDeleteSelected();
        else deleteSelected();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.altKey ? 1 : 1 / 25;
        setCurrentTime((t) => clamp(t + (e.key === "ArrowRight" ? step : -step), 0, totalDuration));
        return;
      }
      if (e.code === "Space" && !meta) {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    doUndo,
    doRedo,
    splitAtPlayhead,
    duplicateSelected,
    deleteSelected,
    rippleDeleteSelected,
    totalDuration,
  ]);

  // Chiều rộng nội dung track: luôn đủ lớn để cuộn và giữ playhead đúng chỗ.
  const trackWidth = (duration: number) =>
    `${Math.max(400, (duration + 2) * pxPerSecond)}px`;
  // Vạch playhead tính theo pixel để khớp với track có cuộn ngang.
  const playhead = (time: number) => `${time * pxPerSecond}px`;

  /** Clip kế tiếp có bám sát mép phải clip này không (điều kiện để ghép transition). */
  const isAdjacent = (clipId: string): boolean => {
    const idx = project.clips.findIndex((c) => c.id === clipId);
    if (idx < 0 || idx + 1 >= project.clips.length) return false;
    const cur = project.clips[idx];
    const next = project.clips[idx + 1];
    return Math.abs(cur.start + cur.duration - next.start) < 0.05;
  };

  const sliders: Array<[keyof Adjust, string, number, number]> = [
    ["brightness", "Độ sáng", -1, 1],
    ["contrast", "Tương phản", -1, 1],
    ["saturation", "Bão hoà", -1, 1],
    ["temperature", "Nhiệt độ", -1, 1],
    ["highlights", "Vùng sáng", -1, 1],
    ["shadows", "Vùng tối", -1, 1],
    ["fade", "Làm mờ đầu/cuối", 0, 1],
    ["sharpen", "Sắc nét", 0, 1],
    ["vignette", "Vignette", 0, 1],
  ];

/**
 * Các đường cong tốc độ có sẵn, đặt tên theo kiểu CapCut: mỗi mẫu là danh
 * sách các mốc `(phần trăm thời lượng, hệ số tốc độ)`.
 */
const DUONG_CONG_TOC_DO: Array<{ ten: string; moc: Array<[number, number]> }> = [
  { ten: "Thường", moc: [[0, 1], [100, 1]] },
  { ten: "Montage", moc: [[0, 4], [30, 1], [70, 1], [100, 4]] },
  { ten: "Bullet", moc: [[0, 1], [12, 5], [100, 1]] },
  { ten: "Hero", moc: [[0, 0.3], [40, 1], [100, 2]] },
  { ten: "Chậm dần", moc: [[0, 2], [100, 0.4]] },
  { ten: "Nhanh dần", moc: [[0, 0.4], [100, 2]] },
  { ten: "Flash", moc: [[0, 1], [15, 6], [30, 1], [100, 1]] },
];

  const keyframeProps: Array<[KeyframableProp, string]> = [
    ["scale", "Tỉ lệ (%)"],
    ["x", "Vị trí ngang (%)"],
    ["y", "Vị trí dọc (%)"],
    ["brightness", "Độ sáng"],
    ["contrast", "Tương phản"],
    ["saturation", "Bão hoà"],
    ["opacity", "Độ đục"],
    ["speed", "Tốc độ (x)"],
  ];

  // Giá trị keyframe đang hiện trên khung xem.
  const previewScale = selected ? keyframeValueNow(selected, "scale") : 100;
  const previewX = selected ? keyframeValueNow(selected, "x") : 50;
  const previewY = selected ? keyframeValueNow(selected, "y") : 50;
  const previewOpacity = selected ? keyframeValueNow(selected, "opacity") : 1;
  const opacityPercent = clamp(previewOpacity, 0, 1);
  // Chỉ dịch khung hình khi clip thật sự có keyframe vị trí, tránh lệch mặc định.
  const hasMoveKeys = Boolean(
    selected?.keyframes.some((k) => k.prop === "x" || k.prop === "y")
  );
  const previewTransform = hasMoveKeys
    ? `translate(${previewX - 50}%, ${previewY - 50}%) scale(${previewScale / 100})`
    : `scale(${previewScale / 100})`;

  const selectedCrop = selected?.crop ?? fullCrop();
  const sourceAspect = 16 / 9;
  const currentCropAspect = cropAspect(selectedCrop, sourceAspect);
  const beatAudio = project.audios.find((a) => a.id === beatingAudioId) ?? null;

  return (
    <div
      className="flex h-full flex-col bg-[#16181d] text-[#e8eaed]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onFileDrop}
    >
      {coBanNhap && (
        // Bản nháp tự lưu: đóng app nhầm thì không mất dự án.
        <div className="flex items-center gap-3 border-b border-[#2a2d33] bg-[#1d3a5f] px-4 py-1.5 text-xs">
          <span className="text-white">
            Có bản nháp từ lần trước chưa lưu.
          </span>
          <button
            className="rounded bg-[#0d92f4] px-2 py-0.5 text-white"
            onClick={() => {
              const duongDan = banNhapPath.current;
              if (!duongDan) return;
              void napTuTep(duongDan, true).then(() => setCoBanNhap(false));
            }}
          >
            Khôi phục
          </button>
          <button
            className="rounded bg-[#2f323a] px-2 py-0.5 text-white"
            onClick={() => void boBanNhap()}
          >
            Bỏ bản nháp
          </button>
        </div>
      )}
      <header className="flex items-center justify-between border-b border-[#2a2d33] px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="text-lg font-bold text-white">OpenCutCut</div>
          <div className="relative">
            <button
              className="rounded bg-[#2f323a] px-2 py-1 text-sm hover:bg-[#3a3d45]"
              onClick={() => setHienDanhSach((v) => !v)}
              title="Mở dự án đã lưu"
            >
              Mở ▾
            </button>
            {hienDanhSach && (
              <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded border border-[#2a2d33] bg-[#1e2025] p-1 shadow-lg">
                {ganDay.length === 0 ? (
                  <p className="px-2 py-1.5 text-[11px] text-[#9aa0a6]">
                    Chưa có dự án nào được mở.
                  </p>
                ) : (
                  ganDay.map((p) => (
                    <button
                      key={p.path}
                      className="block w-full truncate rounded px-2 py-1.5 text-left text-xs text-white hover:bg-[#2f323a]"
                      title={p.path}
                      onClick={() => void moDuanGanDay(p.path)}
                    >
                      {p.ten}
                    </button>
                  ))
                )}
                <button
                  className="mt-1 block w-full rounded bg-[#2f323a] px-2 py-1.5 text-left text-xs text-white hover:bg-[#3a3d45]"
                  onClick={() => {
                    setHienDanhSach(false);
                    void openProjectFile();
                  }}
                >
                  Chọn tệp khác…
                </button>
              </div>
            )}
          </div>
          <button
            className="rounded bg-[#2f323a] px-2 py-1 text-sm hover:bg-[#3a3d45]"
            onClick={mergeProjectFile}
            title="Ghép một dự án khác vào cuối dự án này"
          >
            Ghép
          </button>
          <button
            className="rounded bg-[#2f323a] px-2 py-1 text-sm hover:bg-[#3a3d45]"
            onClick={saveProjectFile}
            title="Lưu dự án"
          >
            Lưu
          </button>
          <button
            className="rounded bg-[#2f323a] px-2 py-1 text-sm disabled:opacity-40"
            onClick={doUndo}
            disabled={!canUndo(history)}
            title="Hoàn tác (Cmd+Z)"
          >
            Hoàn tác
          </button>
          <button
            className="rounded bg-[#2f323a] px-2 py-1 text-sm disabled:opacity-40"
            onClick={doRedo}
            disabled={!canRedo(history)}
            title="Làm lại (Cmd+Shift+Z)"
          >
            Làm lại
          </button>
        </div>
        {/* Thanh trên chỉ giữ phần điều khiển dự án; các thao tác cắt nằm ở
            thanh công cụ timeline đúng như CapCut. */}
        <div className="flex items-center gap-2">
          <select
            className="rounded bg-[#2f323a] px-2 py-1.5 text-sm"
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
          >
            {ratios.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            className="rounded bg-[#0d92f4] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            onClick={exportVideo}
            disabled={exporting || project.clips.length === 0}
          >
            {exporting ? "Đang xuất..." : "Xuất video"}
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-20 shrink-0 flex-col items-center overflow-y-auto border-r border-[#2a2d33] bg-[#1e2025] p-1">
          {tools.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id)}
              title={t.label}
              className={`mb-0.5 flex w-full flex-col items-center gap-0.5 rounded px-1 py-2 text-[9px] leading-tight ${
                activeTool === t.id
                  ? "bg-[#0d92f4] text-white"
                  : "text-[#9aa0a6] hover:bg-[#2a2d33] hover:text-white"
              }`}
            >
              <Icon d={icons[t.id as keyof typeof icons]} className="h-5 w-5" />
              <span className="w-full truncate text-center">{t.label}</span>
            </button>
          ))}
        </aside>

        <aside className="w-72 overflow-y-auto border-r border-[#2a2d33] bg-[#1e2025] p-3 text-xs">
          {activeTool === "media" && (
            <>
              <button
                className="mb-3 w-full rounded bg-[#0d92f4] py-2 text-sm text-white"
                onClick={addMedia}
              >
                + Thêm media
              </button>
              <h3 className="mb-1 font-semibold text-white">Thư viện ({assets.length})</h3>
              <p className="mb-2 text-[10px] text-[#6b7280]">
                Bấm để thêm vào cuối timeline, hoặc kéo xuống track Video.
              </p>
              <input
                value={timKhoa}
                onChange={(e) => setTimKhoa(e.target.value)}
                placeholder="Tìm trong thư viện"
                className="mb-2 w-full rounded bg-[#1e2025] px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-[#0d92f4]"
              />
              {/* Lưới hai cột như CapCut: mỗi ô có hình thu nhỏ và thời lượng. */}
              <div className="grid grid-cols-2 gap-1.5">
                {hienThi.map((a) => (
                  <button
                    key={a.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/opencutcut-asset", a.id);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => dropAsset(a.id, totalDuration)}
                    className="group relative cursor-grab overflow-hidden rounded bg-[#1e2025] text-left hover:bg-[#2f323a]"
                    title={`Thêm ${a.name}`}
                  >
                    {assetThumb(a) ? (
                      <img
                        src={convertFileSrc(assetThumb(a)!)}
                        alt=""
                        draggable={false}
                        className="h-16 w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-16 w-full items-center justify-center bg-[#26282e] text-2xl">
                        {isImagePath(a.path) ? "🖼" : "🎞"}
                      </div>
                    )}
                    {/* Ghim để media hay dùng luôn nằm trên cùng. */}
                    <span
                      role="button"
                      tabIndex={0}
                      className="absolute top-0.5 right-0.5 rounded bg-black/60 px-1 text-[10px] leading-4 hover:bg-black/80"
                      title={a.pinned ? "Bỏ ghim" : "Ghim lên đầu"}
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssets((ds) =>
                          ds.map((x) =>
                            x.id === a.id ? { ...x, pinned: !x.pinned } : x
                          )
                        );
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setAssets((ds) =>
                            ds.map((x) =>
                              x.id === a.id ? { ...x, pinned: !x.pinned } : x
                            )
                          );
                        }
                      }}
                    >
                      {a.pinned ? "★" : "☆"}
                    </span>
                    <div className="px-1 py-0.5">
                      <div className="truncate text-[10px] text-white">{a.name}</div>
                      <div className="text-[9px] text-[#9aa0a6]">
                        {a.duration.toFixed(1)}s
                      </div>
                    </div>
                  </button>
                ))}
                {hienThi.length === 0 && (
                  <p className="col-span-2 py-3 text-center text-[10px] text-[#6b7280]">
                    Không có media nào khớp.
                  </p>
                )}
              </div>
              <h3 className="mb-2 mt-4 font-semibold text-white">
                Clip trong dự án ({project.clips.length})
              </h3>
              {project.clips.map((c) => (
                <div
                  key={c.id}
                  className={`mb-2 cursor-pointer rounded p-2 ${
                    selectedId === c.id
                      ? "bg-[#0d92f4]/30 ring-1 ring-[#0d92f4]"
                      : "bg-[#26282e]"
                  }`}
                  onClick={() => {
                    setSelectedId(c.id);
                    setActiveTool("media");
                  }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-white">
                      {c.locked ? "[khoá] " : ""}
                      {c.name}
                    </span>
                    <button
                      className="rounded bg-[#2f323a] px-1.5 py-0.5 text-[10px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleLock(c.id);
                      }}
                      title={c.locked ? "Mở khoá clip" : "Khoá clip"}
                    >
                      {c.locked ? "Khoá" : "Mở"}
                    </button>
                  </div>
                  <div className="text-[#9aa0a6]">
                    {c.duration.toFixed(2)}s · {c.speed.toFixed(2)}x · {c.start.toFixed(2)}s
                    {c.keyframes.length > 0 ? ` · ${c.keyframes.length} KF` : ""}
                  </div>
                  {selectedId === c.id && (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <label className="w-14">Tốc độ</label>
                        <input
                          type="range"
                          min={0.25}
                          max={4}
                          step={0.05}
                          value={c.speed}
                          onChange={(e) => tuneClip(c.id, "speed", Number(e.target.value))}
                          className="flex-1 accent-[#0d92f4]"
                        />
                        <span className="w-9 text-right">{c.speed.toFixed(2)}x</span>
                      </div>
                      {/* Nội suy khung: chỉ có tác dụng khi giảm tốc. */}
                      <label
                        className={`flex items-center gap-2 text-[10px] ${
                          c.speed >= 0.95 && !coCungTocDo(c) ? "text-[#6b7280]" : "text-white"
                        }`}
                        title="Bịa thêm khung hình khi giảm tốc cho chuyển động mượt"
                      >
                        <input
                          type="checkbox"
                          checked={c.smooth}
                          onChange={(e) => patchClip(c.id, { smooth: e.target.checked })}
                        />
                        Nội suy khung (quay chậm mượt)
                      </label>
                      {/* Đường cong tốc độ: chọn mẫu có sẵn hoặc kéo mốc tại con trỏ. */}
                      <div className="pt-1">
                        <div className="mb-1 text-[10px] text-[#9aa0a6]">
                          Đường cong tốc độ
                          {coCungTocDo(c) && ` · ${soMocTocDo(c)} mốc`}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {DUONG_CONG_TOC_DO.map((mau) => (
                            <button
                              key={mau.ten}
                              className="rounded bg-[#2f323a] px-1.5 py-0.5 text-[10px] text-white hover:bg-[#0d92f4]"
                              onClick={() => apDungDuongCong(c, mau)}
                            >
                              {mau.ten}
                            </button>
                          ))}
                          <button
                            className="rounded bg-[#2f323a] px-1.5 py-0.5 text-[10px] text-white hover:bg-[#0d92f4]"
                            onClick={() => themMocTocDo(c, currentTime, c.speed)}
                            title="Thêm mốc tốc độ tại con trỏ phát"
                          >
                            + Mốc
                          </button>
                          <button
                            className="rounded bg-[#2f323a] px-1.5 py-0.5 text-[10px] text-white hover:bg-[#3a3d45]"
                            onClick={() => xoaHetMocTocDo(c)}
                            disabled={!coCungTocDo(c)}
                          >
                            Xóa
                          </button>
                        </div>
                        {coCungTocDo(c) && (
                          <div className="mt-1 space-y-0.5">
                            {c.keyframes
                              .filter((k) => k.prop === "speed")
                              .sort((a, b) => a.time - b.time)
                              .map((k) => (
                                <div
                                  key={k.id}
                                  className="flex items-center gap-1 text-[10px]"
                                >
                                  <span className="w-11 text-[#9aa0a6]">
                                    {(k.time - c.start).toFixed(2)}s
                                  </span>
                                  <input
                                    type="number"
                                    min={0.05}
                                    max={20}
                                    step={0.05}
                                    value={k.value}
                                    onChange={(e) =>
                                      suaMocTocDo(
                                        c.id,
                                        k.id,
                                        Number(e.target.value)
                                      )
                                    }
                                    className="w-14 rounded bg-[#2f323a] px-1 py-0.5"
                                  />
                                  <span className="text-[#9aa0a6]">x</span>
                                  <input
                                    type="number"
                                    min={0}
                                    max={c.duration}
                                    step={0.05}
                                    value={k.time - c.start}
                                    onChange={(e) =>
                                      doiMocTocDo(
                                        c.id,
                                        k.id,
                                        Number(e.target.value)
                                      )
                                    }
                                    className="w-14 rounded bg-[#2f323a] px-1 py-0.5"
                                  />
                                  <span className="text-[#9aa0a6]">s</span>
                                  <button
                                    className="rounded px-1 text-[#ef4444] hover:bg-[#2f323a]"
                                    onClick={() => xoaMocTocDo(c.id, k.id)}
                                    title="Xóa mốc này"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="w-14">Âm lượng</label>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.05}
                          value={c.volume}
                          onChange={(e) => tuneClip(c.id, "volume", Number(e.target.value))}
                          className="flex-1 accent-[#0d92f4]"
                        />
                        <span className="w-9 text-right">
                          {Math.round(c.volume * 100)}%
                        </span>
                      </div>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={c.muted}
                          onChange={(e) => patchClip(c.id, { muted: e.target.checked })}
                        />
                        Tắt tiếng clip
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={c.reverse}
                          onChange={(e) =>
                            c.kind === "video" &&
                            patchClip(c.id, { reverse: e.target.checked })
                          }
                          disabled={c.kind !== "video"}
                        />
                        Đảo ngược clip
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {activeTool === "adjust" && (
            selected ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold text-white">
                    Điều chỉnh · {selected.name}
                  </h3>
                  <button
                    className="rounded bg-[#2f323a] px-2 py-0.5"
                    onClick={() => patchClip(selected.id, { adjust: defaultAdjust() })}
                  >
                    Đặt lại
                  </button>
                </div>
                {sliders.map(([key, label, min, max]) => (
                  <div key={key} className="mb-1">
                    <div className="flex items-center gap-2">
                      <label className="w-28 text-[#9aa0a6]">{label}</label>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={0.01}
                        value={selected.adjust[key] as number}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          const base = selected.adjust;
                          gossip(`adjust:${selected.id}:${String(key)}`, (p) => ({
                            ...p,
                            clips: p.clips.map((c) =>
                              c.id === selected!.id
                                ? { ...c, adjust: { ...base, [key]: value } }
                                : c
                            ),
                          }));
                        }}
                        className="flex-1 accent-[#0d92f4]"
                      />
                      <span className="w-9 text-right">
                        {(selected.adjust[key] as number).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
                <label className="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.adjust.blackWhite}
                    onChange={(e) =>
                      patchClip(selected.id, {
                        adjust: { ...selected.adjust, blackWhite: e.target.checked },
                      })
                    }
                  />
                  Đen trắng
                </label>
                {/* Bảng HSL: chọn một dải màu rồi kéo ba thanh của dải đó. */}
                <div className="mt-3 border-t border-[#2a2d33] pt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">Dải màu HSL</span>
                    <button
                      className="rounded bg-[#2f323a] px-2 py-0.5 text-[10px] text-white hover:bg-[#3a3d45]"
                      onClick={() =>
                        patchClip(selected.id, {
                          adjust: { ...selected.adjust, hsl: defaultHsl() },
                        })
                      }
                    >
                      Xóa dải
                    </button>
                  </div>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {DAI_MAU.map((d) => {
                      const gia = selected.adjust.hsl[d.ten];
                      const da = gia.hue !== 0 || gia.sat !== 0 || gia.lum !== 0;
                      return (
                        <button
                          key={d.ten}
                          onClick={() => setDaiHsl(d.ten)}
                          title={d.nhan}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                            daiHsl === d.ten ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                          } ${da ? "text-white" : "text-[#9aa0a6]"}`}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ background: d.mau }}
                          />
                          {d.nhan}
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const gia = selected.adjust.hsl[daiHsl];
                    const dong = (
                      khoa: "hue" | "sat" | "lum",
                      nhan: string,
                      min: number,
                      max: number
                    ) => (
                      <div key={khoa} className="mb-1 flex items-center gap-2">
                        <label className="w-12 text-[#9aa0a6]">{nhan}</label>
                        <input
                          type="range"
                          min={min}
                          max={max}
                          step={khoa === "hue" ? 1 : 0.01}
                          value={gia[khoa]}
                          onChange={(e) =>
                            patchClip(selected.id, {
                              adjust: {
                                ...selected.adjust,
                                hsl: {
                                  ...selected.adjust.hsl,
                                  [daiHsl]: { ...gia, [khoa]: Number(e.target.value) },
                                },
                              },
                            })
                          }
                          className="flex-1 accent-[#0d92f4]"
                        />
                        <span className="w-9 text-right text-[10px]">
                          {khoa === "hue"
                            ? Math.round(gia[khoa])
                            : gia[khoa].toFixed(2)}
                        </span>
                      </div>
                    );
                    return (
                      <>
                        {dong("hue", "Sắc", -180, 180)}
                        {dong("sat", "Bão", -1, 1)}
                        {dong("lum", "Sáng", -1, 1)}
                      </>
                    );
                  })()}
                </div>
              </>
            ) : (
              <p className="text-[#9aa0a6]">Chọn một clip ở tab Phương tiện trước.</p>
            )
          )}

          {activeTool === "crop" && (
            selected ? (
              <>
                <h3 className="mb-1 font-semibold text-white">Cắt ảnh</h3>
                <p className="mb-2 text-[10px] text-[#6b7280]">
                  Kéo trên khung xem để chọn vùng, hoặc chỉnh bằng thanh bên dưới.
                </p>
                {(["x", "y", "width", "height"] as const).map((key) => (
                  <div key={key} className="mb-1 flex items-center gap-2">
                    <label className="w-16 text-[#9aa0a6]">
                      {key === "x" ? "Trái" : key === "y" ? "Trên" : key === "width" ? "Rộng" : "Cao"}
                    </label>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.005}
                      value={selectedCrop[key]}
                      onChange={(e) =>
                        updateCrop({ [key]: Number(e.target.value) }, true)
                      }
                      className="flex-1 accent-[#0d92f4]"
                    />
                    <span className="w-9 text-right">
                      {Math.round(selectedCrop[key] * 100)}%
                    </span>
                  </div>
                ))}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    className="rounded bg-[#2f323a] px-2 py-1"
                    onClick={() => patchClip(selected.id, { crop: fullCrop() })}
                  >
                    Đặt lại
                  </button>
                  <span className="text-[#9aa0a6]">
                    Tỉ lệ: {currentCropAspect.toFixed(2)}
                  </span>
                </div>
                <h4 className="mb-1 mt-3 font-semibold text-white">Cắt theo tỉ lệ</h4>
                <div className="flex flex-wrap gap-1">
                  {[
                    { id: "16:9", a: 16 / 9 },
                    { id: "9:16", a: 9 / 16 },
                    { id: "1:1", a: 1 },
                    { id: "4:3", a: 4 / 3 },
                    { id: "free", a: 0 },
                  ].map((r) => (
                    <button
                      key={r.id}
                      className={`rounded px-2 py-1 ${
                        cropAspectRatio === r.id ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                      }`}
                      onClick={() => {
                        setCropAspectRatio(r.id);
                        if (r.a === 0) return;
                        // Tìm hộp crop lớn nhất theo tỉ lệ yêu cầu.
                        const height = 1;
                        const width = clamp(height * r.a / sourceAspect, 0.05, 1);
                        updateCrop({
                          x: (1 - width) / 2,
                          y: (1 - height) / 2,
                          width,
                          height,
                        });
                      }}
                    >
                      {r.id}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[#9aa0a6]">Chọn một clip trước.</p>
            )
          )}

          {activeTool === "chroma" && (
            selected ? (
              <>
                <h3 className="mb-2 font-semibold text-white">Lọc màu nền</h3>
                <label className="mb-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.chroma.enabled}
                    onChange={(e) =>
                      patchClip(selected.id, {
                        chroma: { ...selected.chroma, enabled: e.target.checked },
                      })
                    }
                  />
                  Bật lọc nền
                </label>
                <div className="mb-2 flex items-center gap-2">
                  <label className="w-24 text-[#9aa0a6]">Màu nền</label>
                  <input
                    type="color"
                    value={selected.chroma.color}
                    onChange={(e) =>
                      patchClip(selected.id, {
                        chroma: { ...selected.chroma, color: e.target.value },
                      })
                    }
                    className="h-6 w-10"
                  />
                  <span className="text-[#9aa0a6]">{selected.chroma.color}</span>
                </div>
                {(
                  [
                    ["similarity", "Độ giống", 0.01, 1],
                    ["smoothness", "Độ mềm", 0, 1],
                    ["spill", "Khử viền", 0, 1],
                  ] as Array<[keyof ChromaKey, string, number, number]>
                ).map(([key, label, min, max]) => (
                  <div key={key} className="mb-1 flex items-center gap-2">
                    <label className="w-24 text-[#9aa0a6]">{label}</label>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={0.01}
                      value={selected.chroma[key] as number}
                      onChange={(e) => {
                          const value = Number(e.target.value);
                          const base = selected.chroma;
                          gossip(`chroma:${selected.id}:${String(key)}`, (p) => ({
                            ...p,
                            clips: p.clips.map((c) =>
                              c.id === selected!.id
                                ? { ...c, chroma: { ...base, [key]: value } }
                                : c
                            ),
                          }));
                        }}
                      className="flex-1 accent-[#0d92f4]"
                    />
                    <span className="w-9 text-right">
                      {(selected.chroma[key] as number).toFixed(2)}
                    </span>
                  </div>
                ))}
                <p className="mt-2 text-[10px] text-[#6b7280]">
                  Khi bật, nền trong suốt nên nên đặt clip lên một lớp nền khác.
                </p>
              </>
            ) : (
              <p className="text-[#9aa0a6]">Chọn một clip trước.</p>
            )
          )}

          {activeTool === "curves" && (
            selected ? (
              <>
                <h3 className="mb-2 font-semibold text-white">Đường cong màu</h3>
                <div className="mb-3 flex flex-wrap gap-1">
                  {curvePresets.map(([label, value]) => (
                    <button
                      key={label}
                      className={`rounded px-2 py-1 ${
                        selected.curves.master === value ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                      }`}
                      onClick={() =>
                        patchClip(selected.id, {
                          curves: { ...selected.curves, master: value },
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {(["master", "red", "green", "blue"] as const).map((key) => (
                  <div key={key} className="mb-2">
                    <label className="mb-1 block text-[#9aa0a6]">
                      {key === "master"
                        ? "Tổng"
                        : key === "red"
                          ? "Đỏ"
                          : key === "green"
                            ? "Xanh lá"
                            : "Xanh dương"}
                    </label>
                    <textarea
                      className="w-full rounded bg-[#1e2025] p-1 font-mono text-[10px] text-white"
                      rows={2}
                      placeholder="0/0 0.5/0.6 1/1"
                      value={selected.curves[key]}
                      onChange={(e) => {
                          const value = e.target.value;
                          const base = selected.curves;
                          gossip(`curves:${selected.id}:${key}`, (p) => ({
                            ...p,
                            clips: p.clips.map((c) =>
                              c.id === selected!.id
                                ? { ...c, curves: { ...base, [key]: value } }
                                : c
                            ),
                          }));
                        }}
                    />
                  </div>
                ))}
                <button
                  className="rounded bg-[#2f323a] px-2 py-1"
                  onClick={() => patchClip(selected.id, { curves: defaultCurves() })}
                >
                  Đặt lại
                </button>
              </>
            ) : (
              <p className="text-[#9aa0a6]">Chọn một clip trước.</p>
            )
          )}

          {activeTool === "lut" && (
            selected ? (
              <>
                <h3 className="mb-2 font-semibold text-white">LUT (.cube)</h3>
                <button
                  className="mb-2 w-full rounded bg-[#0d92f4] py-2 text-sm text-white"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".cube";
                    input.onchange = () => {
                      const file = input.files?.[0];
                      if (!file) return;
                      patchClip(selected.id, {
                        lut: { path: (file as any).path || file.name, strength: 1 },
                      });
                    };
                    input.click();
                  }}
                >
                  + Chọn tệp .cube
                </button>
                {selected.lut.path && (
                  <>
                    <div className="mb-2 truncate text-[#9aa0a6]">{selected.lut.path}</div>
                    <div className="mb-2 flex items-center gap-2">
                      <label className="w-20 text-[#9aa0a6]">Cường độ</label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={selected.lut.strength}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          const path = selected.lut.path;
                          gossip(`lut:${selected.id}`, (p) => ({
                            ...p,
                            clips: p.clips.map((c) =>
                              c.id === selected!.id
                                ? { ...c, lut: { path, strength: value } }
                                : c
                            ),
                          }));
                        }}
                        className="flex-1 accent-[#0d92f4]"
                      />
                      <span className="w-9 text-right">
                        {Math.round(selected.lut.strength * 100)}%
                      </span>
                    </div>
                  </>
                )}
                <button
                  className="rounded bg-[#2f323a] px-2 py-1"
                  onClick={() => patchClip(selected.id, { lut: defaultLut() })}
                >
                  Bỏ LUT
                </button>
              </>
            ) : (
              <p className="text-[#9aa0a6]">Chọn một clip trước.</p>
            )
          )}

          {activeTool === "filters" && (
            <>
              <h3 className="mb-2 font-semibold text-white">Bộ lọc toàn video</h3>
              {/* Ô xem trước có mảng màu, giống lưới bộ lọc của CapCut. */}
              <div className="grid grid-cols-3 gap-1.5">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    className={`overflow-hidden rounded ${
                      filter === f.id ? "ring-2 ring-[#0d92f4]" : ""
                    }`}
                    onClick={() => setFilter(f.id)}
                  >
                    <div
                      className="h-10 w-full"
                      style={{ background: timHieuUng(f.id)?.mau ?? "#333" }}
                    />
                    <span className="block bg-[#2f323a] px-1 py-0.5 text-[9px] text-white">
                      {f.label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {activeTool === "mix" && (
            <>
              <h3 className="mb-1 font-semibold text-white">Chế độ hòa trộn</h3>
              <p className="mb-2 text-[#9aa0a6]">Áp dụng cho clip đang chọn.</p>
              <div className="grid grid-cols-2 gap-1">
                {mixModes.map((m) => (
                  <button
                    key={m.id}
                    disabled={!selected}
                    className={`rounded px-2 py-1.5 disabled:opacity-40 ${
                      selected?.mixMode === m.id ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                    }`}
                    onClick={() => selected && patchClip(selected.id, { mixMode: m.id })}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {activeTool === "audio" && (
            <>
              <button
                className="mb-3 w-full rounded bg-[#0d92f4] py-2 text-sm text-white"
                onClick={addAudio}
              >
                + Thêm âm thanh
              </button>
              <h3 className="mb-2 font-semibold text-white">
                Nhạc nền ({project.audios.length})
              </h3>
              {project.audios.map((a) => (
                <div key={a.id} className="mb-2 rounded bg-[#26282e] p-2">
                  <div className="truncate text-white">{a.name}</div>
                  <div className="text-[#9aa0a6]">
                    {a.duration.toFixed(2)}s · {a.beats.length} nhịp
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <label className="text-[10px] text-[#9aa0a6]">Bắt đầu</label>
                    <input
                      type="number"
                      step={0.1}
                      value={a.start}
                      onChange={(e) =>
                        push((p) => ({
                          ...p,
                          audios: p.audios.map((x) =>
                            x.id === a.id
                              ? { ...x, start: readNumber(e.target.value, x.start, 0, 86400) }
                              : x
                          ),
                        }))
                      }
                      className="w-12 rounded bg-[#1e2025] px-1 py-0.5"
                    />
                    <label className="text-[10px] text-[#9aa0a6]">Âm lượng</label>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={a.volume}
                      onChange={(e) =>
                        push((p) => ({
                          ...p,
                          audios: p.audios.map((x) =>
                            x.id === a.id ? { ...x, volume: Number(e.target.value) } : x
                          ),
                        }))
                      }
                      className="min-w-0 flex-1 accent-[#0d92f4]"
                    />
                    <button
                      className="shrink-0 rounded bg-[#2f323a] px-2 py-0.5"
                      onClick={() =>
                        push((p) => ({
                          ...p,
                          audios: p.audios.filter((x) => x.id !== a.id),
                        }))
                      }
                    >
                      X
                    </button>
                  </div>
                  <div className="mt-1 flex gap-1">
                    <button
                      className="flex-1 rounded bg-[#2f323a] px-2 py-0.5"
                      onClick={() => setBeatingAudioId(a.id)}
                    >
                      Nhịp
                    </button>
                    <button
                      className="flex-1 rounded bg-[#2f323a] px-2 py-0.5"
                      onClick={() => analyzeAudio(a.id, a.path)}
                    >
                      Phân tích
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="mb-3 w-full rounded bg-[#2f323a] py-2 text-sm"
                onClick={snapToBeat}
                disabled={!project.audios.some((a) => a.beatGrid?.interval)}
              >
                Căn clip theo nhịp
              </button>
              {beatAudio?.beatGrid && (
                <div className="rounded bg-[#1e2025] p-2 text-[#9aa0a6]">
                  <div>Nhịp đầu: {beatAudio.beatGrid.firstBeat.toFixed(2)}s</div>
                  <div>
                    Chu kỳ: {beatAudio.beatGrid.interval.toFixed(3)}s (
                    {(60 / beatAudio.beatGrid.interval).toFixed(1)} BPM)
                  </div>
                  <div className="mt-1 flex gap-1">
                    <button
                      className="rounded bg-[#2f323a] px-2 py-0.5"
                      onClick={() => rebuildBeatGrid(beatAudio.id)}
                    >
                      Dựng lại lưới
                    </button>
                    <button
                      className="rounded bg-[#2f323a] px-2 py-0.5"
                      onClick={() => setBeatingAudioId(null)}
                    >
                      Đóng
                    </button>
                  </div>
                </div>
              )}
              <h3 className="mb-2 mt-4 font-semibold text-white">Chất lượng xuất</h3>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: "low", label: "Nhẹ" },
                  { id: "medium", label: "Vừa" },
                  { id: "high", label: "Cao" },
                ].map((q) => (
                  <button
                    key={q.id}
                    className={`rounded px-2 py-1.5 ${
                      quality === q.id ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                    }`}
                    onClick={() => setQuality(q.id)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <h3 className="mb-2 mt-4 font-semibold text-white">Khung hình/giây</h3>
              <div className="grid grid-cols-3 gap-1">
                {[24, 30, 60].map((f) => (
                  <button
                    key={f}
                    className={`rounded px-2 py-1.5 ${
                      fps === f ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                    }`}
                    onClick={() => setFps(f)}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </>
          )}

          {activeTool === "text" && (
            <>
              <button
                className="mb-3 w-full rounded bg-[#0d92f4] py-2 text-sm text-white"
                onClick={() => addText("text")}
              >
                + Thêm văn bản
              </button>
              {project.texts
                .filter((t) => t.kind === "text")
                .map((t) => (
                  <div key={t.id} className="mb-2 rounded bg-[#26282e] p-2">
                    <input
                      className="mb-1 w-full rounded bg-[#1e2025] px-2 py-1 text-white"
                      value={t.text}
                      onChange={(e) =>
                        gossip(`text:${t.id}`, (p) => ({
                          ...p,
                          texts: p.texts.map((x) =>
                            x.id === t.id ? { ...x, text: e.target.value } : x
                          ),
                        }))
                      }
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="color"
                        value={t.color}
                        onChange={(e) => updateText(t.id, { color: e.target.value })}
                        className="h-6 w-8"
                      />
                      <input
                        type="range"
                        min={12}
                        max={96}
                        value={t.size}
                        onChange={(e) =>
                          gossip(`text:${t.id}:size`, (p) => ({
                            ...p,
                            texts: p.texts.map((x) =>
                              x.id === t.id ? { ...x, size: Number(e.target.value) } : x
                            ),
                          }))
                        }
                        className="flex-1 accent-[#0d92f4]"
                      />
                      <button
                        className="rounded bg-[#2f323a] px-2 py-0.5"
                        onClick={() => updateText(t.id, { bold: !t.bold })}
                      >
                        {t.bold ? "Đậm" : "Thường"}
                      </button>
                      <button
                        className="rounded bg-[#2f323a] px-2 py-0.5"
                        onClick={() =>
                          push((p) => ({
                            ...p,
                            texts: p.texts.filter((x) => x.id !== t.id),
                          }))
                        }
                      >
                        X
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <label className="text-[#9aa0a6]">Bắt đầu</label>
                      <input
                        type="number"
                        step={0.1}
                        value={t.start}
                        onChange={(e) =>
                        updateText(t.id, {
                          start: readNumber(e.target.value, t.start, 0, 86400),
                        })
                      }
                        className="w-14 rounded bg-[#1e2025] px-1 py-0.5"
                      />
                      <label className="text-[#9aa0a6]">Dài</label>
                      <input
                        type="number"
                        step={0.1}
                        value={t.duration}
                        onChange={(e) =>
                        updateText(t.id, {
                          duration: readNumber(e.target.value, t.duration, 0.1, 86400),
                        })
                      }
                        className="w-14 rounded bg-[#1e2025] px-1 py-0.5"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-[#6b7280]">
                      Nhấn đúp lớp chữ trên khung xem để sửa nhanh.
                    </p>
                  </div>
                ))}
            </>
          )}

          {activeTool === "sticker" && (
            <>
              <h3 className="mb-2 font-semibold text-white">Nhãn dán</h3>
              <div className="grid grid-cols-4 gap-1">
                {stickers.map((s) => (
                  <button
                    key={s}
                    className="rounded bg-[#26282e] py-2 text-xl"
                    onClick={() => addText("sticker", s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {activeTool === "effect" && (
            <>
              <h3 className="mb-2 font-semibold text-white">
                Hiệu ứng {selected ? selected.name : "clip"}
              </h3>
              {!selected ? (
                <p className="text-xs text-[#9aa0a6]">
                  Chọn một clip trên timeline để áp hiệu ứng.
                </p>
              ) : (
                <>
                  {selected.effect && (
                    <div className="mb-2 flex items-center gap-2 rounded bg-[#26282e] p-2">
                      <div
                        className="h-8 w-12 shrink-0 rounded"
                        style={{ background: timHieuUng(selected.effect)?.mau }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-white">
                          {timHieuUng(selected.effect)?.ten}
                        </div>
                        <div className="truncate text-[10px] text-[#9aa0a6]">
                          {timHieuUng(selected.effect)?.loi}
                        </div>
                      </div>
                      <label className="flex items-center gap-1 text-[10px]">
                        <input
                          type="checkbox"
                          checked={selected.effectStrong}
                          onChange={(e) =>
                            patchClip(selected.id, { effectStrong: e.target.checked })
                          }
                        />
                        Mạnh
                      </label>
                      <button
                        className="rounded bg-[#2f323a] px-2 py-0.5"
                        onClick={() =>
                          patchClip(selected.id, { effect: "", effectStrong: false })
                        }
                      >
                        Bỏ
                      </button>
                    </div>
                  )}
                  <input
                    value={tucKhoaHieuUng}
                    onChange={(e) => setTucKhoaHieuUng(e.target.value)}
                    placeholder="Tìm hiệu ứng"
                    className="mb-2 w-full rounded bg-[#1e2025] px-2 py-1 text-xs text-white outline-none focus:ring-1 focus:ring-[#0d92f4]"
                  />
                  {/* Hiệu ứng vừa dùng, giữ theo thứ tự mới nhất trước. */}
                  {hieuUngDaDung.length > 0 && !tucKhoaHieuUng.trim() && (
                    <div className="mb-3">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-[#9aa0a6]">
                        <span>Vừa dùng</span>
                        <button
                          className="hover:text-white"
                          onClick={() => setHieuUngDaDung([])}
                        >
                          Xóa
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {hieuUngDaDung.map((id) => {
                          const h = timHieuUng(id);
                          if (!h) return null;
                          return (
                            <button
                              key={id}
                              className={`overflow-hidden rounded ${
                                selected.effect === id ? "ring-2 ring-[#0d92f4]" : ""
                              }`}
                              title={h.loi ?? h.ten}
                              onClick={() => {
                                patchClip(selected.id, { effect: id });
                                nhoHieuUng(id);
                              }}
                            >
                              <div className="h-11 w-full" style={{ background: h.mau }} />
                              <span className="block truncate bg-[#2f323a] px-1 py-0.5 text-[9px] text-white">
                                {h.ten}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Kho hiệu ứng chia theo nhóm, mỗi ô có mảng màu xem trước. */}
                  {khoHieuUngHienThi.length === 0 && (
                    <p className="py-3 text-center text-[10px] text-[#6b7280]">
                      Không có hiệu ứng nào khớp.
                    </p>
                  )}
                  {khoHieuUngHienThi.map(({ nhom, items }) => (
                      <div key={nhom} className="mb-3">
                        <div className="mb-1 text-[10px] text-[#9aa0a6]">{nhom}</div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {items.map((h) => (
                            <button
                              key={h.id}
                              className={`overflow-hidden rounded ${
                                selected.effect === h.id ? "ring-2 ring-[#0d92f4]" : ""
                              }`}
                              title={h.loi ?? h.ten}
                              onClick={() => {
                                patchClip(selected.id, { effect: h.id });
                                nhoHieuUng(h.id);
                              }}
                            >
                              <div
                                className="h-11 w-full"
                                style={{ background: h.mau }}
                              />
                              <span className="block truncate bg-[#2f323a] px-1 py-0.5 text-[9px] text-white">
                                {h.ten}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                  ))}
                </>
              )}
            </>
          )}

          {activeTool === "transition" && (
            <>
              <h3 className="mb-2 font-semibold text-white">
                Chuyển cảnh cuối {selected ? selected.name : "clip"}
              </h3>
              {!selected ? (
                <p className="text-xs text-[#9aa0a6]">
                  Chọn một clip trên timeline để đặt chuyển cảnh nối sang clip kế
                  tiếp.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    {transitions.map((t) => (
                      <button
                        key={t.id}
                        className={`rounded px-2 py-1.5 text-left text-xs ${
                          selected.transition === t.id
                            ? "bg-[#0d92f4]"
                            : "bg-[#2f323a]"
                        }`}
                        onClick={() =>
                          selected &&
                          patchClip(selected.id, { transition: t.id })
                        }
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {selected.transition !== "none" && (
                    <label className="mt-3 block text-xs text-[#9aa0a6]">
                      Dài {selected.transitionDuration.toFixed(2)}s
                      <input
                        type="range"
                        min={0.1}
                        max={3}
                        step={0.05}
                        value={selected.transitionDuration}
                        onChange={(e) => {
                          const value = Number(e.target.value);
                          const id = selected.id;
                          gossip(`transition:${id}`, (p) => ({
                            ...p,
                            clips: p.clips.map((c) =>
                              c.id === id
                                ? { ...c, transitionDuration: value }
                                : c
                            ),
                          }));
                        }}
                        className="mt-1 w-full accent-[#0d92f4]"
                      />
                    </label>
                  )}
                  {/* Áp nhanh một loại chuyển cảnh cho mọi mối nối trong dự án. */}
                  <div className="mt-3 border-t border-[#2a2d33] pt-2">
                    <p className="mb-1 text-xs font-semibold text-white">
                      Áp cho mọi mối nối ({soMoiNoi})
                    </p>
                    <p className="mb-2 text-[10px] text-[#9aa0a6]">
                      Đặt cùng một loại chuyển cảnh lên tất cả clip đang có mối
                      nối bám sát (không tính khoảng trống và clip đè nhau).
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {transitions.slice(0, 8).map((t) => (
                        <button
                          key={t.id}
                          className="rounded bg-[#2f323a] px-2 py-0.5 text-[10px] text-white hover:bg-[#0d92f4]"
                          onClick={() => apChuyenCanhMoiNoi(t.id)}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Keyframe trong vùng chuyển cảnh: thêm tại hai đầu chuyển cảnh
                      rồi kéo chỉnh, để chuyển cạnh có chuyển động riêng. */}
                  {selected.transition !== "none" && (
                    <div className="mt-3 border-t border-[#2a2d33] pt-2">
                      <p className="mb-1 text-xs font-semibold text-white">
                        Keyframe trong chuyển cảnh
                      </p>
                      <p className="mb-2 text-[10px] text-[#9aa0a6]">
                        Bấm tại con trỏ phát để thêm mốc cho tỉ lệ hoặc độ đục. Mốc
                        nằm trong cửa sổ chuyển cảnh sẽ được áp lên cả khoảnh chuyển.
                      </p>
                      {(["scale", "opacity"] as const).map((prop) => (
                        <div key={prop} className="mb-1 flex items-center gap-2">
                          <span className="w-16 text-[10px] text-[#9aa0a6]">
                            {prop === "scale" ? "Tỉ lệ" : "Độ đục"}
                          </span>
                          <button
                            className="rounded bg-[#2f323a] px-2 py-0.5 text-[10px] text-white hover:bg-[#0d92f4]"
                            onClick={() => {
                              const goc = keyframeValueNow(selected, prop);
                              themKeyframe(selected.id, prop, currentTime, goc);
                            }}
                          >
                            + Mốc
                          </button>
                          <button
                            className="rounded bg-[#2f323a] px-2 py-0.5 text-[10px] text-white hover:bg-[#3a3d45]"
                            onClick={() => xoaKeyframeCuaClip(selected.id, prop)}
                          >
                            Xóa hết
                          </button>
                          <span className="text-[10px] text-[#6b7280]">
                            {selected.keyframes.filter((k) => k.prop === prop).length}{" "}
                            mốc
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {activeTool === "canvas" && (
            <>
              <h3 className="mb-2 font-semibold text-white">Tỉ lệ khung hình</h3>
              <div className="grid grid-cols-2 gap-1">
                {ratios.map((r) => (
                  <button
                    key={r.id}
                    className={`rounded px-2 py-1.5 ${
                      ratio === r.id ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                    }`}
                    onClick={() => setRatio(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <h3 className="mb-2 mt-4 font-semibold text-white">Chất lượng</h3>
              <div className="grid grid-cols-3 gap-1">
                {[
                  { id: "low", label: "Nhẹ" },
                  { id: "medium", label: "Vừa" },
                  { id: "high", label: "Cao" },
                ].map((q) => (
                  <button
                    key={q.id}
                    className={`rounded px-2 py-1.5 ${
                      quality === q.id ? "bg-[#0d92f4]" : "bg-[#2f323a]"
                    }`}
                    onClick={() => setQuality(q.id)}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
              <h3 className="mb-2 mt-4 font-semibold text-white">Keyframe</h3>
              {selected ? (
                <>
                  <select
                    className="mb-2 w-full rounded bg-[#1e2025] px-2 py-1"
                    value={keyframeProp}
                    onChange={(e) => setKeyframeProp(e.target.value as KeyframableProp)}
                  >
                    {keyframeProps.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="mb-2 flex gap-1">
                    <button
                      className="flex-1 rounded bg-[#0d92f4] px-2 py-1 text-white"
                      onClick={addKeyframeAtPlayhead}
                    >
                      Thêm KF
                    </button>
                    <button
                      className="flex-1 rounded bg-[#2f323a] px-2 py-1"
                      onClick={removeKeyframeAtPlayhead}
                    >
                      Xoá KF
                    </button>
                  </div>
                  <div className="mb-2 text-[#9aa0a6]">
                    Giá trị lúc này:{" "}
                    {keyframeValueNow(selected, keyframeProp).toFixed(2)}
                  </div>
                  <div className="mb-1 flex items-center gap-2">
                    <label className="w-24 text-[#9aa0a6]">
                      {keyframeProps.find(([id]) => id === keyframeProp)?.[1]}
                    </label>
                    <input
                      type="range"
                      min={keyframeProp === "scale" ? 10 : -1}
                      max={keyframeProp === "scale" ? 300 : keyframeProp === "opacity" ? 1 : 100}
                      step={0.1}
                      value={keyframeValueNow(selected, keyframeProp)}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        const inside =
                          currentTime > selected.start + 0.001 &&
                          currentTime < selected.start + selected.duration - 0.001;
                        if (inside) {
                          patchClip(selected.id, {
                            keyframes: addKeyframe(selected.keyframes, currentTime, keyframeProp, value),
                          });
                        } else {
                          const base =
                            keyframeProp === "scale"
                              ? {}
                              : keyframeProp === "brightness" ||
                                  keyframeProp === "contrast" ||
                                  keyframeProp === "saturation"
                                ? { adjust: { ...selected.adjust, [keyframeProp]: value } }
                                : {};
                          patchClip(selected.id, base);
                        }
                      }}
                      className="flex-1 accent-[#0d92f4]"
                    />
                  </div>
                  <div className="text-[10px] text-[#6b7280]">
                    Các mốc:{" "}
                    {keyframeTimes(keyframeTarget!, keyframeProp)
                      .map((t) => t.toFixed(2) + "s")
                      .join(", ") || "chưa có"}
                  </div>
                </>
              ) : (
                <p className="text-[#9aa0a6]">Chọn một clip trước.</p>
              )}
            </>
          )}
        </aside>

        <main className="flex flex-1 flex-col bg-[#101114]">
          <div
              className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#101114]"
              style={{ containerType: "size" }}
            >
            {/* Khung canvas phải vừa cả chiều rộng lẫn chiều cao của vùng chứa
                mà vẫn giữ đúng tỉ lệ. `aspect-ratio` kèm `max-height` sẽ bị bóp
                méo, nên tính chiều rộng bằng đơn vị container query: lấy nhỏ
                hơn giữa toàn bộ bề ngang và bề dọc nhân tỉ lệ. */}
            <div
              className="relative shrink-0"
              style={{
                width: `min(100cqw, calc(100cqh * ${canvas.w / canvas.h}))`,
                aspectRatio: `${canvas.w} / ${canvas.h}`,
              }}
            >
              <div
                className="flex h-full w-full items-center justify-center bg-black"
                onPointerDown={activeTool === "crop" ? startCropDrag : undefined}
                style={{ cursor: activeTool === "crop" ? "crosshair" : "default" }}
              >
                {activeClip ? (
                  <div
                    className="relative h-full w-full transition-transform"
                    style={{
                      transform: previewTransform,
                      opacity: opacityPercent,
                    }}
                  >
                    {activeClip.kind === "image" ? (
                      <img
                        src={convertFileSrc(activeClip.path)}
                        className="h-full w-full object-contain"
                        style={{ filter: cssFilter(activeClip, filter) }}
                        alt={activeClip.name}
                      />
                    ) : (
                      <video
                        ref={videoRef}
                        className="h-full w-full object-contain"
                        style={{ filter: cssFilter(activeClip, filter) }}
                        playsInline
                        muted={activeClip.muted}
                      />
                    )}
                    {activeTool === "crop" && selectedCrop && (
                      <div className="pointer-events-none absolute inset-0">
                        <div className="absolute inset-0 bg-black/60" />
                        <div
                          className="absolute border-2 border-[#0d92f4]"
                          style={{
                            left: `${selectedCrop.x * 100}%`,
                            top: `${selectedCrop.y * 100}%`,
                            width: `${selectedCrop.width * 100}%`,
                            height: `${selectedCrop.height * 100}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[#5f6368]">Thêm media để bắt đầu</div>
                )}
                {activeTexts.map((t) => (
                  <div
                    key={t.id}
                    className="absolute cursor-pointer select-none"
                    style={{
                      left: `${t.x}%`,
                      top: `${t.y}%`,
                      fontSize: t.size,
                      color: t.color,
                      fontWeight: t.bold ? 700 : 400,
                      textAlign: t.align,
                      transform: "translate(-50%, -50%)",
                      textShadow: "0 2px 6px rgba(0,0,0,0.9)",
                      whiteSpace: "nowrap",
                    }}
                    onDoubleClick={() => {
                      const v = window.prompt("Sửa nội dung:", t.text);
                      if (v !== null) updateText(t.id, { text: v });
                    }}
                    onPointerDown={(e) => {
                      const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                      beginDrag();
                      const onMove = (ev: PointerEvent) => {
                        const x = clamp(((ev.clientX - rect.left) / rect.width) * 100, 0, 100);
                        const y = clamp(((ev.clientY - rect.top) / rect.height) * 100, 0, 100);
                        transient((p) => ({
                          ...p,
                          texts: p.texts.map((x2) => (x2.id === t.id ? { ...x2, x, y } : x2)),
                        }));
                      };
                      const onUp = () => {
                        window.removeEventListener("pointermove", onMove);
                        window.removeEventListener("pointerup", onUp);
                        endDrag();
                      };
                      window.addEventListener("pointermove", onMove);
                      window.addEventListener("pointerup", onUp);
                    }}
                  >
                    {t.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
              {/* Dải điều khiển phát nằm dưới khung xem, giống CapCut. */}
              <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[#2a2d33] px-3 py-2 text-[#9aa0a6]">
                <button
                  className="rounded p-1 hover:text-white"
                  onClick={() => {
                    setPlaying(false);
                    setCurrentTime(0);
                  }}
                  title="Về đầu"
                >
                  <Icon d="M18 6 8 12l10 6zM6 5v14" className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1 hover:text-white"
                  onClick={() => {
                    setPlaying(false);
                    setCurrentTime((t) => clamp(t - 1 / fps, 0, totalDuration));
                  }}
                  title="Lùi một khung hình"
                >
                  <Icon d="M14 6 6 12l8 6z" className="h-4 w-4" />
                </button>
                <button
                  className="rounded-full bg-white p-2 text-black"
                  onClick={() => setPlaying((p) => !p)}
                  title={playing ? "Tạm dừng (Space)" : "Phát (Space)"}
                >
                  {playing ? (
                    <Icon d="M8 5h3v14H8zM13 5h3v14h-3z" className="h-4 w-4" />
                  ) : (
                    <Icon d="M7 4l12 8-12 8z" className="h-4 w-4" />
                  )}
                </button>
                <button
                  className="rounded p-1 hover:text-white"
                  onClick={() => {
                    setPlaying(false);
                    setCurrentTime((t) => clamp(t + 1 / fps, 0, totalDuration));
                  }}
                  title="Tiến một khung hình"
                >
                  <Icon d="M10 6l8 6-8 6z" className="h-4 w-4" />
                </button>
                <button
                  className="rounded p-1 hover:text-white"
                  onClick={() => setPlaying(false)}
                  title="Về giữa"
                >
                  <Icon d="M12 3v18M8 6l-3 6 3 6M16 6l3 6-3 6" className="h-4 w-4" />
                </button>
                <span className="ml-3 flex items-center gap-1">
                  <Icon d="M4 9v6h4l5 4V5L8 9H4m13.5-1.5a5 5 0 0 1 0 9" className="h-4 w-4" />
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={activeClip ? activeClip.volume : 1}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (activeClip) tuneClip(activeClip.id, "volume", value);
                    }}
                    className="w-20 accent-[#0d92f4]"
                    title="Âm lượng clip đang phát"
                  />
                </span>
              </div>

          <div className="border-t border-[#2a2d33] bg-[#1e2025] p-3">
            {/* Thanh công cụ timeline: cắt nhanh, bật/tắt bám mép, phóng to.
                CapCut đặt các nút này ngay trên dải thời gian. */}
            <div className="flex items-center gap-1 border-b border-[#2a2d33] px-2 py-1.5 text-xs">
              <button
                className="rounded p-1.5 hover:bg-[#2f323a] disabled:opacity-40"
                onClick={splitAtPlayhead}
                disabled={!project.clips.some(
                  (c) =>
                    !c.locked &&
                    currentTime > c.start + 0.05 &&
                    currentTime < c.start + c.duration - 0.05
                )}
                title="Chia tại vị trí phát (Cmd+B)"
              >
                <Icon d="M7 8l-4 4 4 4M17 8l4 4-4 4M12 4v16" className="h-4 w-4" />
              </button>
              <button
                className="rounded p-1.5 hover:bg-[#2f323a] disabled:opacity-40"
                onClick={duplicateSelected}
                disabled={!selected || project.texts.some((t) => t.id === selected.id)}
                title="Nhân bản (Cmd+D)"
              >
                <Icon d="M8 8h11v11H8zM5 16V5h11" className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  className="rounded p-1.5 hover:bg-[#2f323a] disabled:opacity-40"
                  onClick={lapDaDungChon}
                  disabled={!selected || project.texts.some((t) => t.id === selected.id)}
                  title={`Lặp lại đoạn đang chọn ${soLanLap} lần`}
                >
                  <Icon d="M4 10V8a3 3 0 0 1 3-3h4M20 14v2a3 3 0 0 1-3 3h-4M11 2 8 5l3 3M13 22l3-3-3-3" className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={50}
                  step={1}
                  value={soLanLap}
                  onChange={(e) =>
                    setSoLanLap(Math.round(readNumber(e.target.value, soLanLap, 1, 50)))
                  }
                  className="w-11 rounded bg-[#2f323a] px-1 py-0.5 text-[10px]"
                  title="Số lần lặp"
                />
              </div>
              <button
                className="rounded p-1.5 hover:bg-[#2f323a] disabled:opacity-40"
                onClick={deleteSelected}
                disabled={!selectedId}
                title="Xóa (Delete)"
              >
                <Icon d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13" className="h-4 w-4" />
              </button>
              <button
                className="rounded p-1.5 hover:bg-[#2f323a] disabled:opacity-40"
                onClick={rippleDeleteSelected}
                disabled={!selectedId}
                title="Xóa và dồn các clip sau lên (Shift+Delete)"
              >
                <Icon d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13M12 11v5" className="h-4 w-4" />
              </button>

              <button
                className="rounded p-1.5 hover:bg-[#2f323a] disabled:opacity-40"
                onClick={() => themKhungDungYen(dungKhung)}
                disabled={
                  !project.clips.some(
                    (c) =>
                      !c.locked &&
                      c.kind === "video" &&
                      currentTime > c.start + 0.05 &&
                      currentTime < c.start + c.duration - 0.05
                  )
                }
                title="Chèn khung hình đứng yên tại con trỏ phát"
              >
                <Icon d="M4 5h16v14H4zM9 9h6v6H9z" className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={0.1}
                max={30}
                step={0.1}
                value={dungKhung}
                onChange={(e) =>
                  setDungKhung(readNumber(e.target.value, dungKhung, 0.1, 30))
                }
                className="w-14 rounded bg-[#2f323a] px-1 py-0.5 text-[10px]"
                title="Độ dài khung hình đứng yên (giây)"
              />

              <span className="mx-1 h-5 w-px bg-[#2a2d33]" />

              <button
                className={`rounded p-1.5 hover:bg-[#2f323a] ${
                  snapEnabled ? "text-[#0d92f4]" : "text-[#6b7280]"
                }`}
                onClick={() => setSnapEnabled((v) => !v)}
                title="Bám mép clip khi kéo"
              >
                <Icon d="M5 4v7a7 7 0 0 0 14 0V4M9 4v7a3 3 0 0 0 6 0V4" className="h-4 w-4" />
              </button>

              <span className="mx-1 h-5 w-px bg-[#2a2d33]" />

              <button
                className="rounded p-1.5 hover:bg-[#2f323a]"
                onClick={() => setPxPerSecond((v) => clamp(v / 1.4, PX_MIN, PX_MAX))}
                title="Thu nhỏ timeline"
              >
                <Icon d="M5 12h14" className="h-4 w-4" />
              </button>
              <input
                type="range"
                min={PX_MIN}
                max={PX_MAX}
                step={1}
                value={pxPerSecond}
                onChange={(e) => setPxPerSecond(Number(e.target.value))}
                className="w-24 accent-[#0d92f4]"
                title="Mức phóng timeline"
              />
              <button
                className="rounded p-1.5 hover:bg-[#2f323a]"
                onClick={() => setPxPerSecond((v) => clamp(v * 1.4, PX_MIN, PX_MAX))}
                title="Phóng to timeline"
              >
                <Icon d="M12 5v14M5 12h14" className="h-4 w-4" />
              </button>

              <span className="ml-auto tabular-nums text-[#9aa0a6]">
                {currentTime.toFixed(2)}s / {totalDuration.toFixed(2)}s
              </span>
            </div>

            <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
              {/* Thước thời gian và mọi track dùng chung vùng cuộn này nên vạch
                  luôn khớp, kéo ngang cũng giữ cho cả bảng. */}
              <div className="relative" style={{ width: trackWidth(totalDuration) }}>
                <TimeRuler
                  duration={totalDuration}
                  pxPerSecond={pxPerSecond}
                  onSeek={(t) => {
                    setCurrentTime(t);
                    setPlaying(false);
                  }}
                />
              <div className="flex flex-col gap-1 pb-1">
              <div className="flex items-center gap-2">
                <div className="w-12 shrink-0 text-[10px] text-[#9aa0a6]">Video</div>
                <div
                  ref={videoTrackRef}
                  className="relative h-11 flex-1 rounded bg-[#26282e] p-1"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropHint(pixelToTime(e.clientX - trackLeft(), pxPerSecond));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const at = pixelToTime(e.clientX - trackLeft(), pxPerSecond);
                    setDropHint(null);
                    const assetId = e.dataTransfer.getData("text/opencutcut-asset");
                    const clipId = e.dataTransfer.getData("text/opencutcut-clip");
                    if (assetId) dropAsset(assetId, at);
                    else if (clipId) moveClip(clipId, at);
                  }}
                >
                  {/* Nội dung track có chiều rộng theo tổng thời lượng để playhead
                      và các clip cuộn ngang cùng nhau. */}
                  <div
                    className="relative h-full"
                    style={{ width: trackWidth(totalDuration) }}
                  >
                    {project.clips.map((c) => (
                      <div
                        key={c.id}
                        draggable={!c.locked}
                        onDragStart={(e) => {
                          if (c.locked) return;
                          e.dataTransfer.setData("text/opencutcut-clip", c.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        className={`absolute bottom-1 top-1 rounded border ${
                          selectedId === c.id
                            ? "border-[#0d92f4] bg-[#2b83d6]"
                            : "border-[#2b83d6] bg-[#1e6eb8]"
                        } ${c.locked ? "opacity-70" : "cursor-grab"}`}
                        style={{
                          left: c.start * pxPerSecond,
                          width: Math.max(24, c.duration * pxPerSecond),
                        }}
                        title={c.name}
                        onClick={() => {
                          setSelectedId(c.id);
                          setCurrentTime(c.start);
                        }}
                      >
                        {thumbStrips[c.id] && (
                          <img
                            src={convertFileSrc(thumbStrips[c.id])}
                            alt=""
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"
                          />
                        )}
                        {c.kind === "image" && (
                          <img
                            src={convertFileSrc(c.path)}
                            alt=""
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-80"
                          />
                        )}
                        <span className="pointer-events-none block truncate bg-black/45 px-1 text-[10px] text-white">
                          {c.locked ? "[k] " : ""}
                          {c.name}
                        </span>
                        {keyframeTimes({ start: c.start, duration: c.duration, keyframes: c.keyframes }).map(
                          (t) => (
                            <span
                              key={t}
                              className="pointer-events-none absolute bottom-0 h-1.5 w-1.5 rotate-45 bg-[#ffd166]"
                              style={{ left: (t - c.start) * pxPerSecond - 3 }}
                            />
                          )
                        )}
                        {!c.locked && (
                          <>
                            <span
                              className="absolute bottom-0 left-0 top-0 w-1.5 cursor-ew-resize bg-black/30"
                              onDragStart={(e) => e.stopPropagation()}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                startTrim(e, c.id, "start");
                              }}
                            />
                            <span
                              className="absolute bottom-0 right-0 top-0 w-1.5 cursor-ew-resize bg-black/30"
                              onDragStart={(e) => e.stopPropagation()}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                startTrim(e, c.id, "end");
                              }}
                            />
                          </>
                        )}
                        {/* Dấu chuyển cảnh nằm ở mép phải, chỉ khi clip kế tiếp
                            bám sát (không có khoảng trống) mới thấy trong export. */}
                        {c.transition !== "none" &&
                          isAdjacent(c.id) && (
                            <span
                              className="pointer-events-none absolute bottom-0 top-0 w-2 -translate-x-1/2 bg-[#ffd166]/80"
                              style={{
                                right: Math.min(
                                  c.transitionDuration * pxPerSecond,
                                  c.duration * pxPerSecond
                                ),
                              }}
                              title={`Chuyển cảnh ${c.transition}`}
                            />
                          )}
                      </div>
                    ))}
                  </div>
                  {dropHint !== null && (
                    <div
                      className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#ff3b6b]"
                      style={{ left: `${dropHint * pxPerSecond}px` }}
                    />
                  )}
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white"
                    style={{ left: playhead(currentTime) }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-12 shrink-0 text-[10px] text-[#9aa0a6]">Lớp</div>
                <div className="relative h-9 flex-1 rounded bg-[#26282e] p-1">
                  <div className="relative h-full">
                    {/* Lớp dùng toạ độ tuyệt đối theo `start`. */}
                    {project.texts.map((t) => (
                      <div
                        key={t.id}
                        className="absolute bottom-1 top-1 flex items-center justify-center overflow-hidden rounded bg-[#7c3aed] px-1"
                        style={{
                          left: t.start * pxPerSecond,
                          width: Math.max(24, t.duration * pxPerSecond),
                        }}
                        title={`${t.text} · ${t.start.toFixed(2)}s`}
                        onClick={() => {
                          setSelectedId(t.id);
                          setCurrentTime(t.start);
                        }}
                      >
                        <span className="truncate text-[10px] text-white">{t.text}</span>
                      </div>
                    ))}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white"
                      style={{ left: playhead(currentTime) }}
                    />
                  </div>
                </div>
              </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-12 shrink-0 text-[10px] text-[#9aa0a6]">Âm thanh</div>
                <div className="relative h-12 flex-1 rounded bg-[#26282e] p-1">
                  <div className="relative h-full">
                    {project.audios.map((a) => (
                      <div
                        key={a.id}
                        className="absolute bottom-1 top-1 rounded bg-[#059669]/60"
                        style={{
                          left: a.start * pxPerSecond,
                          width: Math.max(24, a.duration * pxPerSecond),
                        }}
                        title={a.name}
                      >
                        {/* svg cần chiều rộng thật, nếu không các nét dọc không hiện. */}
                        <svg
                          className="h-full w-full"
                          width={Math.max(1, a.waveform.length)}
                          height="100%"
                          preserveAspectRatio="none"
                          viewBox={`0 0 ${Math.max(1, a.waveform.length)} 100`}
                        >
                          {a.waveform.map((peak, i) => (
                            <line
                              key={i}
                              x1={i}
                              x2={i}
                              y1={50 - peak * 45}
                              y2={50 + peak * 45}
                              stroke="rgba(255,255,255,0.75)"
                              strokeWidth={1}
                            />
                          ))}
                          {a.beats.map((b, i) => {
                            const x = (b / Math.max(0.01, a.duration)) * Math.max(1, a.waveform.length);
                            return (
                              <line
                                key={`b${i}`}
                                x1={x}
                                x2={x}
                                y1={0}
                                y2={100}
                                stroke="#ffd166"
                                strokeWidth={2}
                              />
                            );
                          })}
                        </svg>
                      </div>
                    ))}
                    <div
                      className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white"
                      style={{ left: playhead(currentTime) }}
                    />
                  </div>
                </div>
              </div>
              </div>

            {exportMsg && (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-[#9aa0a6]">
                {exportMsg}
              </pre>
            )}
          </div>
          </div>
        </main>
      </div>
    </div>
  );
}