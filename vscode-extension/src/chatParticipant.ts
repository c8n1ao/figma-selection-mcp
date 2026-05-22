import * as vscode from 'vscode';
import { NodeStore, FigmaNode } from './nodeStore';

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  store: NodeStore,
): void {
  const participant = vscode.chat.createChatParticipant('figma-mcp.figma', async (
    request: vscode.ChatRequest,
    _chatContext: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    _token: vscode.CancellationToken,
  ) => {
    const query = request.prompt.trim().toLowerCase();

    // 处理获取选中节点
    if (query.includes('selection') || query.includes('选中') || query.includes('选中节点')) {
      const node = store.getSelection();
      if (!node) {
        stream.markdown('⚠️ 当前 Figma 中没有选中任何节点。\n\n请在 Figma Desktop 中选中一个节点后重试。');
        return;
      }
      stream.markdown(formatNodeMarkdown(node));
      return;
    }

    // 处理获取设计 Token
    if (query.includes('token') || query.includes('变量') || query.includes('颜色') || query.includes('字体') || query.includes('style')) {
      const node = store.getSelection();
      if (!node) {
        stream.markdown('⚠️ 没有选中节点，无法提取 Token。');
        return;
      }
      stream.markdown(extractTokenMarkdown(node));
      return;
    }

    // 处理子元素
    if (query.includes('children') || query.includes('子元素') || query.includes('层级')) {
      const node = store.getSelection();
      if (!node) {
        stream.markdown('⚠️ 没有选中节点。');
        return;
      }
      if (!node.children || node.children.length === 0) {
        stream.markdown('当前节点没有子元素。');
        return;
      }
      const list = node.children.map(c => `- ${c.name} (${c.type}) \`${c.id}\``).join('\n');
      stream.markdown(`子元素（共 ${node.children.length} 个）：\n\n${list}`);
      return;
    }

    // 默认帮助
    stream.markdown(
      '👋 **Figma Selection MCP** 已就绪。\n\n' +
      '可用指令：\n' +
      '- **selection** — 获取当前选中节点信息\n' +
      '- **token / 颜色 / 字体** — 提取设计 Token\n' +
      '- **children / 层级** — 查看子元素结构\n\n' +
      `状态：${store.isConnected() ? '🟢 Figma 已连接' : '🔴 Figma 未连接'}`
    );
  });

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'figma-icon.svg');
  context.subscriptions.push(participant);
}

function formatNodeMarkdown(node: FigmaNode): string {
  const lines: string[] = [
    `## 📐 ${node.name}`,
    '',
    '| 属性 | 值 |',
    '|------|-----|',
    `| 类型 | ${node.type} |`,
    `| ID | \`${node.id}\` |`,
  ];
  if (node.width) lines.push(`| 尺寸 | ${Math.round(node.width)} × ${Math.round(node.height!)} px |`);
  if (node.x !== undefined) lines.push(`| 位置 | x=${Math.round(node.x)}, y=${Math.round(node.y!)} |`);
  if (node.rotation) lines.push(`| 旋转 | ${node.rotation}° |`);
  if (node.characters) lines.push(`| 文字 | "${node.characters.slice(0, 100)}" |`);
  if (node.fontSize) lines.push(`| 字号 | ${node.fontSize}px |`);
  if (node.fontName) {
    lines.push(`| 字体 | ${node.fontName.family} ${node.fontName.style} |`);
  }
  if (node.fillColor) {
    lines.push(`| 填充色 | ${node.fillColor} |`);
  }
  if (node.cornerRadius && node.cornerRadius > 0) lines.push(`| 圆角 | ${node.cornerRadius}px |`);
  if (node.opacity !== undefined && node.opacity < 1) lines.push(`| 不透明度 | ${Math.round(node.opacity * 100)}% |`);
  if (node.componentId) lines.push(`| 主组件 | ${node.mainComponentName || node.componentId} |`);
  if (node.layoutMode) lines.push(`| 布局 | ${node.layoutMode} · gap=${node.itemSpacing}px |`);
  if (node.constraints) lines.push(`| 约束 | H=${node.constraints.horizontal} V=${node.constraints.vertical} |`);

  return lines.join('\n');
}

function extractTokenMarkdown(node: FigmaNode): string {
  const tokens: Record<string, string> = {};

  if (node.fillColor) {
    tokens['color-primary'] = node.fillColor;
  } else if (node.fills && node.fills.length > 0) {
    node.fills.forEach((f, i) => {
      if (f.color) tokens[i === 0 ? 'color-primary' : `color-${i}`] = f.color;
    });
  }
  if (node.fontSize) tokens['font-size'] = `${node.fontSize}px`;
  if (node.fontName) tokens['font-family'] = node.fontName.family;
  if (node.width) {
    tokens['width'] = `${Math.round(node.width)}px`;
    tokens['height'] = `${Math.round(node.height!)}px`;
  }
  if (node.itemSpacing !== undefined) tokens['gap'] = `${node.itemSpacing}px`;
  if (node.cornerRadius && node.cornerRadius > 0) tokens['border-radius'] = `${node.cornerRadius}px`;

  const cssVars = Object.entries(tokens)
    .map(([k, v]) => `  --${k}: ${v};`)
    .join('\n');

  return `## 🎨 Design Tokens\n\n\`\`\`css\n:root {\n${cssVars}\n}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify(tokens, null, 2)}\n\`\`\``;
}
