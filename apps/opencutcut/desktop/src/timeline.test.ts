import {
  addKeyframe,
  beatMarkers,
  cropAspect,
  dropItem,
  estimateBeatGrid,
  fullCrop,
  gapToNearestEdge,
  insertItem,
  keyframeExpression,
  keyframeTimes,
  lapLai,
  moveItem,
  mocNoiKeNhau,
  moveItemFree,
  noiDuAn,
  normalizeCrop,
  pack,
  pixelToTime,
  removeKeyframe,
  removeItem,
  reorderItem,
  rippleDelete,
  splitItem,
  tocDoTai,
  totalDuration,
  trimItem,
  valueAtTime,
  type CropRect,
  type Keyframe,
  type TrackItem,
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
  type History,
} from "./history";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`SAI  ${name}\n  thực tế: ${a}\n  cần:     ${e}`);
  }
}

const item = (id: string, start: number, duration: number): TrackItem => ({
  id,
  start,
  duration,
});

// ---------------------------------------------------------------------------
// Timeline cơ bản (nhóm cũ)
// ---------------------------------------------------------------------------

check("pack đóng lại", pack([item("a", 0, 5), item("b", 9, 3)]), [
  { id: "a", start: 0, duration: 5 },
  { id: "b", start: 5, duration: 3 },
]);

check(
  "move kéo giữa",
  moveItem([item("a", 0, 5), item("b", 5, 3), item("c", 8, 2)], "c", 2),
  [
    { id: "a", start: 0, duration: 5 },
    { id: "c", start: 5, duration: 2 },
    { id: "b", start: 7, duration: 3 },
  ]
);

check("move về 0 đưa lên đầu", moveItem([item("a", 0, 5), item("b", 5, 3)], "b", -10), [
  { id: "b", start: 0, duration: 3 },
  { id: "a", start: 3, duration: 5 },
]);

check(
  "trim mép phải nới ra",
  trimItem([item("a", 0, 5), item("b", 5, 3)], "a", "end", 2),
  [
    { id: "a", start: 0, duration: 7 },
    { id: "b", start: 7, duration: 3 },
  ]
);

check(
  "trim mép trái giữ đuôi",
  trimItem([item("a", 0, 5), item("b", 5, 3)], "a", "start", 2),
  [
    { id: "a", start: 2, duration: 3 },
    { id: "b", start: 5, duration: 3 },
  ]
);

check("trim không cắt quá ngắn", trimItem([item("a", 0, 5)], "a", "end", -99), [
  { id: "a", start: 0, duration: 0.1 },
]);

check(
  "insert giữa",
  insertItem([item("a", 0, 5), item("b", 5, 3)], { id: "n", start: 0, duration: 2 }, 3),
  [
    { id: "a", start: 0, duration: 5 },
    { id: "n", start: 5, duration: 2 },
    { id: "b", start: 7, duration: 3 },
  ]
);

const split = splitItem([item("a", 0, 5), item("b", 5, 3)], "a", 2);
check("split sinh thêm một mảnh", split.items.length, 3);
check("split giữ độ dài tổng", totalDuration(split.items), 8);
check("split tại đầu không làm gì", splitItem([item("a", 0, 5)], "a", 0).newId, null);

check("remove đóng lại", removeItem([item("a", 0, 5), item("b", 5, 3)], "a"), [
  { id: "b", start: 0, duration: 3 },
]);

check(
  "reorder đổi chỗ",
  reorderItem([item("a", 0, 2), item("b", 2, 3)], "a", "b"),
  [
    { id: "b", start: 0, duration: 3 },
    { id: "a", start: 3, duration: 2 },
  ]
);

check("pixel sang giây", pixelToTime(200, 40), 5);
check("pixel âm bị chặn", pixelToTime(-50, 40), 0);

// ---------------------------------------------------------------------------
// Ripple delete
// ---------------------------------------------------------------------------

check(
  "ripple dồn mục sau về trước",
  rippleDelete([item("a", 0, 5), item("b", 5, 3), item("c", 8, 2)], "b"),
  [
    { id: "a", start: 0, duration: 5 },
    { id: "c", start: 5, duration: 2 },
  ]
);

