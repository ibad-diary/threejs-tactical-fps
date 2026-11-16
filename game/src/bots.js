// Bots: FSM (patrol / hold / hunt / attack / plant / defuse / dead),
// perception (5-10 Hz, view cone + LOS raycast, hearing), A* on the nav grid.
import * as THREE from 'three';
import { MAP, PALETTE, BOT_NAMES_EMBER, BOT_NAMES_ASH } from './config.js';
import { collideCircle } from './world.js';
import { shootHitscan, bulletDamage } from './weapons.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _ray = new THREE.Raycaster();

// A* over the world nav grid: 4-way + diagonals without corner cutting.
export function findPath(world, sx, sz, tx, tz) {
  const start = world.toGrid(sx, sz), goal = world.toGrid(tx, tz);
  if (!world.isWalkable(goal.gx, goal.gz)) return null;
  const W = world.gridW, D = world.gridD;
  const key = (x, z) => z * W + x;
  const open = [{ x: start.gx, z: start.gz, g: 0, f: 0, parent: null }];
  const gScore = new Map([[key(start.gx, start.gz), 0]]);
  const closed = new Set();
  const h = (x, z) => Math.abs(x - goal.gx) + Math.abs(z - goal.gz);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.z);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.x === goal.gx && cur.z === goal.gz) {
      const path = [];
      let n = cur;
      while (n) { const w = world.toWorld(n.x, n.z); path.unshift(w); n = n.parent; }
      return path;
    }
    for (const [dx, dz, cost] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4], [1, -1, 1.4], [-1, 1, 1.4], [-1, -1, 1.4]]) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (!world.isWalkable(nx, nz)) continue;
      if (dx !== 0 && dz !== 0 && (!world.isWalkable(cur.x + dx, cur.z) || !world.isWalkable(cur.x, cur.z + dz))) continue; // no corner cutting
      const nk = key(nx, nz), ng = cur.g + cost;
      if (gScore.has(nk) && gScore.get(nk) <= ng) continue;
      gScore.set(nk, ng);
      open.push({ x: nx, z: nz, g: ng, f: ng + h(nx, nz), parent: cur });
    }
  }
  return null;
}

const BODY_H = 1.15, HEAD_R = 0.22;

export class Bot {
  constructor(game, team, name, spawn) {
    this.game = game; this.team = team; this.name = name;
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.yaw = team === 'ember' ? 0 : Math.PI; // ember faces north (-z), ash faces south (+z)
    this.hp = 100; this.alive = true;
    this.state = 'patrol';
    this.speed = 3.4 + Math.random() * 0.6;
    this.route = null; this.routeIdx = 0;
    this.path = null; this.pathIdx = 0; this.pathTarget = null;
    this.repathTimer = 0; this.stuckTimer = 0; this.lastProgress = new THREE.Vector3().copy(this.pos);
    this.target = null; this.lastKnown = null; this.lastSeenAt = -99;
    this.heardAt = null; this.heardPos = null;
    this.senseTimer = Math.random() * 0.2; // 5-10 Hz perception
    this.reactionAt = 0; this.burstLeft = 0; this.burstTimer = 0; this.aimError = 0.06;
    this.plantTimer = 0; this.defuseTimer = 0;
    this.walkPhase = Math.random() * 6;
    this.armor = 0;
    this.buildMesh();
  }

