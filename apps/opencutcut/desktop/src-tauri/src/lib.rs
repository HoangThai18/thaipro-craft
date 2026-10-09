use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Kiểu dữ liệu nhận từ frontend
// ---------------------------------------------------------------------------

/// Giá trị chỉnh màu theo clip, tất cả trong khoảng -1..1 (trừ khoảng 0..1 cho
/// fade/sharpen/vignette và boolean cho blackWhite).
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Adjust {
    brightness: f64,
    contrast: f64,
    saturation: f64,
    temperature: f64,
    highlights: f64,
    shadows: f64,
    fade: f64,
    sharpen: f64,
    vignette: f64,
    black_white: bool,
    /// Chỉnh màu theo từng dải màu, giống bảng HSL của CapCut.
    hsl: Hsl,
}

/// Một dải màu trong bảng HSL. `hue` là độ lệch sắc độ (-180..180), `sat` và
/// `lum` là độ lệch bão hoà và độ sáng, cùng trong khoảng -1..1.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct DaiMauHsl {
    hue: f64,
    sat: f64,
    lum: f64,
}

/// Bảng HSL: mỗi dải một bộ ba số.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Hsl {
    do_: DaiMauHsl,
    vang: DaiMauHsl,
    luc: DaiMauHsl,
    cyan: DaiMauHsl,
    xanh: DaiMauHsl,
    tim: DaiMauHsl,
}

impl Hsl {
    /// Lấy từng dải theo đúng thứ tự `DAI_MAU`.
    fn theo_thu_tu(&self) -> [(&'static str, &DaiMauHsl); 6] {
        [
            ("r", &self.do_),
            ("y", &self.vang),
            ("g", &self.luc),
            ("c", &self.cyan),
            ("b", &self.xanh),
            ("m", &self.tim),
        ]
    }

    /// Có dải nào khác 0 không.
    fn co_thay_doi(&self) -> bool {
        self.theo_thu_tu().iter().any(|(_, d)| {
            d.hue.abs() > 0.01 || d.sat.abs() > 0.01 || d.lum.abs() > 0.01
        })
    }
}

/// Vùng cắt chuẩn hoá 0..1 so với khung gần xa nhất.
#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
struct CropRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Lọc màu nền (chroma key).
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct ChromaKey {
    enabled: bool,
    /// Màu phía trên, "RRGGBB".
    color: String,
    similarity: f64,
    smoothness: f64,
    spill: f64,
}

/// Mặt nạ hình học: chỉ giữ lại phần hình bên trong vùng khoanh.
///
/// Toạ độ chuẩn hoá 0..1 tính từ mép khung, nên mặt nạ không đổi khi đổi kích
/// thước xuất.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Mask {
    /// `tron`, `vuong`, `ellipse` hoặc rỗng = không khoanh.
    kind: String,
    center_x: f64,
    center_y: f64,
    /// Bán kính theo phần trăm chiều rộng và chiều cao khung.
    size_x: f64,
    size_y: f64,
    rotation_degrees: f64,
    /// Bề rộng mép mềm, phần trăm khung. 0 = cắt cứng.
    softness: f64,
    /// Cách mép mặt nạ thay đổi theo thời gian: `mo`, `thu`, `quet_ngang`,
    /// `quet_dọc`, rỗng = đứng yên.
    animation: String,
    /// Giây đầu và độ dài hiệu ứng, tính từ đầu clip.
    anim_start: f64,
    anim_duration: f64,
}

impl TimelineClip {
    fn is_image(&self) -> bool {
        self.kind.as_deref() == Some("image")
    }
}

impl Default for ChromaKey {
    fn default() -> Self {
        Self {
            enabled: false,
            color: "00FF00".into(),
            similarity: 0.3,
            smoothness: 0.1,
            spill: 0.2,
        }
    }
}

/// Đường cong màu: mỗi kênh một chuỗi điểm kiểu "0/0 0.5/0.6 1/1".
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Curves {
    master: String,
    red: String,
    green: String,
    blue: String,
}

