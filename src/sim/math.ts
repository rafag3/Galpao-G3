// Matemática mínima da simulação. Não depende do Babylon para que a
// simulação possa rodar também em Node (testes hoje, servidor amanhã).

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/**
 * Euler (radianos) para quaternion na ordem Y → X → Z, a mesma usada pelo
 * Babylon. Render e física usam esta mesma função, então ficam coerentes.
 */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const qy = { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) };
  const qx = { x: Math.sin(x / 2), y: 0, z: 0, w: Math.cos(x / 2) };
  const qz = { x: 0, y: 0, z: Math.sin(z / 2), w: Math.cos(z / 2) };
  return quatMul(quatMul(qy, qx), qz);
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Aproxima `current` de `target` em no máximo `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