  buildMesh() {
    const color = this.team === 'ember' ? PALETTE.ember : PALETTE.ash;
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.7 });
    // Body capsule: cylinder + rounded top, head sphere, gun box.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, BODY_H, 10), mat);
    body.position.y = 0.62; body.castShadow = true;
    body.userData = { bot: this, part: 'body' };
    const head = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R, 12, 10), dark);
    head.position.y = 1.45; head.castShadow = true;
    head.userData = { bot: this, part: 'head' };
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.7), dark);
    gun.position.set(0.3, 1.05, 0.35);
    g.add(body, head, gun);
    // Team ring on the ground for readability.
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 20),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
    g.add(ring);
    this.group = g; this.bodyMesh = body; this.headMesh = head;
    this.group.position.copy(this.pos);
    this.game.scene.add(g);
  }

  respawn(spawn) {
    this.pos.set(spawn[0], 0, spawn[1]);
    this.hp = 100; this.alive = true; this.state = 'patrol';
    this.target = null; this.lastKnown = null; this.lastSeenAt = -99;
    // Full transient reset: a timer or route carried over from last round
    // would let a bot plant/defuse instantly or walk a dead route.
    this.path = null; this.pathIdx = 0; this.pathTarget = null;
    this.route = null; this.routeIdx = 0;
    this.repathTimer = 0; this.stuckTimer = 0;
    this.lastProgress.copy(this.pos);
    this.heardAt = null; this.heardPos = null;
    this.reactionAt = 0; this.burstLeft = 0; this.burstTimer = 0;
    this.plantTimer = 0; this.defuseTimer = 0;
    this.holdUntil = 0; this.walkPhase = Math.random() * 6;
    this.group.visible = true; this.group.position.copy(this.pos);
  }

  takeDamage(amount, attacker, head) {
    if (!this.alive) return false;
    let rest = amount;
    if (this.armor > 0) { const a = Math.min(this.armor, amount * 0.5); this.armor -= a; rest -= a; }
    this.hp -= rest;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.state = 'dead'; this.group.visible = false; return true; }
    return false;
  }

  // --- Perception: view cone 100 deg, LOS raycast to head+chest, hearing. ---
  canSee(targetPos, targetEyeY) {
    _v1.set(targetPos.x, targetEyeY, targetPos.z);
    _v2.copy(_v1).sub(this.eyePos());
    const dist = _v2.length();
    if (dist > 42) return false;
    _v2.normalize();
    // View cone: angle between facing and direction to target.
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (fx * _v2.x + fz * _v2.z < Math.cos(50 * Math.PI / 180)) return false;
    if (this.game.smokeBlocks(this.eyePos(), _v1)) return false;
    _ray.set(this.eyePos(), _v2); _ray.far = dist;
    const hits = _ray.intersectObjects(this.game.world.meshes, false);
    return hits.length === 0;
  }
  eyePos() { return _tmp.set(this.pos.x, 1.45, this.pos.z); }

  sense(now, dt) {
    this.senseTimer -= dt;
    if (this.senseTimer > 0) return;
    this.senseTimer = 0.1 + Math.random() * 0.1; // 5-10 Hz
    const game = this.game;
    // Nearest living enemy: player (if ember) or any ash/ember bot.
    let best = null, bestD = Infinity;
    const consider = (pos, eyeY, ref) => {
      const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
      if (d < bestD) { bestD = d; best = { pos, eyeY, ref }; }
    };
    if (this.team === 'ash' && game.player.alive) consider(game.player.pos, game.player.eyeY, 'player');
    for (const b of game.bots.list) {
      if (b === this || !b.alive || b.team === this.team) continue;
      consider(b.pos, 1.45, b);
    }
    if (best && this.canSee(best.pos, best.eyeY)) {
      this.target = best.ref; this.lastKnown = best.pos.clone(); this.lastSeenAt = now;
      if (this.state === 'patrol' || this.state === 'hold' || this.state === 'hunt') {
        this.state = 'attack'; this.reactionAt = now + 0.35 + Math.random() * 0.25;
        this.burstLeft = 0;
      }
    } else if (this.state === 'attack' && now - this.lastSeenAt > 2.5) {
      this.state = 'hunt'; // go to last known position
    }
    // Hearing: recent gunfire within 25 m.
    if (this.heardAt && now - this.heardAt < 1.5 && this.state !== 'attack') {
      this.lastKnown = this.heardPos.clone();
      if (this.state === 'patrol' || this.state === 'hold') this.state = 'hunt';
    }
  }

  hearShot(pos) {
    if (Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z) > 25) return;
    this.heardAt = this.game.now; this.heardPos = pos.clone();
  }

  requestPath(tx, tz) {
    this.path = findPath(this.game.world, this.pos.x, this.pos.z, tx, tz);
    this.pathIdx = 0;
    if (this.path) this.pathTarget = { x: tx, z: tz };
  }

  followPath(dt) {
    if (!this.path || this.pathIdx >= this.path.length) return true;
    const wp = this.path[this.pathIdx];
    const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) { this.pathIdx++; return this.pathIdx >= this.path.length; }
    this.moveToward(dx / d, dz / d, dt);
    return false;
  }

  moveToward(nx, nz, dt) {
    const step = this.speed * dt;
    const ox = this.pos.x, oz = this.pos.z;
    const out = collideCircle(this.game.world.colliders, this.pos.x + nx * step, this.pos.z + nz * step, 0.4, { x: 0, z: 0 });
    this.pos.x = Math.max(-21.5, Math.min(21.5, out.x));
    this.pos.z = Math.max(-14.5, Math.min(14.5, out.z));
    this.yaw = Math.atan2(-nx, -nz);
    this.walkPhase += dt * 9;
    // Stuck detection: no progress for 2 s -> repath.
    if (Math.hypot(this.pos.x - this.lastProgress.x, this.pos.z - this.lastProgress.z) > 0.5) {
      this.lastProgress.copy(this.pos); this.stuckTimer = 0;
    } else {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2) { this.stuckTimer = 0; this.path = null; }
    }
    return { ox, oz };
  }

  // Bot fires a burst at its target with limited accuracy.
  shootAt(targetPos, eyeY, now, dt) {
    const game = this.game;
    if (this.burstLeft <= 0) {
      if (this.burstTimer > 0) { this.burstTimer -= dt; return; }
      this.burstLeft = 3 + Math.floor(Math.random() * 3);
      this.burstTimer = 0.6 + Math.random() * 0.8;
    }
    if (now - (this.lastShotAt || 0) < 0.12) return;
    this.lastShotAt = now; this.burstLeft--;
    const dist = Math.hypot(targetPos.x - this.pos.x, targetPos.z - this.pos.z);
    const spread = 0.03 + dist * 0.0025; // poor accuracy at range
    const origin = this.eyePos().clone();
    _v1.set(targetPos.x, eyeY, targetPos.z).sub(origin).normalize();
    _v1.x += (Math.random() - 0.5) * 2 * spread;
    _v1.y += (Math.random() - 0.5) * 2 * spread;
    _v1.normalize();
    const def = { damage: 22, headMult: 3, range: 55 };
    const res = shootHitscan(game, origin, _v1.clone(), def, this);
    game.audio.distantShot();
    if (res.hit === 'bot') {
      const dmg = bulletDamage(def, res.dist, res.head);
      const killed = res.bot.takeDamage(dmg, this, res.head);
      game.onBotHit(this, res.bot, dmg, res.head, killed);
    }
    // If the shot was aimed at the player, resolve against the player directly
    // when the ray reached the player's position (bots aim at the player object).
    if (this.target === 'player' && res.hit !== 'bot') {
      // Ray missed the bot list; check if it passed near the player.
      const px = game.player.pos.x, pz = game.player.pos.z;
      const t = Math.max(0, (px - origin.x) * _v1.x + (pz - origin.z) * _v1.z);
      const cx = origin.x + _v1.x * t, cz = origin.z + _v1.z * t;
      const near = Math.hypot(px - cx, pz - cz);
      if (t < dist + 1 && near < 0.55 && t < (res.dist || 55)) {
        game.damagePlayer(bulletDamage(def, dist, false), this);
      }
    }
  }

  update(now, dt, game) {
    if (!this.alive) return;
    this.sense(now, dt);
    const bomb = game.rounds.bomb;
    // Objective overrides: defenders defuse, attackers plant when site is free.
    // Defuse duty goes to the two nearest living Ash bots; the rest keep
    // fighting. When the bomb is about to blow (<10 s), every living Ash bot
    // rushes the defuse, even mid-fight: a bomb that detonates while
    // defenders are alive and shooting is a lost round, not a tactic.
    if (this.team === 'ash' && bomb.planted) {
      const urgent = bomb.timer < 10;
      const assigned = urgent || game.bots.defuseAssignees().includes(this);
      if (assigned && this.state !== 'defuse') this.state = 'defuse';
      if (!assigned && this.state === 'defuse') this.state = 'patrol';
    }
    // If the player (the bomb carrier) is dead, the first living Ember bot
    // takes the plant: otherwise a dead carrier ends the objective entirely.
    if (this.team === 'ember' && !bomb.planted && !game.player.alive && this.state === 'patrol') {
      if (game.bots.emberAlive()[0] === this) this.state = 'plant';
    }
    switch (this.state) {
      case 'patrol': {
        if (!this.route) {
          const routes = game.world.patrolRoutes();
          const keys = this.team === 'ember' ? ['long', 'mid', 'connector'] : ['site', 'mid', 'connector'];
          this.route = routes[keys[Math.floor(Math.random() * keys.length)]];
          this.routeIdx = Math.floor(Math.random() * this.route.length);
        }
        const wp = this.route[this.routeIdx];
        if (Math.hypot(wp[0] - this.pos.x, wp[1] - this.pos.z) < 0.6) {
          this.routeIdx = (this.routeIdx + 1) % this.route.length;
          this.state = 'hold'; this.holdUntil = now + 2 + Math.random() * 3;
          break;
        }
        if (!this.path || this.repathTimer <= 0) { this.requestPath(wp[0], wp[1]); this.repathTimer = 0.5; }
        this.repathTimer -= dt;
        this.followPath(dt);
        break;
      }
      case 'hold':
        if (now > (this.holdUntil || 0)) this.state = 'patrol';
        break;
      case 'hunt': {
        if (!this.lastKnown) { this.state = 'patrol'; break; }
        const d = Math.hypot(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z);
        if (d < 1.2) { this.state = 'patrol'; this.path = null; break; }
        if (!this.pathTarget || Math.hypot(this.pathTarget.x - this.lastKnown.x, this.pathTarget.z - this.lastKnown.z) > 2 || this.repathTimer <= 0) {
          this.requestPath(this.lastKnown.x, this.lastKnown.z); this.repathTimer = 0.5;
        }
        this.repathTimer -= dt;
        if (this.followPath(dt)) this.state = 'patrol';
        break;
      }
      case 'attack': {
        if (!this.target) { this.state = 'hunt'; break; }
        const tp = this.target === 'player' ? game.player.pos : this.target.pos;
        const ty = this.target === 'player' ? game.player.eyeY : 1.45;
        const alive = this.target === 'player' ? game.player.alive : this.target.alive;
        if (!alive) { this.target = null; this.state = 'hunt'; break; }
        // Face the target and fire after the reaction delay.
        const dx = tp.x - this.pos.x, dz = tp.z - this.pos.z;
        this.yaw = Math.atan2(-dx, -dz);
        if (now >= this.reactionAt) this.shootAt(tp, ty, now, dt);
        break;
      }
      case 'plant': {
        const s = MAP.siteA;
        const d = Math.hypot(s.x - this.pos.x, s.z - this.pos.z);
        if (d > 1.5) {
          if (!this.path || this.repathTimer <= 0) { this.requestPath(s.x, s.z); this.repathTimer = 0.5; }
          this.repathTimer -= dt; this.followPath(dt);
        } else {
          this.plantTimer += dt;
          if (this.plantTimer >= MAP.plantTime) { game.rounds.plantBomb(this); this.state = 'patrol'; }
        }
        break;
      }
      case 'defuse': {
        if (!bomb.planted) { this.state = 'patrol'; break; }
        const d = Math.hypot(bomb.x - this.pos.x, bomb.z - this.pos.z);
        if (d > 1.5) {
          if (!this.path || this.repathTimer <= 0) { this.requestPath(bomb.x, bomb.z); this.repathTimer = 0.5; }
          this.repathTimer -= dt; this.followPath(dt);
        } else {
          this.defuseTimer += dt;
          if (this.defuseTimer >= MAP.defuseTime) { game.rounds.defuseBomb(this); this.state = 'patrol'; }
        }
        break;
      }
    }
    // Sync mesh: position, yaw, walk bob + strafe lean.
    this.group.position.set(this.pos.x, Math.abs(Math.sin(this.walkPhase)) * 0.04, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.group.rotation.z = 0;
  }
}

