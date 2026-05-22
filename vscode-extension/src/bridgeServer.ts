import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { NodeStore } from './nodeStore';

/**
 * 轻量级 WebSocket Server（零依赖，纯 Node.js 实现）。
 * 避免引入 ws 库的依赖负担，仅实现 RFC 6455 的握手 + 收发文本帧。
 * 支持双向通信：接收 Figma 消息 & 向 Figma 发送指令。
 */
export class BridgeServer {
  private server: http.Server | null = null;
  private sockets: Set<Socket> = new Set();
  private figmaSocket: Socket | null = null;

  constructor(
    private readonly startPort: number,
    private readonly store: NodeStore,
  ) { }

  async start(): Promise<void> {
    const port = await this.findAvailablePort(this.startPort, this.startPort + 10);
    if (port === null) {
      console.error('[Figma MCP] No available port found in range');
      return;
    }

    this.server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    this.server.on('upgrade', (req: IncomingMessage, socket: Socket, _head: Buffer) => {
      this.handleUpgrade(req, socket);
    });

    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(port, '127.0.0.1', () => {
        console.log(`[Figma MCP] Bridge server listening on ws://127.0.0.1:${port}`);
        this.store.setPort(port);
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  /**
   * 向 Figma 插件发送 JSON 消息（从服务器 → 客户端，帧不 mask）
   */
  send(data: Record<string, unknown>): boolean {
    if (!this.figmaSocket || this.figmaSocket.destroyed) {
      console.warn('[Figma MCP] No Figma connection to send to');
      return false;
    }
    try {
      const payload = Buffer.from(JSON.stringify(data), 'utf8');
      const frame = this.encodeServerFrame(payload);
      this.figmaSocket.write(frame);
      return true;
    } catch (e) {
      console.error('[Figma MCP] Send failed:', e);
      return false;
    }
  }

  isFigmaConnected(): boolean {
    return this.figmaSocket !== null && !this.figmaSocket.destroyed;
  }

  stop(): void {
    this.sockets.forEach(s => s.destroy());
    this.sockets.clear();
    this.figmaSocket = null;
    this.server?.close();
    this.server = null;
  }

  dispose(): void {
    this.stop();
  }

  // ── 编码服务器→客户端帧（不 mask） ─────────────────────
  private encodeServerFrame(payload: Buffer): Buffer {
    // 计算头部大小
    let headerSize = 2;
    if (payload.length >= 126) headerSize += 2;
    if (payload.length > 65535) headerSize += 6;

    const frame = Buffer.alloc(headerSize + payload.length);
    frame[0] = 0x81; // FIN + text opcode

    if (payload.length < 126) {
      frame[1] = payload.length;
    } else if (payload.length <= 65535) {
      frame[1] = 126;
      frame.writeUInt16BE(payload.length, 2);
    } else {
      frame[1] = 127;
      frame.writeBigUInt64BE(BigInt(payload.length), 2);
    }

    payload.copy(frame, headerSize);
    return frame;
  }

  // ── WebSocket 握手 ──────────────────────────────────────
  private handleUpgrade(req: IncomingMessage, socket: Socket): void {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    // 如果已有连接，关闭旧连接（只保留一个 Figma 连接）
    if (this.figmaSocket && !this.figmaSocket.destroyed) {
      console.log('[Figma MCP] New Figma connection, closing old one');
      this.figmaSocket.destroy();
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', 'binary')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey + '\r\n\r\n'
    );

    console.log('[Figma MCP] Figma plugin connected');
    this.figmaSocket = socket;
    this.store.setConnected(true);

    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 2) {
        const frame = this.parseFrame(buffer);
        if (!frame) break;

        buffer = buffer.subarray(frame.totalLength);

        if (frame.opcode === 0x01) {
          // 文本帧
          try {
            const msg = JSON.parse(frame.payload.toString('utf8'));
            if (msg.event === 'selectionchange') {
              this.store.setSelection(msg);
            } else if (msg.event === 'context') {
              // Figma 导出的完整上下文（含截图）
              this.store.setContext(msg);
            } else if (msg.event === 'init') {
              console.log('[Figma MCP] Plugin initialized');
            }
          } catch (e) {
            console.error('[Figma MCP] Failed to parse message:', e);
          }
        } else if (frame.opcode === 0x08) {
          // Close frame
          socket.destroy();
          return;
        } else if (frame.opcode === 0x09) {
          // Ping → Pong
          const pong = Buffer.alloc(2 + frame.payload.length);
          pong[0] = 0x8A; // FIN + opcode pong
          pong[1] = frame.payload.length;
          frame.payload.copy(pong, 2);
          socket.write(pong);
        }
      }
    });

    socket.on('close', () => {
      console.log('[Figma MCP] Figma plugin disconnected');
      this.figmaSocket = null;
      this.store.setConnected(false);
    });

    socket.on('error', (err) => {
      console.error('[Figma MCP] Socket error:', err.message);
      this.figmaSocket = null;
      this.store.setConnected(false);
    });
  }

  // ── 帧解析 ──────────────────────────────────────────────
  private parseFrame(buffer: Buffer): {
    opcode: number;
    payload: Buffer;
    totalLength: number;
  } | null {
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const secondByte = buffer[1];
    const opcode = firstByte & 0x0F;
    const masked = (secondByte & 0x80) !== 0;

    let payloadLength = secondByte & 0x7F;
    let headerOffset = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null;
      payloadLength = buffer.readUInt16BE(2);
      headerOffset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null;
      // 只处理低 32 位（Figma 消息不会超过 4GB）
      payloadLength = Number(buffer.readBigUInt64BE(2));
      headerOffset = 10;
    }

    const maskOffset = headerOffset;
    const mask = masked ? buffer.subarray(maskOffset, maskOffset + 4) : null;
    const dataOffset = masked ? maskOffset + 4 : maskOffset;
    const totalLength = dataOffset + payloadLength;

    if (buffer.length < totalLength) return null;

    let payload = buffer.subarray(dataOffset, totalLength);
    if (masked && mask) {
      payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    }

    return { opcode, payload, totalLength };
  }

  // ── 端口扫描 ────────────────────────────────────────────
  private async findAvailablePort(from: number, to: number): Promise<number | null> {
    for (let port = from; port <= to; port++) {
      const available = await new Promise<boolean>((resolve) => {
        const server = http.createServer();
        server.listen(port, '127.0.0.1', () => {
          server.close(() => resolve(true));
        });
        server.on('error', () => resolve(false));
      });
      if (available) return port;
    }
    return null;
  }
}
