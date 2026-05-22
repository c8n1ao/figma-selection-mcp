import * as vscode from 'vscode';
import { BridgeServer } from './bridgeServer';
import { NodeStore, FigmaNode, ContextMessage } from './nodeStore';
import { registerLmTools } from './lmTools';
import { registerChatParticipant } from './chatParticipant';
import { StatusBarManager } from './statusBar';
import { InspectorPanel } from './inspectorPanel';
import { writeContextToWorkspace, cleanOldContexts } from './contextWriter';

let bridgeServer: BridgeServer | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new NodeStore();
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // 1. 启动 WebSocket 桥接服务
  bridgeServer = new BridgeServer(9877, store);
  await bridgeServer.start();
  context.subscriptions.push({ dispose: () => bridgeServer?.stop() });

  // 2. 注册 Language Model Tools（核心注入机制）
  registerLmTools(context, store);

  // 3. 注册 Chat Participant @figma
  registerChatParticipant(context, store);

  // 4. 状态栏
  const statusBar = new StatusBarManager(context);
  store.onSelectionChange((node) => {
    statusBar.update(node);
  });

  // 5. 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('figma-mcp.openInspector', () => {
      InspectorPanel.show(context, store);
    }),
    vscode.commands.registerCommand('figma-mcp.insertToChat', async () => {
      const node = store.getSelection();
      if (!node) {
        vscode.window.showWarningMessage('Figma：当前无选中节点');
        return;
      }

      // ── Figma 已连接 → 尝试导出含截图的完整上下文 ──
      if (bridgeServer?.isFigmaConnected() && workspaceDir) {
        const context = await requestContext(store);
        if (context) {
          await insertContextFileAndChat(workspaceDir, context);
          return;
        }
        // 图未获取到 → 提示后走降级模式（仍然生成 .md）
        vscode.window.showInformationMessage('Figma 截图获取超时，使用纯属性模式生成上下文文件');
      }

      // ── 降级模式：生成 .md 文件（无 PNG）+ 填入 Chat ──
      if (workspaceDir) {
        await insertFallbackToChat(node, workspaceDir);
        return;
      }

      // ── 最后降级：纯文本填入 Chat ──
      await insertPlainTextToChat(node);
    }),
  );

  console.log('[Figma Selection MCP] Extension activated');
}

export function deactivate(): void {
  bridgeServer?.stop();
  console.log('[Figma Selection MCP] Extension deactivated');
}

// ═══════════════════════════════════════════════════════════
// 模式 1：Figma 完整上下文（含 PNG 截图）
// ═══════════════════════════════════════════════════════════

async function requestContext(store: NodeStore): Promise<ContextMessage | null> {
  const sent = bridgeServer!.send({ event: 'exportContext' });
  if (!sent) return null;
  return await waitForContext(store, 10000);
}

async function insertContextFileAndChat(
  workspaceDir: string,
  context: ContextMessage,
): Promise<void> {
  const { mdPath, relativeMdPath } = writeContextToWorkspace(workspaceDir, context);
  cleanOldContexts(workspaceDir);

  await vscode.workspace.openTextDocument(mdPath).then(doc =>
    vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside })
  );

  await vscode.env.clipboard.writeText(
    `请参考 @${relativeMdPath} 实现这个 Figma 设计节点。`
  );
  await vscode.commands.executeCommand('workbench.action.chat.open');
  await new Promise(r => setTimeout(r, 300));
  await vscode.commands.executeCommand('editor.action.clipboardPasteAction');

  vscode.window.showInformationMessage(`✅ 上下文文件已生成（含截图）：${relativeMdPath}`);
}

// ═══════════════════════════════════════════════════════════
// 模式 2：降级 .md 文件（无 PNG 截图，但含全部属性）
// ═══════════════════════════════════════════════════════════

