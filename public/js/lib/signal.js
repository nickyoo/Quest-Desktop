/** Thin WebSocket signaling client with auto-reconnect. */
export class Signal extends EventTarget {
  constructor(role) {
    super();
    this.role = role;
    this.id = null;
    this.ws = null;
    this.backoff = 500;
  }

  connect() {
    const url = `wss://${location.host}/ws`;
    this.ws = new WebSocket(url);

    this.ws.addEventListener('open', () => {
      this.backoff = 500;
      this.ws.send(JSON.stringify({ type: 'hello', role: this.role }));
    });

    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'welcome') this.id = msg.id;
      this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }));
      this.dispatchEvent(new CustomEvent('*', { detail: msg }));
    });

    this.ws.addEventListener('close', () => {
      this.dispatchEvent(new CustomEvent('disconnected'));
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 8000);
    });

    this.ws.addEventListener('error', () => this.ws.close());
    return this;
  }

  post(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  signal(to, data) {
    this.post({ type: 'signal', to, data });
  }

  on(type, fn) {
    this.addEventListener(type, (e) => fn(e.detail));
    return this;
  }
}