/// LUT dạng .cube đã nạp từ tệp người dùng chọn.
#[derive(Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
struct Lut {
    path: String,
    strength: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct Keyframe {
    /// Thời điểm tuyệt đối trên timeline (giây).
    time: f64,
    /// Tên thuộc tính, khớp với frontend.
    prop: String,
    value: f64,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct TimelineClip {
    path: String,
    /// "video" hoặc "image"; ảnh không có seek.
    #[serde(default)]
    kind: Option<String>,
    start: f64,
    duration: f64,
    #[serde(default)]
    seek_to: Option<f64>,
    #[serde(default)]
    speed: Option<f64>,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    muted: bool,
    /// Mức khử tiếng ồn của clip, 0..1. 0 = không khử.
    #[serde(default)]
    denoise: Option<f64>,
    /// Kiểu hiệu ứng giọng nói, rỗng = không áp.
    #[serde(default)]
    voice_effect: Option<String>,
    #[serde(default)]
    locked: bool,
    #[serde(default)]
    adjust: Option<Adjust>,
    #[serde(default)]
    mix_mode: Option<String>,
    #[serde(default)]
    crop: Option<CropRect>,
    #[serde(default)]
    chroma: Option<ChromaKey>,
    #[serde(default)]
    mask: Option<Mask>,
    #[serde(default)]
    curves: Option<Curves>,
    #[serde(default)]
    lut: Option<Lut>,
    #[serde(default)]
    keyframes: Vec<Keyframe>,
    /// Chuyển cảnh áp dụng tại mép đi của clip này (không | fade | slide | ...).
    #[serde(default)]
    transition: Option<String>,
    #[serde(default)]
    transition_duration: Option<f64>,
    /// Hiệu ứng áp cho clip (id trong kho hiệu ứng của frontend).
    #[serde(default)]
    effect: Option<String>,
    /// Dùng bản mạnh của hiệu ứng.
    #[serde(default)]
    #[serde(rename = "effectStrong")]
    effect_strong: Option<bool>,
    /// Đảo ngược thứ tự khung hình (chỉ dùng được cho video).
    #[serde(default)]
    reverse: bool,
    /// Giữ nguyên khung hình cuối clip trong suốt thời lượng clip.
    #[serde(default)]
    freeze: bool,
    /// Nội suy thêm khung hình cho các đoạn giảm tốc, cho chuyển động mượt.
    #[serde(default)]
    smooth: bool,
    /// Tệp có dòng âm thanh không; mặc định có để dự án cũ vẫn xuất được.
    #[serde(default = "mac_dinh_co_tieng")]
    has_audio: bool,
}

fn mac_dinh_co_tieng() -> bool {
    true
}

/// Lớp chữ/nhãn dán đã được frontend vẽ sẵn thành PNG.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ImageLayer {
    image_path: String,
    start: f64,
    duration: f64,
    /// Tọa đa tính theo phần trăm của khung hình (0..100).
    x: f64,
    y: f64,
    /// Cách chữ xuất hiện: rỗng = hiện thẳng, xem `bo_loc_chu_vao`.
    animation: Option<String>,
    /// Độ dài hiệu ứng vào, tính bằng giây.
    animation_duration: Option<f64>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct AudioTrack {
    path: String,
    start: f64,
    duration: f64,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    muted: bool,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ExportRequest {
    clips: Vec<TimelineClip>,
    #[serde(default)]
    texts: Vec<ImageLayer>,
    #[serde(default)]
    audios: Vec<AudioTrack>,
    output: String,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    /// none | grayscale | warm | cool | vintage | film
    #[serde(default)]
    filter: Option<String>,
    /// none | blur | glow | vhs | filmnoise | sharpen | vignette | bw | invert | fade
    #[serde(default)]
    effect: Option<String>,
    /// high | medium | low
    #[serde(default)]
    quality: Option<String>,
}

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

fn clamp(v: f64, lo: f64, hi: f64) -> f64 {
    v.max(lo).min(hi)
}

/// Biểu thức ffmpeg nội suy tuyến tính từ các keyframe, hoặc None nếu thiếu.
fn keyframe_expression(points: &[(f64, f64)]) -> Option<String> {
    if points.len() < 2 {
        return None;
    }
    let mut sorted = points.to_vec();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let last = sorted.last().unwrap().1;
    let mut expr = format!("{last:.6}");
    for w in (0..sorted.len() - 1).rev() {
        let (t0, v0) = sorted[w];
        let (t1, _v1) = sorted[w + 1];
        let span = t1 - t0;
        if span <= 1e-6 {
            expr = format!("{v0:.6}");
            continue;
        }
        let slope = (sorted[w + 1].1 - v0) / span;
        expr = format!("if(lt(t\\,{t1:.6})\\,{v0:.6}+({slope:.6})*(t-{t0:.6})\\,{expr})");
    }
    Some(expr)
}

/// Gom keyframe của một thuộc tính thành cặp (thời điểm, giá trị).
fn keyframe_points(clip: &TimelineClip, prop: &str) -> Vec<(f64, f64)> {
    clip.keyframes
        .iter()
        .filter(|k| k.prop == prop)
        .map(|k| (k.time, k.value))
        .collect()
}

/// Trừ offset clip để keyframe dùng thời gian tương đối trong chính clip đó.
fn to_clip_time(clip: &TimelineClip, abs_time: f64) -> f64 {
    abs_time - clip.start
}

/// Hex "RRGGBB" thành "0xRRGGBB" cho ffmpeg.
fn hex_color(value: &str) -> String {
    let clean: String = value
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect();
    if clean.len() == 6 {
        format!("0x{clean}")
    } else {
        "0x00FF00".to_string()
    }
}

fn temp_path(name: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("opencutcut_{name}"));
    p
}

// ---------------------------------------------------------------------------
// Dựng filter cho một clip
// ---------------------------------------------------------------------------

fn video_filter_chain(
    clip: &TimelineClip,
    w: u32,
    h: u32,
    fps: u32,
) -> Vec<String> {
    let mut f: Vec<String> = Vec::new();

    // Crop trước, rồi scale về khung: `crop` dùng số pixel nên cần biết kích
    // thước gốc, ta dùng biểu thức theo `in_w`/`in_h` của chính input.
    let crop = clip.crop;
    match crop {
        Some(c) => {
            let cw = clamp(c.width, 0.05, 1.0);
            let ch = clamp(c.height, 0.05, 1.0);
            let cx = clamp(c.x, 0.0, 1.0 - cw);
            let cy = clamp(c.y, 0.0, 1.0 - ch);
            f.push(format!("crop=iw*{cw:.4}:ih*{ch:.4}:iw*{cx:.4}:ih*{cy:.4}"));
        }
        None => {
            f.push("scale=iw:ih".into());
        }
    }

    f.push(format!("scale={w}:{h}:force_original_aspect_ratio=increase"));
    f.push(format!("crop={w}:{h}"));

    if let Some((dai, diem)) = duong_cong_toc_do(clip) {
        // `T` của `setpts` là giây, còn `PTS` là đơn vị timebase. Ép timebase
        // về 1/1000 cho biết chắc đang dùng đơn vị nào, rồi nhân kết quả lên
        // 1000 để ra mili giây, khỏi phụ thuộc timebase của tệp nguồn.
        f.push("settb=1/1000".into());
        f.push(format!("setpts=({})*1000", setpts_bieu_thuc(dai, &diem)));
    } else if let Some(s) = clip.speed {
        if (s - 1.0).abs() > 0.001 {
            f.push(format!("setpts={}*PTS", 1.0 / s));
        }
    }

    // Giảm tốc mà không nội suy thì ffmpeg chỉ lặp lại hoặc bỏ khung, nhìn rất giật.
    // `minterpolate` bịa thêm khung ở giữa nên chuyển động mượt như quay chậm có
    // nội suy. Chỉ bật khi clip thật sự chậm hơn 1×, nếu không sẽ tốn thời gian
    // mà không ích lợi gì.
    if clip.smooth && clip.speed.unwrap_or(1.0) < 0.95 && !clip.is_image() {
        f.push(format!("minterpolate=fps={fps}:mi_mode=mci"));
    }

    f.push(format!("fps={fps}"));

    let a = clip.adjust.clone().unwrap_or_default();

    // Keyframe độc lập cho ba thuộc tính màu, nếu có thì ghi đè giá trị tĩnh.
    let brightness_expr = keyframe_expression(&rel_points(clip, "brightness"));
    let contrast_expr = keyframe_expression(&rel_points(clip, "contrast"));
    let saturation_expr = keyframe_expression(&rel_points(clip, "saturation"));

    let brightness = brightness_expr
        .unwrap_or_else(|| format!("{:.4}", clamp(a.brightness, -1.0, 1.0) * 0.4));
    let contrast = contrast_expr.unwrap_or_else(|| {
        format!("{:.4}", 1.0 + clamp(a.contrast, -1.0, 1.0) * 0.8)
    });
    let saturation = saturation_expr.unwrap_or_else(|| {
        format!("{:.4}", clamp(1.0 + a.saturation, 0.0, 3.0))
    });
    f.push(format!(
        "eq=brightness={brightness}:contrast={contrast}:saturation={saturation}"
    ));

    let t = clamp(a.temperature, -1.0, 1.0);
    if t.abs() > 0.001 {
        let shift = t * 0.12;
        f.push(format!("colorbalance=rs={shift:.4}:bs={:.4}", -shift));
    }

    let shadows = clamp(a.shadows, -1.0, 1.0);
    if shadows.abs() > 0.001 {
        f.push(format!("eq=gamma={:.4}", 1.0 - shadows * 0.45));
    }

    let hl = clamp(a.highlights, -1.0, 1.0);
    if hl.abs() > 0.001 {
        let top = 1.0 - hl.max(0.0) * 0.6 + hl.min(0.0) * 0.4;
        f.push(format!(
            "colorlevels=romax={top:.4}:gomax={top:.4}:bomax={top:.4}"
        ));
    }

    let sharpen = clamp(a.sharpen, 0.0, 1.0);
    if sharpen > 0.001 {
        f.push(format!("unsharp=5:5:{}", sharpen * 1.4));
    }

    let vig = clamp(a.vignette, 0.0, 1.0);
    if vig > 0.001 {
        f.push(format!("vignette=angle=PI/{}", 4.0 + vig * 4.0));
    }

    // Bảng HSL: gộp mọi dải có thay đổi vào một lệnh `huesaturation` vì cờ
    // `colors` của ffmpeg nhận nhiều dải cùng lúc (ví dụ `r+y+m`), chạy một
    // lệnh rẻ hơn là sáu lệnh nối tiếp.
    if a.hsl.co_thay_doi() {
        // `huesaturation` chỉ nhận mỗi lệnh một danh sách dải, nên mỗi dải một
        // lệnh nối tiếp. Không dải nào khác 0 thì bỏ qua cả bộ lọc.
        let mut chuoi: Vec<String> = vec!["format=rgb24".into()];
        for (nhan, d) in a.hsl.theo_thu_tu() {
            if d.hue.abs() <= 0.01 && d.sat.abs() <= 0.01 && d.lum.abs() <= 0.01 {
                continue;
            }
            chuoi.push(format!(
                "huesaturation=hue={:.2}:saturation={:.3}:intensity={:.3}:colors={nhan}",
                clamp(d.hue, -180.0, 180.0),
                clamp(d.sat, -1.0, 1.0),
                clamp(d.lum, -1.0, 1.0)
            ));
        }
        f.push(chuoi.join(","));
    }

    if a.black_white {
        f.push("colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3".into());
    }

    // Đường cong màu.
    if let Some(curves) = &clip.curves {
        let master = if curves.master.trim().is_empty() {
            None
        } else {
            Some(curves.master.as_str())
        };
        let red = if curves.red.trim().is_empty() {
            None
        } else {
            Some(curves.red.as_str())
        };
        let green = if curves.green.trim().is_empty() {
            None
        } else {
            Some(curves.green.as_str())
        };
        let blue = if curves.blue.trim().is_empty() {
            None
        } else {
            Some(curves.blue.as_str())
        };
        if master.is_some() || red.is_some() || green.is_some() || blue.is_some() {
            let mut parts: Vec<String> = Vec::new();
            if let Some(p) = master {
                parts.push(format!("all='{p}'"));
            }
            if let Some(p) = red {
                parts.push(format!("r='{p}'"));
            }
            if let Some(p) = green {
                parts.push(format!("g='{p}'"));
            }
            if let Some(p) = blue {
                parts.push(format!("b='{p}'"));
            }
            f.push(format!("curves={}", parts.join(":")));
        }
    }

    // LUT.
    if let Some(lut) = &clip.lut {
        if !lut.path.is_empty() && PathBuf::from(&lut.path).exists() {
            let strength = clamp(lut.strength, 0.0, 1.0);
            if strength >= 0.999 {
                f.push(format!("lut3d='{}'", lut.path));
            } else {
                // Nội suy giữa ảnh gốc và ảnh đã LUT, rồi trộn theo độ mạnh.
                f.push(format!(
                    "split[a][b];[b]lut3d='{}'[l];[a][l]blend=all_expr='A*(1-{strength:.4})+B*{strength:.4}'",
                    lut.path
                ));
            }
        }
    }

    // Lọc màu nền. chromakey cần nền phẳng nên dùng bộ lọc đơn giản hơn.
    if let Some(chroma) = &clip.chroma {
        if chroma.enabled {
            let key = hex_color(&chroma.color);
            let similarity = clamp(chroma.similarity, 0.01, 1.0);
            let blend = clamp(chroma.smoothness, 0.0, 1.0);
            f.push(format!("chromakey={key}:{similarity:.4}:{blend:.4}"));
            let spill = clamp(chroma.spill, 0.0, 1.0);
            if spill > 0.001 {
                // `despill` dùng `mix` (0..1) và `type` là số nguyên: 0 = green.
                f.push(format!(
                    "despill=type=0:mix={spill:.3}:expand={:.3}",
                    spill * 0.5
                ));
            }
        }
    }

    // Mặt nạ hình học: khoanh vùng thấy được bằng cách gán kênh alpha theo
    // tọa độ trong ảnh. `geq` đánh giá biểu thức cho từng điểm nên làm được
    // mọi hình, kể cả hình không có sẵn trong ffmpeg.
    if let Some(m) = &clip.mask {
        if !m.kind.is_empty() && m.kind != "none" {
            let cx = (m.center_x * 100.0).round() / 100.0;
            let cy = (m.center_y * 100.0).round() / 100.0;
            let rx = (clamp(m.size_x, 0.02, 2.0) * 50.0).round() / 100.0;
            let ry = (clamp(m.size_y, 0.02, 2.0) * 50.0).round() / 100.0;
            // `soft` là bề rộng vùng chuyển tiếp, tính theo phần trăm khung.
            let mem = clamp(m.softness, 0.0, 50.0) / 100.0;
            let goc = m.rotation_degrees;
            let quay = format!(
                "(X-{cx}*W)/({rx}*W)*cos({:.5}*PI/180)+(Y-{cy}*H)/({ry}*H)*sin({:.5}*PI/180)",
                goc, goc
            );
            let nganh = format!(
                "-(X-{cx}*W)/({rx}*W)*sin({:.5}*PI/180)+(Y-{cy}*H)/({ry}*H)*cos({:.5}*PI/180)",
                goc, goc
            );
            let khoang_cach = match m.kind.as_str() {
                // "vuong" cần so từng trục, mọi trục phải nằm trong khoảng.
                "vuong" => format!("max(abs({quay}),abs({nganh}))"),
                // "tron" là hình tròn thật: hai trục dùng chung bán kính.
                _ => format!("hypot({quay},{nganh})"),
            };
            // Ngưỡng mặt nạ: khoảng cách nào được tính là bên trong. Mặt nạ
            // đứng yên thì ngưỡng luôn là 1; có hiệu ứng thì ngưỡng đổi theo
            // `T` (giây kể từ đầu luồng) nên mép mặt nạ chạy theo dòng thời.
            let dai = clamp(m.anim_duration, 0.05, 600.0);
            let t0 = m.anim_start.max(0.0);
            let tien_do = format!("clip((T-{t0:.3})/{dai:.3}\\,0\\,1)");
            let nguong = match m.animation.as_str() {
                "mo" => tien_do.clone(),
                "thu" => format!("(1-{tien_do})"),
                _ => "1".to_string(),
            };
            // Mép mềm: trong khoảng `mem` ngay trước đường viền alpha giảm dần
            // thay vì cắt cứng. Không chia cho `mem` khi mem bằng 0 vì phải
            // tránh chia cho không.
            let alpha = if mem > 0.002 {
                format!("clip(({nguong}-{khoang_cach})/{mem:.4}\\,0\\,1)*255")
            } else {
                format!("if(lt({khoang_cach}\\,{nguong})\\,255\\,0)")
            };
            // Quét là kiểu riêng: nó lộ dần theo một cạnh chứ không nở vùng khoanh.
            let alpha = match m.animation.as_str() {
                "quet_ngang" => {
                    let p = format!("clip(0.0005+0.9995*{tien_do}\\,0\\,1)");
                    format!("if(lt(X\\,W*{p})\\,255\\,0)")
                }
                "quet_doc" => {
                    let p = format!("clip(0.0005+0.9995*{tien_do}\\,0\\,1)");
                    format!("if(lt(Y\\,H*{p})\\,255\\,0)")
                }
                _ => alpha,
            };
            f.push("format=rgba".into());
            f.push(format!(
                "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha}'"
            ));
        }
    }

    // Fade mở/đóng tính theo giá trị thanh fade (0..1 -> 0..0.5s).
    let fade = a.fade;
    if fade > 0.001 {
        let d = clamp(fade * 0.5, 0.05, 2.0);
        f.push(format!("fade=t=in:st=0:d={d:.3}"));
        let out_start = (clip.duration - d).max(0.0);
        f.push(format!("fade=t=out:st={out_start:.3}:d={d:.3}"));
    }

    // Keyframe hình ảnh: scale, vị trí, độ đục. Áp dụng sau khi đã scale về khung.
    //
    // `eval=frame` là bắt buộc: mặc định `scale` đánh giá biểu thức một lần lúc
    // khởi tạo, mà biểu thức có biến `t` nên ffmpeg báo lỗi ngay và cả dự án
    // không xuất được.
    let scale_expr = keyframe_expression(&rel_points(clip, "scale"));
    if let Some(expr) = scale_expr {
        f.push(format!(
            "scale=iw*{expr}/100:ih*{expr}/100:eval=frame,scale={w}:{h}"
        ));
    }
    let opacity_expr = keyframe_expression(&rel_points(clip, "opacity"));
    if let Some(expr) = opacity_expr {
        // colorchannelmixer không nhận biểu thức cho alpha, geq thì có (biến T).
        f.push("format=rgba".into());
        f.push(format!(
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{}'",
            doi_ten_bien(&expr, 't', 'T')
        ));
    }

    f
}

/// Đổi tên biến trong biểu thức, chỉ thay khi `t` đứng riêng một mình.
///
/// Không dùng `replace` thẳng vì sẽ làm hỏng tên hàm: `lt(t,2)` thành
/// `lT(T,2)`, ffmpeg báo "Unknown function" và hỏng cả bộ lọc.
fn doi_ten_bien(expr: &str, tu: char, moi: char) -> String {
    let kytu: Vec<char> = expr.chars().collect();
    let la_chu_cai = |c: char| c.is_ascii_alphabetic() || c == '_';
    let ra: String = kytu
        .iter()
        .enumerate()
        .map(|(i, &c)| {
            if c != tu {
                return c;
            }
            let truoc_dung = i > 0 && la_chu_cai(kytu[i - 1]);
            let sau_dung = i + 1 < kytu.len() && la_chu_cai(kytu[i + 1]);
            if truoc_dung || sau_dung {
                c
            } else {
                moi
            }
        })
        .collect();
    ra
}

/// Keyframe đã chuyển sang thời gian tương đối trong clip.
fn rel_points(clip: &TimelineClip, prop: &str) -> Vec<(f64, f64)> {
    keyframe_points(clip, prop)
        .into_iter()
        .map(|(t, v)| (to_clip_time(clip, t), v))
        .filter(|(t, _)| *t >= -0.001)
        .collect()
}

/// Biểu thức keyframe tính theo thời gian của **lát** đang dựng, không phải
/// của cả clip.
///
/// Lát chuyển cảnh chỉ chiếm một đoạn ngắn ở cuối clip, mà biểu thức của bộ lọc
/// lại chạy từ 0 theo thời lượng lát, nên phải trừ đi thời điểm bắt đầu lát.
fn bieu_thuc_theo_lat(clip: &TimelineClip, prop: &str, t0: f64) -> Option<String> {
    let mut pts: Vec<(f64, f64)> = rel_points(clip, prop)
        .into_iter()
        .map(|(t, v)| (t - t0, v))
        .filter(|(t, _)| *t >= -0.001)
        .collect();
    pts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    keyframe_expression(&pts)
}

/// Clip có keyframe hình ảnh nào không (scale hoặc độ đục).
fn co_keyframe_hinh_anh(clip: &TimelineClip) -> bool {
    ["scale", "opacity"]
        .iter()
        .any(|p| clip.keyframes.iter().any(|k| k.prop == *p))
}

/// Áp keyframe scale/độ đục của clip lên một nhãn đã có, trả về nhãn mới.
///
/// Dùng sau `xfade` để keyframe vẫn có tác dụng trong vùng chuyển cảnh: lát đó
/// đã đi qua `xfade` nên mọi thuộc tính khác của clip bị bỏ qua.
fn ap_keyframe_hinh_anh(clip: &TimelineClip, t0: f64, vao: &str, ra: &str, graph: &mut String) {
    let mut chuoi: Vec<String> = vec![vao.to_string()];
    if let Some(expr) = bieu_thuc_theo_lat(clip, "scale", t0) {
        // Lấy kích thước hiện tại làm gốc để tỉ lệ phần trăm có ý nghĩa.
        chuoi.push(format!("scale=iw*{expr}/100:ih*{expr}/100:eval=frame"));
    }
    if let Some(expr) = bieu_thuc_theo_lat(clip, "opacity", t0) {
        chuoi.push("format=rgba".into());
        chuoi.push(format!(
            "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{}'",
            doi_ten_bien(&expr, 't', 'T')
        ));
    }
    if chuoi.len() == 1 {
        graph.push_str(&format!("{vao}null{ra};"));
        return;
    }
    graph.push_str(&format!("{}{ra};", chuoi.join(",")));
}

/// Nối nhiều `atempo` để đạt tốc độ ngoài khoảng 0.5..2 mà bộ lọc cho phép.
///
/// `atempo` chỉ nhận 0.5..2 mỗi bước, nên tốc độ 4 cần hai bước 2×, còn 0.25
/// cần hai bước 0.5×. Lặp lại bằng phép nhân dừ ở khi vào khoảng cho phép.
fn atempo_chain(speed: f64) -> Vec<String> {
    let target = speed.clamp(0.05, 20.0);
    let mut out = Vec::new();
    // Nhân dần các hệ số hợp lệ cho tới khi phần còn lại vừa khoảng 0.5..2.
    let mut factor = 1.0_f64;
    while target / factor > 2.0 + 1e-6 {
        factor *= 2.0;
        out.push("atempo=2.0".to_string());
    }
    while target / factor < 0.5 - 1e-6 {
        factor *= 0.5;
        out.push("atempo=0.5".to_string());
    }
    let rest = target / factor;
    if (rest - 1.0).abs() > 0.001 {
        // `{}` bỏ số 0 thừa: 2.0 -> "2", 1.5 -> "1.5", tránh "2.0000".
        out.push(format!("atempo={rest}"));
    }
    out
}

/// Chuỗi bộ lọc cho một kiểu hiệu ứng giọng nói.
///
/// Đổi cao độ mà vẫn giữ nguyên độ dài là mấu chốt: `asetrate` đổi cả cao độ lẫn
/// độ dài, nên phải kèm `atempo` với hệ số nghịch để đưa độ dài về như cũ. Không
/// làm vậy thì tiếng sẽ bị lệch khỏi hình.
fn hieu_ung_giong(loai: &str) -> Option<String> {
    let chuoi = match loai {
        "vong" => "aecho=0.8:0.6:60:0.5".to_string(),
        "vong_manh" => "aecho=0.9:0.9:120:0.7".to_string(),
        // Gấp 1.4 lần tần số lấy mẫu nên tiếng mỏng lên, rồi atempo nghịch để
        // độ dài không đổi.
        "mong" => "asetrate=48000*1.4,aresample=48000,atempo=0.714".to_string(),
        "trong" => "asetrate=48000*0.7,aresample=48000,atempo=1.429".to_string(),
        // Robot: nén cao độ rồi điều chế biên độ nhanh, nghe máy móc. Phải kèm
        // `atempo` nghịch cho bước nén cao độ, không thì tiếng bị ngắn đi.
        "robot" => "asetrate=48000*1.5,aresample=48000,atempo=0.667,\
                    tremolo=f=180:d=0.85"
            .to_string(),
        // Vô tuyến: bỏ hai đầu dải và giữ lại phần dải giữa.
        "radio" => "bandpass=f=1800:width_type=h:w=1200,treble=g=6:f=1200".to_string(),
        "phone" => "bandpass=f=1600:width_type=h:w=900".to_string(),
        "flanger" => "flanger=delay=5:depth=4".to_string(),
        "phaser" => "aphaser=in_gain=0.4".to_string(),
        _ => return None,
    };
    Some(chuoi)
}

fn audio_filter_chain(clip: &TimelineClip) -> Vec<String> {
    let mut f: Vec<String> = Vec::new();
    // Khử tiếng ồn đặt trước cùng: bộ lọc này cần dữ liệu còn nguyên chứ chưa
    // bị đổi tốc.
    if let Some(m) = clip.denoise {
        let muc = clamp(m, 0.0, 1.0);
        if muc > 0.001 {
            f.push(afftdn_chuoi(muc));
        }
    }
    // Hiệu ứng giọng nói cũng phải chạy trên dữ liệu gốc, trước khi đổi tốc.
    if let Some(k) = &clip.voice_effect {
        if let Some(b) = hieu_ung_giong(k) {
            f.push(b);
        }
    }
    if let Some(s) = clip.speed {
        f.extend(atempo_chain(s));
    }
    let vol = clamp(clip.volume.unwrap_or(1.0), 0.0, 2.0);
    if (vol - 1.0).abs() > 0.001 {
        f.push(format!("volume={vol:.3}"));
    }
    if clip.muted {
        f.push("volume=0".into());
    }
    f
}

/// Chuỗi `afftdn` cho một mức khử 0..1.
///
/// `nr` càng lớn thì hạ nhiều tiếng ồn hơn; `nf` là ngưỡng cửa dưới tính dB, đặt
/// âm để bộ lọc không máng tiếng nói ngay cả khi chọn mức mạnh nhất. Cao độ làm
/// giọng hơi rỗng nên không cho mức 1.0 = mạnh nhất được.
/// Chuỗi `afftdn` cho một mức khử 0..1.
///
/// Thử nghiệm trên tiếng ồn giả lập cho thấy chính `nf` (cửa dưới coi là ồn)
/// quyết định mức khử, còn `nr` ít tác dụng; `nf` cần nhỏ dần từ -30 xuống -20
/// để khử mạnh hơn. Giữ `nr` ở mức trung cho khỏi làm rỗng giọng.
fn afftdn_chuoi(muc: f64) -> String {
    let muc = clamp(muc, 0.0, 1.0);
    let nf = -30.0 + muc * 10.0;
    format!("afftdn=nr=18:nf={nf:.1}")
}

/// Chia clip có đường cong tốc độ thành các lát nhỏ, mỗi lát một tốc độ hằng.
///
/// Trả về danh sách `(đầu nguồn, cuối nguồn, tốc độ)` tính theo thời gian nguồn.
/// `atempo` chỉ nhận hệ số hằng, nên lát nhỏ là cách làm tiếng chạy đúng với
/// đường cong; chia mỗi lát khoảng 0.2 giây nên nghe liền, không thấy bậc.
fn lat_am_toc_do(dai: f64, diem: &[(f64, f64)]) -> Vec<(f64, f64, f64)> {
    let so_lat = ((dai / 0.2).round() as usize).clamp(1, 32);
    let buoc = dai / so_lat as f64;
    let mut lat: Vec<(f64, f64, f64)> = Vec::with_capacity(so_lat);
    let mut bien = 0.0;
    for k in 0..so_lat {
        let giua = (k as f64 + 0.5) * buoc;
        let v = toc_do_tai(diem, giua);
        let s0 = bien;
        bien += buoc * v;
        lat.push((s0, bien, v));
    }
    lat
}

/// Chuỗi bộ lọc ghép âm thanh của một clip lên nhãn `label`.
///
/// Clip có đường cong tốc độ thì chia nguồn ra nhiều nhánh bằng `asplit`, mỗi
/// nhánh `atrim` một lát rồi `atempo` với tốc độ của lát đó, cuối cùng `concat`
/// lại. Cách này chỉ dùng bộ lọc số hằng nên không gặp giới hạn cú pháp biểu
/// thức của `atempo` trong `-filter_complex`.
fn ghep_am_toc_do(idx: usize, clip: &TimelineClip, dai: f64, diem: &[(f64, f64)], graph: &mut String) {
    let lat = lat_am_toc_do(dai, diem);
    let n = lat.len();
    let vao: Vec<String> = (0..n).map(|k| format!("[am{idx}b{k}]")).collect();
    graph.push_str(&format!("[{idx}:a]asplit={n}{};", vao.concat()));
    let mut ra: Vec<String> = Vec::new();
    for (k, (s0, s1, v)) in lat.iter().enumerate() {
        let mut chuoi = vec![format!("atrim={s0:.4}:{s1:.4}"), "asetpts=N/SR/TB".into()];
        chuoi.extend(atempo_chain(*v));
        let nhan = format!("[am{idx}s{k}]");
        graph.push_str(&format!("[am{idx}b{k}]{}{nhan};", chuoi.join(",")));
        ra.push(nhan);
    }
    let mut chuoi = vec![format!("concat=n={n}:v=0:a=1")];
    chuoi.extend(audio_filter_chain(clip));
    chuoi.push(format!("atrim=0:{dai:.3}"));
    chuoi.push("asetpts=N/SR/TB".into());
    let delay_ms = (clip.start * 1000.0).round().max(0.0) as i64;
    if delay_ms > 0 {
        chuoi.push(format!("adelay={delay_ms}|{delay_ms}"));
    }
    graph.push_str(&format!("{}{}[am{idx}];", ra.concat(), chuoi.join(",")));
}

/// Các mốc của đường cong tốc độ: (thời gian trong clip, hệ số tốc độ).
///
/// Lấy từ keyframe `prop = "speed"` nên không cần thêm trường mới cho clip.
/// Mốc ngoài khoảng `[0, duration]` bị cắt, và hai mốc ở cùng một thời điểm
/// thì giữ mốc sau. Trả về `None` khi không có keyframe tốc độ.
fn duong_cong_toc_do(clip: &TimelineClip) -> Option<(f64, Vec<(f64, f64)>)> {
    let dai = clip.duration;
    if dai <= 0.01 {
        return None;
    }
    let mut diem = rel_points(clip, "speed")
        .into_iter()
        .map(|(t, v)| (t.clamp(0.0, dai), v.clamp(0.05, 20.0)))
        .collect::<Vec<_>>();
    if diem.is_empty() {
        return None;
    }
    diem.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    // Cùng thời điểm thì mốc đặt sau thắng. `dedup_by` của Rust giữ lại mốc
    // đứng trước, nên phải tự gom để đảo chiều lại.
    let mut gop: Vec<(f64, f64)> = Vec::with_capacity(diem.len());
    for (t, v) in diem {
        match gop.last_mut() {
            Some(cuoi) if (cuoi.0 - t).abs() < 1e-6 => cuoi.1 = v,
            _ => gop.push((t, v)),
        }
    }
    Some((dai, gop))
}

/// Nội suy tốc độ theo thời gian trong clip (tuyến tính giữa các mốc).
fn toc_do_tai(diem: &[(f64, f64)], t: f64) -> f64 {
    if diem.is_empty() {
        return 1.0;
    }
    if t <= diem[0].0 {
        return diem[0].1;
    }
    for w in 0..diem.len() - 1 {
        let (t0, v0) = diem[w];
        let (t1, v1) = diem[w + 1];
        if t < t1 {
            let span = t1 - t0;
            if span <= 1e-9 {
                return v1;
            }
            return v0 + (v1 - v0) * (t - t0) / span;
        }
    }
    diem[diem.len() - 1].1
}

/// Trung bình tốc độ của clip khi có đường cong: dùng để biết phải đọc bao
/// nhiêu giây nguồn cho `-ss`/`-t`.
fn toc_do_trung_binh(dai: f64, diem: &[(f64, f64)]) -> f64 {
    if dai <= 0.01 {
        return 1.0;
    }
    // Tích theo từng mảnh 200 bước: đủ chính xác cho `-t` và không cần công thức.
    let buoc = dai / 200.0;
    let mut tong = 0.0;
    for i in 0..200 {
        tong += toc_do_tai(diem, (i as f64 + 0.5) * buoc);
    }
    tong / 200.0
}

/// Bổ sung mốc đầu (t=0) và mốc cuối (t=duration) để đoạn ngoài vùng keyframe
/// vẫn giữ tốc độ, không nhảy về 1.0.
fn moc_toc_do(diem: &[(f64, f64)], dai: f64) -> Vec<(f64, f64)> {
    let dau = diem.first().map(|d| d.1).unwrap_or(1.0);
    let cuoi = diem.last().map(|d| d.1).unwrap_or(1.0);
    let mut moc: Vec<(f64, f64)> = Vec::with_capacity(diem.len() + 2);
    if diem.first().map(|d| d.0).unwrap_or(1.0) > 1e-9 {
        moc.push((0.0, dau));
    }
    moc.extend(diem.iter().copied());
    if diem.last().map(|d| d.0).unwrap_or(0.0) < dai - 1e-9 {
        moc.push((dai, cuoi));
    }
    moc
}

/// Biểu thức `setpts` đảo chiều đường cong: biến `T` của ffmpeg là thời gian
/// **của nguồn** tính bằng giây, còn kết quả phải là thời gian **trên dòng
/// thời**, cũng tính bằng giây.
///
/// Với tốc độ v(t) tuyến tính trên mỗi đoạn, thời gian nguồn tích phân
/// `s(o) = s_k + v_a*u + (v_b - v_a) * u² / (2 * dv)`, với `u = o - o_k`. Đảo
/// lại ra `u` bằng công thức nghiệm của phương trình bậc hai; khi hai tốc độ
/// gần bằng nhau thì dùng phép xấp xỉ tuyến tính cho khỏi mất chính xác.
///
/// Lưu ý: phải dùng biến `T` của `setpts`, không phải `t` (đó là biến của
/// `eq`/`overlay`). Sai tên biến thì ffmpeg báo "Undefined constant" và hỏng cả
/// bộ lọc.
fn setpts_bieu_thuc(dai: f64, diem: &[(f64, f64)]) -> String {
    let moc = moc_toc_do(diem, dai);
    // Mốc tích phân: `bien[k]` là thời gian nguồn tương ứng `moc[k].0`.
    let mut bien: Vec<f64> = Vec::with_capacity(moc.len());
    let mut tong = 0.0;
    bien.push(0.0);
    for k in 0..moc.len() - 1 {
        let dv = moc[k + 1].0 - moc[k].0;
        tong += dv * (moc[k].1 + moc[k + 1].1) / 2.0;
        bien.push(tong);
    }
    let n = moc.len() - 1;
    // Đoạn cuối: tốc độ hằng, chỉ cần chia.
    let (o_n, v_n) = moc[n];
    let mut expr = format!("({o_n:.6}+(T-{:.6})/{v_n:.6})", bien[n]);
    for k in (0..n).rev() {
        let (o_a, v_a) = moc[k];
        let (o_b, v_b) = moc[k + 1];
        let dv = o_b - o_a;
        let thuoc = if dv <= 1e-9 {
            format!("({o_a:.6}+(T-{:.6})/{v_a:.6})", bien[k])
        } else if (v_b - v_a).abs() < 0.005 * v_a {
            // Gần như không đổi: dùng tốc độ đầu đoạn.
            format!("({o_a:.6}+(T-{:.6})/{v_a:.6})", bien[k])
        } else {
            let a = (v_b - v_a) / (2.0 * dv);
            format!(
                "({o_a:.6}+(-{v_a:.6}+sqrt(max(0\\,{v_a:.8}*{v_a:.8}+4*{a:.8}*(T-{:.6}))))/{:.8})",
                bien[k],
                2.0 * a
            )
        };
        expr = format!("if(lt(T\\,{:.6})\\,{thuoc}\\,{expr})", bien[k + 1]);
    }
    expr
}

/// Thân bộ lọc của một hiệu ứng, theo bản thường hoặc bản mạnh.
///
/// Danh sách id và chuỗi lệnh phải khớp `src/effects.ts`; toàn bộ đã được kiểm
/// chứng bằng ffmpeg thật trong `kiemHieuUng.ts`.
fn hieu_ung(id: &str, manh: bool) -> Option<&'static str> {
    Some(match (id, manh) {
        // ----- Chuyển động -----
        ("zoom_vao", _) => {
            "scale=iw*'1+0.35*min(t/3\\,1)':ih*'1+0.35*min(t/3\\,1)':eval=frame,crop=iw/1.35:ih/1.35"
        }
        ("zoom_ra", _) => {
            "scale=iw*'(1.4-0.4*min(t/3\\,1))':ih*'(1.4-0.4*min(t/3\\,1))':eval=frame,crop=iw/1.4:ih/1.4"
        }
        ("zoom_3d_vao", _) => {
            "scale=iw*'1+0.5*min(t/3\\,1)':ih*'1+0.5*min(t/3\\,1)':eval=frame,crop=iw/1.5:ih/1.5"
        }
        ("lay", _) => "crop=iw-16:ih-16:'8+4*sin(t*38)':'8+4*cos(t*31)',scale=iw:ih",
        ("chop_an", false) => {
            "eq=brightness='0.22*exp(-pow((mod(t\\,1.5)-0.4)*14\\,2))':eval=frame"
        }
        ("chop_an", true) => {
            "eq=brightness='0.38*exp(-pow((mod(t\\,1.2)-0.4)*12\\,2))':eval=frame"
        }
        ("pho_de", _) => "eq=brightness='0.2*min(t/2\\,1)':eval=frame",

        // ----- Cổ điển -----
        ("phim", false) => "curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95',eq=saturation=0.85",
        ("phim", true) => {
            "curves=all='0/0 0.3/0.35 0.7/0.9 1/1',noise=alls=12:allf=t"
        }
        ("truyen_anh", _) => "eq=saturation=0",
        ("sepia", _) => "colorchannelmixer=.39:.77:.19:0:.35:.69:.17:0:.27:.53:.13:0",

        // ----- Retro -----
        ("vhs", false) => "chromashift=crh=3:cbh=-3:crv=2:cbv=-2,noise=alls=8:allf=t+u",
        ("vhs", true) => "chromashift=crh=7:cbh=-7:crv=5:cbv=-5,noise=alls=18:allf=t+u",
        ("retro_zoom", _) => {
            "scale=iw*'1.02+0.3*floor(min(t/0.7\\,4))/4':ih*'1.02+0.3*floor(min(t/0.7\\,4))/4':eval=frame,crop=iw/1.32:ih/1.32"
        }
        ("crt", _) => {
            "eq=saturation=1.15:contrast=1.1,vignette=angle=PI/4.5,noise=alls=6:allf=t"
        }
        ("loa_sieu", _) => "eq=brightness=0.08:saturation=1.3,vignette=angle=PI/2.5",

        // ----- Nghệ thuật -----
        ("neon", false) => "eq=saturation=1.6:contrast=1.2:gamma=1.05",
        ("neon", true) => "eq=saturation=2.2:contrast=1.35:gamma=1.1",
        ("trieu_luong", _) => "eq=saturation=1.25:gamma=1.12:brightness=0.04",
        ("mo_man", _) => "gblur=sigma=2,eq=brightness=0.05:gamma=1.1",
        ("doi_mau", _) => "negate",
        ("am_bao", _) => "format=gray,eq=contrast=1.7:brightness=-0.04",
        ("am", _) => "colortemperature=temperature=6500",
        ("lanh", _) => "colortemperature=temperature=10000",
        ("hoai_niem", _) => {
            "curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95',eq=contrast=1.05:saturation=0.9"
        }

        // ----- Biến dạng -----
        ("pixel", false) => "scale=iw/12:ih/12,scale=iw*12:ih*12:flags=neighbor",
        ("pixel", true) => "scale=iw/26:ih/26,scale=iw*26:ih*26:flags=neighbor",
        ("khay_mo", _) => "crop=iw/3:ih/3,tile=3x3,scale=iw:ih",
        ("guong", _) => "hflip",
        ("kaleido", _) => {
            "{IN}split[ka][kb];[kb]hflip[kc];[ka][kc]vstack,scale=iw/2:ih:flags=neighbor"
        }
        ("xoay", _) => "rotate=t*0.15:c=none:fillcolor=black",
        // `geq` dùng biến `T` cho thời gian tính bằng giây.
        ("gia_pho", _) => {
            "geq=r='r(X\\,Y+8*sin(X/40+3*T))':g='g(X\\,Y+8*sin(X/40+3*T))':b='b(X\\,Y+8*sin(X/40+3*T))'"
        }

        // ----- Ánh sáng -----
        ("phat_sang", false) => {
            "{IN}split[sa][sb];[sb]gblur=sigma=8[sg];[sa][sg]blend=all_mode=screen:all_opacity=0.45"
        }
        ("phat_sang", true) => {
            "{IN}split[sa][sb];[sb]gblur=sigma=16[sg];[sa][sg]blend=all_mode=screen:all_opacity=0.7"
        }
        ("lam_mo", false) => "boxblur=3:1",
        ("lam_mo", true) => "boxblur=8:2",
        ("tang_net", _) => "unsharp=5:5:1.1",
        ("vien_toi", _) => "vignette=angle=PI/3.2",

        _ => return None,
    })
}

fn map_mix_mode(mode: &str) -> Option<&'static str> {
    match mode {
        "normal" => None,
        "multiply" => Some("multiply"),
        "screen" => Some("screen"),
        "overlay" => Some("overlay"),
        "soft_light" => Some("softlight"),
        "hard_light" => Some("hardlight"),
        "difference" => Some("difference"),
        "lighten" => Some("lighten"),
        "darken" => Some("darken"),
        "color_dodge" => Some("coloredodge"),
        _ => None,
    }
}

