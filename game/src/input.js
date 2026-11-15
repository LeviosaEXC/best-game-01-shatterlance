// Keyboard and mouse state, plus the autopilot hook used only by the
// scripted verification driver (window.__shatter.autopilot). The game itself
// never reads Math.random and never synthesises input on its own.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseX = 640;
    this.mouseY = 360;
    this.mouseDown = false;
    this.mousePressed = false;
    this.rightDown = false;
    this.rightPressed = false;
    this.autopilot = null;

    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      this.pressed.add(event.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.rightDown = false;
    });
    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = ((event.clientX - rect.left) / rect.width) * 1280;
      this.mouseY = ((event.clientY - rect.top) / rect.height) * 720;
    });
    canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      } else if (event.button === 2) {
        this.rightDown = true;
        this.rightPressed = true;
      }
      event.preventDefault();
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mouseDown = false;
      else if (event.button === 2) this.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  down(code) {
    return this.keys.has(code);
  }

  // True only on the frame the key went down.
  hit(code) {
    return this.pressed.has(code);
  }

  // Movement vector from WASD / arrows, normalised.
  moveVector() {
    let x = 0;
    let y = 0;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyW') || this.down('ArrowUp')) y -= 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.sqrt(2);
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  // Aim angle from the player position to the mouse.
  aimAngle(px, py) {
    return Math.atan2(this.mouseY - py, this.mouseX - px);
  }

  // Consume all edge-triggered presses at the end of a frame.
  endFrame() {
    this.pressed.clear();
    this.mousePressed = false;
    this.rightPressed = false;
  }
}
