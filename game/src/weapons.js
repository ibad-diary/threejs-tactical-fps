// Weapons: definitions, hitscan fire, recoil/spread, reload, tracers, sparks.
import * as THREE from 'three';
import { WEAPONS, falloff } from './config.js';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _sparkGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);

export class WeaponState {
  constructor(def) {
    this.def = def; this.mag = def.mag; this.reserve = def.reserve;
    this.reloading = false; this.reloadEnd = 0; this.lastShot = -99;
    this.bloom = 0; this.recoilPitch = 0; this.recoilYaw = 0;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracerList = []; // {line, life}
    this.sparkList = []; // {mesh, vel, life}
    this.flash = new THREE.PointLight(0xffc65c, 0, 9, 1.8);
    scene.add(this.flash);
    this.flashLife = 0;
  }
  tracer(from, to, color = 0xffd27a) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.tracerList.push({ line, life: 0.07 });
  }
  sparks(point, n = 6) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(_sparkGeo, new THREE.MeshBasicMaterial({ color: 0xffc65c }));
      m.position.copy(point);
      this.scene.add(m);
      _tmp.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 3);
      this.sparkList.push({ mesh: m, vel: _tmp.clone(), life: 0.35 });
    }
  }
  muzzle(pos) { this.flash.position.copy(pos); this.flash.intensity = 14; this.flashLife = 0.05; }
  update(dt) {
    for (let i = this.tracerList.length - 1; i >= 0; i--) {
      const t = this.tracerList[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); this.tracerList.splice(i, 1); }
    }
    for (let i = this.sparkList.length - 1; i >= 0; i--) {
      const s = this.sparkList[i];
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.life <= 0) { this.scene.remove(s.mesh); s.mesh.material.dispose(); this.sparkList.splice(i, 1); }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) this.flash.intensity = 0;
    }
  }
}

// Hitscan shot from `origin` along `dir` (already spread-applied).
// `game` supplies world, bots, effects and a damage callback.
// Returns { hit: 'bot'|'wall'|'none', bot, head, dist, point }.
export function shootHitscan(game, origin, dir, def, shooter) {
  _ray.set(origin, dir);
  _ray.far = def.range;
  const targets = [];
  for (const b of game.bots.list) {
    if (!b.alive || b === shooter) continue;
    targets.push(b.bodyMesh, b.headMesh);
  }
  const hits = _ray.intersectObjects(targets.concat(game.world.meshes), false);
  const result = { hit: 'none', bot: null, head: false, dist: def.range, point: null };
  if (hits.length > 0) {
    const h = hits[0];
    result.dist = h.distance;
    result.point = h.point.clone();
    const obj = h.object;
    if (obj.userData.bot) {
      result.hit = 'bot';
      result.bot = obj.userData.bot;
      result.head = obj.userData.part === 'head';
    } else {
      result.hit = 'wall';
      game.effects.sparks(h.point);
    }
  } else {
    result.point = origin.clone().addScaledVector(dir, def.range);
  }
  game.effects.tracer(origin, result.point);
  return result;
}

// Damage of one bullet at distance, with headshot multiplier.
export function bulletDamage(def, dist, head) {
  return def.damage * falloff(dist) * (head ? def.headMult : 1);
}

// Player-owned weapon set: switching, reload, fire cadence, recoil state.
export class PlayerWeapons {
  constructor(game) {
    this.game = game;
    this.states = {};
    for (const k of Object.keys(WEAPONS)) this.states[k] = new WeaponState(WEAPONS[k]);
    this.current = 'sidekick';
    this.grenades = 0;
  }
  get state() { return this.states[this.current]; }
  get def() { return WEAPONS[this.current]; }

  buy(id) {
    const def = WEAPONS[id];
    if (!def || this.states[id].owned) return false;
    this.states[id].owned = true;
    this.current = id;
    return true;
  }
  switchTo(id) {
    if (!this.states[id] || (id !== 'sidekick' && !this.states[id].owned)) return false;
    if (this.state.reloading) return false;
    this.current = id;
    return true;
  }
  startReload(now) {
    const s = this.state;
    if (s.reloading || s.mag >= s.def.mag || s.reserve <= 0) return false;
    s.reloading = true; s.reloadEnd = now + s.def.reload;
    this.game.audio.reload();
    return true;
  }
  finishReload() {
    const s = this.state;
    const need = s.def.mag - s.mag;
    const take = Math.min(need, s.reserve);
    s.mag += take; s.reserve -= take;
    s.reloading = false; s.bloom = 0;
  }
  // Returns 'fired' | 'empty' | 'reloading' | 'wait' | 'semi'.
  tryFire(now, input) {
    const s = this.state, def = s.def;
    if (s.reloading) return 'reloading';
    const interval = 60 / def.rpm;
    if (now - s.lastShot < interval) return 'wait';
    const wantFire = def.auto ? input.mouseDown : input.consumeClick();
    if (!wantFire) return 'semi';
    if (s.mag <= 0) { this.startReload(now); return 'empty'; }
    s.lastShot = now; s.mag -= 1;
    s.bloom = Math.min(def.maxSpread, s.bloom + def.spreadPerShot);
    // Recoil: upward kick then sideways drift, applied as offsets that decay.
    s.recoilPitch += def.recoil * (0.7 + Math.random() * 0.6);
    s.recoilYaw += (Math.random() - 0.5) * def.recoil * 0.7;
    return 'fired';
  }
  // Per-step decay of bloom and recoil.
  // Stopping to aim pays: moving adds spread, crouching cuts it, and standing
  // still for a beat settles the aim further.
  update(dt, moving, crouched, stillTime) {
    const s = this.state;
    s.bloom = Math.max(0, s.bloom - dt * 0.05);
    s.recoilPitch *= Math.pow(0.0001, dt); // fast decay
    s.recoilYaw *= Math.pow(0.0001, dt);
    let sp = s.def.spread + s.bloom + (moving ? 0.012 : 0);
    if (crouched) sp *= 0.6;
    if (!moving && stillTime > 0.6) sp *= 0.75;
    this.spreadNow = sp;
  }
  // Build a shot direction from the camera with spread only. Recoil is
  // already expressed through the camera kick (main.js adds recoilPitch*0.4
  // to the view), so adding it here too double-counted it: every bullet
  // landed ~1 recoil above the crosshair, and a level shot at a head 5 m
  // away grazed over the top. The crosshair must be where the bullet goes.
  shotDirection(camera) {
    camera.getWorldDirection(_dir);
    const sp = this.spreadNow || this.state.def.spread;
    const sx = (Math.random() - 0.5) * 2 * sp;
    const sy = (Math.random() - 0.5) * 2 * sp;
    _dir.x += sx; _dir.y += sy; _dir.z += (Math.random() - 0.5) * 2 * sp * 0.2;
    return _dir.normalize().clone();
  }
  resetForRound() {
    for (const s of Object.values(this.states)) {
      s.mag = s.def.mag; s.reserve = s.def.reserve;
      s.reloading = false; s.bloom = 0; s.recoilPitch = 0; s.recoilYaw = 0;
    }
    this.current = this.states.longshot.owned ? 'longshot' : this.states.scatter.owned ? 'scatter' : 'sidekick';
    if (this.current === 'sidekick') this.current = 'sidekick';
  }
}
