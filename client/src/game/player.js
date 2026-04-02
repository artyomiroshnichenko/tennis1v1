const SPEED = 320;
const RADIUS = 18;
const SERVE_COOLDOWN = 1.2;

export class Player {
  constructor(x, y, side) {
    this.x = x;
    this.y = y;
    this.radius = RADIUS;
    this.side = side; // 'bottom' | 'top'
    this.serveCooldown = SERVE_COOLDOWN;
    this.color = side === 'bottom' ? '#e63946' : '#457b9d';
  }

  update(dt, keys, ball) {
    const pad = 40 + this.radius;
    const W = 600;

    if (keys['ArrowLeft'] || keys['KeyA']) this.x -= SPEED * dt;
    if (keys['ArrowRight'] || keys['KeyD']) this.x += SPEED * dt;
    if (keys['ArrowUp'] || keys['KeyW']) this.y -= SPEED * dt;
    if (keys['ArrowDown'] || keys['KeyS']) this.y += SPEED * dt;

    this.x = Math.max(pad, Math.min(W - pad, this.x));
    this.y = Math.max(400, Math.min(760, this.y));

    // Serve
    this.serveCooldown -= dt;
    if (!ball.inPlay && this.serveCooldown <= 0 && keys['Space']) {
      ball.x = this.x;
      ball.y = this.y - this.radius - ball.radius - 2;
      ball.serve(-1);
      this.serveCooldown = SERVE_COOLDOWN;
    }
  }

  updateAI(dt, ball) {
    const pad = 40 + this.radius;
    const W = 600;
    const speed = SPEED * 0.75;

    // Chase ball horizontally
    if (ball.x < this.x - 4) this.x -= speed * dt;
    else if (ball.x > this.x + 4) this.x += speed * dt;

    this.x = Math.max(pad, Math.min(W - pad, this.x));

    // AI serve
    this.serveCooldown -= dt;
    if (!ball.inPlay && this.serveCooldown <= 0) {
      ball.x = this.x;
      ball.y = this.y + this.radius + ball.radius + 2;
      ball.serve(1);
      this.serveCooldown = SERVE_COOLDOWN;
    }
  }

  draw(ctx) {
    // Shadow
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 4, this.radius, this.radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
