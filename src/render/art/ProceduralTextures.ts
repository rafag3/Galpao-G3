// Texturas procedurais do mapa: desenhadas por código ao carregar.
// Arte 100% original, sem download e sem licença de terceiros.
//
// Cada gerador produz uma imagem de cor (canvas) e um mapa de altura, do qual
// sai o normal map (relevo que reage à luz). Todas as texturas são contínuas
// nas bordas (tileable), para repetir em superfícies grandes sem emenda.

export interface TexturePair {
  color: HTMLCanvasElement;
  normal: HTMLCanvasElement;
}


// ------------------------------------------------------------------ ruído

/** Hash inteiro → [0, 1). Determinístico: as texturas são sempre iguais. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruído de valor periódico (repete a cada `period` células: tileable). */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash(w(x0), w(y0), seed);
  const b = hash(w(x0 + 1), w(y0), seed);
  const c = hash(w(x0), w(y0 + 1), seed);
  const d = hash(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal (soma de oitavas), em [0, 1]. u, v em [0, 1). */
function fbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u * period, v * period, period, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

// --------------------------------------------------------------- utilidades

type RGB = [number, number, number];

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Ponto da textura → (cor, altura). Altura em [0, 1]. */
type Shader = (u: number, v: number) => { c: RGB; h: number; a?: number };

function render(shader: Shader, normalStrength: number, N = 256): TexturePair {
  const color = document.createElement('canvas');
  color.width = color.height = N;
  const cctx = color.getContext('2d')!;
  const img = cctx.createImageData(N, N);
  const height = new Float32Array(N * N);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const { c, h, a } = shader(x / N, y / N);
      const i = (y * N + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = a === undefined ? 255 : Math.round(clamp01(a) * 255);
      height[y * N + x] = h;
    }
  }
  cctx.putImageData(img, 0, 0);
  return { color, normal: heightToNormal(height, normalStrength, N) };
}

