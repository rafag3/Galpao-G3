// Movimento em primeira pessoa: andar, correr, pular e agachar.
// Personagem cinemático com cápsula + character controller do Rapier.
// Sem dependência de render ou DOM.

import type { MoveIntent } from '../input/InputIntents';
import { BODY, LOOK, MOVE } from './config';
import { approach, clamp, type Vec3, vec3 } from './math';
import { PhysicsWorld, RAPIER } from './PhysicsWorld';

export interface PlayerState {
  /** Posição dos pés (base da cápsula), em metros. */
  feet: Vec3;
  velocity: Vec3;
  /** Yaw: 0 olha para +Z; positivo gira para a direita (+X). */
  yaw: number;
  /** Pitch: positivo olha para baixo. */
  pitch: number;
  grounded: boolean;
  crouching: boolean;
  /** Altura atual dos olhos acima dos pés (suavizada ao agachar). */
  eyeHeight: number;
}

const halfHeightFor = (height: number) => height / 2 - BODY.radius;

export class PlayerController {
  readonly state: PlayerState;
  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private height: number = BODY.standHeight;

  constructor(private readonly physics: PhysicsWorld, spawn: Vec3, yaw = 0) {
    const world = physics.world;
    this.state = {
      feet: { ...spawn },
      velocity: vec3(),
      yaw,
      pitch: 0,
      grounded: false,
      crouching: false,
      eyeHeight: BODY.standHeight - BODY.eyeFromTop,
    };

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        spawn.x,
        spawn.y + this.height / 2,
        spawn.z,
      ),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeightFor(this.height), BODY.radius),
      this.body,
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(BODY.stepHeight, 0.2, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle((BODY.maxSlopeDeg * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle(((BODY.maxSlopeDeg + 5) * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
  }

  /** Aplica o giro de câmera. Chamado a cada frame para resposta imediata. */
  applyLook(deltaYaw: number, deltaPitch: number): void {
    const s = this.state;
    s.yaw = (s.yaw + deltaYaw) % (Math.PI * 2);
    s.pitch = clamp(s.pitch + deltaPitch, -LOOK.maxPitch, LOOK.maxPitch);
  }

  /** Um tick de simulação com passo fixo. */
  step(intent: MoveIntent, dt: number): void {
    const s = this.state;

    this.updateCrouch(intent.crouch);

    // Direção desejada no plano, relativa ao yaw
    let ix = intent.moveX;
    let iz = intent.moveZ;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const sin = Math.sin(s.yaw);
    const cos = Math.cos(s.yaw);
    const dirX = iz * sin + ix * cos;
    const dirZ = iz * cos - ix * sin;

    const speed = s.crouching ? MOVE.crouchSpeed : intent.run ? MOVE.runSpeed : MOVE.walkSpeed;
    const accel = (s.grounded ? MOVE.groundAccel : MOVE.airAccel) * dt;
    s.velocity.x = approach(s.velocity.x, dirX * speed, accel);
    s.velocity.z = approach(s.velocity.z, dirZ * speed, accel);

    // Vertical
    if (s.grounded) {
      s.velocity.y = intent.jump && !s.crouching ? MOVE.jumpSpeed : -1; // -1 mantém contato
    } else {
      s.velocity.y = Math.max(s.velocity.y - MOVE.gravity * dt, -MOVE.maxFallSpeed);
    }

    const desired = { x: s.velocity.x * dt, y: s.velocity.y * dt, z: s.velocity.z * dt };
    this.controller.computeColliderMovement(this.collider, desired);
    const moved = this.controller.computedMovement();
    const wasGrounded = s.grounded;
    s.grounded = this.controller.computedGrounded();

    // Bateu no teto: zera a subida
    if (!s.grounded && s.velocity.y > 0 && moved.y < desired.y - 1e-4) s.velocity.y = 0;
    if (s.grounded && !wasGrounded) s.velocity.y = 0;

    const center = this.body.translation();
    const next = { x: center.x + moved.x, y: center.y + moved.y, z: center.z + moved.z };
    this.body.setNextKinematicTranslation(next);
    // O corpo cinemático só se move de fato no world.step(); a posição
    // lógica já é a de destino.
    s.feet = { x: next.x, y: next.y - this.height / 2, z: next.z };

    const targetEye = this.height - BODY.eyeFromTop;
    s.eyeHeight = approach(s.eyeHeight, targetEye, BODY.eyeLerpSpeed * dt);
  }

  private updateCrouch(wantCrouch: boolean): void {
    const s = this.state;
    if (wantCrouch === s.crouching) return;
    if (!wantCrouch && !this.hasHeadroom(BODY.standHeight)) return; // teto baixo: continua agachado

    const newHeight = wantCrouch ? BODY.crouchHeight : BODY.standHeight;
    const feetY = this.body.translation().y - this.height / 2;
    this.height = newHeight;
    s.crouching = wantCrouch;
    this.collider.setHalfHeight(halfHeightFor(newHeight));
    // Mantém os pés no lugar ao trocar o tamanho da cápsula
    const c = this.body.translation();
    this.body.setTranslation({ x: c.x, y: feetY + newHeight / 2, z: c.z }, true);
  }

  private hasHeadroom(height: number): boolean {
    const c = this.body.translation();
    const feetY = c.y - this.height / 2;
    const shape = new RAPIER.Capsule(halfHeightFor(height) - 0.02, BODY.radius - 0.02);
    let blocked = false;
    this.physics.world.intersectionsWithShape(
      { x: c.x, y: feetY + height / 2 + 0.02, z: c.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      () => {
        blocked = true;
        return false; // para na primeira colisão
      },
      undefined,
      undefined,
      this.collider,
    );
    return !blocked;
  }

  /** Posição dos olhos (para a câmera). */
  eyePosition(): Vec3 {
    const f = this.state.feet;
    return { x: f.x, y: f.y + this.state.eyeHeight, z: f.z };
  }
}
