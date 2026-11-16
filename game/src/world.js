// Ember Yard — map construction, AABB colliders, nav grid, spawns, Site A.
import * as THREE from 'three';
import { MAP, PALETTE } from './config.js';

// One axis-aligned collider. y range matters only for tall cover checks.
export function makeCollider(cx, cz, hx, hz, y0 = 0, y1 = 4) {
  return { minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, y0, y1 };
}

// Circle (x,z,r) vs AABB push-out. Returns corrected position in `out`.
const _c = { x: 0, z: 0 };
export function collideCircle(colliders, x, z, r, out) {
  out.x = x; out.z = z;
  for (const c of colliders) {
    const nx = Math.max(c.minX, Math.min(out.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(out.z, c.maxZ));
    const dx = out.x - nx, dz = out.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      out.x = nx + (dx / d) * r; out.z = nz + (dz / d) * r;
    } else {
      // Centre inside the box: push out along the smallest penetration axis.
      const pl = out.x - c.minX, pr = c.maxX - out.x;
      const pt = out.z - c.minZ, pb = c.maxZ - out.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) out.x = c.minX - r; else if (m === pr) out.x = c.maxX + r;
      else if (m === pt) out.z = c.minZ - r; else out.z = c.maxZ + r;
    }
  }
  return out;
}