/// Tên chuyển cảnh ffmpeg mà clip mang ở mép phải, None nếu không có.
fn transition_kind(clip: &TimelineClip) -> Option<&'static str> {
    match clip.transition.as_deref().unwrap_or("none") {
        "fade" => Some("fade"),
        "fadeblack" => Some("fadeblack"),
        "fadewhite" => Some("fadewhite"),
        "wipeleft" => Some("wipeleft"),
        "wiperight" => Some("wiperight"),
        "wipeup" => Some("wipeup"),
        "wipedown" => Some("wipedown"),
        "slideleft" => Some("slideleft"),
        "slideright" => Some("slideright"),
        "slideup" => Some("slideup"),
        "slidedown" => Some("slidedown"),
        "smoothleft" => Some("smoothleft"),
        "smoothright" => Some("smoothright"),
        "circleopen" => Some("circleopen"),
        "circleclose" => Some("circleclose"),
        "radial" => Some("radial"),
        "dissolve" => Some("dissolve"),
        "pixelize" => Some("pixelize"),
        "diagtl" => Some("diagtl"),
        "diagtr" => Some("diagtr"),
        "diagbl" => Some("diagbl"),
        "diagbr" => Some("diagbr"),
        "distance" => Some("distance"),
        "rectcrop" => Some("rectcrop"),
        "circlecrop" => Some("circlecrop"),
        // Mở/đóng theo chiều ngang và dọc, mềm hơn hình tròn.
        "vertopen" => Some("vertopen"),
        "vertclose" => Some("vertclose"),
        "horzopen" => Some("horzopen"),
        "horzclose" => Some("horzclose"),
        "smoothup" => Some("smoothup"),
        "smoothdown" => Some("smoothdown"),
        // Cắt từng dải, nhìn như đưa qua tấm kính xạo.
        "hlslice" => Some("hlslice"),
        "hrslice" => Some("hrslice"),
        "vuslice" => Some("vuslice"),
        "vdslice" => Some("vdslice"),
        // Mờ dần: đúng nghĩa "chuyển cảnh mờ" mà CapCut có.
        "hblur" => Some("hblur"),
        "fadegrays" => Some("fadegrays"),
        "fadefast" => Some("fadefast"),
        "fadeslow" => Some("fadeslow"),
        "wipetl" => Some("wipetl"),
        "wipetr" => Some("wipetr"),
        "wipebl" => Some("wipebl"),
        "wipebr" => Some("wipebr"),
        "squeezeh" => Some("squeezeh"),
        "squeezev" => Some("squeezev"),
        "zoomin" => Some("zoomin"),
        // Gió thổi từng dải, trông như mép giấy bị xé.
        "hlwind" => Some("hlwind"),
        "hrwind" => Some("hrwind"),
        "vuwind" => Some("vuwind"),
        "vdwind" => Some("vdwind"),
        // Lộ hình từ hướng ngược lại với wipe.
        "coverleft" => Some("coverleft"),
        "coverright" => Some("coverright"),
        "coverup" => Some("coverup"),
        "coverdown" => Some("coverdown"),
        "revealleft" => Some("revealleft"),
        "revealright" => Some("revealright"),
        "revealup" => Some("revealup"),
        "revealdown" => Some("revealdown"),
        _ => None,
    }
}

/// Độ dài chuyển cảnh (giây), bị cắt lại cho vừa với hai clip.
fn transition_duration(left: &TimelineClip, right: &TimelineClip) -> f64 {
    let wanted = left
        .transition_duration
        .unwrap_or(0.5)
        .clamp(0.05, 5.0);
    // Không được dài hơn clip nào trong hai clip, và offset không được âm.
    let room = left
        .duration
        .min(right.duration)
        .min(right.start.max(0.0));
    wanted.min(room).max(0.05)
}

/// Dựng đoạn video của một clip cho lát thời gian [t0, t1] (thời gian tuyệt
/// đối trên timeline), trả về nhãn đã dựng xong.
///
/// Chuỗi bộ lọc màu chạy trước `trim` để keyframe và fade vẫn tính theo thời
/// gian riêng của clip; lát cắt áp dụng sau cùng.
fn clip_segment(
    clip: &TimelineClip,
    idx: usize,
    t0: f64,
    t1: f64,
    w: u32,
    h: u32,
    fps: u32,
    graph: &mut String,
) -> String {
    let chain = video_filter_chain(clip, w, h, fps).join(",");
    let from = (t0 - clip.start).max(0.0);
    let to = (t1 - clip.start).min(clip.duration);
    let tag = format!("sg{idx}_{}", t0.to_string().replace('.', "_"));
    let label = format!("[{tag}]");
    let mut f = chain;
    f.push_str(&format!(",fps={fps}"));
    f.push_str(&format!(
        ",trim=start={from:.4}:end={to:.4},setpts=PTS-STARTPTS"
    ));

    // Khung hình đứng yên: chỉ giữ lại khung cuối của lát rồi nhân bản nó
    // suốt độ dài lát. Tiếng vẫn chạy bình thường. Mọi mốc thời gian ở đây
    // tính theo luồng đã cắt (0..`dai`), không phải theo clip gốc.
    if clip.freeze && !clip.is_image() {
        let dai = (to - from).max(0.0);
        let buoc = 1.0 / fps as f64;
        f.push_str(&format!(
            ",trim=start={:.4}:end={dai:.4},setpts=PTS-STARTPTS",
            (dai - buoc).max(0.0)
        ));
        f.push_str(&format!(
            ",tpad=stop_mode=clone:stop_duration={dai:.3},fps={fps},trim=duration={dai:.3}"
        ));
        graph.push_str(&format!("[{idx}:v]{f}{label};"));
        return label;
    }

    // Hiệu ứng ghép nhiều nhánh phải là một khối filtergraph riêng, không nối
    // bằng dấu phẩy. Nhãn bên trong được tiền tố bằng `tag` để không đụng nhãn
    // của clip khác.
    let hieu = clip
        .effect
        .as_deref()
        .and_then(|id| hieu_ung(id, clip.effect_strong.unwrap_or(false)));
    match hieu {
        None => graph.push_str(&format!("[{idx}:v]{f}{label};")),
        // Một câu lệnh: nối thẳng vào chuỗi hiện có.
        Some(body) if !body.contains(';') => {
            graph.push_str(&format!("[{idx}:v]{f},{body}{label};"))
        }
        // Nhiều câu lệnh: chuỗi chính tạo nhãn trung gian rồi khối hiệu ứng
        // lấy nhãn đó qua `{IN}`.
        Some(body) => {
            let mid = format!("[{tag}i]");
            let noi = body
                .replace("{IN}", &mid)
                .replace("[ka]", &format!("[{tag}ka]"))
                .replace("[kb]", &format!("[{tag}kb]"))
                .replace("[kc]", &format!("[{tag}kc]"))
                .replace("[sa]", &format!("[{tag}sa]"))
                .replace("[sb]", &format!("[{tag}sb]"))
                .replace("[sg]", &format!("[{tag}sg]"));
            graph.push_str(&format!("[{idx}:v]{f}{mid};"));
            // Nhãn cuối của khối là output ẩn, nên gắn nhãn ra bằng `null`.
            graph.push_str(&format!("{noi},null{label};"));
        }
    }
    label
}

// ---------------------------------------------------------------------------
// Lệnh Tauri
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phân tích âm thanh: waveform và nhịp
// ---------------------------------------------------------------------------

/// Đọc toàn bộ tệp thành PCM mono 16-bit �nh tần số thấp, trả về mẫu thô.
fn decode_pcm_mono(path: &str) -> Result<Vec<i16>, String> {
    let output = Command::new("ffmpeg")
        .arg("-v")
        .arg("quiet")
        .arg("-i")
        .arg(path)
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("8000")
        .arg("-f")
        .arg("s16le")
        .arg("-")
        .output()
        .map_err(|e| format!("Không đọc được âm thanh: {e}"))?;
    if !output.status.success() {
        return Err("ffmpeg không giải mã được tệp âm thanh".into());
    }
    let bytes = output.stdout;
    Ok(bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect())
}

/// Đọc thời lượng của tệp media bằng ffprobe, trả về `fallback` nếu lỗi.
#[tauri::command]
fn probe_media(path: String, fallback: Option<f64>) -> Result<f64, String> {
    let fb = fallback.unwrap_or(5.0);
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(&path)
        .output()
        .map_err(|e| format!("Không chạy được ffprobe: {e}"))?;
    if !output.status.success() {
        return Ok(fb);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // Không kéo thêm serde_json phức tạp: dò tay trường "duration".
    for line in text.lines() {
        let line = line.trim().trim_end_matches(',');
        if let Some(rest) = line.strip_prefix("\"duration\":") {
            if let Ok(v) = rest.trim().parse::<f64>() {
                if v.is_finite() && v > 0.0 {
                    return Ok(v);
                }
            }
        }
    }
    Ok(fb)
}

/// Chỉ số màu trung bình của một tệp, dùng cho nút "Cải thiện tự động".
///
/// `signalstats` in ra số đo từng khung, `metadata=print` ghi chúng ra stdout
/// dưới dạng `lavfi.signalstats.TEN=GIÁ_TRỊ`; ở đây chỉ lấy trung bình.
#[tauri::command]
fn do_mau_trung_binh(path: String) -> Result<[f64; 3], String> {
    let goc = do_mau_nguon(&path, None)?;
    let mut bu = cau_mau_tu_dong(goc.0, goc.1, goc.2);
    // Vòng đầu chỉ là ước lượng vì `eq` tương tác giữa ba tham số. Áp thử rồi
    // đo lại, dùng tỉ lệ đáp ứng thực tế để bù phần còn thiếu; lặp tối đa ba
    // vòng cho tới khi chỉ số đo được đã gần chuẩn.
    for _ in 0..3 {
        let Ok(do_duoc) = do_mau_nguon(&path, Some(bu)) else {
            break;
        };
        if !(do_duoc.0.is_finite() && do_duoc.1.is_finite() && do_duoc.2.is_finite()) {
            break;
        }
        let thieu = [
            SANG_MUON - do_duoc.0,
            BAO_HOA_MUON - do_duoc.1,
            DO_RONG_MUON - do_duoc.2,
        ];
        if thieu.iter().all(|t| t.abs() < 4.0) {
            break;
        }
        let moi = [
            bu_tiep(thieu[0], bu[0], do_duoc.0 - goc.0),
            bu_tiep(thieu[1], bu[1], do_duoc.1 - goc.1),
            bu_tiep(thieu[2], bu[2], do_duoc.2 - goc.2),
        ];
        if moi == bu {
            break;
        }
        bu = moi;
    }
    Ok([clamp(bu[0], -1.0, 1.0), clamp(bu[1], -1.0, 1.0), clamp(bu[2], -1.0, 1.0)])
}

/// Bù phần chưa đạt: nếu vòng trước đã làm chỉ số dịch `da_doi` khi bù
/// `bu_dau`, thì phần thiếu chia cho tỉ lệ đáp ứng đó. Không đo được tỉ lệ
/// (bù quá nhỏ nên sai số nén video che mất) thì giữ nguyên, vòng sau đo lại.
fn bu_tiep(thieu: f64, bu_dau: f64, da_doi: f64) -> f64 {
    if bu_dau.abs() < 0.05 {
        return bu_dau;
    }
    let ty_le = da_doi / bu_dau;
    if !ty_le.is_finite() || ty_le.abs() < 1e-6 {
        return bu_dau;
    }
    bu_dau + thieu / ty_le
}

/// Đo ba chỉ số màu thô của một tệp: độ sáng trung bình, độ bão hoà trung bình
/// và độ rộng vùng sáng, tất cả trên thang 0..255.
///
/// Khi có `bu` khác 0 thì đo trên bản đã áp bộ lọc `eq` tương ứng, tức là đo
/// kết quả sau khi chỉnh, không phải của tệp gốc.
fn do_mau_nguon(path: &str, bu: Option<[f64; 3]>) -> Result<(f64, f64, f64), String> {
    // `eq` chỉ nhận một số tròn ba chữ số, nên làm tròn đúng như xuất video để
    // chỉ số đo được khớp với hình người dùng sẽ thấy.
    let bo_loc = match bu {
        None => "null".to_string(),
        Some([bs, bb, bt]) => format!(
            "eq=brightness={:.4}:contrast={:.4}:saturation={:.4}",
            clamp(bs, -1.0, 1.0) * 0.4,
            1.0 + clamp(bt, -1.0, 1.0) * 0.8,
            clamp(1.0 + bb, 0.0, 3.0)
        ),
    };
    let output = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(&path)
        .args(["-vf", &format!("{bo_loc},signalstats,metadata=print:file=-")])
        .args(["-f", "null", "-"])
        .output()
        .map_err(|e| format!("Không chạy được ffmpeg: {e}"))?;
    if !output.status.success() {
        return Err("ffmpeg không đọc được tệp".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut tong_sang = 0.0_f64;
    let mut dem_sang = 0usize;
    let mut tong_bao_hoa = 0.0_f64;
    let mut dem_bao_hoa = 0usize;
    let mut tong_cao = 0.0_f64;
    let mut tong_thap = 0.0_f64;
    let mut dem_vung = 0usize;
    for line in text.lines() {
        let Some(rest) = line.split_once("lavfi.signalstats.") else {
            continue;
        };
        let (ten, gia) = match rest.1.split_once('=') {
            Some(p) => p,
            None => continue,
        };
        let Ok(v) = gia.trim().parse::<f64>() else {
            continue;
        };
        match ten {
            "YAVG" => {
                tong_sang += v;
                dem_sang += 1;
            }
            "SATAVG" => {
                tong_bao_hoa += v;
                dem_bao_hoa += 1;
            }
            // `YHIGH` và `YLOW` về cùng số khung nên hiệu hai trung bình chính là
            // độ rộng vùng sáng trung bình.
            "YHIGH" | "YLOW" => {
                if ten == "YHIGH" {
                    tong_cao += v;
                } else {
                    tong_thap += v;
                }
                dem_vung += 1;
            }
            _ => {}
        }
    }
    if dem_sang == 0 {
        return Err("Không đo được độ sáng của tệp".into());
    }
    let do_rong = if dem_vung > 0 {
        (tong_cao - tong_thap) / dem_vung as f64
    } else {
        0.0
    };
    Ok((
        tong_sang / dem_sang as f64,
        tong_bao_hoa / dem_bao_hoa.max(1) as f64,
        do_rong,
    ))
}

/// Độ sáng trung bình mong muốn, 0..255. Lấy hơi dưới 128 vì phần lớn video
/// nhìn dễ chịu hơn khi tối hơn một chút so với trung tính tuyệt đối.
const SANG_MUON: f64 = 118.0;
/// Độ bão hoà trung bình mong muốn, cùng thang 0..255 của `SATAVG`.
const BAO_HOA_MUON: f64 = 118.0;
/// Độ rộng vùng sáng mong muốn (`YHIGH - YLOW`), 0..255.
const DO_RONG_MUON: f64 = 200.0;

/// Tính phần chỉnh đưa màu của clip về gần mức chuẩn.
///
/// Nhận ba chỉ số đo được và trả về đúng ba giá trị trong khoảng -1..1 để cộng
/// vào `Adjust`. Đo đạc tách khỏi chỗ tính để phần tính kiểm thử được bằng số
/// thuần.
///
/// Độ sáng và bão hoà đo trung bình, còn tương phản suy từ độ rộng vùng sáng
/// vì độ rộng cho biết hình đang phẳng hay gắt. Mỗi nhánh bị chặn để một clip
/// lệch màu mạnh không bị kéo quá xa về chuẩn.
fn cau_mau_tu_dong(sang: f64, bao_hoa: f64, do_rong: f64) -> [f64; 3] {
    // `eq=brightness` cộng thêm khoảng 255×0.4 cho mỗi đơn vị `Adjust`.
    let bu_chinh_sang = clamp(
        (SANG_MUON - sang) / 255.0 / 0.4,
        -0.6,
        0.6,
    );
    // `eq=saturation` nhân bão hoà theo hệ số, nên lấy tỉ lệ rồi trừ 1.
    let he_so_bao_hoa = if bao_hoa > 4.0 {
        BAO_HOA_MUON / bao_hoa
    } else {
        1.0
    };
    let bu_chinh_bao_hoa = clamp(he_so_bao_hoa - 1.0, -0.4, 0.5);
    // `eq=contrast` nhân tương phản, và độ rộng vùng sáng cũng nhân theo.
    let he_so_tuong_phan = if do_rong > 20.0 {
        DO_RONG_MUON / do_rong
    } else {
        1.0
    };
    let bu_chinh_tuong_phan = clamp(he_so_tuong_phan - 1.0, -0.4, 0.7);
    [bu_chinh_sang, bu_chinh_bao_hoa, bu_chinh_tuong_phan]
}

/// Độ lớn mẫu tuyệt đối, chuẩn hoá về 0..1.
fn envelope(samples: &[i16], window: usize) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }
    let win = window.max(1);
    samples
        .chunks(win)
        .map(|chunk| {
            let peak = chunk
                .iter()
                .map(|s| s.abs() as f32 / 32768.0)
                .fold(0.0_f32, f32::max);
            peak
        })
        .collect()
}

/// Đường bao âm thanh để vẽ waveform: `buckets` giá trị trong khoảng 0..1.
#[tauri::command]
fn audio_waveform(path: String, buckets: Option<u32>) -> Result<Vec<f32>, String> {
    let buckets = buckets.unwrap_or(600).clamp(16, 4096) as usize;
    let samples = decode_pcm_mono(&path)?;
    if samples.is_empty() {
        return Ok(vec![0.0; buckets]);
    }
    let per = (samples.len() as f64 / buckets as f64).ceil() as usize;
    let peaks = envelope(&samples, per.max(1));
    // Cân bằng theo đỉnh lớn nhất để waveform luôn nhìn rõ.
    let max = peaks.iter().cloned().fold(0.0_f32, f32::max).max(1e-6);
    let out: Vec<f32> = peaks.iter().take(buckets).map(|p| (p / max).min(1.0)).collect();
    Ok(out)
}

/// Phát hiện nhịp đơn giản: năng lượng cửa sổ trượt, đỉnh nổi lên rõ rệt so với
/// trung bình cục bộ. Trả về các mốc thời gian (giây).
#[tauri::command]
fn detect_beats(path: String, sensitivity: Option<f32>) -> Result<Vec<f64>, String> {
    let samples = decode_pcm_mono(&path)?;
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let sample_rate = 8000.0_f64;
    let hop = 256usize; // 32ms
    let window = 512usize; // 64ms
    let levels: Vec<f32> = samples
        .windows(window)
        .step_by(hop)
        .map(|w| {
            let sum: f32 = w.iter().map(|s| (*s as f32 / 32768.0).abs()).sum();
            sum / w.len() as f32
        })
        .collect();
    if levels.len() < 4 {
        return Ok(Vec::new());
    }

    // Trung bình trượt theo cửa sổ ~1 giây.
    let local_window = 32usize;
    let mut beats: Vec<f64> = Vec::new();
    let sensitivity = sensitivity.unwrap_or(0.5).clamp(0.05, 2.0);
    let min_gap_frames = ((0.28_f64 * sample_rate) / hop as f64) as usize;
    let mut last_beat = 0usize;

    for i in 1..levels.len() - 1 {
        let from = i.saturating_sub(local_window);
        let local_mean = levels[from..=i].iter().sum::<f32>() / (i - from + 1) as f32;
        if levels[i] <= levels[i - 1] || levels[i] < levels[i + 1] {
            continue;
        }
        if levels[i] < local_mean * (1.0 + sensitivity) {
            continue;
        }
        if beats.is_empty() && levels[i] < 0.05 {
            continue;
        }
        if i < last_beat + min_gap_frames {
            continue;
        }
        beats.push(i as f64 * hop as f64 / sample_rate);
        last_beat = i;
    }
    Ok(beats)
}

/// Đường dẫn bản nháp tự lưu, nằm trong thư mục dữ liệu của ứng dụng.
///
/// Dùng một tệp cố định để lúc khởi động luôn biết đọc từ đâu, không cần người
/// dùng chọn tệp. Trả về rỗng khi chạy ngoài Tauri (ví dụ trong kiểm thử).
#[tauri::command]
fn draft_path(app: tauri::AppHandle) -> Option<String> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("ban-nhap.json").to_string_lossy().to_string())
}

