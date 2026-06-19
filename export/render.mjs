// BESTA — Radio → vídeo (render offline determinista)
// Renderiza el primer plano (barras reactivas al audio, cover ken-burns, grain,
// viñeta, textos) en canvas y deja que ffmpeg componga el aftermovie de fondo
// en loop + el audio. Sin PNGs intermedios: los frames se piden por stdin a ffmpeg.
//
// Uso:
//   node render.mjs                      → vertical 1080x1920, 30fps, audio completo
//   node render.mjs --seconds 6          → preview de 6s (para validar el look)
//   node render.mjs --landscape          → 1920x1080
//   node render.mjs --fps 25 --out x.mp4
//
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---------- Args ----------
const argv = process.argv.slice(2);
const getFlag = (n) => argv.includes(`--${n}`);
const getOpt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

const LANDSCAPE = getFlag('landscape');
const FPS = parseInt(getOpt('fps', '30'), 10);
const PREVIEW_SECONDS = getOpt('seconds', null) ? parseFloat(getOpt('seconds', null)) : null;
const W = LANDSCAPE ? 1920 : 1080;
const H = LANDSCAPE ? 1080 : 1920;
const OUT = path.resolve(getOpt('out', path.join(__dirname, 'out', LANDSCAPE ? 'radio-landscape.mp4' : 'radio.mp4')));

const AUDIO = path.join(ROOT, 'assets/audios/BESTA RADIO CASTELLDFELS.m4a');
const BG = path.join(ROOT, 'assets/videos/aftermovie.mp4');
const COVER = path.join(ROOT, 'assets/images/radio/radio-1.jpg');
const LOGO = path.join(ROOT, 'assets/images/besta_color.png');

const SR = 44100;
const FFT_SIZE = 512;
const BINS = FFT_SIZE / 2;        // 256
const SMOOTH = 0.78;              // smoothingTimeConstant de la página
const NUM_BARS = 52;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

// ---------- Colores de la página ----------
const C = {
  accent: 'rgb(219,127,78)',
  radio: 'rgb(244,211,94)',
  fg: 'rgb(245,247,255)',
  muted: 'rgba(245,247,255,0.6)',
};

// ---------- FFT radix-2 in-place ----------
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] = re[a] + vr; im[a] = im[a] + vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// Ventana Blackman (como el AnalyserNode)
const WIN = new Float64Array(FFT_SIZE);
for (let n = 0; n < FFT_SIZE; n++) {
  WIN[n] = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (FFT_SIZE - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (FFT_SIZE - 1));
}

// ---------- Decodificar audio a PCM mono f32 ----------
function decodeAudio() {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', AUDIO, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
    const p = spawn(ffmpegPath, args);
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error('ffmpeg decode exit ' + code));
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4)));
    });
  });
}

// Espectro byte[256] para el frame i (replica getByteFrequencyData)
const prevMag = new Float64Array(BINS);
const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);
function spectrumAtFrame(pcm, i, out) {
  const end = Math.round((i / FPS) * SR);
  const start = end - FFT_SIZE;
  for (let n = 0; n < FFT_SIZE; n++) {
    const idx = start + n;
    const s = (idx >= 0 && idx < pcm.length) ? pcm[idx] : 0;
    re[n] = s * WIN[n];
    im[n] = 0;
  }
  fft(re, im);
  for (let k = 0; k < BINS; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / FFT_SIZE;
    const sm = SMOOTH * prevMag[k] + (1 - SMOOTH) * mag;
    prevMag[k] = sm;
    const db = 20 * Math.log10(sm + 1e-12);
    let b = Math.round((255 * (db + 100)) / 70); // minDb -100, maxDb -30
    out[k] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

// ---------- Helpers de dibujo ----------
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Tiles de grain precomputados (deterministas, se rotan por frame)
function buildGrainTiles(n, size) {
  const tiles = [];
  let seed = 1337;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let t = 0; t < n; t++) {
    const c = createCanvas(size, size);
    const cx = c.getContext('2d');
    const img = cx.createImageData(size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = rnd() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = rnd() * 38;
    }
    cx.putImageData(img, 0, 0);
    tiles.push(c);
  }
  return tiles;
}

function buildVignette() {
  const c = createCanvas(W, H);
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0.85)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, W, H);
  return c;
}

