let nextId = 1;

export class Room {
  constructor() {
    this.id = String(nextId++);
    this.players = { bottom: null, top: null };
  }

  join(ws) {
    if (!this.players.bottom) { this.players.bottom = ws; return 'bottom'; }
    if (!this.players.top)    { this.players.top = ws;    return 'top'; }
    return null;
  }

  leave(side) {
    if (side) this.players[side] = null;
  }

  isFull()  { return this.players.bottom && this.players.top; }
  isEmpty() { return !this.players.bottom && !this.players.top; }

  start() {
    this._broadcast({ type: 'start' });
  }

  handleMessage(fromSide, msg) {
    // Relay input from one player to the other
    const otherSide = fromSide === 'bottom' ? 'top' : 'bottom';
    const other = this.players[otherSide];
    if (other && other.readyState === 1) {
      other.send(JSON.stringify({ ...msg, from: fromSide }));
    }
  }

  _broadcast(data) {
    const str = JSON.stringify(data);
    for (const ws of Object.values(this.players)) {
      if (ws && ws.readyState === 1) ws.send(str);
    }
  }
}
