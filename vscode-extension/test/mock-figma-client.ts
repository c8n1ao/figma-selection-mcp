/**
 * Mock Figma Client — 测试入口
 *
 * 模拟 Figma Plugin 通过 WebSocket 向 BridgeServer 发送选中数据。
 * 运行方式：
 *   npm test
 *   npx ts-node test/mock-figma-client.ts
 *
 * 使用说明：
 * 1. 先在 VS Code 中按 F5 启动扩展开发模式（这会启动 BridgeServer）
 * 2. 然后运行本测试脚本模拟 Figma 发送数据
 * 3. 观察 VS Code 状态栏和 Inspector Panel 的变化
 */

import * as http from 'node:http';
import * as crypto from 'node:crypto';

// ═══════════════════════════════════════════════════════════
// WebSocket 客户端（零依赖）
// ═══════════════════════════════════════════════════════════

function connectWebSocket(port: number): Promise<{ send: (data: string) => void; close: () => void; onMessage: (cb: (msg: string) => void) => void }> {
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

    req.on('upgrade', (res, socket) => {
      // WebSocket 帧封装（正确处理扩展长度编码）
      function sendFrame(data: string): void {
        const payload = Buffer.from(data, 'utf8');
        const mask = crypto.randomBytes(4);

        // 计算帧大小
        let headerSize = 2; // base header
        if (payload.length >= 126) headerSize += 2; // extended 16-bit
        if (payload.length > 65535) headerSize += 6; // extended 64-bit
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

      socket.on('error', (err) => {
        console.error('Socket error:', err.message);
      });

      const msgListeners: Array<(msg: string) => void> = [];
      let recvBuffer = Buffer.alloc(0);
      socket.on('data', (chunk: Buffer) => {
        recvBuffer = Buffer.concat([recvBuffer, chunk]);
        while (recvBuffer.length >= 2) {
          const opcode = recvBuffer[0] & 0x0F;
          let plen = recvBuffer[1] & 0x7F;
          let off = 2;
          if (plen === 126) { if (recvBuffer.length < 4) break; plen = recvBuffer.readUInt16BE(2); off = 4; }
          else if (plen === 127) { if (recvBuffer.length < 10) break; plen = Number(recvBuffer.readBigUInt64BE(2)); off = 10; }
          const totalLen = off + plen;
          if (recvBuffer.length < totalLen) break;
          if (opcode === 0x01) {
            const payload = recvBuffer.subarray(off, totalLen).toString('utf8');
            msgListeners.forEach(cb => cb(payload));
          }
          recvBuffer = recvBuffer.subarray(totalLen);
        }
      });

      resolve({
        send: sendFrame,
        close: () => socket.destroy(),
        onMessage: (cb: (msg: string) => void) => { msgListeners.push(cb); },
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error(
          `无法连接到 ws://127.0.0.1:${port}。\n` +
          '请先在 VS Code 中按 F5 启动扩展开发模式。'
        ));
      } else {
        reject(err);
      }
    });

    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// Mock 数据
// ═══════════════════════════════════════════════════════════

function createMockHeader(): Record<string, unknown> {
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
      fills: [
        { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 },
      ],
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.1 },
          offset: { x: 0, y: 2 },
          radius: 4,
          visible: true,
        },
      ],
      cornerRadius: 0,
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'SPACE_BETWEEN',
      counterAxisAlignItems: 'CENTER',
      paddingLeft: 16,
      paddingRight: 16,
      paddingTop: 0,
      paddingBottom: 0,
      itemSpacing: 8,
      children: [
        { id: '100:2', name: 'Logo', type: 'TEXT' },
        { id: '100:3', name: 'Menu Icon', type: 'FRAME' },
      ],
    },
    others: [],
  };
}

function createMockButton(): Record<string, unknown> {
  return {
    event: 'selectionchange',
    timestamp: Date.now(),
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
      fills: [
        { type: 'SOLID', color: { r: 0.227, g: 0.494, b: 0.969 }, opacity: 1 },
      ],
      cornerRadius: 12,
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'CENTER',
      paddingLeft: 24,
      paddingRight: 24,
      paddingTop: 12,
      paddingBottom: 12,
      itemSpacing: 0,
      children: [
        { id: '200:2', name: 'Label', type: 'TEXT' },
      ],
    },
    others: [],
  };
}

function createMockText(): Record<string, unknown> {
  return {
    event: 'selectionchange',
    timestamp: Date.now(),
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
      letterSpacing: { unit: 'PERCENT', value: 0 },
      fills: [
        { type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1 }, opacity: 1 },
      ],
      textAlignHorizontal: 'LEFT',
      textAlignVertical: 'TOP',
    },
    others: [],
  };
}

// ═══════════════════════════════════════════════════════════
// 测试运行器
// ═══════════════════════════════════════════════════════════

async function runTest(port: number): Promise<void> {
  console.log(`🔌 正在连接 ws://127.0.0.1:${port} ...`);
  const ws = await connectWebSocket(port);
  console.log('✅ WebSocket 已连接\n');

  // 处理双向通信：VS Code → Figma 的 exportContext 请求
  let lastNode: any = null;
  ws.onMessage((msg) => {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.event === 'exportContext' && lastNode?.primary) {
        const mockCtx = {
          event: 'context',
          timestamp: Date.now(),
          nodeId: lastNode.primary.id || '',
          nodeName: lastNode.primary.name || '',
          pageId: lastNode.pageId || '0:1',
          pageName: lastNode.pageName || 'Mock Page',
          node: lastNode.primary,
          pngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          scale: 1,
        };
        ws.send(JSON.stringify(mockCtx));
      }
    } catch { /* 忽略 */ }
  });

  const scenarios = [
    { name: 'Header 导航栏', data: createMockHeader() },
    { name: 'Primary Button 按钮', data: createMockButton() },
    { name: 'Title 文字', data: createMockText() },
  ];

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    console.log(`📤 [${i + 1}/${scenarios.length}] 发送: ${s.name}`);
    ws.send(JSON.stringify(s.data));
    lastNode = s.data;  // 保存最新节点，供 exportContext 使用

    // 等 1.5 秒再发下一个
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n✅ 测试完成！请检查 VS Code 中的效果：');
  console.log('  - 状态栏右下角应显示 Figma 节点信息');
  console.log('  - 打开 Inspector Panel（Ctrl+Shift+P → Figma: Open Design Inspector）');
  console.log('  - 在 Copilot Agent 模式下说"帮我实现 Figma 选中的组件"');

  // 保持连接 5 秒后关闭
  await new Promise(r => setTimeout(r, 5000));
  ws.close();
  console.log('👋 连接已关闭');
}

// ═══════════════════════════════════════════════════════════
// 入口
// ═══════════════════════════════════════════════════════════

const PORT = parseInt(process.argv[2] || '9877', 10);

runTest(PORT).catch((err) => {
  console.error('❌ 测试失败:', err.message);
  console.log('\n💡 提示：请先在 VS Code 中按 F5 启动扩展开发模式，然后再运行此测试。');
  process.exit(1);
});