async function insertFallbackToChat(
  node: FigmaNode,
  workspaceDir: string,
): Promise<void> {
  // 构造 ContextMessage（无 pngBase64）
  const context: ContextMessage = {
    event: 'context',
    timestamp: Date.now(),
    nodeId: node.id,
    nodeName: node.name,
    pageId: '-',
    pageName: '-',
    node,
    pngBase64: '',
    scale: 1,
  };

  const { mdPath, relativeMdPath } = writeContextToWorkspace(workspaceDir, context);
  cleanOldContexts(workspaceDir);

  await vscode.workspace.openTextDocument(mdPath).then(doc =>
    vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside })
  );

  await vscode.env.clipboard.writeText(
    `请参考 @${relativeMdPath} 实现这个 Figma 设计节点。`
  );
  await vscode.commands.executeCommand('workbench.action.chat.open');
  await new Promise(r => setTimeout(r, 300));
  await vscode.commands.executeCommand('editor.action.clipboardPasteAction');

  vscode.window.showInformationMessage(`✅ 上下文文件已生成（纯属性）：${relativeMdPath}`);
}

// ═══════════════════════════════════════════════════════════
// 模式 3：最后降级 — 纯文本填入 Chat（无工作区目录时）
// ═══════════════════════════════════════════════════════════

async function insertPlainTextToChat(node: FigmaNode): Promise<void> {
  const text = formatNodeForChat(node);
  await vscode.env.clipboard.writeText(text);
  await vscode.commands.executeCommand('workbench.action.chat.open');
  await new Promise(r => setTimeout(r, 200));
  await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
}

function waitForContext(store: NodeStore, timeoutMs: number): Promise<ContextMessage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      store.off('context', handler);
      resolve(null);
    }, timeoutMs);

    const handler = (msg: ContextMessage) => {
      clearTimeout(timer);
      store.off('context', handler);
      resolve(msg);
    };

    store.on('context', handler);
  });
}

