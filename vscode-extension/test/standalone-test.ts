/**
 * 独立端到端测试 — 一条命令验证 BridgeServer + Mock Client 完整链路
 *
 * 运行：npx ts-node -P test/tsconfig.json test/standalone-test.ts
 *
 * 不依赖 F5 调试模式，在纯 Node.js 中启动 BridgeServer，
 * 然后用 Mock WebSocket Client 发送模拟 Figma 选中数据，
 * 最后验证 NodeStore 是否正确接收。
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════
// 0. 从 dist 加载 BridgeServer 和 NodeStore
// ═══════════════════════════════════════════════════════════

// 直接动态加载编译好的 JS（CommonJS）
const { BridgeServer } = require('../dist/bridgeServer');
const { NodeStore } = require('../dist/nodeStore');

// ═══════════════════════════════════════════════════════════
// 1. WebSocket 客户端（复刻 mock-figma-client.ts 的逻辑）
// ═══════════════════════════════════════════════════════════

function connectWebSocket(port: number): Promise<{
  send: (data: string) => void;
  close: () => void;
  onMessage: (cb: (msg: string) => void) => void;
}> {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    req.on('upgrade', (_res, socket) => {
      const listeners: Array<(msg: string) => void> = [];

      // 接收帧
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        // 简单帧解析（跳过 close/pong 帧）
        while (buffer.length >= 2) {
          const opcode = buffer[0] & 0x0F;
          let payloadLen = buffer[1] & 0x7F;
          let offset = 2;
          if (payloadLen === 126) { if (buffer.length < 4) break; payloadLen = buffer.readUInt16BE(2); offset = 4; }
          else if (payloadLen === 127) { if (buffer.length < 10) break; payloadLen = Number(buffer.readBigUInt64BE(2)); offset = 10; }
          const totalLen = offset + 4 + payloadLen; // masked
          if (buffer.length < totalLen) break;
          if (opcode === 0x01) {
            // unmask
            const mask = buffer.subarray(offset, offset + 4);
            const data = buffer.subarray(offset + 4, totalLen);
            const payload = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
            const msg = payload.toString('utf8');
            listeners.forEach(cb => cb(msg));
          }
          buffer = buffer.subarray(totalLen);
        }
      });

      // 发送帧（正确处理扩展长度编码）
      function sendFrame(data: string): void {
        const payload = Buffer.from(data, 'utf8');
        const mask = crypto.randomBytes(4);

        // 计算帧大小
        let headerSize = 2; // base header
        if (payload.length >= 126) headerSize += 2; // extended 16-bit
        if (payload.length > 65535) headerSize += 6; // extended 64-bit (total 8)
        headerSize += 4; // mask key

        const frame = Buffer.alloc(headerSize + payload.length);
        frame[0] = 0x81; // FIN + text opcode

        // 长度编码
        if (payload.length < 126) {
          frame[1] = 0x80 | payload.length;
        } else if (payload.length <= 65535) {
          frame[1] = 0x80 | 126;
          frame.writeUInt16BE(payload.length, 2);
        } else {
          frame[1] = 0x80 | 127;
          frame.writeBigUInt64BE(BigInt(payload.length), 2);
        }

        // mask key
        const maskOffset = headerSize - 4;
        mask.copy(frame, maskOffset);

        // masked payload
        for (let i = 0; i < payload.length; i++) {
          frame[maskOffset + 4 + i] = payload[i] ^ mask[i % 4];
        }
        socket.write(frame);
      }

      resolve({
        send: sendFrame,
        close: () => socket.destroy(),
        onMessage: (cb) => { listeners.push(cb); },
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(new Error(`WebSocket 连接失败: ${err.message}`));
    });

    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// 2. Mock 数据生成
// ═══════════════════════════════════════════════════════════

function makeMockHeader() {
  return {
    event: 'selectionchange',
    timestamp: Date.now(),
    pageId: '0:1',
    pageName: 'Page 1',
    count: 1,
    primary: {
      id: '100:1',
      name: 'Header',
      type: 'FRAME',
      width: 375,
      height: 64,
      x: 0,
      y: 0,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }],
      effects: [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 2 }, radius: 4, visible: true }],
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER',
      paddingLeft: 16, paddingRight: 16, paddingTop: 0, paddingBottom: 0,
      itemSpacing: 8,
      children: [
        { id: '100:2', name: 'Logo', type: 'TEXT' },
        { id: '100:3', name: 'Menu Icon', type: 'FRAME' },
      ],
    },
    others: [],
  };
}

function makeMockButton() {
  return {
    event: 'selectionchange',
    timestamp: Date.now() + 1000,
    pageId: '0:1',
    pageName: 'Page 1',
    count: 1,
    primary: {
      id: '200:1',
      name: 'Primary Button',
      type: 'FRAME',
      width: 120,
      height: 44,
      x: 100,
      y: 200,
      fills: [{ type: 'SOLID', color: { r: 0.227, g: 0.494, b: 0.969 }, opacity: 1 }],
      cornerRadius: 12,
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      paddingLeft: 24, paddingRight: 24, paddingTop: 12, paddingBottom: 12,
      itemSpacing: 0,
      children: [
        { id: '200:2', name: 'Label', type: 'TEXT' },
      ],
    },
    others: [{ id: '200:3', name: 'Icon', type: 'VECTOR' }],
  };
}

function makeMockText() {
  return {
    event: 'selectionchange',
    timestamp: Date.now() + 2000,
    pageId: '0:1',
    pageName: 'Page 1',
    count: 1,
    primary: {
      id: '300:1',
      name: 'Title',
      type: 'TEXT',
      width: 200,
      height: 28,
      x: 16,
      y: 80,
      characters: 'Welcome Back!',
      fontSize: 20,
      fontName: { family: 'Inter', style: 'Semi Bold' },
      lineHeight: { unit: 'PIXELS', value: 28 },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 }],
    },
    others: [],
  };
}

// ═══════════════════════════════════════════════════════════
// Mock PNG 图片（最小 1x1 透明 PNG，用于导出上下文测试）
// ═══════════════════════════════════════════════════════════

function makeMockPngBase64(): string {
  // 1×1 像素透明 PNG 的 Base64
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
}

// ═══════════════════════════════════════════════════════════
// 3. 主测试流程
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Figma Selection MCP — 独立链路测试      ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const store = new NodeStore();
  const bridge = new BridgeServer(9877, store);

  // ── 启动 BridgeServer ──
  console.log('🚀 启动 BridgeServer...');
  await bridge.start();
  const actualPort = store.getPort();
  console.log(`✅ BridgeServer 已启动在 ws://127.0.0.1:${actualPort}\n`);

  // ── 连接 Mock Figma Client ──
  console.log('🔌 连接 Mock Figma Client...');
  const ws = await connectWebSocket(actualPort!);
  console.log('✅ WebSocket 已连接\n');

  // ── 注册双向通信：处理 VS Code → Figma 的 exportContext 请求 ──
  ws.onMessage((msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.event === 'exportContext') {
        // 模拟 Figma 导出 PNG + 节点属性
        const sel = store.getSelection();
        if (!sel) {
          ws.send(JSON.stringify({ event: 'contextError', error: 'No selection' }));
          return;
        }
        const mockCtx = {
          event: 'context',
          timestamp: Date.now(),
          nodeId: sel.id,
          nodeName: sel.name,
          pageId: store.getFullMessage()?.pageId || '0:1',
          pageName: store.getFullMessage()?.pageName || 'Mock Page',
          node: sel, // 递归属性
          pngBase64: makeMockPngBase64(),
          scale: 1,
        };
        ws.send(JSON.stringify(mockCtx));
      }
    } catch { /* 忽略非 JSON 消息 */ }
  });

  // ── 监听 NodeStore 变化 ──
  const received: string[] = [];
  store.onSelectionChange((node: { name: string; type: string; width: number; height: number; children?: Array<{ name: string }>; fills?: unknown[] } | null) => {
    if (node) {
      received.push(node.name);
      console.log(`  📩 NodeStore 收到: ${node.name} (${node.type}) ${node.width}×${node.height}px`);
      if (node.children) {
        console.log(`     子元素: ${node.children.map((c: { name: string }) => c.name).join(', ')}`);
      }
      if (node.fills && Array.isArray(node.fills)) {
        const colors = node.fills
          .filter((f: unknown) => (f as { type: string }).type === 'SOLID')
          .map((f: unknown) => {
            const c = (f as { color: { r: number; g: number; b: number } }).color;
            const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
            return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
          });
        if (colors.length) console.log(`     颜色: ${colors.join(', ')}`);
      }
    } else {
      console.log('  📩 NodeStore 收到: null (deselect)');
    }
  });

  // ── 发送测试数据 ──
  console.log('\n📤 发送测试数据...\n');
  const scenarios = [
    { name: 'Header 导航栏', data: makeMockHeader() },
    { name: 'Primary Button 按钮', data: makeMockButton() },
    { name: 'Title 文字', data: makeMockText() },
  ];

  for (const s of scenarios) {
    console.log(`── 发送: ${s.name} ──`);
    ws.send(JSON.stringify(s.data));
    await new Promise(r => setTimeout(r, 500));
  }

  // ── 验证结果 ──
  await new Promise(r => setTimeout(r, 500));
  console.log('\n══════════════════════════════════════════');
  console.log('📊 测试结果');
  console.log('══════════════════════════════════════════');

  const expected = ['Header', 'Primary Button', 'Title'];
  let allPassed = true;

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    const got = received[i];
    const status = exp === got ? '✅' : '❌';
    if (exp !== got) allPassed = false;
    console.log(`  ${status} 第${i + 1}条: 期望 "${exp}" → 收到 "${got || '(无)'}"`);
  }

  console.log(`\n连接状态: ${store.isConnected() ? '🟢 已连接' : '🔴 断联'}`);
  console.log(`最后一次消息时间: ${new Date(store.getFullMessage()?.timestamp || 0).toISOString()}`);

  ws.close();
  bridge.stop();

  if (allPassed) {
    console.log('\n🎉 全部测试通过！BridgeServer ↔ Mock Client 链路正常。\n');
    console.log('下一步：');
    console.log('  1. 在 Figma Desktop 中导入插件 (figma-plugin/manifest.json)');
    console.log('  2. 在 VS Code 中按 F5 → 选择 "Run Extension (Figma MCP)"');
    console.log('  3. 在 Figma 中选中节点 → VS Code 状态栏实时显示');
    process.exit(0);
  } else {
    console.log('\n❌ 部分测试失败，请检查。');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ 测试异常:', err.message);
  console.error(err.stack);
  process.exit(1);
});