export class BotManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }
  spawnAll() {
    for (const b of this.list) this.game.scene.remove(b.group);
    this.list = [];
    const w = this.game.world;
    w.attackerSpawns().slice(1).forEach((s, i) => {
      this.list.push(new Bot(this.game, 'ember', BOT_NAMES_EMBER[i], s));
    });
    w.defenderSpawns().forEach((s, i) => {
      this.list.push(new Bot(this.game, 'ash', BOT_NAMES_ASH[i], s));
    });
  }
  respawnAll() {
    const w = this.game.world;
    const ember = this.list.filter((b) => b.team === 'ember');
    const ash = this.list.filter((b) => b.team === 'ash');
    w.attackerSpawns().slice(1).forEach((s, i) => ember[i] && ember[i].respawn(s));
    w.defenderSpawns().forEach((s, i) => ash[i] && ash[i].respawn(s));
  }
  emberAlive() { return this.list.filter((b) => b.team === 'ember' && b.alive); }
  ashAlive() { return this.list.filter((b) => b.team === 'ash' && b.alive); }
  // The two living Ash bots nearest the planted bomb own the defuse.
  defuseAssignees() {
    const bomb = this.game.rounds.bomb;
    if (!bomb.planted) return [];
    return this.list
      .filter((b) => b.team === 'ash' && b.alive)
      .sort((a, b) => Math.hypot(a.pos.x - bomb.x, a.pos.z - bomb.z) - Math.hypot(b.pos.x - bomb.x, b.pos.z - bomb.z))
      .slice(0, 2);
  }
  update(now, dt) { for (const b of this.list) b.update(now, dt, this.game); }
}