function formatNodeForChat(node: FigmaNode, depth = 0): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  const header = depth === 0
    ? `[Figma 选中节点: **${node.name}** · ${node.type}]`
    : `- **${node.name}** (${node.type})`;
  lines.push(indent + header);

  const push = (s: string) => lines.push(indent + s);

  if (node.width !== undefined) push(`  尺寸: ${node.width} × ${node.height!} px`);
  if (node.x !== undefined) {
    const pos = `x=${node.x}, y=${node.y}`;
    const rel = node.relX !== undefined ? ` · 相对父: (${node.relX}, ${node.relY})` : '';
    if (node.rotation) push(`  位置: ${pos}${rel} · 旋转: ${node.rotation}°`);
    else push(`  位置: ${pos}${rel}`);
  }
  if (node.parentName) push(`  父节点: ${node.parentName} (${node.parentType}) ${node.parentWidth ? `${node.parentWidth}×${node.parentHeight}` : ''}`);

  // 外观
  if (node.fillColor) push(`  填充: ${node.fillColor}`);
  else if (node.fills?.length) {
    const parts = node.fills.map(f => f.color || f.gradientType || f.type).join(', ');
    push(`  填充: ${parts}`);
  }
  if (node.fillStyleName) push(`  填充样式: ${node.fillStyleName}`);

  if (node.strokes?.length && (node.strokeWeight ?? 0) > 0) {
    const sc = node.strokes.map(f => f.color || f.type).join(', ');
    push(`  描边: ${sc} ${node.strokeWeight}px ${node.strokeAlign || 'INSIDE'}`);
    if (node.dashPattern?.length) push(`  虚线: [${node.dashPattern.join(', ')}]`);
    if (node.strokeTopWeight !== undefined) push(`  描边权重: ↑${node.strokeTopWeight} →${node.strokeRightWeight} ↓${node.strokeBottomWeight} ←${node.strokeLeftWeight}`);
  }
  if (node.strokeStyleName) push(`  描边样式: ${node.strokeStyleName}`);

  if (node.effects?.length) {
    node.effects.forEach(e => {
      switch (e.type) {
        case 'DROP_SHADOW': push(`  阴影: offset(${e.offsetX},${e.offsetY}) blur=${e.radius}${e.spread ? ` spread=${e.spread}` : ''} ${e.color || ''}`); break;
        case 'INNER_SHADOW': push(`  内阴影: offset(${e.offsetX},${e.offsetY}) blur=${e.radius}`); break;
        case 'LAYER_BLUR': push(`  模糊: ${e.radius}px`); break;
        case 'BACKGROUND_BLUR': push(`  背景模糊: ${e.radius}px`); break;
      }
    });
  }
  if (node.effectStyleName) push(`  效果样式: ${node.effectStyleName}`);

  if (node.opacity !== undefined && node.opacity < 1) push(`  不透明度: ${Math.round(node.opacity * 100)}%`);
  if (node.blendMode) push(`  混合模式: ${node.blendMode}`);

  if (node.cornerRadius !== undefined && node.cornerRadius > 0) push(`  圆角: ${node.cornerRadius}px`);
  else if (node.topLeftRadius !== undefined) push(`  圆角: TL=${node.topLeftRadius} TR=${node.topRightRadius} BR=${node.bottomRightRadius} BL=${node.bottomLeftRadius}`);
  if (node.cornerSmoothing) push(`  圆角平滑: ${node.cornerSmoothing}`);

  if (node.clipsContent) push(`  裁切内容: ✓`);
  if (node.isMask) push(`  蒙版: ${node.maskType || 'ALPHA'}`);

  // 文字
  if (node.characters) {
    const preview = node.characters.length > 100 ? node.characters.slice(0, 100) + '…' : node.characters;
    push(`  文字: "${preview}"`);
  }
  if (node.fontSize !== undefined) push(`  字号: ${node.fontSize}px`);
  if (node.fontName) push(`  字体: ${node.fontName.family} ${node.fontName.style}`);
  if (node.fontVariations) push(`  可变字体轴: ${JSON.stringify(node.fontVariations)}`);
  if (node.lineHeight !== undefined) {
    const lh = typeof node.lineHeight === 'number' ? `${node.lineHeight}px` : `${node.lineHeight.value}${node.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`;
    push(`  行高: ${lh}`);
  }
  if (node.letterSpacing !== undefined) {
    const ls = typeof node.letterSpacing === 'number' ? `${node.letterSpacing}px` : `${node.letterSpacing.value}${node.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`;
    if (typeof node.letterSpacing !== 'number' || node.letterSpacing !== 0) push(`  字间距: ${ls}`);
  }
  if (node.textAlignHorizontal) push(`  对齐: ${node.textAlignHorizontal} / ${node.textAlignVertical}`);
  if (node.textDecoration && node.textDecoration !== 'NONE') push(`  装饰: ${node.textDecoration}`);
  if (node.textCase && node.textCase !== 'ORIGINAL') push(`  大小写: ${node.textCase}`);
  if (node.paragraphSpacing !== undefined) push(`  段间距: ${node.paragraphSpacing}px`);
  if (node.paragraphIndent !== undefined) push(`  段缩进: ${node.paragraphIndent}px`);
  if (node.maxLines !== undefined) push(`  最大行: ${node.maxLines}`);
  if (node.textAutoResize) push(`  自动尺寸: ${node.textAutoResize}`);
  if (node.leadingTrim) push(`  行裁剪: ${node.leadingTrim}`);
  if (node.hasMissingFont) push(`  ⚠️ 缺字体`);
  if (node.hyperlink) push(`  超链接: ${node.hyperlink.value}`);
  if (node.textStyleName) push(`  文字样式: ${node.textStyleName}`);
  if (node.textTruncation) push(`  截断: ${node.textTruncation}`);

  // 分段样式
  if (node.textStyledSegments?.length) {
    push(`  分段样式 (${node.textStyledSegments.length} 段):`);
    node.textStyledSegments.slice(0, 5).forEach(seg => {
      const segParts: string[] = [];
      if (seg.fontSize) segParts.push(`${seg.fontSize}px`);
      if (seg.fontName) segParts.push(`${seg.fontName.family} ${seg.fontName.style}`);
      if (seg.fillColor) segParts.push(seg.fillColor);
      if (seg.textDecoration) segParts.push(seg.textDecoration);
      push(`    [${seg.start}-${seg.end}] ${segParts.join(' · ')}`);
    });
    if (node.textStyledSegments.length > 5) push(`    ... 还有 ${node.textStyledSegments.length - 5} 段`);
  }

  // 形状
  if (node.arcData) push(`  弧: ${node.arcData.startingAngle}°→${node.arcData.endingAngle}° inner=${node.arcData.innerRadius}`);
  if (node.pointCount !== undefined) push(`  顶点数: ${node.pointCount}`);
  if (node.vectorNetwork) push(`  矢量: ${node.vectorNetwork.vertexCount} 顶点, ${node.vectorNetwork.segmentCount} 线段`);
  if (node.vectorPaths) push(`  路径数: ${node.vectorPaths}`);

  // Auto Layout
  if (node.layoutMode) {
    push(`  布局: ${node.layoutMode} · 主轴=${node.primaryAxisAlignItems} · 交叉轴=${node.counterAxisAlignItems}`);
    if (node.layoutWrap && node.layoutWrap !== 'NO_WRAP') push(`  换行: ${node.layoutWrap}`);
    push(`  内边距: ↑${node.paddingTop} →${node.paddingRight} ↓${node.paddingBottom} ←${node.paddingLeft}`);
    push(`  间距: ${node.itemSpacing}px${node.counterAxisSpacing !== undefined ? ` · 交叉轴: ${node.counterAxisSpacing}px` : ''}`);
    if (node.layoutSizingHorizontal) push(`  尺寸: H=${node.layoutSizingHorizontal} V=${node.layoutSizingVertical}`);
    if (node.minWidth !== undefined) push(`  最小: W=${node.minWidth} H=${node.minHeight}`);
    if (node.maxWidth !== undefined) push(`  最大: W=${node.maxWidth} H=${node.maxHeight}`);
  }

  // 布局网格
  if (node.layoutGrids?.length) {
    node.layoutGrids.forEach((g, i) => {
      push(`  网格${i + 1}: ${g.pattern} ${g.count ? g.count + '列' : ''}${g.sectionSize ? ' section=' + g.sectionSize : ''}${g.gutterSize ? ' gutter=' + g.gutterSize : ''}${g.offset ? ' offset=' + g.offset : ''}`);
    });
  }

  if (node.constraints) push(`  约束: H=${node.constraints.horizontal} V=${node.constraints.vertical}`);

  // 导出
  if (node.exportSettings?.length) {
    push(`  导出: ${node.exportSettings.map(e => `${e.format}${e.suffix ? '@' + e.suffix : ''}${e.constraint ? ` ${e.constraint.type}=${e.constraint.value}` : ''}`).join(', ')}`);
  }

  // 组件
  if (node.componentId) push(`  主组件: ${node.mainComponentName || node.componentId}`);
  if (node.mainComponentKey) push(`  组件 Key: ${node.mainComponentKey}`);
  if (node.componentKey) push(`  本地 Key: ${node.componentKey}`);
  if (node.description) push(`  描述: ${node.description}`);
  if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
    const props = Object.entries(node.componentProperties)
      .map(([k, v]) => `\`${k}\`=${JSON.stringify(v.value)}`)
      .join(', ');
    push(`  组件属性: ${props}`);
  }
  if (node.variantProperties) {
    const vp = Object.entries(node.variantProperties)
      .map(([k, v]) => `${k}=${v}`).join(', ');
    push(`  Variant: ${vp}`);
  }
  if (node.variantGroupProperties) {
    push(`  Variant 选项: ${JSON.stringify(node.variantGroupProperties)}`);
  }
  if (node.exposedInstances?.length) {
    push(`  嵌套实例: ${node.exposedInstances.map(i => i.name).join(', ')}`);
  }

  // 递归子元素
  if (node.children && node.children.length > 0) {
    push(`  子元素 (${node.children.length}):`);
    node.children.forEach(c => {
      // 递归：有子节点的子元素展开；否则用 formatNodeSummary
      if (c.children && c.children.length > 0) {
        lines.push(formatNodeForChat(c, depth + 1));
      } else {
        lines.push(formatNodeSummary(c, depth + 1));
      }
    });
  }

  if (depth === 0) {
    lines.push(``);
    lines.push(`> 请输入你的需求，例如："将这个组件转为 React + Tailwind" / "提取设计 Token" / "改成暗色版本"`);
  }

  return lines.join('\n');
}

/** 子节点摘要（不递归） */
function formatNodeSummary(node: FigmaNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const extra: string[] = [];
  if (node.width) extra.push(`${node.width}×${node.height}`);
  if (node.relX !== undefined) extra.push(`(${node.relX}, ${node.relY})`);
  if (node.characters) extra.push(`"${(node.characters || '').slice(0, 30)}"`);
  if (node.fontSize) extra.push(`${node.fontSize}px`);
  if (node.fillColor) extra.push(node.fillColor);
  if (node.opacity !== undefined && node.opacity < 1) extra.push(`${Math.round(node.opacity * 100)}%`);
  return `${indent}- ${node.name} (${node.type}) ${extra.join(' · ')}`;
}