/// Một dự án từng được mở, dùng cho danh sách "gần đây".
#[derive(serde::Serialize, serde::Deserialize)]
struct RecentProject {
    path: String,
    ten: String,
}

/// Đọc danh sách dự án mở gần đây, mới nhất trước.
/// Kiểm tra tệp có dòng âm thanh hay không.
///
/// Không có dòng tiếng thì không được tham chiếu `[i:a]` trong filtergraph,
/// nếu không ffmpeg báo lỗi và cả dự án không xuất được. Hỏng ffprobe thì coi
/// như có tiếng để không âm thầm làm mất tiếng.
#[tauri::command]
fn has_audio_stream(path: String) -> bool {
    let ra = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", "a"])
        .args(["-show_entries", "stream=codec_type"])
        .args(["-of", "csv=p=0"])
        .arg(&path)
        .output();
    match ra {
        Ok(o) => !String::from_utf8_lossy(&o.stdout).trim().is_empty(),
        Err(_) => true,
    }
}

#[tauri::command]
fn recent_projects(app: tauri::AppHandle) -> Vec<RecentProject> {
    let Some(dir) = app.path().app_data_dir().ok() else {
        return Vec::new();
    };
    let duong_dan = dir.join("mo-gan-nay.json");
    let Ok(noi_dung) = fs::read_to_string(&duong_dan) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<RecentProject>>(&noi_dung).unwrap_or_default()
}

/// Ghi một dự án vào danh sách gần đây, dồn lên đầu và giữ tối đa 10 mục.
#[tauri::command]
fn recent_push(app: tauri::AppHandle, path: String, ten: String) -> Vec<RecentProject> {
    let Ok(dir) = app.path().app_data_dir() else {
        return Vec::new();
    };
    let _ = fs::create_dir_all(&dir);
    let duong_dan = dir.join("mo-gan-nay.json");
    let mut danh_sach: Vec<RecentProject> = fs::read_to_string(&duong_dan)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    danh_sach.retain(|p| p.path != path);
    danh_sach.insert(0, RecentProject { path, ten });
    danh_sach.truncate(10);
    if let Ok(chuoi) = serde_json::to_string(&danh_sach) {
        let _ = fs::write(&duong_dan, chuoi);
    }
    danh_sach
}

/// Xoá một mục khỏi danh sách gần đây (tệp đã bị xoá hoặc di chuyển).
#[tauri::command]
fn recent_remove(app: tauri::AppHandle, path: String) -> Vec<RecentProject> {
    let Ok(dir) = app.path().app_data_dir() else {
        return Vec::new();
    };
    let duong_dan = dir.join("mo-gan-nay.json");
    let mut danh_sach: Vec<RecentProject> = fs::read_to_string(&duong_dan)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    danh_sach.retain(|p| p.path != path);
    if let Ok(chuoi) = serde_json::to_string(&danh_sach) {
        let _ = fs::write(&duong_dan, chuoi);
    }
    danh_sach
}

/// Ghi nội dung dự án ra tệp (chỉ một tệp văn bản, không phải lưu video).
#[tauri::command]
fn save_project(path: String, data: String) -> Result<String, String> {
    fs::write(&path, data).map_err(|e| format!("Không ghi được tệp dự án: {e}"))?;
    Ok(path)
}

/// Đọc nội dung dự án từ tệp.
#[tauri::command]
fn load_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Không đọc được tệp dự án: {e}"))
}

/// Lấy các khung hình làm ảnh nhỏ cho clip trên timeline.
///
/// CapCut vẽ dải thumbnail dọc theo clip. Ta trả về một dải PNG ngang gộp
/// `count` khung, rồi frontend cắt ra bằng CSS nên chỉ cần gọi ffmpeg một lần.
#[tauri::command]
fn clip_thumbnails(path: String, seek_to: f64, duration: f64, count: u32, height: u32) -> Result<String, String> {
    let count = count.clamp(1, 24);
    let height = height.clamp(24, 240);
    // Vị trí lấy mẫu: rải đều trong clip, nhưng bỏ qua đoạn cuối quá ngắn.
    let span = duration.max(0.1);
    let mut seeks: Vec<f64> = Vec::new();
    let mut filters: Vec<String> = Vec::new();
    for i in 0..count {
        seeks.push(seek_to + span * (i as f64 + 0.5) / count as f64);
        filters.push(format!(
            "[{i}:v]scale=-1:{height},setsar=1,format=rgba[th{i}]"
        ));
    }
    let list: Vec<String> = (0..count).map(|i| format!("[th{i}]")).collect();
    let strip = temp_path(&format!("thumbs_{}.png", std::process::id()));
    let graph = format!(
        "{};{}hstack=inputs={count}[out]",
        filters.join(";"),
        list.join("")
    );
    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y").arg("-nostdin").arg("-v").arg("error");
    // Mỗi mốc thời gian cần một input riêng để `hstack` ghép được.
    for at in &seeks {
        cmd.arg("-ss")
            .arg(format!("{at:.3}"))
            .arg("-i")
            .arg(&path);
    }
    cmd.arg("-filter_complex")
        .arg(&graph)
        .arg("-map")
        .arg("[out]")
        .arg("-frames:v")
        .arg("1")
        .arg(&strip);
    let result = cmd.output().map_err(|e| format!("Không chạy được ffmpeg: {e}"))?;
    if !result.status.success() {
        let tail = String::from_utf8_lossy(&result.stderr);
        let last: Vec<&str> = tail.lines().rev().take(4).collect();
        return Err(format!("Lấy thumbnail lỗi:\n{}", last.join("\n")));
    }
    Ok(strip.to_string_lossy().to_string())
}

