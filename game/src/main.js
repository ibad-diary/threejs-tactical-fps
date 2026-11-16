// Ember Yard — bootstrap, fixed-step 60 Hz sim, render loop, combat wiring.
import * as THREE from 'three';
import { MAP, PALETTE, ECONOMY, WEAPONS } from './config.js';
import { World } from './world.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { PlayerWeapons, Effects, shootHitscan, bulletDamage } from './weapons.js';
import { BotManager } from './bots.js';
import { Rounds } from './rounds.js';
import { AudioSys } from './audio.js';
import { HUD } from './hud.js';

const STEP = 1 / 60;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// Smoke grenade: parabolic projectile, bursts into a LOS-blocking smoke ball.
class Grenades {
  constructor(game) {
    this.game = game;
    this.count = 0;
    this.flying = null; // {pos, vel, t}
    this.smokes = []; // {pos, until, group}
  }
  reset() { this.count = 0; this.clearSmoke(); if (this.flying) { this.flying = null; } }
  clearSmoke() {
    for (const s of this.smokes) this.game.scene.remove(s.group);
    this.smokes = [];
  }
  throwFrom(origin, dir) {
    if (this.count <= 0 || this.flying) return false;
    this.count -= 1;
    this.flying = { pos: origin.clone(), vel: dir.clone().multiplyScalar(14).add(new THREE.Vector3(0, 4, 0)), t: 0 };
    return true;
  }
  burst(pos) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.32, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random(), 10, 8), mat);
      s.position.set((Math.random() - 0.5) * 3, 0.8 + Math.random() * 1.6, (Math.random() - 0.5) * 3);
      group.add(s);
    }
    group.position.copy(pos);
    this.game.scene.add(group);
    this.smokes.push({ pos: pos.clone(), until: this.game.now + 12, group, radius: 3.2 });
  }
  update(dt) {
    if (this.flying) {
      const f = this.flying;
      f.t += dt;
      f.vel.y -= 9.8 * dt;
      f.pos.addScaledVector(f.vel, dt);
      if (f.pos.y <= 0.2 || f.t > 1.6) { this.burst(f.pos.clone().setY(Math.max(0.2, f.pos.y))); this.flying = null; }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      if (this.game.now > this.smokes[i].until) {
        this.game.scene.remove(this.smokes[i].group);
        this.smokes.splice(i, 1);
      }
    }
  }
  // True if segment a->b passes through any live smoke ball.
  blocks(a, b) {
    for (const s of this.smokes) {
      _v.copy(b).sub(a);
      const len = _v.length();
      if (len < 1e-6) continue;
      _v2.copy(s.pos).sub(a);
      const t = Math.max(0, Math.min(len, _v2.dot(_v) / len));
      _v.copy(a).addScaledVector(_v.normalize(), t);
      if (_v.distanceTo(s.pos) < s.radius) return true;
    }
    return false;
  }
}

class Game {
  constructor() {
    this.now = 0;
    this.started = false;
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = this.skyTexture();
    this.scene.fog = new THREE.Fog(PALETTE.fog, 32, 95);

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 200);
    this.scene.add(this.camera);

