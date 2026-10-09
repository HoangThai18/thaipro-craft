import {
  doKichChu,
  doVongCong,
  veChuLen,
  viTriTheoCong,
  GOC_QUET_TOI_DA,
  type LopChuVe,
  type VeChu,
} from "./chu";

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

/** Lớp chữ trần, không viền bóng nền. */
const lop = (ghi: Partial<LopChuVe> = {}): LopChuVe => ({
  text: "Chữ",
  size: 48,
  bold: true,
  align: "center",
  color: "#ffffff",
  stroke: "",
  strokeWidth: 0.08,
  shadow: "",
  shadowBlur: 0.3,
  shadowOffset: 0.08,
  background: "",
  backgroundPad: 0.3,
  backgroundRadius: 0.2,
  curve: 0,
  ...ghi,
});

const canvasGia = (doRong = 200) => {
  const buoc: string[] = [];
  const thuoc = {
    scale: () => buoc.push("scale"),
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    lineJoin: "miter",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    measureText: () => ({ width: doRong }),
    beginPath: () => buoc.push("beginPath"),
    roundRect: (_x: number, _y: number, _w: number, _h: number, r: number) =>
      buoc.push(`roundRect:${r}`),
    fill: () => buoc.push(`fill:${thuoc.fillStyle}`),
    strokeText: (s: string, x: number, y: number) =>
      buoc.push(`stroke:${s}@${x},${y}`),
    fillText: (s: string, x: number, y: number) => buoc.push(`fill:${s}@${x},${y}`),
    save: () => buoc.push("save"),
    restore: () => buoc.push("restore"),
    translate: (x: number, y: number) => buoc.push(`tai:${x},${y}`),
    rotate: (a: number) => buoc.push(`xoay:${a.toFixed(3)}`),
  };
  return { ctx: thuoc as unknown as VeChu, buoc };
};

// ---------------------------------------------------------------------------
// Kích thước ảnh của lớp chữ
// ---------------------------------------------------------------------------

const tran = doKichChu(lop(), 200);
check("cỡ chữ ảnh gấp rưỡi cỡ hiển thị", tran.fontSize, 77);
check("bề rộng không có viền bóng nền bằng bề rộng đo", tran.width, 200);
check("viền rỗng thì không kẻ viền", tran.lineWidth, 0);
check("chuỗi font theo độ đậm", tran.font.startsWith("700 "), true);

const coVien = doKichChu(lop({ stroke: "#000" }), 200);
check("viền làm ảnh rộng ra hai bên", coVien.width > tran.width, true);
check("viền dày thêm đúng hai nửa bề dày", coVien.width - tran.width, coVien.lineWidth);

const coBong = doKichChu(lop({ shadow: "#000" }), 200);
check("bóng làm ảnh lớn ra", coBong.width > tran.width, true);
// Bóng phải chừa đủ ở cả hai bên: mỗi bên chừa độ nhò cộng độ lệch.
check(
  "chỗ chừa cho bóng bằng hai lần nhò cộng lệch",
  coBong.width - 200,
  (Math.round(0.3 * 77) + Math.round(0.08 * 77)) * 2
);

const coNen = doKichChu(lop({ background: "#000" }), 200);
check("nền làm ảnh lớn ra hai bên", coNen.width - 200, coNen.pad * 2);
check("khoảng đệm tính theo cỡ chữ", coNen.pad, Math.round(0.3 * 77));

check("chữ rỗng vẫn ra ảnh kích thước tối thiểu", doKichChu(lop({ text: "" }), 0).width >= 1, true);
check("cỡ chữ nhỏ không xuống dưới 12", doKichChu(lop({ size: 1 }), 20).fontSize, 12);
check("cỡ chữ lớn không tràn", doKichChu(lop({ size: 400 }), 900).fontSize, 640);

const trai = doKichChu(lop({ align: "left", background: "#000" }), 200);
check("căn trái bắt đầu sau khoảng đệm", trai.x, trai.pad);
check("căn giữa bắt đầu ở giữa ảnh", tran.x, 0);