/** Normal map por diferenças finitas (com borda contínua). */
function heightToNormal(h: Float32Array, strength: number, N: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = N;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Distância até a linha mais próxima de uma grade com `count` divisões. */
const gridDist = (t: number, count: number) => {
  const f = (t * count) % 1;
  return Math.min(f, 1 - f) / count;
};

// ---------------------------------------------------------------- texturas

/** Piso de concreto industrial: manchas, juntas de dilatação e rachaduras. */
export function concreteFloor(): TexturePair {
  const base = hex('#7d7b76');
  const dark = hex('#5d5b57');
  const oil = hex('#4a4844');
  return render((u, v) => {
    const n = fbm(u, v, 4, 5, 1);
    const stain = clamp01((fbm(u, v, 2, 4, 9) - 0.55) * 4);
    const grit = hash(Math.floor(u * 512), Math.floor(v * 512), 3) * 0.08;
    // Junta a cada metade da textura (textura = 4 m → junta a cada 2 m)
    const joint = Math.min(gridDist(u, 2), gridDist(v, 2)) < 0.003 ? 1 : 0;
    // Rachadura: faixa estreita onde o ruído cruza um nível
    const crackN = fbm(u + 0.3, v, 3, 5, 21);
    const crack = Math.abs(crackN - 0.5) < 0.0025 && fbm(u, v, 2, 2, 33) > 0.68 ? 1 : 0;
    let c = mix(base, dark, n * 0.6 + grit);
    c = mix(c, oil, stain * 0.55);
    if (joint) c = mix(c, hex('#3a3936'), 0.7);
    if (crack) c = mix(c, hex('#4a4844'), 0.45);
    return { c, h: 0.5 + n * 0.15 - joint * 0.4 - crack * 0.15 };
  }, 2.5, 512);
}

/** Parede de concreto pré-moldado: placas, furos de amarração e escorridos. */
export function concreteWall(): TexturePair {
  const base = hex('#8e8a83');
  const dark = hex('#6c6862');
  return render((u, v) => {
    const n = fbm(u, v, 3, 5, 41);
    const seam = gridDist(u, 2) < 0.002 || gridDist(v, 1) < 0.002;
    // Furos de amarração em grade (como em concreto moldado)
    const hu = (u * 4) % 1;
    const hv = (v * 4) % 1;
    const hole = Math.hypot(hu - 0.5, hv - 0.5) < 0.025;
    // Escorridos verticais de sujeira
    const streak = clamp01((fbm(u * 6, v * 0.5, 4, 3, 47) - 0.6) * 3) * (0.4 + v * 0.6);
    let c = mix(base, dark, n * 0.55 + streak * 0.5);
    if (seam) c = mix(c, hex('#4d4a45'), 0.6);
    if (hole) c = hex('#45423d');
    return { c, h: 0.5 + n * 0.1 - (seam ? 0.35 : 0) - (hole ? 0.4 : 0) };
  }, 2, 512);
}

/** Chapa metálica ondulada (telhado): nervuras e ferrugem. */
export function corrugatedMetal(): TexturePair {
  const steel = hex('#7f8a90');
  const shade = hex('#5c656b');
  const rust = hex('#8a5a3b');
  return render((u, v) => {
    const wave = Math.sin(u * Math.PI * 2 * 16) * 0.5 + 0.5;
    const n = fbm(u, v, 4, 4, 61);
    const r = clamp01((fbm(u, v, 3, 5, 67) - 0.58) * 3.5);
    let c = mix(steel, shade, (1 - wave) * 0.5 + n * 0.25);
    c = mix(c, rust, r * 0.8);
    return { c, h: wave * 0.8 + n * 0.05 };
  }, 4);
}

/** Caixa de madeira: tábuas, moldura, travessa diagonal e pregos. */
export function woodCrate(): TexturePair {
  const wood = hex('#9c7a4e');
  const darkWood = hex('#6f5333');
  const frame = hex('#7e5f39');
  return render((u, v) => {
    const border = 0.11;
    const inFrame = u < border || u > 1 - border || v < border || v > 1 - border;
    // Travessa diagonal
    const diag = Math.abs(u - v) < border * 0.7;
    const plank = Math.floor(v * 5);
    const plankEdge = gridDist(v, 5) < 0.004;
    // Veio: ruído esticado no sentido da tábua
    const grain = fbm(u * 0.3, v * 3 + plank * 0.37, 6, 4, 71 + plank);
    const nail =
      [0.055, 0.945].some((cx) => [0.055, 0.945].some((cy) => Math.hypot(u - cx, v - cy) < 0.012)) ? 1 : 0;
    let c: RGB;
    let h: number;
    if (inFrame || diag) {
      c = mix(frame, darkWood, grain * 0.6);
      h = 0.75 + grain * 0.1;
    } else {
      c = mix(wood, darkWood, grain * 0.7 + (plank % 2) * 0.08);
      h = 0.45 + grain * 0.1 - (plankEdge ? 0.3 : 0);
    }
    if (nail) {
      c = hex('#3b3b3b');
      h = 0.9;
    }
    // Borda escurecida (desgaste)
    const edge = Math.min(u, 1 - u, v, 1 - v);
    c = mix(c, darkWood, clamp01(1 - edge * 30) * 0.5);
    return { c, h };
  }, 3);
}

/** Contêiner: nervuras trapezoidais, ferrugem e arranhões. Neutro: a cor vem do material. */
export function shippingContainer(): TexturePair {
  const paint = hex('#e6e6e6');
  const shade = hex('#a8a8a8');
  const rust = hex('#7a4a2c');
  return render((u, v) => {
    // Perfil trapezoidal: platô / rampa / vale
    const p = (u * 10) % 1;
    const rib = p < 0.35 ? 1 : p < 0.5 ? 1 - (p - 0.35) / 0.15 : p < 0.85 ? 0 : (p - 0.85) / 0.15;
    const n = fbm(u, v, 4, 4, 81);
    const r = clamp01((fbm(u, v, 3, 5, 87) - 0.6) * 3) + clamp01((v - 0.93) * 14) * 0.6; // ferrugem embaixo
    const scratch = Math.abs(fbm(u * 8, v * 0.2, 2, 2, 91) - 0.5) < 0.004 ? 1 : 0;
    let c = mix(paint, shade, (1 - rib) * 0.35 + n * 0.2);
    c = mix(c, rust, clamp01(r) * 0.75);
    if (scratch) c = mix(c, hex('#d8d8d8'), 0.6);
    return { c, h: rib * 0.85 + n * 0.05 };
  }, 4);
}

/** Pilar de aço com faixa de alerta na base. */
export function steelPillar(): TexturePair {
  const steel = hex('#4f565e');
  const shade = hex('#3a4046');
  return render((u, v) => {
    const n = fbm(u, v, 3, 4, 101);
    // v = 1 é a base (o canvas é invertido no envio para a GPU)
    const hazard = v > 0.86;
    let c = mix(steel, shade, n * 0.5);
    if (hazard) {
      const stripe = Math.floor((u * 4 + v * 8) % 2) === 0;
      c = stripe ? hex('#e0a62a') : hex('#1d1d1d');
      c = mix(c, hex('#5a4a30'), n * 0.3);
    }
    const bolt = Math.hypot(u - 0.5, ((v * 6) % 1) - 0.5) < 0.04 && !hazard;
    if (bolt) c = hex('#2e3338');
    return { c, h: 0.5 + n * 0.05 + (bolt ? 0.3 : 0) };
  }, 2);
}

/** Caminhão: lataria vermelha com painéis e sujeira. */
export function truckPaint(): TexturePair {
  const red = hex('#a8382a');
  const dark = hex('#6e2219');
  return render((u, v) => {
    const n = fbm(u, v, 3, 4, 111);
    const panel = gridDist(u, 3) < 0.003 || gridDist(v, 2) < 0.003;
    const dirt = clamp01((v - 0.6) * 2.2) * (0.5 + n * 0.5);
    let c = mix(red, dark, n * 0.4);
    c = mix(c, hex('#4d4235'), dirt * 0.7);
    if (panel) c = mix(c, hex('#3a120d'), 0.7);
    return { c, h: 0.5 + n * 0.05 - (panel ? 0.3 : 0) };
  }, 2);
}

/** Chapa xadrez (rampa). */
export function treadPlate(): TexturePair {
  const steel = hex('#8a9096');
  return render((u, v) => {
    const cu = (u * 16) % 1;
    const cv = (v * 16) % 1;
    const a = (Math.floor(u * 16) + Math.floor(v * 16)) % 2 === 0;
    const d = a ? Math.abs(cu - cv) : Math.abs(cu + cv - 1);
    const bump = d < 0.12 && Math.abs(cu - 0.5) < 0.35 && Math.abs(cv - 0.5) < 0.35 ? 1 : 0;
    const n = fbm(u, v, 4, 3, 121);
    return { c: mix(steel, hex('#5f656b'), n * 0.5 + bump * 0.1), h: bump * 0.8 + n * 0.05 };
  }, 3);
}

/** Pintura amarela de bombsite: hachura gasta, com transparência (o concreto aparece). */
export function siteHatch(): TexturePair {
  const yellow = hex('#e2b13a');
  return render((u, v) => {
    // Faixas finas e gastas: o concreto aparece entre elas
    const stripe = ((u + v) * 6) % 1 < 0.16;
    const wear = fbm(u, v, 6, 4, 131);
    const a = stripe && wear > 0.47 ? 1 : 0;
    return { c: mix(yellow, hex('#a87e2a'), wear * 0.6), h: a * 0.2, a };
  }, 1);
}
