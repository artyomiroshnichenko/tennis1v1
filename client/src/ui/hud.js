const POINTS = ['0', '15', '30', '40'];

export class HUD {
  constructor() {
    this.score = { bottom: 0, top: 0 };
  }

  point(who) {
    this.score[who]++;
  }

  draw(ctx, W) {
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.fillText(`YOU  ${this.score.bottom}`, 20, 30);
    ctx.textAlign = 'right';
    ctx.fillText(`${this.score.top}  CPU`, W - 20, 30);
  }
}
