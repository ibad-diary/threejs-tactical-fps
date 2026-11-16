// Rounds: state machine, economy, buy menu data, bomb plant/defuse objective.
import { MAP, ECONOMY, WEAPONS } from './config.js';

export class Rounds {
  constructor(game) {
    this.game = game;
    this.round = 1;
    this.score = { ember: 0, ash: 0 };
    this.phase = 'menu'; // menu | freeze | live | ended | matchEnd
    this.timer = MAP.roundTime;
    this.freezeTimer = MAP.freezeTime;
    this.endTimer = 0;
    this.endReason = '';
    this.money = ECONOMY.startMoney;
    this.armor = 0;
    this.bomb = { planted: false, x: MAP.siteA.x, z: MAP.siteA.z, timer: 0, planter: null, beepTimer: 0 };
    this.buyOpen = false;
  }

  startMatch() {
    this.round = 1; this.score = { ember: 0, ash: 0 };
    this.money = ECONOMY.startMoney;
    this.startRound();
  }

  startRound() {
    const g = this.game;
    this.bomb = { planted: false, x: MAP.siteA.x, z: MAP.siteA.z, timer: 0, planter: null, beepTimer: 0 };
    this.phase = 'freeze'; this.freezeTimer = MAP.freezeTime; this.timer = MAP.roundTime;
    this.buyOpen = true;
    g.player.respawn(...g.world.attackerSpawns()[0]);
    g.bots.respawnAll();
    g.weapons.resetForRound();
    g.player.armor = this.armor;
    g.grenades.reset();
    g.hud.message(`Round ${this.round} — press B to buy`, 3);
    g.hud.showBuy(true);
  }

  // Freeze time counts down, then the round goes live.
  update(dt) {
    const g = this.game;
    if (this.phase === 'freeze') {
      this.freezeTimer -= dt;
      if (this.freezeTimer <= 0) { this.phase = 'live'; this.buyOpen = false; g.hud.showBuy(false); g.hud.message('Go!', 1); }
      return;
    }
    if (this.phase !== 'live') {
      if (this.phase === 'ended') {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.nextRound();
      }
      return;
    }
    this.timer -= dt;
    if (this.bomb.planted) {
      this.bomb.timer -= dt;
      this.bomb.beepTimer -= dt;
      if (this.bomb.beepTimer <= 0) { g.audio.beep(this.bomb.timer < 10 ? 1600 : 1100); this.bomb.beepTimer = this.bomb.timer < 10 ? 0.5 : 1; }
      if (this.bomb.timer <= 0) { this.endRound('ember', 'Bomb detonated'); g.audio.explosion(); return; }
    }
    if (this.timer <= 0) {
      // Timer expiry: defenders win unless the bomb is planted (then bomb timer rules).
      if (!this.bomb.planted) this.endRound('ash', 'Time expired — Site A held');
      return;
    }
    // Elimination check.
    if (g.player.alive === false && g.bots.emberAlive().length === 0) {
      this.endRound('ash', 'Ember team eliminated');
    } else if (g.bots.ashAlive().length === 0) {
      this.endRound('ember', 'Ash team eliminated');
    }
  }

  endRound(winner, reason) {
    if (this.phase !== 'live' && this.phase !== 'freeze') return;
    this.phase = 'ended'; this.endTimer = 4; this.endReason = reason;
    this.score[winner] += 1;
    const won = winner === 'ember';
    this.money += won ? ECONOMY.winReward : ECONOMY.loseReward;
    if (won) this.game.audio.roundWin(); else this.game.audio.roundLose();
    this.game.hud.showRoundEnd(won, reason, this.score);
    // Match end?
    if (this.score[winner] >= MAP.winScore || this.round >= MAP.maxRounds) {
      this.phase = 'matchEnd';
      this.game.hud.showMatchEnd(this.score.ember > this.score.ash ? 'ember' : 'ash', this.score);
    }
  }

  nextRound() {
    if (this.phase === 'matchEnd') return;
    this.round += 1;
    if (this.round > MAP.maxRounds) { this.phase = 'matchEnd'; return; }
    this.startRound();
  }

  // --- Bomb ---
  inSite(x, z) {
    const s = MAP.siteA;
    return Math.abs(x - s.x) <= s.size / 2 && Math.abs(z - s.z) <= s.size / 2;
  }
  plantBomb(actor) {
    if (this.bomb.planted || this.phase !== 'live') return false;
    this.bomb.planted = true; this.bomb.timer = MAP.bombTime; this.bomb.planter = actor;
    this.bomb.x = MAP.siteA.x; this.bomb.z = MAP.siteA.z; this.bomb.beepTimer = 1;
    if (actor === 'player') this.money += ECONOMY.plantReward;
    this.game.audio.plant();
    this.game.hud.message('Bomb planted — 35 seconds', 3);
    return true;
  }
  defuseBomb(actor) {
    if (!this.bomb.planted) return false;
    this.bomb.planted = false;
    this.endRound('ash', actor === 'player' ? 'Bomb defused by you' : 'Bomb defused');
    return true;
  }
  // The bomb carrier is the player while alive; else the first living ember bot.
  carrierAlive(game) {
    if (game.player.alive) return true;
    return game.bots.emberAlive().length > 0;
  }

  // --- Economy / buy menu ---
  canBuy() { return this.phase === 'freeze' && this.buyOpen; }
  buy(id) {
    if (!this.canBuy()) return 'Buy window closed';
    if (id === 'grenade') {
      if (this.money < ECONOMY.grenadePrice) return 'Not enough money';
      if (this.game.grenades.count >= 2) return 'Max 2 grenades';
      this.money -= ECONOMY.grenadePrice; this.game.grenades.count += 1;
      return null;
    }
    if (id === 'armor') {
      if (this.money < ECONOMY.armorPrice) return 'Not enough money';
      if (this.armor >= ECONOMY.armorMax) return 'Armor full';
      this.money -= ECONOMY.armorPrice; this.armor = ECONOMY.armorMax;
      this.game.player.armor = ECONOMY.armorMax;
      return null;
    }
    const def = WEAPONS[id];
    if (!def) return 'Unknown item';
    if (this.game.weapons.states[id].owned) return 'Already owned';
    if (this.money < def.price) return 'Not enough money';
    this.money -= def.price;
    this.game.weapons.buy(id);
    return null;
  }
}