function triWave(t, period) { // 0..1..0 triangular
  const x = (t % period) / period;
  return x < 0.5 ? x * 2 : 2 - x * 2;
}

// ---------- Layout + draw del foreground ----------
function makeRenderer(coverImg, logoImg, grainTiles, vignette) {
  const coverSize = Math.round((LANDSCAPE ? H * 0.5 : W * 0.66));
  const S = coverSize / 360; // tipografía/espaciado proporcionales al cover (ref. página)

  // Stack vertical centrado: pill, marca, estación, cover, barras
  const pillH = Math.round(34 * S);
  const brandH = Math.round(56 * S);
  const stationH = Math.round(20 * S);
  const vizH = Math.round(110 * S);
  const gap = Math.round(28 * S);
  const totalH = pillH + gap + brandH + gap + stationH + gap * 1.4 + coverSize + gap + vizH;
  let y0 = (H - totalH) / 2;

  return function drawFrame(ctx, frameIndex, spec) {
    ctx.clearRect(0, 0, W, H);
    const t = frameIndex / FPS;
    let y = y0;

    // --- ON AIR pill ---
    ctx.save();
    const pillFont = `600 ${Math.round(15 * S)}px Menlo, monospace`;
    ctx.font = pillFont;
    const pillText = 'ON AIR · GRABADO';
    const tw = ctx.measureText(pillText).width;
    const padX = 14 * S, dot = 9 * S, dotGap = 9 * S;
    const pillW = tw + padX * 2 + dot + dotGap;
    const px = (W - pillW) / 2;
    ctx.fillStyle = 'rgba(244,211,94,0.06)';
    ctx.strokeStyle = 'rgba(244,211,94,0.4)';
    ctx.lineWidth = 1 * S;
    roundRect(ctx, px, y, pillW, pillH, pillH / 2);
    ctx.fill(); ctx.stroke();
    // dot parpadeante
    const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos((t / 1.4) * 2 * Math.PI));
    ctx.globalAlpha = blink;
    ctx.fillStyle = C.radio;
    ctx.shadowColor = C.radio; ctx.shadowBlur = 12 * S;
    ctx.beginPath();
    ctx.arc(px + padX + dot / 2, y + pillH / 2, dot / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    ctx.fillStyle = C.radio;
    ctx.textBaseline = 'middle';
    ctx.fillText(pillText, px + padX + dot + dotGap, y + pillH / 2 + 1 * S);
    ctx.restore();
    y += pillH + gap;

    // --- Marca: logo + "en la radio" ---
    const logoH = Math.round(46 * S);
    const logoW = logoImg ? logoH * (logoImg.width / logoImg.height) : 0;
    ctx.save();
    ctx.font = `${Math.round(24 * S)}px Menlo, monospace`;
    ctx.fillStyle = C.muted;
    const enText = 'en la radio';
    const enW = ctx.measureText(enText).width;
    const blockW = logoW + 14 * S + enW;
    const bx = (W - blockW) / 2;
    if (logoImg) {
      ctx.shadowColor = 'rgba(219,127,78,0.35)'; ctx.shadowBlur = 18 * S;
      ctx.drawImage(logoImg, bx, y + (brandH - logoH) / 2, logoW, logoH);
      ctx.shadowBlur = 0;
    }
    ctx.textBaseline = 'middle';
    ctx.fillText(enText, bx + logoW + 14 * S, y + brandH / 2 + 2 * S);
    ctx.restore();
    y += brandH + gap;

    // --- Estación ---
    ctx.save();
    ctx.font = `${Math.round(13 * S)}px Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sFull = 'RÀDIO CASTELLDEFELS · 98.0 FM';
    // medir para colorear "Ràdio Castelldefels" en acento
    const accentPart = 'RÀDIO CASTELLDEFELS';
    const restPart = ' · 98.0 FM';
    const aw = ctx.measureText(accentPart).width;
    const rw = ctx.measureText(restPart).width;
    const startX = (W - (aw + rw)) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.accent;
    ctx.fillText(accentPart, startX, y + stationH / 2);
    ctx.fillStyle = C.muted;
    ctx.fillText(restPart, startX + aw, y + stationH / 2);
    ctx.restore();
    y += stationH + gap * 1.4;

    // --- Cover con ken burns ---
    const cx = (W - coverSize) / 2;
    const cy = y;
    ctx.save();
    roundRect(ctx, cx, cy, coverSize, coverSize, 16 * S);
    ctx.save(); // sombra del marco
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 60 * S; ctx.shadowOffsetY = 24 * S;
    ctx.fillStyle = '#0d0b11';
    ctx.fill();
    ctx.restore();
    ctx.clip();
    if (coverImg) {
      const kb = 1.02 + 0.08 * triWave(t, 44); // 22s ida/vuelta
      const cw = coverSize * kb, ch = coverSize * kb;
      ctx.globalAlpha = 1;
      ctx.filter = 'brightness(0.82) saturate(1.05)';
      ctx.drawImage(coverImg, cx - (cw - coverSize) / 2, cy - (ch - coverSize) / 2, cw, ch);
      ctx.filter = 'none';
    }
    // gradiente inferior
    const cg = ctx.createLinearGradient(0, cy + coverSize * 0.4, 0, cy + coverSize);
    cg.addColorStop(0, 'rgba(0,0,0,0)');
    cg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = cg;
    ctx.fillRect(cx, cy, coverSize, coverSize);
    ctx.restore();

    // borde sutil del cover
    ctx.save();
    roundRect(ctx, cx, cy, coverSize, coverSize, 16 * S);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 * S; ctx.stroke();
    ctx.restore();

    // botón play (con pulso)
    const pr = (LANDSCAPE ? 56 : 64) * S;
    const pcx = W / 2, pcy = cy + coverSize / 2;
    const pulse = 0.5 + 0.5 * Math.cos((t / 2.4) * 2 * Math.PI);
    ctx.save();
    ctx.beginPath(); ctx.arc(pcx, pcy, pr + (6 + pulse * 8) * S, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(219,127,78,${0.10 + pulse * 0.08})`; ctx.fill();
    ctx.beginPath(); ctx.arc(pcx, pcy, pr, 0, 2 * Math.PI);
    ctx.fillStyle = C.accent;
    ctx.shadowColor = 'rgba(219,127,78,0.6)'; ctx.shadowBlur = (40 + pulse * 30) * S;
    ctx.fill(); ctx.shadowBlur = 0;
    // triángulo play
    ctx.fillStyle = '#1a1009';
    const ts = pr * 0.46;
    ctx.beginPath();
    ctx.moveTo(pcx - ts * 0.5 + ts * 0.18, pcy - ts);
    ctx.lineTo(pcx + ts, pcy);
    ctx.lineTo(pcx - ts * 0.5 + ts * 0.18, pcy + ts);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // etiqueta del cover
    ctx.save();
    ctx.font = `${Math.round(10 * S)}px Menlo, monospace`;
    ctx.textBaseline = 'alphabetic';
    const labY = cy + coverSize - 16 * S;
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 6 * S;
    ctx.fillStyle = C.radio;
    ctx.fillText('ENTREVISTA', cx + 16 * S, labY);
    const ew = ctx.measureText('ENTREVISTA').width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(' · RÀDIO CASTELLDEFELS · 98.0 FM', cx + 16 * S + ew, labY);
    ctx.restore();
    y += coverSize + gap;

    // --- Visualizador (barras reactivas) ---
    const vw = coverSize, vx = (W - vw) / 2, vy = y, vhh = vizH;
    const gp = Math.max(2, vw * 0.004);
    const bw = (vw - gp * (NUM_BARS - 1)) / NUM_BARS;
    const midY = vy + vhh / 2;
    const maxHalf = vhh * 0.46;
    for (let i = 0; i < NUM_BARS; i++) {
      const bin = Math.floor((i / NUM_BARS) * BINS * 0.85);
      const value = spec[bin] / 255;
      const halfH = Math.max(2 * S, value * maxHalf);
      const x = vx + i * (bw + gp);
      const g = ctx.createLinearGradient(0, midY - halfH, 0, midY + halfH);
      g.addColorStop(0, `rgba(244,211,94,${0.6 + value * 0.4})`);
      g.addColorStop(0.5, `rgba(219,127,78,${0.7 + value * 0.3})`);
      g.addColorStop(1, `rgba(244,211,94,${0.6 + value * 0.4})`);
      ctx.fillStyle = g;
      roundRect(ctx, x, midY - halfH, bw, halfH * 2, Math.min(bw / 2, 3 * S));
      ctx.fill();
    }

    // --- Grain ---
    const tile = grainTiles[frameIndex % grainTiles.length];
    ctx.save();
    ctx.globalAlpha = 0.32;
    for (let gy = 0; gy < H; gy += tile.height) {
      for (let gx = 0; gx < W; gx += tile.width) {
        ctx.drawImage(tile, gx, gy);
      }
    }
    ctx.restore();

    // --- Viñeta ---
    ctx.drawImage(vignette, 0, 0);
  };
}