/// Ghi lớp chữ/sticker (PNG base64) ra file tạm, trả về đường dẫn.
#[tauri::command]
fn save_overlay_image(name: String, base64_data: String) -> Result<String, String> {
    use base64::Engine;
    let path = temp_path(&format!("{name}.png"));
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.split(',').next_back().unwrap_or(&base64_data))
        .map_err(|e| format!("PNG không hợp lệ: {e}"))?;
    fs::write(&path, bytes).map_err(|e| format!("Không ghi được file tạm: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_video(req: ExportRequest) -> Result<String, String> {
    if req.clips.is_empty() {
        return Err("Không có clip nào để xuất".into());
    }
    // Timeline có thể lưu clip theo thứ tự khác (kéo thả, thêm xen kẽ), nên
    // sắp lại theo thời gian trước khi tính các lát cắt.
    let mut clips = req.clips.clone();
    clips.sort_by(|a, b| {
        a.start
            .partial_cmp(&b.start)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let w = req.width.unwrap_or(1280);
    let h = req.height.unwrap_or(720);
    let h = req.height.unwrap_or(720);
    let fps = req.fps.unwrap_or(30);

    // Clip đảo ngược phải đọc hết rồi ghi ra tệp tạm, vì bộ lọc `reverse` của
    // ffmpeg cần toàn bộ khung hình trong bộ nhớ.
    let mut tam_dao_nguoc: Vec<PathBuf> = Vec::new();
    for (i, clip) in clips.iter_mut().enumerate() {
        if !clip.reverse || clip.is_image() || clip.duration <= 0.05 {
            continue;
        }
        let span = clip.duration * clip.speed.unwrap_or(1.0).max(0.05);
        let out = temp_path(&format!("dao_nguoc_{}_{}.mp4", std::process::id(), i));
        let result = Command::new("ffmpeg")
            .arg("-y")
            .arg("-nostdin")
            .arg("-v")
            .arg("error")
            .arg("-ss")
            .arg(clip.seek_to.unwrap_or(0.0).to_string())
            .arg("-t")
            .arg(span.to_string())
            .arg("-i")
            .arg(&clip.path)
            .arg("-vf")
            .arg(format!(
                "scale={w}x{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps={fps},reverse"
            ))
            .arg("-c:v")
            .arg("libx264")
            .arg("-crf")
            .arg("18")
            .arg("-c:a")
            .arg("aac")
            .arg(&out)
            .output();
        match result {
            Ok(r) if r.status.success() => {
                clip.path = out.to_string_lossy().to_string();
                clip.seek_to = Some(0.0);
                // Tệp đã nén sẵn về khung, đừng co giãn và đổi tốc độ lần nữa.
                clip.speed = Some(1.0);
                tam_dao_nguoc.push(out);
            }
            Ok(r) => {
                let tail = String::from_utf8_lossy(&r.stderr);
                let lines: Vec<&str> = tail.lines().rev().take(4).collect();
                return Err(format!("Không đảo ngược được clip:\n{}", lines.join("\n")));
            }
            Err(e) => return Err(format!("Không chạy được ffmpeg: {e}")),
        }
    }
    let crf = match req.quality.as_deref() {
        Some("low") => "28",
        Some("high") => "18",
        _ => "23",
    };

    let mut cmd = Command::new("ffmpeg");
    // Không đọc stdin: tránh treo khi ffmpeg chạy nền hoặc trong test.
    cmd.arg("-y").arg("-nostdin");

    for clip in &clips {
        // `speed` nén/nới thời gian bằng `setpts`, nên phải đọc nhiều nguồn hơn
        // rồi mới nén lại cho đúng `duration` giây trên timeline.
        // Đường cong tốc độ làm độ dài nguồn cần đọc thay đổi theo từng thời điểm,
        // nên phải lấy theo tốc độ trung bình thay vì nhân với `speed` cố định.
        let source_span = match duong_cong_toc_do(clip) {
            Some((dai, diem)) => dai * toc_do_trung_binh(dai, &diem),
            None => clip.duration * clip.speed.unwrap_or(1.0).max(0.05),
        };
        // Ảnh phải lặp vô hạn để có đủ dòng hình trong bộ dài của clip.
        if clip.is_image() {
            cmd.arg("-loop").arg("1").arg("-t").arg(source_span.to_string());
        } else {
            cmd.arg("-ss")
                .arg(clip.seek_to.unwrap_or(0.0).to_string())
                .arg("-t")
                .arg(source_span.to_string());
        }
        cmd.arg("-i").arg(&clip.path);
    }

    let live_texts: Vec<&ImageLayer> = req
        .texts
        .iter()
        .filter(|l| PathBuf::from(&l.image_path).exists())
        .collect();
    for layer in &live_texts {
        cmd.arg("-loop")
            .arg("1")
            .arg("-t")
            .arg(layer.duration.to_string())
            .arg("-i")
            .arg(&layer.image_path);
    }

    let live_audios: Vec<&AudioTrack> = req
        .audios
        .iter()
        .filter(|a| !a.muted && PathBuf::from(&a.path).exists())
        .collect();
    for audio in &live_audios {
        cmd.arg("-t")
            .arg(audio.duration.to_string())
            .arg("-i")
            .arg(&audio.path);
    }

    let text_input_base = clips.len();
    let audio_input_base = text_input_base + live_texts.len();

    let mut graph = String::new();

    // --- Dựng video theo lát cắt thời gian ---
    //
    // Timeline cho phép khoảng trống và clip chồng nhau (nhiều lớp), nên không
    // thể dùng `concat` thẳng. Ta chia timeline thành các lát giữa hai mốc thời
    // gian (đầu/cuối clip, đầu/cuối cửa sổ chuyển cảnh). Trong mỗi lát, tập clip
    // đang chạy là cố định nên chỉ cần vẽ đè lên nền đen rồi ghép các lát lại.
    //
    // Cách này xử lý được cả ba trường hợp: khoảng trống (lát không clip -> đen),
    // chồng lấn (vẽ đè nhiều lớp) và chuyển cảnh (lát giao nhau dùng `xfade`).
    let mut marks: Vec<f64> = vec![0.0];
    for clip in &clips {
        marks.push(clip.start.max(0.0));
        marks.push(clip.start + clip.duration);
    }
    let mut edges: Vec<(usize, usize, &'static str, f64)> = Vec::new();
    for i in 0..clips.len().saturating_sub(1) {
        if let Some(kind) = transition_kind(&clips[i]) {
            let td = transition_duration(&clips[i], &clips[i + 1]);
            if td > 0.001 {
                let left = clips[i].start + clips[i].duration;
                let right = clips[i + 1].start;
                if (left - right).abs() < 0.05 {
                    edges.push((i, i + 1, kind, td));
                    marks.push(left);
                    marks.push(right);
                }
            }
        }
    }
    let total_duration = req
        .clips
        .iter()
        .map(|c| c.start + c.duration)
        .fold(0.0_f64, f64::max);
    marks.push(total_duration);
    marks.retain(|m| *m >= -0.001 && *m <= total_duration + 0.001);
    marks.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    marks.dedup_by(|a, b| (*a - *b).abs() < 0.004);

    let mut slice_labels: Vec<String> = Vec::new();
    for s in 0..marks.len().saturating_sub(1) {
        let t0 = marks[s];
        let t1 = marks[s + 1];
        let len = t1 - t0;
        if len <= 0.0005 {
            continue;
        }
        // Các clip đang chạy trong lát này.
        let active: Vec<usize> = (0..clips.len())
            .filter(|i| {
                let c = &clips[*i];
                c.start < t1 - 0.001 && c.start + c.duration > t0 + 0.001
            })
            .collect();

        let label = format!("[sl{s}]");
        if active.is_empty() {
            graph.push_str(&format!(
                "color=c=black:s={w}x{h}:r={fps}:d={len:.3},format=yuv420p{label};"
            ));
            slice_labels.push(label);
            continue;
        }

        // Lát chỉ có hai lớp và trùng cửa sổ chuyển cảnh -> `xfade`.
        if active.len() == 2 {
            let (first, second) = if clips[active[0]].start <= clips[active[1]].start {
                (active[0], active[1])
            } else {
                (active[1], active[0])
            };
            if let Some((_, _, kind, td)) = edges
                .iter()
                .find(|(a, b, _, _)| *a == first && *b == second)
                .copied()
            {
                if (len - td).abs() < 0.02 {
                    let fa = clip_segment(&clips[first], first, t0, t1, w, h, fps, &mut graph);
                    let fb = clip_segment(&clips[second], second, t0, t1, w, h, fps, &mut graph);
                    // Clip đích có keyframe hình ảnh thì áp sau `xfade`, vì lát đi
                    // qua `xfade` nên keyframe của clip không còn tác dụng.
                    if co_keyframe_hinh_anh(&clips[second]) {
                        let giua = format!("[xf{s}]");
                        graph.push_str(&format!(
                            "{fa}{fb}xfade=transition={kind}:duration={td:.3}:offset=0{giua};"
                        ));
                        ap_keyframe_hinh_anh(&clips[second], t0, &giua, &label, &mut graph);
                    } else {
                        graph.push_str(&format!(
                            "{fa}{fb}xfade=transition={kind}:duration={td:.3}:offset=0{label};"
                        ));
                    }
                    slice_labels.push(label);
                    continue;
                }
            }
        }

        // Lát thường: nền đen rồi vẽ đè từng lớp.
        graph.push_str(&format!(
            "color=c=black:s={w}x{h}:r={fps}:d={len:.3}[bg{s}];"
        ));
        let mut cursor = format!("[bg{s}]");
        for (rank, idx) in active.iter().enumerate() {
            let seg = clip_segment(&clips[*idx], *idx, t0, t1, w, h, fps, &mut graph);
            let next = format!("[lx{s}_{rank}]");
            let mode = clips[*idx].mix_mode.as_deref().and_then(map_mix_mode);
            match mode {
                // `blend` bỏ qua alpha nên chỉ dùng cho lớp đục. Cả nền và lớp
                // phải cùng định dạng phẳng trước khi trộn.
                Some(m) => {
                    graph.push_str(&format!(
                        "{cursor}format=gbrp[bgm{s}_{rank}];{seg}format=gbrp[fgm{s}_{rank}];\
                         [bgm{s}_{rank}][fgm{s}_{rank}]blend=all_mode={m}:all_opacity=1{next};"
                    ));
                }
                None => {
                    graph.push_str(&format!("{cursor}{seg}overlay=0:0{next};"));
                }
            }
            cursor = next;
        }
        graph.push_str(&format!("{cursor}format=yuv420p{label};"));
        slice_labels.push(label);
    }

    graph.push_str(&format!(
        "{}concat=n={}:v=1:a=0[basev];",
        slice_labels.concat(),
        slice_labels.len()
    ));

    if let Some(f) = req.filter.as_deref() {
        match f {
            "grayscale" => {
                graph.push_str("[basev]colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3[basev];")
            }
            // `colortemp` không tồn tại trong một số bản ffmpeg; `colortemperature` và
            // `colorbalance` thì có mặt và cho ra màu tương đương.
            "warm" => graph.push_str("[basev]colortemperature=temperature=6500[basev];"),
            "cool" => graph.push_str("[basev]colortemperature=temperature=10000[basev];"),
            "vintage" => {
                graph.push_str("[basev]curves=all='0/0 0.4/0.45 0.75/0.85 1/0.95'[basev];")
            }
            "film" => {
                graph.push_str("[basev]eq=contrast=1.1:saturation=0.85:gamma=0.95[basev];")
            }
            "sepia" => {
                graph.push_str("[basev]colorchannelmixer=.39:.77:.19:0:.35:.69:.17:0:.27:.53:.13:0[basev];")
            }
            "invert" => graph.push_str("[basev]negate[basev];"),
            "noir" => {
                graph.push_str(
                    "[basev]format=gray,eq=contrast=1.6:brightness=-0.05[basev];",
                )
            }
            _ => {}
        }
    }

    // --- Hiệu ứng nhanh toàn video ---
    if let Some(e) = req.effect.as_deref() {
        match e {
            "blur" => graph.push_str("[basev]boxblur=2:1[basev];"),
            // `blend` cần hai nguồn nên phải tách nhãn riêng, không dùng lại
            // nhãn đã vào một bộ lọc khác trong cùng chuỗi.
            "glow" => graph.push_str(
                "[basev]split[efsrc][efblur];[efblur]gblur=sigma=6[efglow];\
                 [efsrc][efglow]blend=all_mode=screen:all_opacity=0.5[basev];",
            ),
            "vhs" => {
                // Trôi màu + nhiễu dòng, gần với hiệu ứng video cũ.
                graph.push_str(
                    "[basev]chromashift=crh=3:cbh=-3:crv=2:cbv=-2,noise=alls=8:allf=t+u[basev];",
                );
            }
            "filmnoise" => graph.push_str("[basev]noise=alls=14:allf=t[basev];"),
            "sharpen" => graph.push_str("[basev]unsharp=5:5:1.2[basev];"),
            "vignette" => graph.push_str("[basev]vignette=angle=PI/3[basev];"),
            "bw" => {
                graph.push_str("[basev]colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3[basev];")
            }
            "invert" => graph.push_str("[basev]negate[basev];"),
            "fade" => {
                // Mờ dần ở đầu và cuối, mỗi bên 0.5 giây.
                graph.push_str(&format!(
                    "[basev]fade=t=in:st=0:d=0.5,fade=t=out:st={:.3}:d=0.5[basev];",
                    (total_duration - 0.5).max(0.0)
                ));
            }
            _ => {}
        }
    }

    // --- Ghép âm thanh ---
    //
    // Không cần chia lát: mỗi clip trễ theo `start` rồi `amix` chồng lên nhau.
    // `amix` tự cắt theo lát cắt đầu-cuối nên khoảng trống và chồng lấn đều
    // đúng; cuối cùng pad/cắt cho khớp tổng thời lượng của timeline.
    //
    // `apad` phải có tham số. Bản không tham số phụ thuộc vào việc luồng vào
    // kết thúc, mà `amix` với `duration=longest` đôi khi không báo hết dữ liệu
    // nên ffmpeg treo vô hạn. Dùng `pad_dur` chứ không phải `whole_dur`: `pad_dur`
    // nói rõ cần thêm bao nhiêu giây, nên luôn đủ cho `atrim` cắt đúng tổng thời
    // lượng, kể cả khi `amix` kết thúc sớm.
    let mut mix_parts: Vec<String> = Vec::new();
    for (i, clip) in clips.iter().enumerate() {
        if clip.muted || clip.is_image() {
            continue;
        }
        // Video không có tiếng vẫn phải đóng góp một đoạn im lặng, nếu không
        // tham chiếu `[i:a]` sẽ làm hỏng filtergraph của cả dự án.
        if !clip.has_audio {
            let mut a = vec![
                "anullsrc=r=48000:cl=stereo".to_string(),
                format!("atrim=0:{:.3}", clip.duration),
                "asetpts=N/SR/TB".into(),
            ];
            let delay_ms = (clip.start * 1000.0).round().max(0.0) as i64;
            if delay_ms > 0 {
                a.push(format!("adelay={delay_ms}|{delay_ms}"));
            }
            graph.push_str(&format!("{}[am{i}];", a.join(",")));
            mix_parts.push(format!("[am{i}]"));
            continue;
        }
        // Có đường cong tốc độ thì ghép âm thanh theo từng lát, vì `atempo` chỉ
        // nhận một hệ số hằng cho mỗi lần chạy.
        if let Some((dai, diem)) = duong_cong_toc_do(clip) {
            let vmin = diem.iter().map(|d| d.1).fold(f64::INFINITY, f64::min);
            let vmax = diem.iter().map(|d| d.1).fold(0.0_f64, f64::max);
            if vmax - vmin > 0.001 {
                ghep_am_toc_do(i, clip, dai, &diem, &mut graph);
                mix_parts.push(format!("[am{i}]"));
                continue;
            }
        }
        let mut a = audio_filter_chain(clip);
        if a.is_empty() {
            a.push("anull".into());
        }
        a.push(format!("atrim=0:{:.3}", clip.duration));
        a.push("asetpts=N/SR/TB".into());
        let delay_ms = (clip.start * 1000.0).round().max(0.0) as i64;
        if delay_ms > 0 {
            a.push(format!("adelay={delay_ms}|{delay_ms}"));
        }
        graph.push_str(&format!("[{i}:a]{}[am{i}];", a.join(",")));
        mix_parts.push(format!("[am{i}]"));
    }
    let audio_count = mix_parts.len();
    if audio_count == 0 {
        graph.push_str(&format!(
            "anullsrc=channel_layout=stereo:sample_rate=48000,\
             atrim=0:{total_duration:.3},asetpts=N/SR/TB[clipa];"
        ));
    } else if audio_count == 1 {
        graph.push_str(&format!(
            "{}apad=pad_dur={total_duration:.3},atrim=0:{total_duration:.3}[clipa];",
            mix_parts.concat()
        ));
    } else {
        graph.push_str(&format!(
            "{}amix=inputs={audio_count}:duration=longest:normalize=0,\
             apad=pad_dur={total_duration:.3},atrim=0:{total_duration:.3}[clipa];",
            mix_parts.concat()
        ));
    }

    // --- Trộn nhạc nền ---
    let mut mix_inputs = String::from("[clipa]");
    for (j, audio) in live_audios.iter().enumerate() {
        let idx = audio_input_base + j;
        let vol = clamp(audio.volume.unwrap_or(1.0), 0.0, 2.0);
        let delay_ms = (audio.start * 1000.0).round() as i64;
        graph.push_str(&format!(
            "[{idx}:a]volume={vol:.3},adelay={delay_ms}|{delay_ms}[bg{j}];"
        ));
        mix_inputs.push_str(&format!("[bg{j}]"));
    }
    let mix_count = 1 + live_audios.len();
    // `amix` với `inputs=1` thừa vì cắt bớt dữ liệu, mà chính nó làm âm thanh
    // bị cụt (ffmpeg đôi khi chấm dừng sớm). Không có nhạc nền thì nối thẳng.
    if live_audios.is_empty() {
        graph.push_str("[clipa]anull[outa];");
    } else {
        graph.push_str(&format!(
            "{mix_inputs}amix=inputs={mix_count}:duration=longest:normalize=0[outa];"
        ));
    }

    // --- Dán lớp chữ / nhãn dán ---
    //
    // Biến thời gian `T` của luồng lớp chữ trùng với dòng thời của video, nên
    // mọi biểu thức hiệu ứng đều phải trừ `layer.start` mới ra đúng thời gian
    // tính từ lúc lớp chữ xuất hiện.
    let mut cursor = String::from("[basev]");
    let mut placed = 0usize;
    for layer in live_texts.iter() {
        let idx = text_input_base + placed;
        placed += 1;
        let x = ((layer.x / 100.0) * w as f64 - 100.0).round() as i64;
        let y = ((layer.y / 100.0) * h as f64 - 100.0).round() as i64;
        let bt = layer.animation.as_deref().unwrap_or("");
        let d = clamp(
            layer.animation_duration.unwrap_or(0.6),
            0.05,
            (layer.duration * 0.9).max(0.05),
        );
        // Mỗi bộ lọc dùng tên biến thời gian khác nhau: `geq` nhận `T` (giây theo
        // thời lượng của luồng), còn `rotate` và `overlay` nhận `t` (mốc thời
        // gian trên dòng thời). Hai cái này về đây là một nên dựng sẵn hai chuỗi.
        let p_ge = format!("clip((T-{:.3})/{:.3}\\,0\\,1)", layer.start, d);
        let p_t = format!("clip((t-{:.3})/{:.3}\\,0\\,1)", layer.start, d);
        // Bộ lọc đặt trước khi dán: chỉ có hiệu ứng nào cần mới thêm.
        let mut bo_loc: Vec<String> = vec!["scale=iw:ih".into()];
        let mut xo = x.to_string();
        let mut yo = y.to_string();
        match bt {
            "mo_dan" => bo_loc.push(format!("fade=t=in:st={:.3}:d={d:.3}:alpha=1", layer.start)),
            "dan_may" => {
                bo_loc.push("format=rgba".into());
                bo_loc.push(format!(
                    "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X\\,W*{p_ge})\\,255\\,0)'"
                ));
            }
            "xoay_vao" => {
                // Góc xoay giảm dần về 0 nên chữ từ nghiêng thẳng lại.
                bo_loc.push(format!(
                    "rotate=0.6*(1-{p_t}):ow=rotw(iw):oh=roth(ih):fillcolor=none"
                ));
            }
            "truot_xuong" => yo = format!("{y}-(1-{p_t})*{h}"),
            "truot_len" => yo = format!("{y}+(1-{p_t})*{h}"),
            "truot_phai" => xo = format!("{x}+(1-{p_t})*{w}"),
            "truot_trai" => xo = format!("{x}-(1-{p_t})*{w}"),
            _ => {}
        }
        graph.push_str(&format!(
            "[{idx}:v]{}[layer{placed}];",
            bo_loc.join(",")
        ));
        // `eval=frame` chỉ cần khi toạ độ dán có biểu thức thay đổi theo thời
        // gian, đặt luôn cũng không tốn gì.
        graph.push_str(&format!(
            "{cursor}[layer{placed}]overlay=x='{xo}':y='{yo}':eval=frame:\
             enable='between(t,{:.3},{:.3})'{next};",
            layer.start,
            layer.start + layer.duration,
            next = format!("[ov{placed}]")
        ));
        cursor = format!("[ov{placed}]");
    }

    let video_out = if placed == 0 {
        "[basev]".to_string()
    } else {
        cursor
    };

    graph.push_str(&format!("{video_out}format=yuv420p[outv]"));

    cmd.arg("-filter_complex").arg(&graph);
    cmd.arg("-map").arg("[outv]").arg("-map").arg("[outa]");
    cmd.arg("-c:v").arg("libx264").arg("-crf").arg(crf);
    cmd.arg("-preset").arg("medium");
    cmd.arg("-c:a").arg("aac").arg("-b:a").arg("192k");
    cmd.arg("-movflags").arg("+faststart");
    cmd.arg(&req.output);

    let result = cmd
        .output()
        .map_err(|e| format!("Không chạy được ffmpeg: {e}"))?;
    if !result.status.success() {
        // In chuỗi bộ lọc ra log khi cần dò lỗi: nó dài và không hợp để nhét
        // vào thông báo cho người dùng.
        if std::env::var_os("OPEN_CUTCUT_IN_XUAT").is_some() {
            eprintln!("{graph}");
        }
        let tail = String::from_utf8_lossy(&result.stderr);
        let last: Vec<&str> = tail.lines().rev().take(14).collect();
        return Err(format!("ffmpeg lỗi:\n{}", last.join("\n")));
    }

    for layer in live_texts {
        let _ = fs::remove_file(&layer.image_path);
    }
    for path in &tam_dao_nguoc {
        let _ = fs::remove_file(path);
    }

    Ok(format!("Xuất thành công: {}", req.output))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

// ---------------------------------------------------------------------------
// Kiểm thử
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// Thư mục tạm riêng cho test để không đụng vào tệp người dùng.
    fn thu_muc_test(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("opencutcut_test_{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("tạo thư mục test");
        dir
    }

    fn co_ffmpeg() -> bool {
        Command::new("ffmpeg")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    fn co_ffprobe() -> bool {
        Command::new("ffprobe")
            .arg("-version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Tạo video màu kèm âm thanh, dùng làm đầu vào cho test.
    fn tao_clip(dir: &Path, name: &str, seconds: u32, freq: u32) -> String {
        let path = dir.join(name);
        let status = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-nostdin"])
            .args(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=25"])
            .args(["-f", "lavfi", "-i", &format!("sine=frequency={freq}:sample_rate=48000")])
            .args(["-t", &seconds.to_string(), "-c:v", "libx264", "-crf", "30", "-preset", "ultrafast"])
            .args(["-c:a", "aac", "-shortest"])
            .arg(&path)
            .status()
            .expect("chạy ffmpeg tạo clip");
        assert!(status.success(), "không tạo được clip {name}");
        path.to_string_lossy().to_string()
    }

    /// Tạo video một màu, dùng khi test cần đo màu ở một vị trí xác định.
    ///
    /// `tao_clip` dùng nguồn `testsrc` nhiều màu nên không dùng được khi so
    /// kênh màu để biết lớp nào đang hiện ra.
    fn tao_video_mau(dir: &Path, name: &str, mau: &str, giay: u32) -> String {
        let path = dir.join(name);
        let status = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-nostdin", "-f", "lavfi", "-i"])
            .arg(format!("color=c={mau}:s=320x180:r=25"))
            .args(["-t", &giay.to_string(), "-c:v", "libx264", "-crf", "20"])
            .args(["-preset", "ultrafast"])
            .arg(&path)
            .status()
            .expect("chạy ffmpeg tạo clip màu");
        assert!(status.success(), "không tạo được clip màu {name}");
        path.to_string_lossy().to_string()
    }

    /// Tạo video có chuyển động rõ rệt.
    ///
    /// `testsrc` dùng cho các test khác hầu như đứng yên giữa hai khung, nên
    /// không phân biệt được nội suy khung với lặp khung. `testsrc2` chuyển động
    /// mạnh hơn nên đo được.
    fn tao_clip_chuyen_dong(dir: &Path) -> String {
        let path = dir.join("chuyen_dong.mp4");
        let status = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25"])
            .args(["-f", "lavfi", "-i", "sine=frequency=300:sample_rate=48000"])
            .args(["-t", "4", "-c:v", "libx264", "-crf", "30", "-preset", "ultrafast"])
            .args(["-c:a", "aac", "-shortest"])
            .arg(&path)
            .status()
            .expect("chạy ffmpeg tạo clip chuyển động");
        assert!(status.success(), "không tạo được clip chuyển động");
        path.to_string_lossy().to_string()
    }

    /// Độ dài tệp đã xuất (giây).
    fn do_thoi_luong(path: &str) -> f64 {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "format=duration"])
            .args(["-of", "csv=p=0", path])
            .output()
            .expect("chạy ffprobe");
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse()
            .expect("đọc thời lượng")
    }

    /// Kiểm tra một tệp xuất có đúng thời lượng mong muốn (sai số 0.25s).
    fn kiem_tra_tap(path: &str, can_co: f64, nhan: &str) {
        let thuc_te = do_thoi_luong(path);
        assert!(
            (thuc_te - can_co).abs() < 0.25,
            "{nhan}: thực tế {thuc_te:.3}s, cần {can_co:.3}s"
        );
    }

    fn clip_mau(path: String, bat_dau: f64, do_dai: f64) -> TimelineClip {
        TimelineClip {
            path,
            kind: Some("video".into()),
            start: bat_dau,
            duration: do_dai,
            seek_to: None,
            speed: None,
            volume: None,
            muted: false,
            denoise: None,
            voice_effect: None,
            locked: false,
            adjust: None,
            mix_mode: None,
            crop: None,
            chroma: None,
            mask: None,
            curves: None,
            lut: None,
            keyframes: Vec::new(),
            transition: None,
            transition_duration: None,
            effect: None,
            effect_strong: None,
            reverse: false,
            freeze: false,
            smooth: false,
            has_audio: true,
        }
    }

    fn request(clips: Vec<TimelineClip>, output: &str, w: u32, h: u32) -> ExportRequest {
        ExportRequest {
            clips,
            texts: Vec::new(),
            audios: Vec::new(),
            output: output.into(),
            width: Some(w),
            height: Some(h),
            fps: Some(25),
            filter: None,
            effect: None,
            quality: Some("low".into()),
        }
    }

    /// Xuất video và trả về thông báo (lỗi nếu ffmpeg chạy không thành công).
    fn xuat_hoac_loi(req: ExportRequest) -> String {
        match export_video(req) {
            Ok(msg) => msg,
            Err(e) => panic!("export lỗi: {e}"),
        }
    }

    #[test]
    fn xuất_clip_lien_nhau_giữ_nguyên_thoi_luong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("nhau");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 3, 600);
        let out = dir.join("out.mp4");
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), clip_mau(b, 4.0, 3.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 7.0, "hai clip liền nhau");
    }

    #[test]
    fn xuất_giu_khoang_trong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("trong");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 3, 600);
        let out = dir.join("out.mp4");
        // Clip sau bắt đầu muộn hơn 2s: phải có 2s đen ở giữa.
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), clip_mau(b, 6.0, 3.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 9.0, "khoảng trống");
    }

    #[test]
    fn xuất_clip_chong_lan_linh_ho_cua_tong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("chong");
        let a = tao_clip(&dir, "a.mp4", 6, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        // Clip thứ hai nằm đè lên clip đầu: tổng thời lượng lấy theo mép phải
        // của clip kết thúc muộn nhất (2 + 4 = 6s).
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 6.0), clip_mau(b, 2.0, 4.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 6.0, "clip chồng lấn");
    }

    #[test]
    fn xuất_chuyen_canh_giu_nguyen_tong_thoi_luong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("transition");
        let a = tao_clip(&dir, "a.mp4", 5, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        let mut first = clip_mau(a, 0.0, 5.0);
        first.transition = Some("fade".into());
        first.transition_duration = Some(0.5);
        xuat_hoac_loi(request(
            vec![first, clip_mau(b, 5.0, 4.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        // Chuyển cảnh phải chồng lấn chứ không cắt bớt thời lượng.
        kiem_tra_tap(&out.to_string_lossy(), 9.0, "có chuyển cảnh");
    }

    #[test]
    fn xuất_mix_mode_khong_lam_hong() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("mix");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        let mut top = clip_mau(b, 2.0, 4.0);
        top.mix_mode = Some("screen".into());
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), top],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 6.0, "mix mode");
    }

    #[test]
    fn noi_suy_khung_khong_con_khung_lap() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("noi_suy");
        let nguon = tao_clip_chuyen_dong(&dir);
        let co = dir.join("co.mp4");
        let khong = dir.join("khong.mp4");

        // 0.1×: nguồn 25fps còn 2.5fps, nếu không nội suy thì gần như toàn bộ
        // các khung đều là bản lặp của nhau.
        let mut chay = |ra: &Path, noi_suy: bool| {
            let mut clip = clip_mau(nguon.clone(), 0.0, 2.0);
            clip.speed = Some(0.1);
            clip.smooth = noi_suy;
            xuat_hoac_loi(request(vec![clip], &ra.to_string_lossy(), 320, 180));
            kiem_tra_tap(&ra.to_string_lossy(), 2.0, "nội suy khung");
        };
        chay(&khong, false);
        chay(&co, true);

        // Nguồn chuyển động mạnh: không nội suy thì phần lớn số khung là bản lặp,
        // còn nội suy thì hầu như không còn khung lặp nào.
        let lap_khong = ti_le_khung_trung_lap(&khong.to_string_lossy(), 0.01);
        let lap_co = ti_le_khung_trung_lap(&co.to_string_lossy(), 0.01);
        assert!(
            lap_khong > 30.0,
            "không nội suy mà ít khung lặp ({lap_khong:.1}%) thì phép đo không đáng tin"
        );
        assert!(
            lap_co * 2.0 < lap_khong,
            "có nội suy ({lap_co:.1}%) vẫn cao gần bằng không nội suy ({lap_khong:.1}%)"
        );
    }

    /// Mọi loại chuyển cảnh trong bảng của giao diện phải chạy được thật.
    ///
    /// Danh sách phải khớp `transitions` trong `src/App.tsx` và với `transition_kind`;
    /// lệch một chỗ thì người dùng bấm vào loại đó sẽ không xuất được.
    #[test]
    fn moi_loai_chuyen_canh_trong_bang_deu_chay_duoc() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("tat_ca_chuyen_canh");
        let a = tao_clip(&dir, "a.mp4", 2, 300);
        let b = tao_clip(&dir, "b.mp4", 2, 600);
        let loai = [
            "fade", "fadeblack", "fadewhite", "slideleft", "slideright", "slideup",
            "slidedown", "wipeleft", "wiperight", "smoothleft", "smoothright", "circleopen",
            "circleclose", "radial", "dissolve", "pixelize", "distance", "rectcrop",
            "circlecrop", "vertopen", "vertclose", "horzopen", "horzclose", "smoothup",
            "smoothdown", "hblur", "fadegrays", "fadefast", "fadeslow", "hlslice",
            "hrslice", "vuslice", "vdslice", "wipetl", "wipetr", "wipebl", "wipebr",
            "squeezeh", "squeezev", "zoomin", "diagbl", "diagbr", "hlwind", "hrwind",
            "vuwind", "vdwind", "coverleft", "coverright", "coverup", "coverdown",
            "revealleft", "revealright", "revealup", "revealdown",
        ];
        for id in loai {
            let out = dir.join(format!("{id}.mp4"));
            let mut trai = clip_mau(a.clone(), 0.0, 1.0);
            trai.transition = Some(id.into());
            trai.transition_duration = Some(0.4);
            let mut phai = clip_mau(b.clone(), 1.0, 1.0);
            phai.transition = Some(id.into());
            phai.transition_duration = Some(0.4);
            xuat_hoac_loi(request(vec![trai, phai], &out.to_string_lossy(), 320, 180));
            kiem_tra_tap(&out.to_string_lossy(), 2.0, id);
        }
    }

    #[test]
    fn keyframe_hinh_anh_xuat_duoc_va_ap_duoc_trong_chuyen_canh() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("kf_hinh_anh");
        let a = tao_clip_chuyen_dong(&dir);
        let b = tao_clip_chuyen_dong(&dir);
        let out = dir.join("out.mp4");

        // Clip có keyframe scale đứng một mình: trước đây `scale` thiếu
        // `eval=frame` nên ffmpeg báo lỗi và cả dự án không xuất được.
        let mut don = clip_mau(a.clone(), 0.0, 2.0);
        don.keyframes = vec![
            Keyframe { time: 0.0, prop: "scale".into(), value: 100.0 },
            Keyframe { time: 2.0, prop: "scale".into(), value: 220.0 },
        ];
        xuat_hoac_loi(request(vec![don.clone()], &out.to_string_lossy(), 320, 180));
        kiem_tra_tap(&out.to_string_lossy(), 2.0, "keyframe scale");

        // Cùng keyframe đó nhưng nằm trong vùng chuyển cảnh.
        let mut trai = clip_mau(a, 0.0, 2.0);
        let mut phai = clip_mau(b, 2.0, 2.0);
        phai.transition = Some("fade".into());
        phai.transition_duration = Some(0.5);
        phai.keyframes = vec![
            // Mốc nằm trong cửa sổ chuyển cảnh (2.0 -> 2.5).
            Keyframe { time: 1.5, prop: "scale".into(), value: 100.0 },
            Keyframe { time: 2.5, prop: "scale".into(), value: 220.0 },
            Keyframe { time: 2.5, prop: "opacity".into(), value: 1.0 },
            Keyframe { time: 4.0, prop: "opacity".into(), value: 1.0 },
        ];
        trai.transition = Some("fade".into());
        trai.transition_duration = Some(0.5);
        xuat_hoac_loi(request(
            vec![trai, phai],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 4.0, "keyframe trong chuyển cảnh");
    }

    /// Hoạt ảnh chữ vào phải thật sự chạy khi xuất.