check(
  "ripple giữ nguyên mục trước",
  rippleDelete([item("a", 0, 2), item("b", 2, 5), item("c", 7, 3)], "b"),
  [
    { id: "a", start: 0, duration: 2 },
    { id: "c", start: 2, duration: 3 },
  ]
);

check("ripple không đổi khi id sai", rippleDelete([item("a", 0, 5)], "zz"), [
  { id: "a", start: 0, duration: 5 },
]);

// ---------------------------------------------------------------------------
// Kéo thả tự do và chèn theo mép
// ---------------------------------------------------------------------------

check(
  "kéo xa thì giữ khoảng trống",
  moveItemFree([item("a", 0, 5), item("b", 5, 3)], "b", 9),
  [
    { id: "a", start: 0, duration: 5 },
    { id: "b", start: 9, duration: 3 },
  ]
);

check("kéo về âm bị chặn", moveItemFree([item("a", 0, 5)], "a", -5), [
  { id: "a", start: 0, duration: 5 },
]);

check("kéo giữ các clip khác đứng yên", moveItemFree([item("a", 0, 5), item("b", 5, 3)], "a", 2), [
  { id: "a", start: 2, duration: 5 },
  { id: "b", start: 5, duration: 3 },
]);

check(
  "khoảng cách tới mép gần nhất",
  Math.round(gapToNearestEdge([item("a", 0, 5), item("b", 8, 3)], "x", 5.4, 2)! * 100) / 100,
  0.4
);
check("không có clip khác thì không có mép", gapToNearestEdge([item("a", 0, 5)], "a", 1, 2), null);

check(
  "thả sát mép thì chèn xen vào",
  dropItem([item("a", 0, 5), item("b", 5, 3)], item("n", 0, 2), 4.8),
  [
    { id: "a", start: 0, duration: 5 },
    { id: "n", start: 5, duration: 2 },
    { id: "b", start: 7, duration: 3 },
  ]
);

check(
  "thả xa thì giữ khoảng trống",
  dropItem([item("a", 0, 5), item("b", 5, 3)], item("n", 0, 2), 20),
  [
    { id: "a", start: 0, duration: 5 },
    { id: "b", start: 5, duration: 3 },
    { id: "n", start: 20, duration: 2 },
  ]
);

check(
  "kéo clip đã có sẵn sang xa thì danh sách vẫn theo thứ tự thời gian",
  dropItem([item("a", 0, 5), item("b", 5, 3)], item("a", 0, 5), 12),
  [
    { id: "b", start: 5, duration: 3 },
    { id: "a", start: 12, duration: 5 },
  ]
);

// ---------------------------------------------------------------------------
// Nối nhiều dự án
// ---------------------------------------------------------------------------

check(
  "nối dự án vào sau dự án hiện tại",
  noiDuAn(
    [item("a", 0, 4), item("b", 4, 2)],
    [item("c", 0, 5), item("d", 5, 1)],
    () => "x"
  ).map((i) => i.start),
  [0, 4, 6, 11]
);
check("dự án nguồn rỗng thì giữ nguyên", noiDuAn([item("a", 0, 4)], [], () => "x"), [
  { id: "a", start: 0, duration: 4 },
]);
check("dự án hiện tại rỗng thì lấy nguyên nguồn", noiDuAn([], [item("c", 3, 2)], () => "id1"), [
  { id: "id1", start: 3, duration: 2 },
]);
check(
  "mục nguồn được sinh id mới",
  noiDuAn([item("a", 0, 4)], [item("c", 0, 2)], () => "id2").map((i) => i.id),
  ["a", "id2"]
);
check(
  "id mới sinh không trùng id đang có",
  new Set(noiDuAn([item("a", 0, 4), item("b", 4, 2)], [item("c", 0, 2)]).map((i) => i.id)).size,
  3
);

// ---------------------------------------------------------------------------
// Mối nối để đặt chuyển cảnh
// ---------------------------------------------------------------------------

