// Player controller: WASD + accel/friction, crouch, jump, circle-vs-AABB slide.
import * as THREE from 'three';
import { MAP, PLAYER } from './config.js';
import { collideCircle } from './world.js';

const _out = { x: 0, z: 0 };

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3(0, 0, 12); // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0; // facing north (-z) at spawn: forward = (-sin yaw, -cos yaw)
    this.pitch = 0;
    this.hp = PLAYER.maxHp;
    this.armor = 0;
    this.crouching = false;
    this.onGround = true;
    this.alive = true;
    this.eyeHeight = PLAYER.eyeStand;
    this.stepTimer = 0;
    this.movedDist = 0;
  }

  get eyeY() { return this.pos.y + this.eyeHeight; }
  get height() { return this.crouching ? PLAYER.heightCrouch : PLAYER.heightStand; }

  respawn(x, z) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.hp = PLAYER.maxHp; this.armor = 0; this.alive = true;
    this.crouching = false; this.eyeHeight = PLAYER.eyeStand;
  }

  // Damage with armor: armor absorbs 50% until depleted.
  takeDamage(amount) {
    if (!this.alive) return;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.5);
      this.armor -= absorbed; rest = amount - absorbed;
    }
    this.hp -= rest;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
  }

  update(dt, input, frozen) {
    if (!this.alive) return;
    // Mouse look.
    const { dx, dy } = input.consumeMouse();
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    this.pitch = Math.max(-Math.PI / 2 + 0.027, Math.min(Math.PI / 2 - 0.027, this.pitch)); // ±89 deg

    this.crouching = input.down('ControlLeft') || input.down('ControlRight');
    const targetEye = this.crouching ? PLAYER.eyeCrouch : PLAYER.eyeStand;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    if (frozen) { // freeze time: look around, but no movement
      this.vel.x = 0; this.vel.z = 0;
      return;
    }
    // Wish direction from keys, relative to yaw.
    let fx = 0, fz = 0;
    if (input.down('KeyW')) fz -= 1;
    if (input.down('KeyS')) fz += 1;
    if (input.down('KeyA')) fx -= 1;
    if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward F = (-sin yaw, -cos yaw), right R = (cos yaw, -sin yaw).
    // W gives fz=-1 -> +F; D gives fx=+1 -> +R.
    const wx = sin * fz + cos * fx;
    const wz = cos * fz - sin * fx;
    const maxSpeed = this.crouching ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
    this.vel.x += wx * PLAYER.accel * dt;
    this.vel.z += wz * PLAYER.accel * dt;
    // Friction when no input, and clamp to max speed.
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (fx === 0 && fz === 0 && hSpeed > 0) {
      const dec = Math.max(0, hSpeed - PLAYER.friction * dt);
      this.vel.x *= dec / hSpeed; this.vel.z *= dec / hSpeed;
    }
    if (hSpeed > maxSpeed) {
      this.vel.x *= maxSpeed / hSpeed; this.vel.z *= maxSpeed / hSpeed;
    }
    // Integrate + collide (circle vs AABB, slides along walls).
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    collideCircle(this.world.colliders, nx, nz, PLAYER.radius, _out);
    const beforeX = this.pos.x, beforeZ = this.pos.z;
    this.pos.x = Math.max(-MAP.width / 2 + 0.5, Math.min(MAP.width / 2 - 0.5, _out.x));
    this.pos.z = Math.max(-MAP.depth / 2 + 0.5, Math.min(MAP.depth / 2 - 0.5, _out.z));
    this.movedDist += Math.hypot(this.pos.x - beforeX, this.pos.z - beforeZ);

    // Jump + gravity.
    if (input.down('Space') && this.onGround) {
      this.vel.y = PLAYER.jumpSpeed; this.onGround = false;
    }
    this.vel.y -= PLAYER.gravity * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = 0; this.onGround = true; }

    // Footstep timing.
    if (hSpeed > 1 && this.onGround) {
      this.stepTimer -= dt * hSpeed;
      if (this.stepTimer <= 0) { this.stepTimer = 2.2; this.stepped = true; }
    }
  }
}
