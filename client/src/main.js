import { Court } from './game/court.js';
import { Ball } from './game/ball.js';
import { Player } from './game/player.js';
import { HUD } from './ui/hud.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// Viewport — fixed logical resolution, scaled to window
const W = 600;
const H = 800;

function resize() {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${W * scale}px`;
  canvas.style.height = `${H * scale}px`;
}
resize();
window.addEventListener('resize', resize);

// Game objects
const court = new Court(W, H);
const ball = new Ball(W / 2, H / 2);
const playerBottom = new Player(W / 2, H - 80, 'bottom');
const playerTop = new Player(W / 2, 80, 'top');
const hud = new HUD();

// Input
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

// Game loop
let last = 0;
function loop(ts) {
  const dt = Math.min((ts - last) / 1000, 0.05);
  last = ts;

  playerBottom.update(dt, keys, ball);
  playerTop.updateAI(dt, ball);
  ball.update(dt, playerBottom, playerTop, W, H, hud);

  ctx.clearRect(0, 0, W, H);
  court.draw(ctx);
  ball.draw(ctx);
  playerBottom.draw(ctx);
  playerTop.draw(ctx);
  hud.draw(ctx, W);

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
