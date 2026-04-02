export class Court {
  constructor(w, h) {
    this.w = w;
    this.h = h;
  }

  draw(ctx) {
    const { w, h } = this;

    // Background
    ctx.fillStyle = '#2d6a2d';
    ctx.fillRect(0, 0, w, h);

    // Court outline
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    const pad = 40;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);

    // Net
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(pad, h / 2);
    ctx.lineTo(w - pad, h / 2);
    ctx.stroke();

    // Centre service line
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, pad);
    ctx.lineTo(w / 2, h - pad);
    ctx.stroke();

    // Service boxes
    const serviceY = h / 2 - 120;
    ctx.beginPath();
    ctx.moveTo(pad, serviceY);
    ctx.lineTo(w - pad, serviceY);
    ctx.stroke();

    const serviceYb = h / 2 + 120;
    ctx.beginPath();
    ctx.moveTo(pad, serviceYb);
    ctx.lineTo(w - pad, serviceYb);
    ctx.stroke();
  }
}