///
/// Đo số pixel sáng trong vùng chữ ở nhiều thời điểm: mỗi kiểu hiệu ứng đều
/// phải đưa chữ từ "chưa hiện" sang "hiện đủ" sau thời lượng khai báo.
#[test]
fn hoat_anh_chu_vao_chay_that_khi_xuat() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("chu_anim");
    let nen = tao_video_mau(&dir, "nen.mp4", "black", 4);

    // Vùng chữ: lớp ảnh 200×60 dán ở (20, 60) trên khung 320×180.
    let dem_sang = |tap: &Path, t: f64| -> usize {
        let raw = Command::new("ffmpeg")
            .args(["-v", "error", "-ss"])
            .arg(format!("{t:.2}"))
            .args(["-i"])
            .arg(tap)
            .args(["-vf", "crop=200:60:20:60,format=gray"])
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
            .output()
            .expect("chạy ffmpeg đếm pixel");
        raw.stdout.iter().filter(|b| **b > 120).count()
    };
    let moc = [1.05f64, 1.4, 1.9, 2.5];

    for loai in ["mo_dan", "dan_may", "xoay_vao"] {
        // Ảnh lớp chữ: nền sáng để dễ đếm, khác hẳn nền đen của video.
        let anh = dir.join(format!("{loai}.png"));
        let ve = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=200x60"])
            .args(["-frames:v", "1"])
            .arg(&anh)
            .status()
            .expect("chạy ffmpeg");
        assert!(ve.success(), "không dựng được ảnh lớp chữ");

        let mut clip = clip_mau(nen.clone(), 0.0, 4.0);
        clip.has_audio = false;
        let out = dir.join(format!("{loai}.mp4"));
        let mut req = request(vec![clip], &out.to_string_lossy(), 320, 180);
        req.texts = vec![ImageLayer {
            image_path: anh.to_string_lossy().to_string(),
            start: 1.0,
            duration: 3.0,
            // Toạ độ tính theo phần trăm, dịch nửa chiều rộng ảnh lớp (100px)
            // nên 37.5% và 88.9% cho vị trí 20px, 60px trên khung 320×180.
            x: 37.5,
            y: 88.9,
            animation: Some(loai.into()),
            animation_duration: Some(1.0),
        }];
        xuat_hoac_loi(req);

        let truoc = dem_sang(&out, 0.5);
        assert_eq!(truoc, 0, "{loai}: trước khi hiện phải không thấy chữ");
        let sau = dem_sang(&out, 2.6);
        assert!(
            sau > 3000,
            "{loai}: cuối hiệu ứng phải hiện đủ chữ, đếm {sau}"
        );
        let giua = dem_sang(&out, 1.4);
        assert!(
            giua < sau,
            "{loai}: giữa hiệu ứng phải chưa hiện hết, đếm {giua}/{sau}"
        );
    }

    // Trượt xuống: vùng ở mép trên của chữ phải sáng dần lên khi chữ trượt vào.
    let anh = dir.join("truot.png");
    let ve = Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=white:s=200x60"])
        .args(["-frames:v", "1"])
        .arg(&anh)
        .status()
        .expect("chạy ffmpeg");
    assert!(ve.success(), "không dựng được ảnh lớp chữ");
    let mut clip = clip_mau(nen.clone(), 0.0, 4.0);
    clip.has_audio = false;
    let out = dir.join("truot.mp4");
    let mut req = request(vec![clip], &out.to_string_lossy(), 320, 180);
    req.texts = vec![ImageLayer {
        image_path: anh.to_string_lossy().to_string(),
        start: 1.0,
        duration: 3.0,
        x: 37.5,
        y: 88.9,
        animation: Some("truot_xuong".into()),
        animation_duration: Some(1.0),
    }];
    xuat_hoac_loi(req);

    let moc_tren = |t: f64| {
        let raw = Command::new("ffmpeg")
            .args(["-v", "error", "-ss"])
            .arg(format!("{t:.2}"))
            .args(["-i"])
            .arg(&out)
            .args(["-vf", "crop=200:14:20:64,format=gray"])
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"])
            .output()
            .expect("chạy ffmpeg");
        raw.stdout.iter().filter(|b| **b > 120).count()
    };
    let _ = moc;
    let dau = moc_tren(1.05);
    let giua = moc_tren(1.4);
    let cuoi = moc_tren(2.6);
    assert_eq!(dau, 0, "đầu hiệu ứng chữ còn trên ngoài khung");
    assert!(
        cuoi > 500,
        "cuối hiệu ứng chữ phải nằm đúng chỗ, đếm {cuoi}"
    );
    assert!(
        giua < cuoi,
        "giữa hiệu ứng chữ còn đang trượt, đếm {giua}/{cuoi}"
    );
}

/// Mặt nạ hình học phải thật sự khoanh vùng khi xuất.
///
/// Clip trên là ảnh một màu, clip dưới là một màu khác: sau khi khoanh, mải
/// hình của clip trên phải lộ ra màu của clip dưới, và chỉ ở giữa vùng khoanh.
#[test]
fn mat_na_hinh_geo_khoanh_dung_vung() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("mask");
    let xanh = tao_video_mau(&dir, "xanh.mp4", "blue", 2);
    let do_net = tao_video_mau(&dir, "do.mp4", "red", 2);

    // Điểm lấy mẫu trên tệp xuất: giữa khung và bốn góc.
    let mau = |tap: &Path, x: i64, y: i64| -> (i32, i32, i32) {
        let raw = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(tap)
            .args(["-vf", &format!("crop=2:2:{x}:{y}")])
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .expect("chạy ffmpeg lấy mẫu");
        (i32::from(raw.stdout[0]), i32::from(raw.stdout[1]), i32::from(raw.stdout[2]))
    };

    // Clip đầu là nền đỏ, clip sau vẽ đè lên nên mới thấy tác dụng của mặt nạ.
    // Hai clip màu không có tiếng nên phải tắt tham chiếu dòng âm thanh.
    let mut duoi = clip_mau(do_net.clone(), 0.0, 2.0);
    duoi.has_audio = false;
    let mut tren = clip_mau(xanh, 0.0, 2.0);
    tren.has_audio = false;
    tren.mix_mode = None;
    tren.mask = Some(Mask {
        kind: "tron".into(),
        center_x: 0.5,
        center_y: 0.5,
        size_x: 0.3,
        size_y: 0.3,
        rotation_degrees: 0.0,
        softness: 0.0,
        ..Default::default()
    });
    let out = dir.join("out.mp4");
    xuat_hoac_loi(request(vec![duoi.clone(), tren], &out.to_string_lossy(), 320, 180));

    let tam = mau(&out, 160, 90);
    let goc = mau(&out, 4, 4);
    // Clip trên màu xanh dương nên kênh xanh (B) hơn kênh đỏ.
    assert!(
        tam.2 > tam.0 + 30,
        "giữa vòng tròn phải còn clip trên, thấy {:?}",
        tam
    );
    // Ngoài vòng tròn lộ nền đỏ nên kênh đỏ hơn kênh xanh.
    assert!(
        goc.0 > goc.2 + 30,
        "ngoài vòng tròn phải lộ nền đỏ, thấy {:?}",
        goc
    );
}

/// Mặt nạ chữ nhật phải theo độ nghiêng và mép mềm cho sẵn.
#[test]
fn mat_na_chu_nhat_theo_goc_va_mep_mem() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("mask2");
    let xanh = tao_video_mau(&dir, "xanh.mp4", "blue", 2);
    let do_net = tao_video_mau(&dir, "do.mp4", "red", 2);

    let mau = |tap: &Path, x: i64, y: i64| -> (i32, i32, i32) {
        let raw = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(tap)
            .args(["-vf", &format!("crop=2:2:{x}:{y}")])
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .expect("chạy ffmpeg lấy mẫu");
        (i32::from(raw.stdout[0]), i32::from(raw.stdout[1]), i32::from(raw.stdout[2]))
    };
    let xanh_hon = |m: (i32, i32, i32)| m.2 > m.0 + 30;

    // Hình chữ nhật nghiêng 45 độ, rộng 0.2 và cao 0.4 khung. Sau khi quay 45
    // độ, góc trên bên phải của hình nằm ở đâu đó dọc theo đường chéo: lấy
    // điểm đối xứng qua tâm để chắc chắn trong, và lấy điểm lệch ra ngoài để
    // chắc chắn ngoài.
    let mut duoi = clip_mau(do_net.clone(), 0.0, 2.0);
    duoi.has_audio = false;
    let mut tren = clip_mau(xanh.clone(), 0.0, 2.0);
    tren.has_audio = false;
    tren.mask = Some(Mask {
        kind: "vuong".into(),
        center_x: 0.5,
        center_y: 0.5,
        size_x: 0.2,
        size_y: 0.4,
        rotation_degrees: 45.0,
        softness: 0.0,
        ..Default::default()
    });
    let out = dir.join("nghien.mp4");
    xuat_hoac_loi(request(vec![duoi.clone(), tren], &out.to_string_lossy(), 320, 180));
    // Nửa cạnh dọc là 0.1*W = 32px và nửa cạnh ngang là 0.2*H = 36px. Với góc
    // quay 45 độ, điểm (160+32*cos45, 90-32*sin45) là góc trên phải, đúng mép.
    let s45 = 0.707_106_78_f64;
    let goc_tren_phai = (160.0 + 32.0 * s45) as i64;
    let trong = (90.0 - 32.0 * s45) as i64;
    // Lùi thêm 12px về tâm thì chắc chắn nằm trong vùng khoanh.
    assert!(
        xanh_hon(mau(&out, goc_tren_phai - 12, trong + 12)),
        "điểm lùi về tâm phải còn clip trên"
    );
    // Vọt ra ngoài 12px thì chắc chắn đã ra khỏi vùng khoanh.
    assert!(
        !xanh_hon(mau(&out, goc_tren_phai + 12, trong - 12)),
        "điểm vọt ra ngoài phải lộ nền đỏ"
    );

    // Mép mềm: cùng hình chữ nhật nhưng có vùng chuyển tiếp, điểm ngay ngoài
    // mép phải ra màu trộn giữa hai lớp chứ không còn thuần một màu.
    let mut mem = clip_mau(xanh.clone(), 0.0, 2.0);
    mem.has_audio = false;
    mem.mask = Some(Mask {
        kind: "vuong".into(),
        center_x: 0.5,
        center_y: 0.5,
        size_x: 0.3,
        size_y: 0.3,
        rotation_degrees: 0.0,
        softness: 30.0,
        ..Default::default()
    });
    let out2 = dir.join("mem.mp4");
    xuat_hoac_loi(request(vec![duoi, mem], &out2.to_string_lossy(), 320, 180));
    // Quét ngang qua mép phải để tìm điểm chuyển tiếp: vùng mềm phải cho ra
    // màu trộn, tức có cả kênh đỏ và kênh xanh. Không đoán vị trí vì bề rộng vùng
    // chuyển tiếp phụ thuộc cách chia của ffmpeg.
    let mut thay = Vec::new();
    for x in 150..260 {
        let m = mau(&out2, x, 90);
        if m.0 > 20 && m.2 > 20 {
            thay.push(x);
        }
    }
    assert!(
        !thay.is_empty(),
        "mép mềm phải ra vùng màu trộn, không thấy ở dải ngang nào"
    );
    // Vùng trộn phải liền mạch, không lấm tấm: số điểm liên tiếp phải dài.
    let lien = thay.windows(2).all(|c| c[1] - c[0] == 1);
    assert!(lien, "vùng trộn bị rách rời: {thay:?}");
}

/// Mặt nạ phải chạy theo dòng thời: cùng một vị trí phải đổi từ trong ra ngoài
/// hoặc ngược lại khi xuất.
#[test]
fn mat_na_chay_theo_dong_thoi() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("mask_anim");
    let xanh = tao_video_mau(&dir, "xanh.mp4", "blue", 4);
    let do_net = tao_video_mau(&dir, "do.mp4", "red", 4);

    // Kênh xanh dương tại một thời điểm: có nghĩa là vùng khoanh đã phủ tới đó.
    let xanh_tai = |tap: &Path, t: f64, x: i64| -> bool {
        let raw = Command::new("ffmpeg")
            .args(["-v", "error", "-ss"])
            .arg(format!("{t:.2}"))
            .args(["-i"])
            .arg(tap)
            .args(["-vf", &format!("crop=2:2:{x}:90")])
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .expect("chạy ffmpeg lấy mẫu");
        i32::from(raw.stdout[2]) > i32::from(raw.stdout[0]) + 30
    };

    let mut duoi = clip_mau(do_net.clone(), 0.0, 4.0);
    duoi.has_audio = false;

    // Bán kính vòng tròn là 0.2/2 chiều rộng = 32px, nên điểm đo lấy cách tâm
    // 26px: nằm trong vòng tròn khi mở hết, nằm ngoài khi co lại.
    // "mo": vòng tròn nở ra, điểm gần mép chưa được phủ ngay đầu rồi được phủ sau.
    let mut mo = clip_mau(xanh.clone(), 0.0, 4.0);
    mo.has_audio = false;
    mo.mask = Some(Mask {
        kind: "tron".into(),
        center_x: 0.5,
        center_y: 0.5,
        size_x: 0.2,
        size_y: 0.2,
        rotation_degrees: 0.0,
        softness: 0.0,
        animation: "mo".into(),
        anim_start: 0.0,
        anim_duration: 2.0,
    });
    let out = dir.join("mo.mp4");
    xuat_hoac_loi(request(vec![duoi.clone(), mo], &out.to_string_lossy(), 320, 180));
    let duong = &out;
    assert!(
        !xanh_tai(duong, 0.1, 186),
        "đầu hiệu ứng, điểm xa tâm phải chưa được phủ"
    );
    assert!(
        xanh_tai(duong, 3.5, 186),
        "cuối hiệu ứng, điểm xa tâm phải được phủ"
    );
    assert!(
        xanh_tai(duong, 3.5, 160),
        "giữa vòng tròn luôn được phủ"
    );

    // "thu": ngược lại, đầu hiệu ứng đã phủ hết rồi mới co lại.
    let mut thu = clip_mau(xanh.clone(), 0.0, 4.0);
    thu.has_audio = false;
    thu.mask = Some(Mask {
        kind: "tron".into(),
        center_x: 0.5,
        center_y: 0.5,
        size_x: 0.2,
        size_y: 0.2,
        rotation_degrees: 0.0,
        softness: 0.0,
        animation: "thu".into(),
        anim_start: 0.0,
        anim_duration: 2.0,
    });
    let out2 = dir.join("thu.mp4");
    xuat_hoac_loi(request(vec![duoi.clone(), thu], &out2.to_string_lossy(), 320, 180));
    let thu_dong = &out2;
    assert!(
        xanh_tai(thu_dong, 0.1, 186),
        "đầu hiệu ứng thu, vùng khoanh phải còn đầy đủ"
    );
    assert!(
        !xanh_tai(thu_dong, 3.5, 186),
        "cuối hiệu ứng thu, điểm xa tâm phải biến mất"
    );

    // "quet_ngang": mép lộ dần từ trái sang, cùng một cột phải đổi theo thời gian.
    let mut quet = clip_mau(xanh.clone(), 0.0, 4.0);
    quet.has_audio = false;
    quet.mask = Some(Mask {
        kind: "tron".into(),
        center_x: 0.5,
        center_y: 0.5,
        size_x: 0.2,
        size_y: 0.2,
        rotation_degrees: 0.0,
        softness: 0.0,
        animation: "quet_ngang".into(),
        anim_start: 0.0,
        anim_duration: 2.0,
    });
    let out3 = dir.join("quet.mp4");
    xuat_hoac_loi(request(vec![duoi, quet], &out3.to_string_lossy(), 320, 180));
    let quet_dong = &out3;
    assert!(
        !xanh_tai(quet_dong, 0.1, 186),
        "đầu quét, mép phải phải chưa lộ"
    );
    assert!(
        xanh_tai(quet_dong, 3.5, 186),
        "cuối quét, mép phải phải lộ"
    );
}