check(
  "hai clip bám sát thì lấy clip trước",
  mocNoiKeNhau([item("a", 0, 4), item("b", 4, 3)]).map((i) => i.id),
  ["a"]
);
check(
  "ba clip nối tiếp thì có hai mối nối",
  mocNoiKeNhau([item("a", 0, 4), item("b", 4, 3), item("c", 7, 2)]).map((i) => i.id),
  ["a", "b"]
);
check(
  "khoảng trống không phải mối nối",
  mocNoiKeNhau([item("a", 0, 4), item("b", 5, 3)]).length,
  0
);
check(
  "lệch nhỏ dưới 0.05s vẫn tính là bám sát",
  mocNoiKeNhau([item("a", 0, 4), item("b", 4.04, 3)]).map((i) => i.id),
  ["a"]
);
check(
  "clip đè nhau không phải mối nối",
  mocNoiKeNhau([item("a", 0, 4), item("b", 3, 3)]).length,
  0
);
check("danh sách rỗng thì không có mối nối", mocNoiKeNhau([]).length, 0);
check(
  "một clip lẻ không có mối nối",
  mocNoiKeNhau([item("a", 2, 4)]).length,
  0
);
check(
  "đảo thứ tự đầu vào vẫn tìm đúng",
  mocNoiKeNhau([item("c", 7, 2), item("a", 0, 4), item("b", 4, 3)]).map(
    (i) => i.id
  ),
  ["a", "b"]
);

// ---------------------------------------------------------------------------
// Lặp lại một đoạn
// ---------------------------------------------------------------------------

const lap = (ds: any[], id: string, n: number) =>
  lapLai(ds, id, n, () => `${id}-l${Math.random().toString(36).slice(2, 6)}`);

check(
  "lặp 3 lần thì dãy dài gấp 3",
  lap([{ id: "a", start: 0, duration: 2 }], "a", 3).map((i) => i.duration),
  [2, 2, 2]
);
check(
  "lặp lần thứ hai bắt đầu ngay sau lần đầu",
  lap([{ id: "a", start: 5, duration: 2 }], "a", 3).map((i) => i.start),
  [5, 7, 9]
);
check(
  "mục phía sau bị dời sang phải",
  lap(
    [
      { id: "a", start: 0, duration: 2 },
      { id: "b", start: 2, duration: 3 },
    ],
    "a",
    3
  ).find((i) => i.id === "b")?.start,
  6
);
check(
  "mục phía trước không đổi",
  lap(
    [
      { id: "z", start: 0, duration: 4 },
      { id: "a", start: 4, duration: 2 },
    ],
    "a",
    2
  ).find((i) => i.id === "z")?.start,
  0
);
check("lặp 1 lần thì không đổi", lap([{ id: "a", start: 0, duration: 2 }], "a", 1), [
  { id: "a", start: 0, duration: 2 },
]);
check(
  "mỗi bản lặp có id riêng",
  new Set(lap([{ id: "a", start: 0, duration: 2 }], "a", 4).map((i) => i.id)).size,
  4
);
check(
  "chuyển cảnh dồn sang bản lặp cuối",
  lap([{ id: "a", start: 0, duration: 2, transition: "mo" }], "a", 3).map(
    (i) => i.transition
  ),
  ["none", "none", "mo"]
);
check(
  "id không tồn tại thì giữ nguyên danh sách",
  lap([{ id: "a", start: 0, duration: 2 }], "khong", 3).length,
  1
);

// ---------------------------------------------------------------------------
// Tốc độ theo con trỏ
// ---------------------------------------------------------------------------

const cong = (moc: Array<[number, number]>, speed = 1) => ({
  id: "a",
  start: 0,
  duration: 6,
  speed,
  keyframes: moc.map(([time, value]) => ({ id: `k${time}`, time, prop: "speed", value })),
});

check("không có mốc thì giữ tốc độ cố định", tocDoTai(cong([], 1.5), 3), 1.5);
check("nội suy tuyến tính giữa hai mốc", tocDoTai(cong([[0, 1], [6, 2]]), 3), 1.5);
check("trước mốc đầu thì giữ tốc độ đầu", tocDoTai(cong([[2, 3]]), 1), 3);
check("sau mốc cuối thì giữ tốc độ cuối", tocDoTai(cong([[0, 3]]), 5), 3);
check("ba mốc thì nội suy đúng từng đoạn", tocDoTai(cong([[0, 1], [3, 2], [6, 3]]), 4.5), 2.5);
check("mốc trùng thời điểm thì lấy mốc sau", tocDoTai(cong([[0, 1], [3, 1], [3, 5]]), 3), 5);
check(
  "clip lệch vị trí vẫn tính đúng",
  tocDoTai({ ...cong([[2, 1], [8, 2]]), start: 2 }, 5),
  1.5
);