// ---------------------------------------------------------------------------
// Vẽ: thứ tự lớp và việc tôn trọng thuộc tính
// ---------------------------------------------------------------------------

{
  const { ctx, buoc } = canvasGia();
  const l = lop();
  veChuLen(ctx, l, doKichChu(l, 200));
  check("không viền bóng nền thì chỉ tô chữ", buoc, ["fill:Chữ@0,54"]);
  check("cỡ chữ truyền vào canvas", ctx.font.startsWith("700 "), true);
  check("chữ được kẻ ở giữa chiều cao", ctx.textBaseline, "middle");
}

{
  const { ctx, buoc } = canvasGia();
  const l = lop({ stroke: "#ff0000" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("có viền thì kẻ viền trước rồi tô chữ", buoc, [
    "stroke:Chữ@0,57",
    "fill:Chữ@0,57",
  ]);
  check("màu viền đúng", ctx.strokeStyle, "#ff0000");
  check("bề dày viền đúng", ctx.lineWidth, Math.round(0.08 * 77));
}

{
  const { ctx, buoc } = canvasGia();
  const l = lop({ background: "#00ff00" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("nền được vẽ trước chữ", buoc, [
    "beginPath",
    "roundRect:15",
    "fill:#00ff00",
    "fill:Chữ@23,77",
  ]);
  check("màu chữ đè lên nền", ctx.fillStyle, "#ffffff");
}

{
  const { ctx, buoc } = canvasGia();
  const l = lop({ shadow: "#0000ff" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("bóng không vẽ thêm lần tô nào", buoc, ["fill:Chữ@0,83"]);
  check("màu bóng được đặt", ctx.shadowColor, "#0000ff");
  check("độ nhò của bóng", ctx.shadowBlur, Math.round(0.3 * 77));
  check("bóng lệch cả ngang và dọc", [ctx.shadowOffsetX, ctx.shadowOffsetY], [
    Math.round(0.08 * 77),
    Math.round(0.08 * 77),
  ]);
}

{
  const { ctx, buoc } = canvasGia();
  const l = lop({ stroke: "#f00", shadow: "#00f", background: "#0f0" });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("đủ ba lớp thì thứ tự nền, viền, chữ", buoc, [
    "beginPath",
    "roundRect:15",
    "fill:#0f0",
    "stroke:Chữ@23,109",
    "fill:Chữ@23,109",
  ]);
}

{
  const { ctx, buoc } = canvasGia();
  const l = lop({ background: "#123", backgroundRadius: 0 });
  veChuLen(ctx, l, doKichChu(l, 200));
  check("bo bằng 0 thì nền góc vuông", buoc[1], "roundRect:0");
}

// ---------------------------------------------------------------------------
// Chữ thẳng: vị trí ký tự
// ---------------------------------------------------------------------------

// Chi lay toa do khi moi ky tu co be rong rieng, khong thi vi tri se lech do
// can thieu be rong.
const thang = viTriTheoCong({ curve: 0 }, "Chữ", [50, 60, 70], { x: 200, y: 54 });
check("chữ thẳng vẫn ra từng ký tự", thang.length, 3);
check("ký tự thẳng đứng", thang.map((v) => v.alpha), [0, 0, 0]);
check("ký tự thẳng nằm đúng tâm dọc", thang.map((v) => v.y), [54, 54, 54]);
check("ký tự thẳng xê dần theo bề rộng", thang.map((v) => v.x), [135, 190, 255]);

// ---------------------------------------------------------------------------
// Chữ cong: ảnh phải lớn hơn, và ký tự phải xoay theo dây cung
// ---------------------------------------------------------------------------

const cong = lop({ curve: 60 });
const kichCong = doKichChu(cong, 200);
check("chữ cong làm ảnh lớn hơn chữ thẳng", kichCong.height > tran.height, true);
check("chữ cong cũng rộng hơn chữ thẳng", kichCong.width > tran.width, true);
check("độ võng của chữ thẳng bằng 0", doVongCong({ curve: 0 }, 200, 77), 0);
check("độ võng tăng theo mức cong", doVongCong({ curve: 60 }, 200, 77) >
  doVongCong({ curve: 20 }, 200, 77), true);
check("chữ chúm xuống ra độ võng như chữ cong lên",
  doVongCong({ curve: -60 }, 200, 77), doVongCong({ curve: 60 }, 200, 77));
check("độ võng luôn dương", doVongCong({ curve: -100 }, 200, 77) > 0, true);

const chin = viTriTheoCong({ curve: 60 }, "aaaaaaaaa", [20, 20, 20, 20, 20, 20, 20, 20, 20], { x: 200, y: 54 });
check("số ký tự không đổi khi cong", chin.length, 9);
// Cong lên (cầu vồng) thì hai đầu chúm xuống, tức y lớn hơn ký tự giữa.
check("ký tự giữa là điểm cao nhất", Math.min(...chin.map((v) => v.y)), chin[4].y);
check("hai đầu thấp hơn giữa", chin[0].y > chin[4].y && chin[4].y < chin[8].y, true);
check("hai đầu thấp bằng nhau", chin[0].y, chin[8].y);
check("hai đầu đối xứng nhau", Math.round(chin[0].x), Math.round(400 - chin[8].x));
check("ký tự đầu ngả một chiều", chin[0].alpha < 0, true);
check("ký tự cuối ngả chiều ngược lại", chin[8].alpha > 0, true);
check("ký tự giữa không xoay", chin[4].alpha, 0);
check("góc xoay trong khoảng cho phép", chin.every((v) => Math.abs(v.alpha) <= GOC_QUET_TOI_DA / 2), true);

const chum = viTriTheoCong({ curve: -60 }, "aaaaaaaaa", [20, 20, 20, 20, 20, 20, 20, 20, 20], { x: 200, y: 54 });
check("chúm xuống thì hai đầu cao hơn giữa", chum[0].y < chum[4].y, true);
check("chúm xuống là đảo chiều cong lên", chum[0].y < chin[0].y, true);
check("chúm xuống thì giữa là điểm thấp nhất", Math.max(...chum.map((v) => v.y)), chum[4].y);
check("chúm xuống xoay ngược lại", chum[0].alpha, -chin[0].alpha);

// Cong tối đa không được vượt góc quét đã đặt.
const toi = viTriTheoCong({ curve: 100, thetaToiDa: Math.PI }, "aaaaaaaa", [25, 25, 25, 25, 25, 25, 25, 25], { x: 200, y: 54 });
check("cong 100 độ đạt góc quét tối đa", Math.abs(toi[0].alpha) <= Math.PI / 2 + 0.001, true);
const mot = viTriTheoCong({ curve: 500 }, "a", [20], { x: 100, y: 50 });
check("mức cong trên 100 vẫn bị chặn", Math.abs(mot[0].alpha), 0);

// Vẽ thật: chữ cong phải vẽ từng ký tự, không phải cả câu một khối.
{
  const { ctx, buoc } = canvasGia();
  const l = lop({ text: "Chữ", curve: 50 });
  veChuLen(ctx, l, doKichChu(l, 200));
  const veKyTu = buoc.filter((b) => b.startsWith("fill:") || b.startsWith("stroke:"));
  check("mỗi ký tự được vẽ riêng", veKyTu.length, 3);
  // Ký tự giữa nằm đúng đỉnh dây cung nên không cần xoay; hai ký tự còn lại thì có.
  check("ký tự nghiêng được xoay", buoc.filter((b) => b.startsWith("xoay:")).length, 2);
  check("không vẽ cả câu một khối", buoc.some((b) => b.includes("Chữ@")), false);
  check("mỗi ký tự có lưu và khôi phục", buoc.filter((b) => b === "save").length, 3);
  check("khôi phục cũng đủ", buoc.filter((b) => b === "restore").length, 3);
}

console.log(`\n${passed} đạt, ${failed} sai`);
if (failed > 0) throw new Error(`${failed} phép kiểm tra sai`);