/// Khử tiếng ồn phải thật sự hạ sàn tiếng ổn khi xuất.
///
/// Tệp thử là nửa đầu có tiếng, nửa sau chỉ còn tiếng ổn: đo nửa sau ra sàn tiếng
/// ănng, nếu bộ lọc chạy thì phải thấp hơn bản không khử.
#[test]
fn khua_tieng_on_ha_san_tieng_on() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("khua_on");
    // Nửa đầu: tiếng sine. Nửa sau: chỉ còn tiếng ổn, nên đo nửa sau ra sàn.
    // Làm hai bước cho chắc: dựng âm thanh trước, rồi ghép với ảnh đen.
    let am = dir.join("them_on.m4a");
    let ve = Command::new("ffmpeg")
        .args(["-y", "-v", "error"])
        .args(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:d=3"])
        .args(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=3"])
        .args(["-f", "lavfi", "-i", "anoisesrc=a=0.3:d=6"])
        .args(["-filter_complex", "[0][1]concat=n=2:v=0:a=1[tieng];[tieng][2]amix=inputs=2:normalize=0[outa]"])
        .args(["-map", "[outa]", "-t", "6", "-c:a", "aac"])
        .arg(&am)
        .status()
        .expect("chạy ffmpeg");
    assert!(ve.success(), "không dựng được âm thanh thử");

    let ra = dir.join("them_on.mp4");
    let ve = Command::new("ffmpeg")
        .args(["-y", "-v", "error"])
        .args(["-i"])
        .arg(&am)
        .args(["-f", "lavfi", "-i", "color=c=black:s=320x180:r=25:d=6"])
        .args(["-map", "0:a", "-map", "1:v", "-c:v", "libx264", "-crf", "30"])
        .args(["-preset", "ultrafast", "-shortest"])
        .arg(&ra)
        .status()
        .expect("chạy ffmpeg");
    assert!(ve.success(), "không tạo được tệp thử có tiếng ổn");

    let san = |tap: &Path| -> f64 {
        let r = Command::new("ffmpeg")
            .args(["-v", "info", "-ss", "3", "-i"])
            .arg(tap)
            .args(["-af", "volumedetect", "-f", "null", "-"])
            .output()
            .expect("chạy ffmpeg đo độ lớn");
        let t = String::from_utf8_lossy(&r.stderr);
        for d in t.lines() {
            if let Some(rest) = d.split_once("mean_volume:") {
                let chu = rest.1.trim();
                if let Ok(v) = chu.split_whitespace().next().unwrap_or("").parse::<f64>() {
                    return v;
                }
            }
        }
        0.0
    };

    // Bản không khử làm mốc so sánh.
    let mut khong = clip_mau(ra.to_string_lossy().to_string(), 0.0, 6.0);
    let out_khong = dir.join("khong.mp4");
    xuat_hoac_loi(request(vec![khong], &out_khong.to_string_lossy(), 320, 180));
    // Clip không đổi, chỉ cần đo âm thanh của nó.
    let am_khong = dir.join("khong.m4a");
    let st = Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-i"])
        .arg(&out_khong)
        .args(["-vn", "-c:a", "copy"])
        .arg(&am_khong)
        .status()
        .expect("chạy ffmpeg tách âm thanh");
    assert!(st.success(), "không tách được âm thanh");

    let mut co = clip_mau(ra.to_string_lossy().to_string(), 0.0, 6.0);
    co.denoise = Some(0.8);
    let out_co = dir.join("co.mp4");
    xuat_hoac_loi(request(vec![co], &out_co.to_string_lossy(), 320, 180));
    let am_co = dir.join("co.m4a");
    let st = Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-i"])
        .arg(&out_co)
        .args(["-vn", "-c:a", "copy"])
        .arg(&am_co)
        .status()
        .expect("chạy ffmpeg tách âm thanh");
    assert!(st.success(), "không tách được âm thanh");

    let moc = san(&am_khong);
    let sau = san(&am_co);
    assert!(
        sau < moc - 0.5,
        "sàn tiếng ổn phải thấp hơn: {moc:.1} -> {sau:.1} dB"
    );
}

/// Mười mẫu hiệu ứng giọng nói phải đổi tiếng thật và giữ nguyên độ dài.
///
/// So bằng tỉ lệ đổi dấu: đổi cao độ làm số lần qua mức không đổi nhiều hơn hay
/// ít hơn, đo được cả khi mức tiếng không đổi. Các kiểu không đổi cao độ (vọng,
/// flanger) thì so bằng độ lớn thay vì tỉ lệ đó.
#[test]
fn hieu_ung_giong_doi_tieng_va_giu_do_dai() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("giong");
    // Giọng nói thử: một tiếng trầm rung nhẹ cho giống người.
    let nguon = dir.join("giong.mp4");
    let ve = Command::new("ffmpeg")
        .args(["-y", "-v", "error"])
        .args(["-f", "lavfi", "-i", "sine=frequency=180:sample_rate=48000:d=3"])
        .args(["-f", "lavfi", "-i", "color=c=black:s=320x180:r=25:d=3"])
        .args(["-map", "1:v", "-map", "0:a", "-af", "vibrato=f=6:d=0.4"])
        .args(["-c:v", "libx264", "-crf", "30", "-preset", "ultrafast"])
        .args(["-c:a", "aac", "-shortest"])
        .arg(&nguon)
        .status()
        .expect("chạy ffmpeg");
    assert!(ve.success(), "không tạo được clip tiếng thử");

    let ky_hieu = |tap: &Path| -> (f64, f64) {
        let r = Command::new("ffmpeg")
            .args(["-v", "info", "-i"])
            .arg(tap)
            .args(["-af", "astats=metadata=1", "-f", "null", "-"])
            .output()
            .expect("chạy ffmpeg đo tiếng");
        let t = String::from_utf8_lossy(&r.stderr);
        let mut zc = 0.0_f64;
        let mut rms = 0.0_f64;
        for d in t.lines() {
            if let Some(rest) = d.split_once("Zero crossings rate:") {
                if let Ok(v) = rest.1.trim().parse::<f64>() {
                    zc = v;
                }
            }
            if let Some(rest) = d.split_once("RMS level dB:") {
                if let Ok(v) = rest.1.trim().split_whitespace().next().unwrap_or("").parse::<f64>() {
                    rms = v;
                }
            }
        }
        (zc, rms)
    };
    let do_dai = |tap: &Path| -> f64 {
        let r = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"])
            .arg(tap)
            .output()
            .expect("chạy ffprobe");
        String::from_utf8_lossy(&r.stdout)
            .trim()
            .parse::<f64>()
            .unwrap_or(0.0)
    };

    let muc = |loai: &str| -> (f64, f64) {
        let b = hieu_ung_giong(loai).unwrap_or_else(|| "anull".to_string());
        let am = dir.join(format!("ra_{loai}.m4a"));
        let st = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-i"])
            .arg(&nguon)
            .args(["-af", &b])
            .args(["-vn", "-c:a", "aac"])
            .arg(&am)
            .status()
            .expect("chạy ffmpeg áp hiệu ứng");
        assert!(st.success(), "không áp được hiệu ứng {loai}");
        ky_hieu(&am)
    };
    let moc = muc("");
    let dai_moc = do_dai(&nguon);
    assert!(moc.0 > 0.0 && moc.1 < 0.0, "không đo được tiếng nguồn");

    for loai in [
        "vong", "vong_manh", "mong", "trong", "robot", "radio", "phone", "flanger", "phaser",
    ] {
        let (zc, rms) = muc(loai);
        assert!(
            (zc - moc.0).abs() > 0.0001 || (rms - moc.1).abs() > 0.5,
            "hiệu ứng {loai} không đổi tiếng: {moc:?} -> ({zc}, {rms})"
        );
        // Độ dài không được đổi: lệch quá 5% là tiếng bị trượt khỏi hình.
        let am = dir.join(format!("ra_{loai}.m4a"));
        let d = do_dai(&am);
        assert!(
            (d - dai_moc).abs() < dai_moc * 0.05,
            "hiệu ứng {loai} làm đổi độ dài: {dai_moc:.2} -> {d:.2}"
        );
    }

    // Mỏng và trầm phải đi hai chiều ngược nhau rõ rệt.
    let (zc_mong, _) = muc("mong");
    let (zc_trong, _) = muc("trong");
    assert!(
        zc_mong > moc.0 && zc_trong < moc.0,
        "mỏng phải nhiều lần qua mức hơn gốc, trầm phải ít hơn: {moc:?} -> {zc_mong}, {zc_trong}"
    );
    // Tên lạ thì không ra bộ lọc nào.
    assert!(hieu_ung_giong("khong_co").is_none());

    // Phải qua chính lối xuất: nếu mất dây nối giữa clip và bộ lọc thì hai bản
    // xuất ra sẽ giống hệt nhau, và đây mới là chỗ dễ hỏng.
    let mut thang = clip_mau(nguon.to_string_lossy().to_string(), 0.0, 3.0);
    thang.has_audio = true;
    let out_thang = dir.join("xuat_thang.mp4");
    xuat_hoac_loi(request(vec![thang], &out_thang.to_string_lossy(), 320, 180));

    let mut co = clip_mau(nguon.to_string_lossy().to_string(), 0.0, 3.0);
    co.has_audio = true;
    co.voice_effect = Some("robot".into());
    let out_robot = dir.join("xuat_robot.mp4");
    xuat_hoac_loi(request(vec![co], &out_robot.to_string_lossy(), 320, 180));

    let am_thang = dir.join("xuat_thang.m4a");
    let st = Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-i"])
        .arg(&out_thang)
        .args(["-vn", "-c:a", "copy"])
        .arg(&am_thang)
        .status()
        .expect("chạy ffmpeg tách âm thanh");
    assert!(st.success(), "không tách được âm thanh bản thắng");
    let am_robot = dir.join("xuat_robot.m4a");
    let st = Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-i"])
        .arg(&out_robot)
        .args(["-vn", "-c:a", "copy"])
        .arg(&am_robot)
        .status()
        .expect("chạy ffmpeg tách âm thanh");
    assert!(st.success(), "không tách được âm thanh bản robot");

    let kc = ky_hieu(&am_thang);
    let kr = ky_hieu(&am_robot);
    assert!(
        (kr.0 - kc.0).abs() > 0.0001 || (kr.1 - kc.1).abs() > 0.5,
        "bản xuất với hiệu ứng phải khác bản không có: {kc:?} vs {kr:?}"
    );
    // Độ dài âm thanh hai bản phải khớp nhau.
    let dt = do_dai(&am_thang);
    let dr = do_dai(&am_robot);
    assert!(
        (dt - dr).abs() < 0.05,
        "hiệu ứng không được làm đổi độ dài: {dt:.2} vs {dr:.2}"
    );
}

/// "Cải thiện tự động" phải kéo clip tối và nhạt về gần mức chuẩn.
///
/// Đo bằng `do_mau_trung_binh` trên chính tệp xuất ra, nên đo được cả tác
/// dụng của bộ lọc chứ không chỉ công thức tính.
#[test]
fn cai_thien_tu_dong_keo_mau_ve_gan_chuan() {
    if !co_ffmpeg() || !co_ffprobe() {
        return;
    }
    let dir = thu_muc_test("tu_dong");
    // Clip cố tình tối và nhạt màu.
    let nguon = dir.join("nguon.mp4");
    let ve = Command::new("ffmpeg")
        .args(["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25"])
        .args(["-t", "2", "-vf", "eq=brightness=-0.15:contrast=0.8:saturation=0.5"])
        .args(["-c:v", "libx264", "-crf", "20", "-preset", "ultrafast"])
        .arg(&nguon)
        .status()
        .expect("chạy ffmpeg");
    assert!(ve.success(), "không tạo được clip tối");
    let duong = nguon.to_string_lossy().to_string();

    let (sang, bao_hoa, do_rong) = do_mau_nguon(&duong, None).expect("đo được clip nguồn");
    assert!(sang < 100.0, "clip thử phải tối, đo ra {sang:.1}");
    assert!(bao_hoa < 80.0, "clip thử phải nhạt màu, đo ra {bao_hoa:.1}");

    let [bs, bb, bt] = do_mau_trung_binh(duong.clone()).expect("cải thiện được");
    let _ = do_rong;
    assert!(
        bs > 0.05,
        "hình tối thì phải tăng sáng, tính ra {bs:.3}"
    );
    assert!(
        bb > 0.05,
        "hình nhạt thì phải tăng bão hoà, tính ra {bb:.3}"
    );
    // Clip thử vừa tối vừa phẳng, nên cả ba nhánh đều phải ra số khác 0.
    assert!(bt > 0.0, "hình phẳng thì phải tăng tương phản, tính ra {bt:.3}");

    let mut c = clip_mau(duong.clone(), 0.0, 2.0);
    c.has_audio = false;
    c.adjust = Some(Adjust {
        brightness: bs,
        saturation: bb,
        contrast: bt,
        ..Default::default()
    });
    let out = dir.join("sau.mp4");
    xuat_hoac_loi(request(vec![c], &out.to_string_lossy(), 320, 180));

    let (sang_sau, bao_hoa_sau, _) =
        do_mau_nguon(&out.to_string_lossy(), None).expect("đo được clip sau");
    assert!(
        sang_sau > sang + 15.0,
        "sáng phải lên rõ: {sang:.1} -> {sang_sau:.1}"
    );
    assert!(
        (sang_sau - SANG_MUON).abs() < (sang - SANG_MUON).abs(),
        "sáng phải gần chuẩn hơn: {sang:.1} -> {sang_sau:.1}, chuẩn {SANG_MUON:.0}"
    );
    assert!(
        bao_hoa_sau > bao_hoa + 8.0,
        "bão hoà phải lên rõ: {bao_hoa:.1} -> {bao_hoa_sau:.1}"
    );
}

/// Công thức tự cải thiện: không kéo hình vốn đã đúng, và không kéo quá đà.
#[test]
fn cau_mau_tu_dong_khong_keo_hoi() {
    // Hình đã ở chuẩn thì ra 0.
    let [bs, bb, bt] = cau_mau_tu_dong(SANG_MUON, BAO_HOA_MUON, DO_RONG_MUON);
    assert!(bs.abs() < 0.001 && bb.abs() < 0.001 && bt.abs() < 0.001);
    // Hình sáng quá thì phải giảm sáng.
    let [bs, _, _] = cau_mau_tu_dong(SANG_MUON + 90.0, BAO_HOA_MUON, DO_RONG_MUON);
    assert!(bs < -0.2, "hình quá sáng phải giảm, tính ra {bs:.3}");
    // Mọi nhánh đều bị chặn trong khoảng -1..1.
    for (s, b, d) in [(0.0, 0.0, 0.0), (255.0, 255.0, 255.0), (128.0, 5.0, 25.0)] {
        let [bs, bb, bt] = cau_mau_tu_dong(s, b, d);
        for v in [bs, bb, bt] {
            assert!((-1.0..=1.0).contains(&v), "giá trị ngoài khoảng: {v}");
        }
    }
}

/// Bảng HSL phải đổi đúng dải màu được chọn, không lẫn sang dải khác.
    ///
    /// Đo bằng cách dựng một tệp có sáu mảng màu rõ ràng rồi so màu từng mảng
    /// trước và sau khi xuất.
    #[test]
    fn hsl_doi_dung_dai_mau() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("hsl");
        // Sáu mảng màu nguyên chất, mỗi mảng 107px trên nền tối.
        let mau = dir.join("mau.png");
        let ve = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x202020:s=640x360"])
            .args(["-vf", "drawbox=x=0:y=0:w=107:h=60:color=red:t=fill,\
drawbox=x=107:y=0:w=107:h=60:color=yellow:t=fill,\
drawbox=x=214:y=0:w=107:h=60:color=lime:t=fill,\
drawbox=x=321:y=0:w=107:h=60:color=cyan:t=fill,\
drawbox=x=428:y=0:w=107:h=60:color=blue:t=fill,\
drawbox=x=535:y=0:w=105:h=60:color=magenta:t=fill"])
            .args(["-frames:v", "1"])
            .arg(&mau)
            .status()
            .expect("chạy ffmpeg");
        assert!(ve.success(), "không dựng được ảnh sáu dải màu");

        // Điểm lấy mẫu: giữa từng mải, ngoài vùng viền để tránh nhiễu nén.
        let diem = [53i64, 160, 267, 374, 481, 587];
        let ten_dai = ["do", "vang", "luc", "cyan", "xanh", "tim"];
        let mau_tam = |tap: &Path| -> Vec<(u8, u8, u8)> {
            diem
                .iter()
                .map(|x| {
                    let raw = Command::new("ffmpeg")
                        .args(["-v", "error", "-i"])
                        .arg(tap)
                        .args(["-vf", &format!("crop=2:2:{x}:29")])
                        .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
                        .output()
                        .expect("chạy ffmpeg lấy mẫu màu");
                    let p = raw.stdout;
                    (p[0], p[1], p[2])
                })
                .collect()
        };
        // Video đầu vào: ảnh sáu dải màu kéo dài 2 giây.
        let nguon = dir.join("nguon.mp4");
        let ve = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-loop", "1", "-i"])
            .arg(&mau)
            .args(["-t", "2", "-r", "25", "-c:v", "libx264", "-crf", "20", "-preset", "ultrafast"])
            .arg(&nguon)
            .status()
            .expect("chạy ffmpeg");
        assert!(ve.success(), "không tạo được video nguồn");

        let goc = mau_tam(&mau);
        let do_ = |i: usize| goc[i];

        // Chỉ đổi dải đỏ sang xanh lá: dải đỏ phải đổi, dải xanh dương giữ nguyên.
        let mut don = clip_mau(nguon.to_string_lossy().to_string(), 0.0, 2.0);
        don.has_audio = false;
        don.adjust = Some(Adjust {
            hsl: Hsl {
                do_: DaiMauHsl {
                    hue: 90.0,
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        });
        let out = dir.join("do.mp4");
        xuat_hoac_loi(request(vec![don], &out.to_string_lossy(), 320, 180));
        let khung = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-i"])
            .arg(&out)
            .args(["-vf", "scale=640:360", "-frames:v", "1"])
            .arg(dir.join("sau_do.png"))
            .status()
            .expect("chạy ffmpeg");
        assert!(khung.success());
        let sau = mau_tam(&dir.join("sau_do.png"));
        let lech = |a: (u8, u8, u8), b: (u8, u8, u8)| -> u32 {
            (a.0 as i32 - b.0 as i32).unsigned_abs()
                + (a.1 as i32 - b.1 as i32).unsigned_abs()
                + (a.2 as i32 - b.2 as i32).unsigned_abs()
        };
        assert!(
            lech(do_(0), sau[0]) > 60,
            "dải đỏ không đổi: {:?} -> {:?}",
            do_(0),
            sau[0]
        );
        for i in 1..6 {
            assert!(
                lech(do_(i), sau[i]) < 40,
                "dải {} đổi theo dải đỏ: {:?} -> {:?}",
                ten_dai[i],
                do_(i),
                sau[i]
            );
        }

        // Đổi hai dải khác nhau cùng lúc thì cả hai đều đổi, dải còn lại giữ nguyên.
        let mut hai = clip_mau(nguon.to_string_lossy().to_string(), 0.0, 2.0);
        hai.has_audio = false;
        hai.adjust = Some(Adjust {
            hsl: Hsl {
                vang: DaiMauHsl {
                    // Dải vàng gốc đã chạm đỉnh (255,255,0) nên tăng sáng không
                    // thấy được; giảm sáng mới đo ra rõ.
                    lum: -0.6,
                    ..Default::default()
                },
                xanh: DaiMauHsl {
                    hue: 120.0,
                    ..Default::default()
                },
                ..Default::default()
            },
            ..Default::default()
        });
        let out2 = dir.join("hai_dai.mp4");
        xuat_hoac_loi(request(vec![hai], &out2.to_string_lossy(), 320, 180));
        let khung = Command::new("ffmpeg")
            .args(["-y", "-v", "error", "-i"])
            .arg(&out2)
            .args(["-vf", "scale=640:360", "-frames:v", "1"])
            .arg(dir.join("sau_hai.png"))
            .status()
            .expect("chạy ffmpeg");
        assert!(khung.success());
        let sau2 = mau_tam(&dir.join("sau_hai.png"));
        assert!(lech(do_(1), sau2[1]) > 30, "dải vàng không tối đi");
        assert!(lech(do_(4), sau2[4]) > 60, "dải xanh dương không đổi sắc độ");
        for i in [0, 2, 3, 5] {
            assert!(
                lech(do_(i), sau2[i]) < 40,
                "dải {} bị lẫn: {:?} -> {:?}",
                ten_dai[i],
                do_(i),
                sau2[i]
            );
        }
    }

    /// `apad` không có `whole_dur` làm ffmpeg treo ngẫu nhiên khi đệm âm thanh
    /// bị trộn. Lỗi hiện ra khoảng một phần ba số lần chạy, nên phải lặp lại
    /// mới bắt được; đây chính là cách duy nhất phát hiện được lỗi treo này.
    #[test]
    fn dem_am_thanh_khong_bao_gio_treo() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("khong_treo");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        for lan in 0..6 {
            let out = dir.join(format!("ra{lan}.mp4"));
            let mut tren = clip_mau(b.clone(), 2.0, 4.0);
            tren.mix_mode = Some("screen".into());
            xuat_hoac_loi(request(
                vec![clip_mau(a.clone(), 0.0, 4.0), tren],
                &out.to_string_lossy(),
                320,
                180,
            ));
            kiem_tra_tap(&out.to_string_lossy(), 6.0, &format!("lần {lan}"));
        }
    }

    #[test]
    fn xuất_tat_ca_clip_giu_am_thanh() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("audio");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        // Lặp nhiều lần vì chuỗi bộ lọc âm thanh từng cắt cụt khoảng một nửa
        // (chỉ còn tiếng của clip đầu) ở khoảng 4 phần trăm số lần chạy.
        for lan in 0..4 {
            let out = dir.join(format!("out{lan}.mp4"));
            xuat_hoac_loi(request(
                vec![clip_mau(a.clone(), 0.0, 4.0), clip_mau(b.clone(), 4.0, 4.0)],
                &out.to_string_lossy(),
                320,
                180,
            ));
            // Clip sau bắt buộc còn dòng âm thanh (trước đây bị bỏ mất khi ghép).
            let probe = Command::new("ffprobe")
                .args(["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name"])
                .args(["-of", "csv=p=0", &out.to_string_lossy()])
                .output()
                .expect("chạy ffprobe");
            assert!(
                String::from_utf8_lossy(&probe.stdout).contains("aac"),
                "tệp xuất không có dòng âm thanh"
            );
            // Và âm thanh phải dài bằng video.
            let aout = dir.join(format!("out{lan}.m4a"));
            let status = Command::new("ffmpeg")
                .args(["-y", "-v", "error", "-nostdin", "-i"])
                .arg(&out)
                .args(["-vn", "-c:a", "copy"])
                .arg(&aout)
                .status()
                .expect("chạy ffmpeg");
            assert!(status.success());
            kiem_tra_tap(&aout.to_string_lossy(), 8.0, &format!("âm thanh ghép lần {lan}"));
        }
    }

    #[test]
    fn xuất_clip_tat_tieng_va_clip_anh() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("muted");
        let a = tao_clip(&dir, "a.mp4", 4, 300);
        let b = tao_clip(&dir, "b.mp4", 4, 600);
        let out = dir.join("out.mp4");
        let mut muted = clip_mau(b, 4.0, 4.0);
        muted.muted = true;
        xuat_hoac_loi(request(
            vec![clip_mau(a, 0.0, 4.0), muted],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 8.0, "clip tắt tiếng");
    }

    #[test]
    fn xuất_toc_do_phai_dung_thu_tu_timeline() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("thutu");
        let a = tao_clip(&dir, "a.mp4", 3, 300);
        let b = tao_clip(&dir, "b.mp4", 3, 600);
        let out = dir.join("out.mp4");
        // Truyền vào lộn thứ tự: kết quả phải theo `start`, không theo mảng.
        xuat_hoac_loi(request(
            vec![clip_mau(b, 3.0, 3.0), clip_mau(a, 0.0, 3.0)],
            &out.to_string_lossy(),
            320,
            180,
        ));
        kiem_tra_tap(&out.to_string_lossy(), 6.0, "thứ tự lộn");
    }

    #[test]
    fn atempo_tep_phong_dong_duoc_toc_do() {
        // 4x cần hai bước 2×, 0.25x cần hai bước 0.5×.
        assert_eq!(atempo_chain(4.0), vec!["atempo=2.0", "atempo=2"]);
        assert_eq!(atempo_chain(0.25), vec!["atempo=0.5", "atempo=0.5"]);
        assert_eq!(atempo_chain(1.5), vec!["atempo=1.5"]);
        assert!(atempo_chain(1.0).is_empty());
        // 1.5x chỉ một bước, còn 8x cần ba bước.
        assert_eq!(atempo_chain(1.5).len(), 1);
        assert_eq!(atempo_chain(8.0).len(), 3);
    }

    #[test]
    fn chuyen_canh_bi_cat_theo_clip_ngan() {
        // Transition dài hơn clip thì phải bị cắt vừa, không được âm.
        let short = clip_mau("/tmp/a.mp4".into(), 0.0, 0.2);
        let long = clip_mau("/tmp/b.mp4".into(), 0.2, 5.0);
        let (_, td) = (transition_kind(&short), transition_duration(&short, &long));
        assert!(td > 0.0 && td <= 0.2, "thời lượng chuyển cảnh = {td}");
        // Clip sau bắt đầu âm thì offset không được âm.
        let behind = clip_mau("/tmp/c.mp4".into(), -1.0, 3.0);
        let td2 = transition_duration(&long, &behind);
        assert!(td2 > 0.0 && td2 <= 3.0);
    }

    #[test]
    fn khong_co_chuyen_canh_thi_khong_dung_xfade() {
        let plain = clip_mau("/tmp/a.mp4".into(), 0.0, 3.0);
        assert_eq!(transition_kind(&plain), None);
    }

    #[test]
    fn dao_nguoc_clip_giu_nguyen_do_dai() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("dao_nguoc");
        let clip = tao_clip(&dir, "a.mp4", 4, 300);
        let out = dir.join("out.mp4");
        let mut dao = clip_mau(clip, 0.0, 4.0);
        dao.reverse = true;
        xuat_hoac_loi(request(vec![dao], &out.to_string_lossy(), 320, 180));
        kiem_tra_tap(&out.to_string_lossy(), 4.0, "clip đảo ngược");
        // Tệp tạm phải được dọn sau khi xuất.
        let con_lai: Vec<PathBuf> = std::env::temp_dir()
            .read_dir()
            .map(|d| {
                d.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .map(|n| n.starts_with(&format!("opencutcut_dao_nguoc_{}_", std::process::id())))
                            .unwrap_or(false)
                    })
                    .collect()
            })
            .unwrap_or_default();
        assert!(con_lai.is_empty(), "còn tệp tạm: {con_lai:?}");
    }

    /// Tạo video 6 giây, mỗi giây một màu khác nhau: đỏ, xanh lá, xanh dương,