// ---------------------------------------------------------------------------
// Gộp nhiều thay đổi liên tiếp vào một bước undo
// ---------------------------------------------------------------------------

check("cùng loại thì gộp", coalesce("text", "text", 5), true);
check("khác loại thì tách", coalesce("text", "slider", 5), false);
check("thay đổi đầu tiên luôn tách", coalesce(null, "text", 5), false);

// Bộ đếm gộp phải chặn việc một chuỗi thay đổi phình vô hạn.
const limitChecks: boolean[] = [];
for (let i = 0; i < 4; i++) limitChecks.push(coalesce("x", "x", 2));
check("đạt giới hạn thì tách", limitChecks, [true, true, false, false]);

// `commitMerge` giữ nguyên lịch sử, chỉ đổi trạng thái hiện tại.
{
  const h0 = createHistory("p0");
  const h1 = commit(h0, "p1");
  const h2 = commit(h1, "p2");
  const m1 = commitMerge(h2, "a");
  check("gộp giữ lịch sử", m1.past, ["p0", "p1"]);
  check("gộp đổi trạng thái", m1.present, "a");
  const m2 = commitMerge(m1, "ab");
  const m3 = commitMerge(m2, "abc");
  check("gộp nhiều lần chỉ còn 1 bước", m3.past, ["p0", "p1"]);
  check("hoàn tác về trạng thái trước khi gõ", undo(m3).present, "p1");
  check("làm lại về trạng thái cuối", redo(undo(m3)).present, "abc");
  check("gộp xoá redo", commitMerge(redo(m3), "x").future, []);
  check("gộp không đổi thì không làm gì", commitMerge(m3, "abc"), m3);
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

const h0 = createHistory(1);
check("history mới không có quá khứ", canUndo(h0), false);
check("history mới không có tương lai", canRedo(h0), false);
check("undo khi rỗng là no-op", undo(h0).present, 1);

const h1 = commit(h0, 2);
const h2 = commit(h1, 3);
check("commit hai lần có hai bước", h2.past.length, 2);
check("trạng thái hiện tại", h2.present, 3);

const h3 = undo(h2);
check("undo về 2", h3.present, 2);
check("undo đẩy tương lai", h3.future[0], 3);
check("redo trở lại 3", redo(h3).present, 3);
check("sau redo tương lai rỗng", redo(h3).future.length, 0);

const h4 = commit(h3, 99);
check("commit sau undo xóa redo", h4.future.length, 0);
check("replace không tạo bước", replace(h4, 100).past.length, 2);

check("commit trùng không ghi", commit(createHistory(5), 5).past.length, 0);

const limited = [1, 2, 3, 4].reduce<History<number>>((acc, n) => commit(acc, n, 3), createHistory(0));
check("giới hạn lịch sử", limited.past.length, 3);

// ---------------------------------------------------------------------------
// Keyframe
// ---------------------------------------------------------------------------

const kf = (time: number, prop: Keyframe["prop"], value: number): Keyframe => ({
  id: `${prop}-${time}`,
  time,
  prop,
  value,
});

let frames = addKeyframe([], 0, "scale", 100);
frames = addKeyframe(frames, 2, "scale", 200);
check("thêm hai keyframe", frames.length, 2);
check(
  "thêm lại cùng thời điểm thì cập nhật",
  addKeyframe(frames, 0, "scale", 150).length,
  2
);
check("giá trị sau cập nhật", addKeyframe(frames, 0, "scale", 150)[0].value, 150);

check(
  "nội suy giữa hai điểm",
  valueAtTime({ start: 0, duration: 4, keyframes: frames }, "scale", 1),
  150
);
check("trước điểm đầu giữ giá trị đầu", valueAtTime({ start: 0, duration: 4, keyframes: frames }, "scale", -1), 100);
check("sau điểm cuối giữ giá trị cuối", valueAtTime({ start: 0, duration: 4, keyframes: frames }, "scale", 99), 200);
check("không có keyframe thì trả fallback", valueAtTime({ start: 0, duration: 4, keyframes: [] }, "scale", 1, 42), 42);

const two = [kf(0, "x", 0), kf(2, "x", 100)];
check("nội suy ở 0.5", valueAtTime({ start: 0, duration: 2, keyframes: two }, "x", 0.5), 25);

check("xoá keyframe", removeKeyframe(frames, 0, "scale").length, 1);
check("xoá keyframe sai chỗ thì giữ nguyên", removeKeyframe(frames, 1.5, "scale").length, 2);

check("thời điểm keyframe", keyframeTimes({ start: 0, duration: 3, keyframes: two }), [0, 2]);
check("lọc theo thuộc tính", keyframeTimes({ start: 0, duration: 3, keyframes: frames }, "scale"), [0, 2]);

const three = [kf(0, "scale", 100), kf(1, "scale", 200), kf(2, "scale", 100)];
check(
  "biểu thức 2 điểm",
  keyframeExpression(three.slice(0, 2)),
  "if(lt(t\\,1)\\,100+(100)*(t-0)\\,200)"
);
check("một điểm thì không có biểu thức", keyframeExpression([kf(0, "scale", 1)]), null);
const expr = keyframeExpression(three)!;
check("biểu thức 3 điểm có hai if", (expr.match(/if\(lt/g) || []).length, 2);
check(
  "biểu thức 3 điểm kết thúc bằng giá trị cuối",
  expr.endsWith(",100))"),
  true
);

// ---------------------------------------------------------------------------
// Beat sync
// ---------------------------------------------------------------------------

const grid = estimateBeatGrid([0, 0.5, 1.0, 1.5, 2.0]);
check("suy ra nhịp 0.5s", grid.interval, 0.5);
check("nhịp đầu tiên", grid.firstBeat, 0);

check(
  "vạch nhịp từ 0 dừng 2s",
  beatMarkers({ firstBeat: 0, interval: 0.5 }, 2),
  [0, 0.5, 1, 1.5, 2]
);

check(
  "vạch nhịp bắt đầu lệch",
  beatMarkers({ firstBeat: 0.25, interval: 0.5 }, 1.25),
  [0.25, 0.75, 1.25]
);

check("bỏ đỉnh nhiễu", estimateBeatGrid([0, 0.5, 1.0, 1.05, 1.5]).interval, 0.5);
check("không đủ đỉm thì interval 0", estimateBeatGrid([0]).interval, 0);
check("interval 0 thì không có vạch", beatMarkers({ firstBeat: 0, interval: 0 }, 5), []);

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

const cropEq = (name: string, actual: CropRect, x: number, y: number, w: number, h: number) =>
  check(
    name,
    [actual.x, actual.y, actual.width, actual.height].map((v) => Math.round(v * 1e6) / 1e6),
    [x, y, w, h]
  );

cropEq("crop đầy đủ", fullCrop(), 0, 0, 1, 1);
cropEq("crop chuẩn hoá tràn", normalizeCrop({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }), 0.5, 0.5, 0.5, 0.5);
cropEq("crop giới hạn kích thước", normalizeCrop({ x: 0, y: 0, width: 0.01, height: 0.01 }), 0, 0, 0.05, 0.05);
check(
  "tỉ lệ sau crop",
  Math.round(cropAspect({ x: 0, y: 0, width: 0.5, height: 1 }, 1.777) * 100) / 100,
  0.89
);

// ---------------------------------------------------------------------------
// Lịch sử gộp theo thao tác kéo
// ---------------------------------------------------------------------------

{
  const h = createHistory("a");
  const before = h.present;
  // Kéo chuột: nhiều lần replace, chỉ ghi một bước ở cuối.
  const mid = replace(replace(h, "b"), "c");
  const done = commitFrom(mid, before, "d");
  check("kéo nhiều lần chỉ tạo một bước", done.past.length, 1);
  check("bước lưu trạng thái trước khi kéo", done.past[0], "a");
  check("giá trị cuối", done.present, "d");
  check("undo sau kéo về trạng thái đầu", undo(done).present, "a");
}

check("commitFrom bỏ qua khi không đổi", commitFrom(createHistory(1), 1, 1).past.length, 0);

console.log(`\n${passed} đạt, ${failed} sai`);
if (failed > 0) throw new Error(`${failed} phép kiểm tra sai`);