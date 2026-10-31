// Texturas pequenas (128 px) da arma e das mãos em primeira pessoa.

import { clamp01, fbm, gridDist, hash, hex, mix, render, type TexturePair } from './ProceduralTextures';

const SIZE = 128;

/** Polímero preto fosco com textura pontilhada (empunhadura, guarda-mão). */
export function polymer(): TexturePair {
  return render((u, v) => {
    const n = fbm(u, v, 4, 3, 201);
    const stipple = hash(Math.floor(u * 64), Math.floor(v * 64), 7) > 0.6 ? 1 : 0;
    return { c: mix(hex('#2a2c30'), hex('#1b1c1f'), n * 0.5 + stipple * 0.25), h: stipple * 0.4 + n * 0.1 };
  }, 1.5, SIZE);
}

/** Aço fosfatizado com desgaste claro nas bordas. */
export function parkerized(): TexturePair {
  return render((u, v) => {
    const n = fbm(u, v, 6, 4, 211);
    const edge = clamp01(1 - Math.min(u, 1 - u, v, 1 - v) * 18);
    let c = mix(hex('#3a3e44'), hex('#25282c'), n * 0.6);
    c = mix(c, hex('#6f747b'), edge * 0.35);
    return { c, h: n * 0.15 };
  }, 1.5, SIZE);
}

/** Trilho com fendas (topo e guarda-mão). */
export function rail(): TexturePair {
  return render((u, v) => {
    const slot = gridDist(v, 10) < 0.03 ? 1 : 0;
    const n = fbm(u, v, 4, 3, 221);
    return { c: mix(hex('#30343a'), hex('#14161a'), slot * 0.8 + n * 0.2), h: 1 - slot * 0.8 };
  }, 4, SIZE);
}

/** Luva tática: tecido escuro com costuras. */
export function glove(): TexturePair {
  return render((u, v) => {
    const weave = (Math.sin(u * 140) * Math.sin(v * 140)) * 0.5 + 0.5;
    const seam = gridDist(u, 3) < 0.006 ? 1 : 0;
    const n = fbm(u, v, 4, 3, 231);
    return { c: mix(hex('#3a3229'), hex('#221d18'), n * 0.5 + weave * 0.15 + seam * 0.3), h: weave * 0.2 - seam * 0.3 };
  }, 2, SIZE);
}

/** Manga do uniforme do ataque: bege com padrão camuflado verde-oliva. */
export function sleeveAttack(): TexturePair {
  return render((u, v) => {
    const blot = fbm(u, v, 3, 4, 241);
    const weave = (Math.sin(u * 200) + Math.sin(v * 200)) * 0.25 + 0.5;
    let c = mix(hex('#b9a27a'), hex('#a08a63'), weave * 0.3);
    if (blot > 0.56) c = mix(c, hex('#5d6142'), 0.85);
    else if (blot < 0.38) c = mix(c, hex('#7d6a4c'), 0.6);
    return { c, h: weave * 0.15 };
  }, 1.5, SIZE);
}

/** Manga da defesa: azul-marinho liso. */
export function sleeveDefense(): TexturePair {
  return render((u, v) => {
    const n = fbm(u, v, 4, 3, 251);
    const weave = (Math.sin(u * 200) + Math.sin(v * 200)) * 0.25 + 0.5;
    return { c: mix(hex('#283a57'), hex('#1b2840'), n * 0.4 + weave * 0.2), h: weave * 0.15 };
  }, 1.5, SIZE);
}
