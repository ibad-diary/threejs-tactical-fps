// Keyboard / mouse / pointer-lock state. No game logic here.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.mouseDown = false; this.mouseClicked = false; // edge-triggered click
    this.locked = false;
    this.onKey = null; // (code) => void, set by main for one-shot keys
    this.onMouseDown = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouseDown = true; this.mouseClicked = true;
      if (this.onMouseDown) this.onMouseDown();
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseDown = false; });
  }

  requestLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { /* headless / denied: game still runs */ });
    } catch { /* ignore */ }
  }
  exitLock() { if (this.locked) document.exitPointerLock(); }

  down(code) { return this.keys.has(code); }
  // Consume accumulated mouse deltas (called once per fixed step).
  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }
  consumeClick() {
    const c = this.mouseClicked; this.mouseClicked = false; return c;
  }
}