// ---------- Main ----------
async function main() {
  console.log(`▶ BESTA radio → vídeo  (${W}x${H} @ ${FPS}fps${PREVIEW_SECONDS ? `, preview ${PREVIEW_SECONDS}s` : ''})`);
  console.log('· Decodificando audio…');
  const pcm = await decodeAudio();
  const audioDur = pcm.length / SR;
  const duration = PREVIEW_SECONDS ? Math.min(PREVIEW_SECONDS, audioDur) : audioDur;
  const totalFrames = Math.floor(duration * FPS);
  console.log(`· Audio: ${audioDur.toFixed(1)}s → renderizando ${totalFrames} frames`);

  const [coverImg, logoImg] = await Promise.all([
    loadImage(COVER).catch(() => null),
    loadImage(LOGO).catch(() => null),
  ]);
  const grainTiles = buildGrainTiles(16, 256);
  const vignette = buildVignette();
  const drawFrame = makeRenderer(coverImg, logoImg, grainTiles, vignette);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // ffmpeg: bg aftermovie loop + fg (pipe) + audio → mp4
  const encArgs = [
    '-y', '-v', 'error', '-stats',
    '-stream_loop', '-1', '-i', BG,
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', 'pipe:0',
    '-i', AUDIO,
    '-filter_complex',
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${FPS},eq=brightness=-0.22:saturation=1.1:contrast=1.05[bg];[bg][1:v]overlay=shortest=1[v]`,
    '-map', '[v]', '-map', '2:a',
    '-t', String(duration),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'veryfast',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    OUT,
  ];
  const enc = spawn(ffmpegPath, encArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    enc.on('error', rej);
    enc.on('close', (code) => code === 0 ? res() : rej(new Error('ffmpeg encode exit ' + code)));
  });

  const spec = new Uint8Array(BINS);
  const t0 = Date.now();
  for (let i = 0; i < totalFrames; i++) {
    spectrumAtFrame(pcm, i, spec);
    drawFrame(ctx, i, spec);
    const buf = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
    if (!enc.stdin.write(buf)) {
      await new Promise((r) => enc.stdin.once('drain', r));
    }
    if (i % 60 === 0 || i === totalFrames - 1) {
      const pct = ((i + 1) / totalFrames * 100).toFixed(1);
      const fpsNow = ((i + 1) / ((Date.now() - t0) / 1000)).toFixed(1);
      process.stdout.write(`\r· frame ${i + 1}/${totalFrames} (${pct}%) — ${fpsNow} fps render   `);
    }
  }
  enc.stdin.end();
  console.log('\n· Codificando audio/vídeo final…');
  await done;
  console.log(`✓ Listo: ${OUT}`);
}

main().catch((e) => { console.error('\n✗ Error:', e); process.exit(1); });