// Point-in-collider test (for nav grid and spawn validation).
export function pointBlocked(colliders, x, z) {
  for (const c of colliders) {
    if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return true;
  }
  return false;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.meshes = []; // solid meshes for raycast blocking
    this.siteA = MAP.siteA;
    this.build();
    this.buildNavGrid();
  }

  addBox(cx, cy, cz, sx, sy, sz, color, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.9, metalness: opts.metal ?? 0.05 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(cx, cy, cz);
    m.castShadow = true; m.receiveShadow = true;
    this.scene.add(m);
    if (opts.collide !== false) {
      this.colliders.push(makeCollider(cx, cz, sx / 2, sz / 2, cy - sy / 2, cy + sy / 2));
      this.meshes.push(m);
    }
    return m;
  }

  build() {
    const s = this.scene;
    const W = MAP.width, D = MAP.depth;
    // Floor (concrete slab, slightly darker border strip).
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W + 6, D + 6),
      new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; s.add(floor);
    // Perimeter walls, 4 m tall, 0.6 m thick.
    this.addBox(0, 2, -D / 2 - 0.3, W + 1.2, 4, 0.6, PALETTE.concreteDark);
    this.addBox(0, 2, D / 2 + 0.3, W + 1.2, 4, 0.6, PALETTE.concreteDark);
    this.addBox(-W / 2 - 0.3, 2, 0, 0.6, 4, D + 1.2, PALETTE.concreteDark);
    this.addBox(W / 2 + 0.3, 2, 0, 0.6, 4, D + 1.2, PALETTE.concreteDark);

    // --- Long Hall (west lane): corridor along x = -17 with two bends. ---
    // North-south wall segments forming the hall, leaving gaps at z = -2 and z = 6.
    this.addBox(-14, 2, -15, 0.5, 4, 4, PALETTE.steelTeal); // north stub
    this.addBox(-14, 2, -6, 0.5, 4, 8, PALETTE.steelTeal);  // mid wall
    this.addBox(-14, 2, 2, 0.5, 4, 4, PALETTE.steelTeal);   // south stub
    this.addBox(-18, 2, -2, 8, 4, 0.5, PALETTE.steelTeal);  // bend wall north
    this.addBox(-18, 2, 6, 8, 4, 0.5, PALETTE.steelTeal);   // bend wall south
    // Hall cover crates.
    this.addBox(-17, 0.5, -9, 1, 1, 1, PALETTE.wood);
    this.addBox(-17, 0.5, 4, 1, 1, 1, PALETTE.wood);
    this.addBox(-19.5, 0.6, -4, 2, 1.2, 1, PALETTE.woodDark);

    // --- Mid Cut (centre): open lane with two crates + a steel container. ---
    this.addBox(-2, 0.5, 0, 1, 1, 1, PALETTE.wood);
    this.addBox(3, 0.5, 3, 1, 1, 1, PALETTE.wood);
    this.addBox(4, 0.6, -4, 2, 1.2, 1, PALETTE.woodDark);
    this.addBox(8, 1.3, -1, 6, 2.6, 2.4, PALETTE.steelTeal, { metal: 0.4, rough: 0.6 }); // container
    this.addBox(-6, 1.3, 7, 6, 2.6, 2.4, PALETTE.steelTeal, { metal: 0.4, rough: 0.6 }); // container

    // --- Connector (mid-north corridor, z = -6): low cover walls. ---
    this.addBox(-6, 0.6, -6, 4, 1.2, 0.5, PALETTE.concreteDark);
    this.addBox(7, 1.2, -6, 4, 2.4, 0.5, PALETTE.concreteDark);
    this.addBox(0, 0.5, -8.5, 1, 1, 1, PALETTE.wood);

    // --- Site A (north end): yellow plant pad + lamp + cover. ---
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(MAP.siteA.size, MAP.siteA.size),
      new THREE.MeshStandardMaterial({ color: PALETTE.siteYellow, roughness: 0.7, emissive: 0x553300, emissiveIntensity: 0.4 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(MAP.siteA.x, 0.02, MAP.siteA.z);
    pad.receiveShadow = true; s.add(pad);
    this.addBox(-3.5, 0.5, -12.5, 1, 1, 1, PALETTE.wood);
    this.addBox(3.5, 0.5, -12.5, 1, 1, 1, PALETTE.wood);
    this.addBox(0, 1.2, -14, 6, 2.4, 0.6, PALETTE.concreteDark); // back cover wall
    // Barrels (cylinders, approximated by square colliders).
    this.addBarrel(-9, -10); this.addBarrel(9, -10); this.addBarrel(12, 8); this.addBarrel(-12, 9);
    // South spawn cover.
    this.addBox(-4, 0.6, 10, 2, 1.2, 1, PALETTE.woodDark);
    this.addBox(5, 0.6, 10, 2, 1.2, 1, PALETTE.woodDark);

    // Site A marker light + yard lamps (visual only, colliders off for poles).
    this.addPointLight(MAP.siteA.x, 3.2, MAP.siteA.z, 0xffc65c, 18, 12);
    this.addPointLight(-12, 3.5, 0, 0xf0a830, 14, 14);
    this.addPointLight(12, 3.5, -4, 0xf0a830, 14, 14);
    // Lamp posts.
    for (const [x, z] of [[-12, 0], [12, -4], [0, -12.5]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8),
        new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.6 }));
      pole.position.set(x, 1.75, z); pole.castShadow = true; s.add(pole);
    }
  }

  addBarrel(x, z) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x9a4a2a, roughness: 0.7, metalness: 0.3 }));
    b.position.set(x, 0.55, z); b.castShadow = true; b.receiveShadow = true;
    this.scene.add(b);
    this.colliders.push(makeCollider(x, z, 0.5, 0.5, 0, 1.1));
    this.meshes.push(b);
  }

  addPointLight(x, y, z, color, intensity, distance) {
    const l = new THREE.PointLight(color, intensity, distance, 1.6);
    l.position.set(x, y, z); this.scene.add(l);
  }

  // 1 m nav grid over the map; cell blocked if its centre is inside a collider.
  buildNavGrid() {
    this.gridW = MAP.width; this.gridD = MAP.depth;
    this.grid = new Uint8Array(this.gridW * this.gridD);
    for (let gz = 0; gz < this.gridD; gz++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const x = gx - MAP.width / 2 + 0.5, z = gz - MAP.depth / 2 + 0.5;
        this.grid[gz * this.gridW + gx] = pointBlocked(this.colliders, x, z) ? 1 : 0;
      }
    }
  }

  toGrid(x, z) {
    return {
      gx: Math.max(0, Math.min(this.gridW - 1, Math.floor(x + MAP.width / 2))),
      gz: Math.max(0, Math.min(this.gridD - 1, Math.floor(z + MAP.depth / 2))),
    };
  }
  toWorld(gx, gz) { return { x: gx - MAP.width / 2 + 0.5, z: gz - MAP.depth / 2 + 0.5 }; }
  isWalkable(gx, gz) {
    if (gx < 0 || gz < 0 || gx >= this.gridW || gz >= this.gridD) return false;
    return this.grid[gz * this.gridW + gx] === 0;
  }

  // Waypoint routes per lane for bot patrols (world coords).
  patrolRoutes() {
    return {
      long: [[-19, 10], [-19, -2], [-19, -11], [-16, -12], [-10, -11]],
      mid: [[-2, 11], [-2, 0], [2, -6], [0, -11]],
      connector: [[8, 10], [8, -6], [-6, -6], [-6, -11]],
      site: [[-4, -11], [4, -11], [0, -9], [-2, -13]],
    };
  }

  attackerSpawns() {
    return [[-4, 12.5], [-1.5, 13], [1.5, 13], [4, 12.5], [0, 11]];
  }
  defenderSpawns() {
    return [[-4, -12.5], [-1.5, -13], [1.5, -13], [4, -12.5], [0, -11]];
  }
}
