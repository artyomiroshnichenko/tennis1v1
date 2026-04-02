// WebSocket client — wired up when online mode is implemented
export class GameSocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.onMessage = null;
  }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onmessage = (e) => {
      if (this.onMessage) this.onMessage(JSON.parse(e.data));
    };
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) this.ws.close();
  }
}
