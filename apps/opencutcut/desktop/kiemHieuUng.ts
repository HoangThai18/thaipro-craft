// Chạy thử toàn bộ kho hiệu ứng bằng ffmpeg thật, bám đúng cách `clip_segment`
// dựng trong lib.rs: chuỗi chính tạo nhãn trung gian, rồi khối hiệu ứng lấy nhãn
// đó qua `{IN}`.
//
// Dùng: npx tsx kiemHieuUng.ts

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hieuUng } from "./src/effects";

const MEDIE =
  "/private/var/folders/n0/wwsf8585587_32mzjfhsmv2w0000gn/T/opencode/occmedia/clip1.mp4";
const thu_muc = mkdtempSync(join(tmpdir(), "hieuung-"));
const W = 320;
const H = 180;

function doDoan(c: (typeof hieuUng)[number], manh: boolean): string {
  const tag = "sg0_0";
  const goc = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=25,eq=brightness=0`;
  const thanh = `${goc},trim=start=0:end=2,setpts=PTS-STARTPTS`;
  const body = manh && c.ffmpegManh ? c.ffmpegManh : c.ffmpeg!;
  const out = `[${tag}]`;
  if (!body.includes(";")) return `[0:v]${thanh},${body}${out};`;
  const mid = `[${tag}i]`;
  const noi = body
    .replace("{IN}", mid)
    .replace(/\[(\w+)\]/g, (m, ten) => (m === mid ? m : `[${tag}${ten}]`));
  return `[0:v]${thanh}${mid};${noi},null${out};`;
}

let that_bai = 0;
let tong = 0;
for (const c of hieuUng) {
  for (const manh of [false, true]) {
    tong++;
    const nhan = `${c.id}${manh ? "-manh" : ""}`;
    const dau_ra = join(thu_muc, `${nhan}.mp4`);
    try {
      execFileSync(
        "ffmpeg",
        [
          "-y", "-nostdin", "-v", "error",
          "-ss", "0", "-t", "2", "-i", MEDIE,
          "-filter_complex", doDoan(c, manh) + "[sg0_0]format=yuv420p[out]",
          "-map", "[out]",
          "-c:v", "libx264", "-crf", "32", "-preset", "ultrafast",
          "-t", "2", dau_ra,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      console.log(`OK    ${nhan}`);
    } catch (e: any) {
      that_bai++;
      const loi = String(e.stderr ?? e.message)
        .split("\n")
        .filter(Boolean)
        .slice(0, 2)
        .join(" | ");
      console.log(`SAI   ${nhan}: ${loi}`);
    }
  }
}
console.log(`\nxong: ${tong - that_bai}/${tong} lọt`);
process.exit(that_bai > 0 ? 1 : 0);