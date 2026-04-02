const RADIUS = 8;
const INITIAL_SPEED = 280;

export class Ball {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = RADIUS;
    this.vx = 0;
    this.vy = 0;
    this.inPlay = false;
  }

  serve(direction = 1) {
    const angle = (Math.random() - 0.5) * 0.8;
    this.vx = Math.sin(angle) * INITIAL_SPEED;
    this.vy = direction * INITIAL_SPEED;
    this.inPlay = true;
  }

  update(dt, playerBottom, playerTop, W, H, hud) {
    if (!this.inPlay) return;

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Wall bounce
    const pad = 40;
    if (this.x - this.radius < pad) { this.x = pad + this.radius; this.vx = Math.abs(this.vx); }
    if (this.x + this.radius > W - pad) { this.x = W - pad - this.radius; this.vx = -Math.abs(this.vx); }

    // Player collisions
    this._checkPaddleHit(playerBottom);
    this._checkPaddleHit(playerTop);

    // Scoring
    if (this.y > H) {
      hud.point('top');
      this._reset(W / 2, H / 2);
    }
    if (this.y < 0) {
      hud.point('bottom');
      this._reset(W / 2, H / 2);
    }
  }

  _checkPaddleHit(player) {
    const dx = this.x - player.x;
    const dy = this.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < this.radius + player.radius) {
      const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy) * 1.05;
      const nx = dx / dist;
      const ny = dy / dist;
      this.vx = nx * speed;
      this.vy = ny * speed;
      // Push out of overlap
      this.x = player.x + nx * (this.radius + player.radius + 1);
      this.y = player.y + ny * (this.radius + player.radius + 1);
    }
  }

  _reset(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.inPlay = false;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#c8f000';
    ctx.fill();
    ctx.strokeStyle = '#8ab000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
