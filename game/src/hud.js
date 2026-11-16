// HUD: DOM updates for health, ammo, timer, score, money, killfeed, menus.
export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      healthBar: $('health-bar'), healthNum: $('health-num'), armor: $('armor'),
      ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), weaponName: $('weapon-name'),
      timer: $('timer'), score: $('score'), money: $('money'), grenades: $('grenades'),
      killfeed: $('killfeed'), centerMsg: $('center-msg'), crosshair: $('crosshair'),
      hitmarker: $('hitmarker'), startMenu: $('start-menu'), buyMenu: $('buy-menu'),
      roundEnd: $('round-end'), roundEndText: $('round-end-text'),
      matchEnd: $('match-end'), matchEndText: $('match-end-text'),
      plantBar: $('plant-bar'), plantFill: $('plant-fill'), plantLabel: $('plant-label'),
      bombTimer: $('bomb-timer'), hint: $('hint'), defuseWarn: $('defuse-warning'),
    };
    this.msgTimer = 0;
    this.killfeedItems = [];
  }

  setHealth(hp, armor) {
    this.el.healthBar.style.width = Math.max(0, hp) + '%';
    this.el.healthNum.textContent = Math.ceil(hp);
    this.el.armor.textContent = armor > 0 ? `Armor ${Math.ceil(armor)}` : '';
    this.el.healthBar.style.background = hp > 50 ? '#7ec850' : hp > 25 ? '#f0a830' : '#e04040';
  }
  setAmmo(mag, reserve, name) {
    this.el.ammoMag.textContent = mag;
    this.el.ammoReserve.textContent = '/ ' + reserve;
    this.el.weaponName.textContent = name;
  }
  setTimer(seconds, phase, freezeLeft) {
    if (phase === 'freeze') {
      this.el.timer.textContent = 'BUY ' + Math.ceil(freezeLeft);
      this.el.timer.style.color = '#f0a830';
    } else {
      const s = Math.max(0, Math.ceil(seconds));
      this.el.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.el.timer.style.color = s <= 15 ? '#e04040' : '#fff';
    }
  }
  setScore(ember, ash) { this.el.score.textContent = `${ember} — ${ash}`; }
  setMoney(m) { this.el.money.textContent = '$' + m; }
  setGrenades(n) { this.el.grenades.textContent = n > 0 ? `Smoke x${n} [G]` : ''; }
  setBombTimer(planted, t) {
    this.el.bombTimer.style.display = planted ? 'block' : 'none';
    if (planted) this.el.bombTimer.textContent = 'BOMB ' + Math.ceil(t) + 's';
  }
  setCrosshair(spreadPx, moving) {
    const s = Math.round(6 + spreadPx);
    this.el.crosshair.style.setProperty('--gap', s + 'px');
    this.el.crosshair.classList.toggle('moving', moving);
  }
  showHitmarker(kill) {
    this.el.hitmarker.style.opacity = '1';
    this.el.hitmarker.classList.toggle('kill', !!kill);
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { this.el.hitmarker.style.opacity = '0'; }, 120);
  }
  message(text, seconds = 2.5) {
    this.el.centerMsg.textContent = text;
    this.el.centerMsg.style.opacity = '1';
    this.msgTimer = seconds;
  }
  tickMessage(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.centerMsg.style.opacity = '0';
    }
  }
  killfeed(killer, victim, weapon, head) {
    const div = document.createElement('div');
    div.className = 'kf-item';
    div.textContent = `${killer}  →  ${victim}  [${weapon}${head ? ' • HEADSHOT' : ''}]`;
    this.el.killfeed.prepend(div);
    this.killfeedItems.push(div);
    while (this.killfeedItems.length > 4) this.killfeedItems.shift().remove();
    setTimeout(() => div.remove(), 6000);
  }
  showStart(show) { this.el.startMenu.style.display = show ? 'flex' : 'none'; }
  showBuy(show) {
    this.el.buyMenu.style.display = show ? 'block' : 'none';
    if (show) this.refreshBuy();
  }
  refreshBuy(money, owned) {
    if (!money) return;
    const set = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
    set('buy-money', '$' + money);
    set('buy-longshot', owned.longshot ? 'OWNED' : '$2700');
    set('buy-scatter', owned.scatter ? 'OWNED' : '$1500');
    set('buy-grenade', '$300');
    set('buy-armor', '$650');
  }
  showRoundEnd(won, reason, score) {
    this.el.roundEndText.textContent = `${won ? 'ROUND WON' : 'ROUND LOST'} — ${reason}  (${score.ember}–${score.ash})`;
    this.el.roundEnd.style.display = 'block';
    setTimeout(() => { this.el.roundEnd.style.display = 'none'; }, 4000);
  }
  showMatchEnd(winner, score) {
    this.el.matchEndText.textContent = `${winner === 'ember' ? 'EMBER WINS THE MATCH' : 'ASH WINS THE MATCH'}  (${score.ember}–${score.ash})`;
    this.el.matchEnd.style.display = 'block';
  }
  hideMatchEnd() { this.el.matchEnd.style.display = 'none'; }
  showPlant(progress, label) {
    if (progress == null) { this.el.plantBar.style.display = 'none'; return; }
    this.el.plantBar.style.display = 'block';
    this.el.plantFill.style.width = Math.round(progress * 100) + '%';
    this.el.plantLabel.textContent = label;
  }
  setHint(t) { this.el.hint.textContent = t; }
  // Shown while an Ash bot is channeling the defuse; empty hides it.
  setDefuseWarning(t) {
    this.el.defuseWarn.textContent = t;
    this.el.defuseWarn.style.display = t ? 'block' : 'none';
  }
}