    // Dusk sun + sky/ground bounce.
    const sun = new THREE.DirectionalLight(0xffb45e, 1.2);
    sun.position.set(-18, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    sun.shadow.camera.far = 80;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0x4a7a8a, 0x8a6a45, 0.85));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    this.world = new World(this.scene);
    this.input = new Input(this.canvas);
    this.player = new Player(this.world);
    this.weapons = new PlayerWeapons(this);
    this.effects = new Effects(this.scene);
    this.audio = new AudioSys();
    this.hud = new HUD();
    this.bots = new BotManager(this);
    this.rounds = new Rounds(this);
    this.grenades = new Grenades(this);
    this.bots.spawnAll();

    this.viewmodel = this.buildViewmodel();
    this.camera.add(this.viewmodel);

    this.plantProgress = 0; this.defuseProgress = 0;
    this.channelAnchor = null;
    this.acc = 0; this.lastT = performance.now();
    this.stillTime = 0; // seconds the player has stood still (settles the aim)
    this.hitStopUntil = 0; // real-time ms: sim frozen while now < this
    this.trauma = 0; // decaying 0..1 shake energy (visual only, never moves bodies)
    this.shakeT = 0;

    this.bindKeys();
    this.bindButtons();
    window.addEventListener('resize', () => this.onResize());
    this.hud.showStart(true);
    this.hud.setHealth(100, 0);
    this.hud.setMoney(ECONOMY.startMoney);
    this.hud.setScore(0, 0);
    this.hud.setAmmo(12, 36, WEAPONS.sidekick.name);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  skyTexture() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 512;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#2c4a63');
    grad.addColorStop(0.55, '#7a6a72');
    grad.addColorStop(1, '#e08a4c');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  buildViewmodel() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.5), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
    barrel.position.set(0, 0.03, -0.36);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.09), dark);
    grip.position.set(0, -0.13, 0.12); grip.rotation.x = 0.3;
    g.add(body, barrel, grip);
    g.position.set(0.28, -0.26, -0.55);
    return g;
  }

  // Hit-stop: freeze the SIMULATION for `ms` real milliseconds (kill/headshot
  // feedback). Only the newest call owns the restore; time is real, never scaled.
  triggerHitStop(ms) { this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + ms); }
  // Trauma shake: small, fast-decaying, camera-only. Hera's rule: keep it subtle.
  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  bindKeys() {
    this.input.onKey = (code) => {
      if (!this.started) return;
      if (code === 'KeyM') { this.audio.setMuted(!this.audio.muted); this.hud.message(this.audio.muted ? 'Muted' : 'Sound on', 1); return; }
      if (code === 'KeyR') { this.weapons.startReload(this.now); return; }
      if (code === 'KeyB') {
        if (this.rounds.canBuy()) { this.rounds.buyOpen = !this.rounds.buyOpen; this.hud.showBuy(this.rounds.buyOpen); }
        return;
      }
      if (code === 'KeyG') {
        this.camera.getWorldDirection(_v);
        if (this.grenades.throwFrom(this.camera.getWorldPosition(_v2), _v)) this.hud.setGrenades(this.grenades.count);
        return;
      }
      if (this.rounds.buyOpen) {
        const buyMap = { Digit1: 'longshot', Digit2: 'scatter', Digit3: 'grenade', Digit4: 'armor' };
        if (buyMap[code]) {
          const err = this.rounds.buy(buyMap[code]);
          this.hud.message(err || 'Purchased', 1.5);
          this.hud.refreshBuy(this.rounds.money, { longshot: this.weapons.states.longshot.owned, scatter: this.weapons.states.scatter.owned });
          this.hud.setMoney(this.rounds.money);
          this.hud.setGrenades(this.grenades.count);
          this.hud.setAmmo(this.weapons.state.mag, this.weapons.state.reserve, this.weapons.def.name);
          this.hud.setHealth(this.player.hp, this.player.armor);
        }
        return;
      }
      const switchMap = { Digit1: 'longshot', Digit2: 'scatter', Digit3: 'sidekick' };
      if (switchMap[code]) {
        if (this.weapons.switchTo(switchMap[code])) {
          this.hud.setAmmo(this.weapons.state.mag, this.weapons.state.reserve, this.weapons.def.name);
        }
      }
    };
    this.input.onMouseDown = () => {
      if (!this.started) return;
      this.input.requestLock();
    };
  }

  bindButtons() {
    document.getElementById('play-btn').addEventListener('click', () => {
      this.audio.ensure();
      this.input.requestLock();
      this.started = true;
      this.hud.showStart(false);
      this.rounds.startMatch();
    });
    document.getElementById('next-round-btn').addEventListener('click', () => {
      if (this.rounds.phase === 'ended') this.rounds.endTimer = 0;
    });
    document.getElementById('again-btn').addEventListener('click', () => {
      this.hud.hideMatchEnd();
      this.rounds.startMatch();
    });
    document.getElementById('resume-btn')?.addEventListener('click', () => this.input.requestLock());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // --- Combat wiring ---
  smokeBlocks(a, b) { return this.grenades.blocks(a, b); }

  damagePlayer(amount, attacker) {
    if (!this.player.alive) return;
    this.player.takeDamage(amount);
    this.audio.hurt();
    this.addTrauma(0.3);
    if (!this.player.alive) {
      this.hud.killfeed(attacker ? attacker.name : 'Ash', 'You', 'SK-9 "Scatter"', false);
      this.hud.message('You were eliminated', 2);
      this.input.exitLock();
    }
  }

  onBotHit(shooter, victim, dmg, head, killed) {
    const isPlayer = shooter === 'player';
    if (isPlayer) {
      this.hud.showHitmarker(killed);
      if (killed) {
        this.audio.kill();
        this.triggerHitStop(60); this.addTrauma(0.12); // kill: medium tier
        this.rounds.money += ECONOMY.killReward;
        this.hud.setMoney(this.rounds.money);
      } else {
        this.audio.hit();
        if (head) { this.triggerHitStop(30); this.addTrauma(0.05); }
      }
    }
    if (killed) {
      this.hud.killfeed(isPlayer ? 'You' : shooter.name, victim.name, isPlayer ? this.weapons.def.name : 'SK-9 "Scatter"', head);
      if (victim.team === 'ash' && isPlayer) this.hud.message('', 0);
    }
  }

  playerShoot() {
    const w = this.weapons;
    const res = w.tryFire(this.now, this.input);
    if (res === 'fired') {
      const origin = this.camera.getWorldPosition(_v2).clone();
      const dir = w.shotDirection(this.camera);
      this.audio.shot(w.def.kind);
      this.addTrauma(0.03); // faint kick per shot; never stacks into nausea
      this.effects.muzzle(origin.clone().addScaledVector(dir, 0.6));
      const hit = shootHitscan(this, origin, dir, w.def, 'player');
      // Bot hearing: gunfire within 25 m.
      for (const b of this.bots.list) if (b.alive) b.hearShot(origin);
      if (hit.hit === 'bot') {
        const dmg = bulletDamage(w.def, hit.dist, hit.head);
        const killed = hit.bot.takeDamage(dmg, 'player', hit.head);
        this.onBotHit('player', hit.bot, dmg, hit.head, killed);
      }
      this.hud.setAmmo(w.state.mag, w.state.reserve, w.def.name);
    } else if (res === 'empty') {
      this.hud.message('Reloading… (R)', 1);
      this.hud.setAmmo(w.state.mag, w.state.reserve, w.def.name);
    }
  }

  // Plant / defuse channel: hold E in Site A; moving cancels.
  updateChannel(dt) {
    const r = this.rounds;
    const want = this.input.down('KeyE') && this.player.alive && r.phase === 'live';
    const inSite = r.inSite(this.player.pos.x, this.player.pos.z);
    let label = null, progress = null;
    if (want && inSite) {
      if (!this.channelAnchor) this.channelAnchor = this.player.pos.clone();
      const moved = this.player.pos.distanceTo(this.channelAnchor);
      if (moved > 0.6) { this.plantProgress = 0; this.defuseProgress = 0; this.channelAnchor = this.player.pos.clone(); }
      if (!r.bomb.planted) {
        this.plantProgress += dt / MAP.plantTime;
        label = 'Planting bomb…'; progress = this.plantProgress;
        if (this.plantProgress >= 1) {
          if (r.plantBomb('player')) this.hud.message('Bomb planted!', 2);
          this.plantProgress = 0; this.channelAnchor = null;
        }
      } else {
        this.defuseProgress += dt / MAP.defuseTime;
        label = 'Defusing bomb…'; progress = this.defuseProgress;
        if (this.defuseProgress >= 1) {
          r.defuseBomb('player');
          this.defuseProgress = 0; this.channelAnchor = null;
        }
      }
    } else {
      this.plantProgress = 0; this.defuseProgress = 0; this.channelAnchor = null;
    }
    this.hud.showPlant(progress, label);
    if (want && inSite) this.hud.setHint('Hold E — moving cancels');
    else if (r.phase === 'live' && inSite && !r.bomb.planted) this.hud.setHint('Hold E to plant the bomb');
    else if (r.phase === 'live' && r.bomb.planted && inSite) this.hud.setHint('Hold E to defuse');
    else this.hud.setHint('');
  }

  step(dt) {
    this.now += dt;
    const r = this.rounds;
    const frozen = r.phase === 'freeze' || r.phase === 'menu' || r.phase === 'ended' || r.phase === 'matchEnd';
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 0.5;
    this.stillTime = moving ? 0 : this.stillTime + dt;
    this.player.update(dt, this.input, frozen || !this.started);
    if (this.player.stepped) { this.player.stepped = false; this.audio.step(); }
    this.weapons.update(dt, moving, this.player.crouching, this.stillTime);
    const ws = this.weapons.state;
    if (ws.reloading && this.now >= ws.reloadEnd) this.weapons.finishReload();
    if (this.started && this.player.alive && r.phase === 'live') this.playerShoot();
    this.updateChannel(dt);
    if (this.started) {
      // Bots only act while the round is live: freeze time is a real freeze,
      // and nobody shoots after the round has ended.
      if (r.phase === 'live') this.bots.update(this.now, dt);
      r.update(dt);
    }
    // Defuse warning: an Ash bot channeling the defuse is the round's loudest fact.
    const defuser = this.bots.list.find((b) => b.team === 'ash' && b.alive && b.state === 'defuse' && b.defuseTimer > 0);
    this.hud.setDefuseWarning(defuser ? `⚠ ${defuser.name.toUpperCase()} IS DEFUSING THE BOMB!` : '');
    this.grenades.update(dt);
    this.effects.update(dt);
    // HUD refresh.
    this.hud.setHealth(this.player.hp, this.player.armor);
    this.hud.setAmmo(ws.mag, ws.reserve, this.weapons.def.name);
    this.hud.setTimer(r.timer, r.phase, r.freezeTimer);
    this.hud.setScore(r.score.ember, r.score.ash);
    this.hud.setMoney(r.money);
    this.hud.setGrenades(this.grenades.count);
    this.hud.setBombTimer(r.bomb.planted, r.bomb.timer);
    this.hud.setCrosshair(this.weapons.spreadNow * 900 + (moving ? 6 : 0), moving);
    this.hud.tickMessage(dt);
  }

  render() {
    // Camera follows the player head; recoil offsets pitch slightly.
    const p = this.player;
    this.camera.position.set(p.pos.x, p.eyeY, p.pos.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = p.yaw;
    this.camera.rotation.x = p.pitch + (this.weapons.state ? this.weapons.state.recoilPitch * 0.4 : 0);
    this.camera.rotation.z = 0;
    // Trauma shake (camera only, summed sines, trauma^2 so light hits barely
    // move it; decays in real time so it never freezes off-centre in hit-stop).
    const shake = this.trauma * this.trauma;
    if (shake > 0) {
      this.camera.rotation.z = 0.012 * shake * Math.sin(this.shakeT * 1.1);
      this.camera.position.x += 0.03 * shake * Math.sin(this.shakeT * 1.7);
      this.camera.position.y += 0.02 * shake * Math.sin(this.shakeT * 2.3);
    }
    // Viewmodel bob.
    const bob = Math.sin(this.now * 9) * 0.006 * Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5);
    this.viewmodel.position.y = -0.26 + bob;
    this.viewmodel.position.x = 0.28 + (this.weapons.state ? this.weapons.state.recoilYaw * 2 : 0);
    this.renderer.render(this.scene, this.camera);
  }

  loop(t) {
    requestAnimationFrame(this.loop);
    const frameDt = Math.min(0.25, (t - this.lastT) / 1000);
    this.lastT = t;
    // Shake decays in REAL time (also during hit-stop) so it always returns to rest.
    this.trauma = Math.max(0, this.trauma - 1.2 * frameDt);
    this.shakeT += frameDt * 30;
    // Hit-stop: freeze the simulation, keep rendering (frozen pose, live shake).
    if (performance.now() < this.hitStopUntil) { this.render(); return; }
    this.acc += frameDt;
    let n = 0;
    while (this.acc >= STEP && n < 5) { this.step(STEP); this.acc -= STEP; n++; }
    if (n === 5) this.acc = 0;
    this.render();
  }
}

const game = new Game();
window.__game = game;
