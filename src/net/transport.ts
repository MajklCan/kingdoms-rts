/**
 * Transport — the wire between a client and the lockstep relay. Abstracted so
 * the session doesn't care whether frames travel over a real WebSocket or an
 * in-process test double.
 */

import {
  decodeServer,
  encode,
  type ClientMessage,
  type ServerMessage,
} from './protocol';

export interface Transport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): void;
  onOpen(cb: () => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Real WebSocket transport against the relay (e.g. wss://…/kingdoms-mp). */
export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private msgCb: ((msg: ServerMessage) => void) | null = null;
  private openCb: (() => void) | null = null;
  private closeCb: (() => void) | null = null;
  private readonly sendQueue: ClientMessage[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      for (const m of this.sendQueue) this.ws.send(encode(m));
      this.sendQueue.length = 0;
      this.openCb?.();
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = decodeServer(typeof ev.data === 'string' ? ev.data : '');
      if (msg) this.msgCb?.(msg);
    });
    this.ws.addEventListener('close', () => this.closeCb?.());
    this.ws.addEventListener('error', () => this.closeCb?.());
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.sendQueue.push(msg);
    }
    // Dropped if closing/closed — caller is notified via onClose.
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.msgCb = cb;
  }
  onOpen(cb: () => void): void {
    this.openCb = cb;
  }
  onClose(cb: () => void): void {
    this.closeCb = cb;
  }
  close(): void {
    this.ws.close();
  }
}
