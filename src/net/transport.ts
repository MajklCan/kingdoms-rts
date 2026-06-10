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
  onClose(cb: (info?: TransportCloseInfo) => void): void;
  close(): void;
}

export interface TransportCloseInfo {
  type: 'close' | 'error' | 'manual';
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

/** Real WebSocket transport against the relay (e.g. wss://…/kingdoms-mp). */
export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  private msgCb: ((msg: ServerMessage) => void) | null = null;
  private openCb: (() => void) | null = null;
  private closeCb: ((info?: TransportCloseInfo) => void) | null = null;
  private readonly sendQueue: ClientMessage[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('open', () => {
      // eslint-disable-next-line no-console
      console.info('[Kingdoms MP transport] open', { url, queued: this.sendQueue.length });
      for (const m of this.sendQueue) this.ws.send(encode(m));
      this.sendQueue.length = 0;
      this.openCb?.();
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = decodeServer(typeof ev.data === 'string' ? ev.data : '');
      if (msg) {
        this.msgCb?.(msg);
      } else {
        // eslint-disable-next-line no-console
        console.warn('[Kingdoms MP transport] dropped invalid server frame', {
          dataType: typeof ev.data,
          length: typeof ev.data === 'string' ? ev.data.length : null,
        });
      }
    });
    this.ws.addEventListener('close', (ev) => {
      const info: TransportCloseInfo = {
        type: 'close',
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
      };
      // eslint-disable-next-line no-console
      console.warn('[Kingdoms MP transport] close', info);
      this.closeCb?.(info);
    });
    this.ws.addEventListener('error', () => {
      const info: TransportCloseInfo = { type: 'error' };
      // eslint-disable-next-line no-console
      console.error('[Kingdoms MP transport] error', info);
      this.closeCb?.(info);
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.sendQueue.push(msg);
      // eslint-disable-next-line no-console
      console.info('[Kingdoms MP transport] queued while connecting', { msgType: msg.t, queued: this.sendQueue.length });
    } else {
      // eslint-disable-next-line no-console
      console.warn('[Kingdoms MP transport] dropped while closed', { msgType: msg.t, readyState: this.ws.readyState });
    }
  }

  onMessage(cb: (msg: ServerMessage) => void): void {
    this.msgCb = cb;
  }
  onOpen(cb: () => void): void {
    this.openCb = cb;
  }
  onClose(cb: (info?: TransportCloseInfo) => void): void {
    this.closeCb = cb;
  }
  close(): void {
    // eslint-disable-next-line no-console
    console.info('[Kingdoms MP transport] close requested');
    this.ws.close();
  }
}