/// trắng, vàng, tím. Nhờ vậy test tốc độ đổi theo thời gian biết chính xác
/// mốc thời gian nào phải ra màu nào.
fn tao_clip_mau(dir: &Path) -> String {
    let path = dir.join("mau.mp4");
    let mau = ["red", "lime", "blue", "white", "yellow", "magenta"];
    let mut cmd = Command::new("ffmpeg");
    cmd.args(["-y", "-v", "error", "-nostdin"]);
    for m in mau {
        cmd.args(["-f", "lavfi", "-i"])
            .arg(format!("color=c={m}:s=64x64:r=25:d=1"));
    }
    let noi = mau
        .iter()
        .enumerate()
        .map(|(i, _)| format!("[{i}:v]"))
        .collect::<Vec<_>>()
        .join("");
    cmd.args(["-f", "lavfi", "-i"])
        .arg(format!("sine=frequency=440:sample_rate=48000:d=6"));
    cmd.arg("-filter_complex")
        .arg(format!("{noi}concat=n=6:v=1:a=0[v]"))
        .args(["-map", "[v]", "-map", "6:a", "-c:v", "libx264", "-crf", "14", "-preset", "ultrafast"])
        .args(["-c:a", "aac", "-shortest"])
        // 4:4:4 để màu không bị lẫn khi nén, đọc màu ở đầu ra mới tin được.
        .args(["-pix_fmt", "yuv444p"])
        .arg(&path);
    let status = cmd.status().expect("chạy ffmpeg tạo clip màu");
    assert!(status.success(), "không tạo được clip màu");
    path.to_string_lossy().to_string()
}

/// Đọc màu tại tâm một khung hình, trả về (đỏ, xanh lá, xanh dương).
fn mau_tam(path: &str, giay: f64) -> (u8, u8, u8) {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss"])
        .arg(format!("{giay}"))
        .args(["-i"])
        .arg(path)
        .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .output()
        .expect("đọc màu khung hình");
    let a = &out.stdout;
    assert!(a.len() >= 4096, "khung hình quá nhỏ: {} byte", a.len());
    // 64x64: tâm là byte đầu của hàng thứ 32.
    let o = 32 * 64 * 3;
    (a[o], a[o + 1], a[o + 2])
}

/// Chấp nhận màu gần đúng: nén H.264 và sự lệch thời điểm lấy khung khiến
/// giá trị RGB không bao giờ chính xác tuyệt đối.
fn mau_gan(a: (u8, u8, u8), b: (u8, u8, u8)) -> bool {
    a.0.abs_diff(b.0) < 60 && a.1.abs_diff(b.1) < 60 && a.2.abs_diff(b.2) < 60
}

/// Số byte của một khung hình xám, lấy từ chiều rộng × chiều cao.
    fn dem_kich_thuoc_khung(path: &str) -> usize {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-select_streams", "v:0"])
            .args(["-show_entries", "stream=width,height", "-of", "csv=p=0"])
            .arg(path)
            .output()
            .expect("chạy ffprobe");
        let v: Vec<usize> = String::from_utf8_lossy(&out.stdout)
            .trim()
            .split(',')
            .filter_map(|x| x.parse().ok())
            .collect();
        v[0] * v[1]
    }

    /// Phần trăm cặp khung liền nhau gần như giống hệt nhau.
    ///
    /// Giảm tốc mà không nội suy thì ffmpeg chỉ lặp lại khung cũ, nên phần lớn
    /// các cặp khung bằng nhau. Bật `minterpolate` thì hầu như hết cặp nào.
    fn ti_le_khung_trung_lap(path: &str, nguong: f64) -> f64 {
        let kich = dem_kich_thuoc_khung(path);
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(path)
            .args(["-f", "rawvideo", "-pix_fmt", "gray", "-"])
            .output()
            .expect("đọc khung hình");
        let du = out.stdout.len() / kich;
        if du < 2 {
            return 100.0;
        }
        let mut trung = 0usize;
        for i in 0..du - 1 {
            let a = &out.stdout[i * kich..(i + 1) * kich];
            let b = &out.stdout[(i + 1) * kich..(i + 2) * kich];
            if sai_khac(a, b) < nguong {
                trung += 1;
            }
        }
        trung as f64 * 100.0 / (du - 1) as f64
    }

    /// Đếm số khung hình của tệp.
    fn dem_khung(path: &str) -> i64 {
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-count_frames", "-select_streams", "v:0"])
            .args(["-show_entries", "stream=nb_read_frames", "-of", "csv=p=0"])
            .arg(path)
            .output()
            .expect("chạy ffprobe");
        String::from_utf8_lossy(&out.stdout)
            .trim()
            .parse()
            .expect("đếm khung hình")
    }

    /// Đọc thô một khung hình tại mốc `giay`, trả về byte RGB24.
    fn vua_khung(path: &str, giay: f64) -> Vec<u8> {
        let out = Command::new("ffmpeg")
            .args(["-v", "error", "-ss"])
            .arg(format!("{giay}"))
            .args(["-i"])
            .arg(path)
            .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            .output()
            .expect("đọc khung hình");
        assert!(!out.stdout.is_empty(), "không đọc được khung hình tại {giay}s");
        out.stdout
    }

    /// Trung bình sai khác mỗi byte giữa hai khung hình (0 = giống hệt).
    ///
    /// Không so bằng bằng chứng hash: tệp đầu ra đã nén lại bằng H.264 nên
    /// byte bao giờ cũng khác, dù hình thì giống.
    fn sai_khac(a: &[u8], b: &[u8]) -> f64 {
        let n = a.len().min(b.len());
        assert!(n > 0, "khung hình rỗng");
        let tong: u64 = a[..n]
            .iter()
            .zip(&b[..n])
            .map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs() as u64)
            .sum();
        tong as f64 / n as f64
    }

    #[test]
    fn khung_hinh_dung_yen_giu_mot_khung_va_giu_tien() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("khung_dung_yen");
        let nguon = tao_clip(&dir, "a.mp4", 4, 300);
        let out = dir.join("out.mp4");
        let mut clip = clip_mau(nguon.clone(), 0.0, 4.0);
        clip.freeze = true;
        xuat_hoac_loi(request(vec![clip], &out.to_string_lossy(), 320, 180));
        let ra = out.to_string_lossy().to_string();
        kiem_tra_tap(&ra, 4.0, "khung đứng yên");

        // Cả 4 giây phải là cùng một hình tĩnh.
        let dau = vua_khung(&ra, 0.5);
        for giay in [1.5, 2.5, 3.5] {
            assert!(
                sai_khac(&dau, &vua_khung(&ra, giay)) < 1.0,
                "giây {giay} lệch so với giây 0.5, tức hình không đứng yên"
            );
        }

        // Hình giữ phải là khung CUỐI của đoạn, không phải khung đầu.
        let gan_cuoi = sai_khac(&dau, &vua_khung(&nguon, 3.9));
        let xa_dau = sai_khac(&dau, &vua_khung(&nguon, 0.1));
        assert!(
            gan_cuoi < xa_dau,
            "hình giữ giống đầu đoạn ({xa_dau:.2}) hơn cuối đoạn ({gan_cuoi:.2})"
        );

        // Tiếng vẫn chạy: đoạn giữa không được im lặng.
        let do_am = Command::new("ffmpeg")
            .args(["-v", "info", "-i"])
            .arg(&out)
            .args(["-af", "volumedetect", "-f", "null", "-"])
            .output()
            .expect("đo âm lượng");
        let van_ban = String::from_utf8_lossy(&do_am.stderr);
        let tb = van_ban.lines().find_map(|l| {
            let (_, sau) = l.split_once("mean_volume:")?;
            sau.trim().trim_end_matches("dB").trim().parse::<f64>().ok()
        });
        match tb {
            Some(v) => assert!(v > -60.0, "tiếng gần như mất sạch: {v} dB"),
            None => panic!("không đo được âm lượng đầu ra"),
        }
    }

    #[test]
    fn duong_cong_toc_do_nhieu_moc_tren_clip_that() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("toc_do_nhieu_moc");
        let nguon = tao_clip_mau(&dir);
        let out = dir.join("out.mp4");
        let mut clip = clip_mau(nguon.clone(), 0.0, 6.0);
        // Mốc (0s, 1.0x), (4s, 0.75x), (6s, 1.75x): tích tốc độ đúng bằng 6
        // nên đọc hết đúng 6 giây nguồn.
        clip.keyframes = vec![
            Keyframe { time: 0.0, prop: "speed".into(), value: 1.0 },
            Keyframe { time: 4.0, prop: "speed".into(), value: 0.75 },
            Keyframe { time: 6.0, prop: "speed".into(), value: 1.75 },
        ];
        xuat_hoac_loi(request(vec![clip], &out.to_string_lossy(), 64, 64));
        let ra = out.to_string_lossy().to_string();
        kiem_tra_tap(&ra, 6.0, "đường cong nhiều mốc");
        // Thời gian nguồn tích phân từng đoạn: s(o) = o - 0.03125o² cho o<=4,
        // rồi 3.5 + 0.75x + 0.25x² với x = o-4 cho phần còn lại.
        let s = |o: f64| {
            if o <= 4.0 {
                o - 0.03125 * o * o
            } else {
                let x = o - 4.0;
                3.5 + 0.75 * x + 0.25 * x * x
            }
        };
        // Mỗi mốc cách xa ít nhất 0.15 giây so với ranh giới giữa hai màu, vì
        // ranh giới thực tế lệch vài khung hình so với lý thuyết.
        for (giay, mau) in [
            (0.5, "red"),
            (1.5, "lime"),
            (2.5, "blue"),
            (3.6, "white"),
            (4.8, "yellow"),
            (5.6, "magenta"),
        ] {
            let thuc = mau_tam(&ra, giay);
            let can = mau_tam(&nguon, s(giay));
            assert!(
                mau_gan(thuc, can),
                "giây {giay} (nguồn {:.2}s) ra {thuc:?}, cần {can:?} ({mau})",
                s(giay)
            );
        }
    }

    #[test]
    fn duong_cong_toc_do_tuyen_tinh_tren_clip_that() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("toc_do_tuyen_tinh");
        let nguon = tao_clip_mau(&dir);
        let out = dir.join("out.mp4");
        let mut clip = clip_mau(nguon.clone(), 0.0, 6.0);
        // Tốc độ nội suy tuyến tính 0.5× -> 1.5×: thời gian nguồn tích phân là
        // F(o) = 0.5o + o²/12, cho F(6) = 6s vừa đúng độ dài nguồn.
        clip.keyframes = vec![
            Keyframe { time: 0.0, prop: "speed".into(), value: 0.5 },
            Keyframe { time: 6.0, prop: "speed".into(), value: 1.5 },
        ];
        xuat_hoac_loi(request(vec![clip], &out.to_string_lossy(), 64, 64));
        let ra = out.to_string_lossy().to_string();
        kiem_tra_tap(&ra, 6.0, "tốc độ nội suy");
        // F(o) = 0.5o + o²/12 -> mốc thời gian nguồn, rồi đối chiếu màu nguồn.
        let f = |o: f64| 0.5 * o + o * o / 12.0;
        for (giay, mau) in [
            (1.0, "red"),
            (2.0, "lime"),
            (3.0, "blue"),
            (4.0, "white"),
            (5.0, "yellow"),
        ] {
            let thuc = mau_tam(&ra, giay);
            let can = mau_tam(&nguon, f(giay));
            assert!(
                mau_gan(thuc, can),
                "giây {giay} (nguồn {:.2}s) ra {thuc:?}, cần {can:?} ({mau})",
                f(giay)
            );
        }
    }

    #[test]
    fn toan_toc_do_theo_duong_cong() {
        let diem = vec![(0.0, 0.5), (2.0, 2.0)];
        assert!((toc_do_tai(&diem, -1.0) - 0.5).abs() < 1e-9);
        assert!((toc_do_tai(&diem, 1.0) - 1.25).abs() < 1e-9);
        assert!((toc_do_tai(&diem, 3.0) - 2.0).abs() < 1e-9);
        // 2 giây đầu nội suy 0.5× -> 2×, 2 giây sau giữ 2×:
        // tích = 2*(0.5+2)/2 + 2*2 = 6.5, trên 4 giây là 1.625.
        assert!((toc_do_trung_binh(4.0, &diem) - 1.625).abs() < 0.01);
        // Đường cong hằng trả về đúng hệ số đó.
        let phang = vec![(0.0, 1.5), (3.0, 1.5)];
        assert!((toc_do_trung_binh(3.0, &phang) - 1.5).abs() < 1e-9);
        // Mốc ngoài vùng keyframe vẫn giữ tốc độ đầu/cuối.
        let moc = moc_toc_do(&diem, 4.0);
        assert_eq!(moc.first().map(|m| m.0), Some(0.0));
        assert_eq!(moc.last().map(|m| m.0), Some(4.0));
        assert_eq!(moc.last().map(|m| m.1), Some(2.0));
    }

    #[test]
    fn tat_ca_hieu_ung_trong_kho_deu_chay_duoc() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("kho_hieu_ung");
        let clip = tao_clip(&dir, "a.mp4", 3, 300);
        // Danh sách id phải khớp `src/effects.ts`; lệch thì hậu xuất sẽ báo lỗi.
        let ids = [
            "zoom_vao", "zoom_ra", "zoom_3d_vao", "lay", "chop_an", "pho_de", "phim",
            "truyen_anh", "sepia", "vhs", "retro_zoom", "crt", "loa_sieu", "neon",
            "trieu_luong", "mo_man", "doi_mau", "am_bao", "am", "lanh", "hoai_niem", "pixel",
            "khay_mo", "guong", "kaleido", "xoay", "gia_pho", "phat_sang", "lam_mo", "tang_net",
            "vien_toi",
        ];
        for id in ids {
            for manh in [false, true] {
                let mut clip_mau_hieu = clip_mau(clip.clone(), 0.0, 3.0);
                clip_mau_hieu.effect = Some(id.to_string());
                clip_mau_hieu.effect_strong = Some(manh);
                let out = dir.join(format!("{id}{}.mp4", if manh { "-m" } else { "" }));
                xuat_hoac_loi(request(
                    vec![clip_mau_hieu],
                    &out.to_string_lossy(),
                    320,
                    180,
                ));
                kiem_tra_tap(&out.to_string_lossy(), 3.0, &format!("hiệu ứng {id}"));
            }
        }
    }

    #[test]
    fn bo_loc_va_hieu_ung_moi_deu_chay_duoc() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("effects");
        let clip = tao_clip(&dir, "a.mp4", 3, 300);
        let filters = [
            "none",
            "grayscale",
            "warm",
            "cool",
            "vintage",
            "film",
            "sepia",
            "invert",
            "noir",
        ];
        let effects = [
            "none", "blur", "glow", "vhs", "filmnoise", "sharpen", "vignette", "bw", "invert",
            "fade",
        ];
        for (i, f) in filters.iter().enumerate() {
            let out = dir.join(format!("f{i}.mp4"));
            let mut req = request(vec![clip_mau(clip.clone(), 0.0, 3.0)], &out.to_string_lossy(), 320, 180);
            req.filter = Some((*f).to_string());
            xuat_hoac_loi(req);
            kiem_tra_tap(&out.to_string_lossy(), 3.0, &format!("bộ lọc {f}"));
        }
        for (i, e) in effects.iter().enumerate() {
            let out = dir.join(format!("e{i}.mp4"));
            let mut req = request(vec![clip_mau(clip.clone(), 0.0, 3.0)], &out.to_string_lossy(), 320, 180);
            req.effect = Some((*e).to_string());
            xuat_hoac_loi(req);
            kiem_tra_tap(&out.to_string_lossy(), 3.0, &format!("hiệu ứng {e}"));
        }
    }

    #[test]
    fn lay_duoc_dai_thumbnail_cho_clip() {
        if !co_ffmpeg() || !co_ffprobe() {
            return;
        }
        let dir = thu_muc_test("thumbs");
        let clip = tao_clip(&dir, "a.mp4", 4, 300);
        let strip = clip_thumbnails(clip, 0.0, 4.0, 4, 32).expect("lấy thumbnail");
        assert!(PathBuf::from(&strip).exists(), "không tạo được dải {strip}");
        // Dải gồm 4 khung nối ngang nên phải rộng hơn chiều cao.
        let out = Command::new("ffprobe")
            .args(["-v", "error", "-show_entries", "stream=width,height"])
            .args(["-of", "csv=p=0", &strip])
            .output()
            .expect("chạy ffprobe");
        let text = String::from_utf8_lossy(&out.stdout);
        let dims: Vec<i64> = text
            .trim()
            .split(',')
            .map(|v| v.parse().unwrap_or(0))
            .collect();
        assert_eq!(dims.get(1).copied(), Some(32), "chiều cao: {text}");
        assert!(
            dims.first().copied().unwrap_or(0) > 32 * 3,
            "dải phải có nhiều khung: {text}"
        );
        let _ = fs::remove_file(&strip);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            export_video,
            save_overlay_image,
            save_project,
            load_project,
            draft_path,
            has_audio_stream,
            recent_projects,
            recent_push,
            recent_remove,
            clip_thumbnails,
            do_mau_trung_binh,
            probe_media,
            audio_waveform,
            detect_beats
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}