// Ember Yard — shared constants, weapon data and palette.
// All values are in metres / seconds / game units unless noted otherwise.
export const MAP = {
  width: 44, depth: 30, // playable area: x in [-22, 22], z in [-15, 15]
  wallHeight: 4,
  siteA: { x: 0, z: -12.5, size: 4 }, // plant zone centre + half-size
  attackerSpawn: { x: 0, z: 12 },
  defenderSpawn: { x: 0, z: -12 },
  roundTime: 100, freezeTime: 8, bombTime: 35,
  plantTime: 3.5, defuseTime: 5,
  winScore: 5, maxRounds: 9,
};

export const PALETTE = {
  concrete: 0x6b6f75, concreteDark: 0x55595e, steelTeal: 0x2e5f6b,
  wood: 0x8a6a45, woodDark: 0x6e5233, amber: 0xf0a830, amberLight: 0xffc65c,
  ember: 0xff7a1a, ash: 0x7d9bb5, siteYellow: 0xf5c542,
  skyTop: 0x2c4a63, skyBottom: 0xe08a4c, fog: 0x8a6f5c,
};

export const PLAYER = {
  radius: 0.4, eyeStand: 1.62, eyeCrouch: 1.05, heightStand: 1.8, heightCrouch: 1.1,
  walkSpeed: 5.2, crouchSpeed: 2.6, accel: 40, friction: 12,
  jumpSpeed: 5.4, gravity: 14, maxHp: 100,
};

// Damage falloff: full up to 20 m, linear down to 60% at 45 m, then flat 60%.
export function falloff(dist) {
  if (dist <= 20) return 1;
  if (dist >= 45) return 0.6;
  return 1 - 0.4 * (dist - 20) / 25;
}

export const WEAPONS = {
  sidekick: {
    id: 'sidekick', name: 'P-12 "Sidekick"', kind: 'pistol', price: 0,
    damage: 26, headMult: 3, rpm: 360, auto: false, mag: 12, reserve: 36,
    reload: 1.6, spread: 0.012, spreadPerShot: 0.004, maxSpread: 0.05,
    recoil: 0.011, range: 60,
  },
  scatter: {
    id: 'scatter', name: 'SK-9 "Scatter"', kind: 'smg', price: 1500,
    damage: 22, headMult: 3, rpm: 900, auto: true, mag: 32, reserve: 96,
    reload: 2.0, spread: 0.018, spreadPerShot: 0.003, maxSpread: 0.07,
    recoil: 0.009, range: 55,
  },
  longshot: {
    id: 'longshot', name: 'VK-7 "Longshot"', kind: 'rifle', price: 2700,
    damage: 34, headMult: 4, rpm: 600, auto: true, mag: 25, reserve: 75,
    reload: 2.4, spread: 0.006, spreadPerShot: 0.005, maxSpread: 0.06,
    recoil: 0.016, range: 80,
  },
};

export const ECONOMY = {
  startMoney: 800, killReward: 300, winReward: 3250, loseReward: 1900,
  plantReward: 300, grenadePrice: 300, armorPrice: 650, armorMax: 50,
};

export const BOT_NAMES_EMBER = ['Sable', 'Koda', 'Rook', 'Vex'];
export const BOT_NAMES_ASH = ['Dusk', 'Frost', 'Hale', 'Mire', 'Quill'];
export const PLAYER_NAME = 'You';
