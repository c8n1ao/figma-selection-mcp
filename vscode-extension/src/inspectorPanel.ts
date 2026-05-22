import * as vscode from 'vscode';
import { NodeStore, FigmaNode } from './nodeStore';

export class InspectorPanel {
  static currentPanel: InspectorPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static show(context: vscode.ExtensionContext, store: NodeStore): void {
    if (InspectorPanel.currentPanel) {
      InspectorPanel.currentPanel.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'figmaInspector',
      'Figma Design Inspector',
      vscode.ViewColumn.Beside,
      { enableScripts: true },
    );
    InspectorPanel.currentPanel = new InspectorPanel(panel, store);
  }

  constructor(panel: vscode.WebviewPanel, store: NodeStore) {
    this.panel = panel;
    this.render(store.getSelection());

    store.onSelectionChange((node) => {
      this.render(node);
    });

    panel.onDidDispose(() => {
      InspectorPanel.currentPanel = undefined;
    });

    // 接收 Webview 发来的消息
    panel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'insertToChat') {
        vscode.commands.executeCommand('figma-mcp.insertToChat');
      }
    });
  }

  private render(node: FigmaNode | null): void {
    this.panel.webview.html = this.buildHtml(node);
  }

  private buildHtml(node: FigmaNode | null): string {
    if (!node) {
      return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: var(--vscode-font-family); font-size: 13px; padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  .empty { text-align: center; color: #888; margin-top: 60px; }
  .empty .icon { font-size: 48px; margin-bottom: 16px; }
  p { line-height: 1.6; }
</style>
</head>
<body>
  <div class="empty">
    <div class="icon">📐</div>
    <p>在 Figma 中选中一个节点后，这里会显示其属性。</p>
    <p style="font-size:12px">请确保已安装 "Figma Selection MCP" 插件。</p>
  </div>
</body>
</html>`;
    }

    // 构建属性表格
    const rows: Array<[string, string]> = [
      ['名称', node.name],
      ['类型', node.type],
      ['ID', `<code>${node.id}</code>`],
    ];
    if (node.width !== undefined) {
      rows.push(['尺寸', `${Math.round(node.width)} × ${Math.round(node.height!)} px`]);
    }
    if (node.x !== undefined) {
      rows.push(['位置', `x: ${Math.round(node.x)}, y: ${Math.round(node.y!)}`]);
    }
    if (node.rotation) {
      rows.push(['旋转', `${node.rotation}°`]);
    }
    if (node.opacity !== undefined && node.opacity < 1) {
      rows.push(['不透明度', `${Math.round(node.opacity * 100)}%`]);
    }
    if (node.blendMode) {
      rows.push(['混合模式', node.blendMode]);
    }
    if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
      rows.push(['圆角', `${node.cornerRadius}px`]);
    } else if (node.topLeftRadius !== undefined) {
      rows.push(['圆角', `TL=${node.topLeftRadius} TR=${node.topRightRadius} BR=${node.bottomRightRadius} BL=${node.bottomLeftRadius}`]);
    }
    if (node.clipsContent) {
      rows.push(['裁切内容', '是']);
    }
    if (node.isMask) {
      rows.push(['蒙版', node.maskType || 'ALPHA']);
    }
    if (node.characters) {
      rows.push(['文字', `"${node.characters}"`]);
    }
    if (node.fontSize !== undefined) {
      rows.push(['字号', `${node.fontSize}px`]);
    }
    if (node.fontName) {
      rows.push(['字体', `${node.fontName.family} ${node.fontName.style}`]);
    }
    if (node.lineHeight !== undefined) {
      const lh = typeof node.lineHeight === 'number'
        ? `${node.lineHeight}px`
        : `${node.lineHeight.value}${node.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`;
      rows.push(['行高', lh]);
    }
    if (node.letterSpacing !== undefined && (typeof node.letterSpacing !== 'number' || node.letterSpacing !== 0)) {
      const ls = typeof node.letterSpacing === 'number'
        ? `${node.letterSpacing}px`
        : `${node.letterSpacing.value}${node.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`;
      rows.push(['字间距', ls]);
    }
    if (node.textDecoration && node.textDecoration !== 'NONE') {
      rows.push(['装饰', node.textDecoration]);
    }
    if (node.textCase && node.textCase !== 'ORIGINAL') {
      rows.push(['大小写', node.textCase]);
    }
    if (node.maxLines !== undefined) {
      rows.push(['最大行', `${node.maxLines}`]);
    }
    if (node.layoutMode) {
      rows.push(['自动布局', node.layoutMode]);
      rows.push(['主轴对齐', node.primaryAxisAlignItems || '—']);
      rows.push(['交叉轴对齐', node.counterAxisAlignItems || '—']);
      rows.push(['内间距', `↑${node.paddingTop} →${node.paddingRight} ↓${node.paddingBottom} ←${node.paddingLeft}`]);
      rows.push(['子项间距', `${node.itemSpacing}px${node.counterAxisSpacing !== undefined ? ` / 交叉轴:${node.counterAxisSpacing}px` : ''}`]);
      if (node.layoutWrap && node.layoutWrap !== 'NO_WRAP') rows.push(['换行', node.layoutWrap]);
      if (node.layoutSizingHorizontal) rows.push(['尺寸模式', `H=${node.layoutSizingHorizontal} V=${node.layoutSizingVertical}`]);
    }
    if (node.constraints) {
      rows.push(['约束', `H=${node.constraints.horizontal} V=${node.constraints.vertical}`]);
    }
    if (node.componentId) {
      rows.push(['主组件', node.mainComponentName || node.componentId]);
    }
    if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
      const props = Object.entries(node.componentProperties)
        .map(([k, v]) => `${k}=${JSON.stringify(v.value)}`)
        .join(', ');
      rows.push(['组件属性', props]);
    }
    if (node.parentName) {
      rows.push(['父节点', `${node.parentName} (${node.parentType})`]);
    }
    // 填充色和描边 — 使用已格式化的数据
    if (node.fillColor) {
      rows.push(['填充色', node.fillColor]);
    } else if (node.fills && node.fills.length > 0) {
      const parts = node.fills.map(f => f.color || f.type).join(', ');
      rows.push(['填充', parts]);
    }
    if (node.strokes && node.strokes.length > 0 && node.strokeWeight && node.strokeWeight > 0) {
      const sc = node.strokes.map(f => f.color || f.type).join(', ');
      rows.push(['描边', `${sc} · ${node.strokeWeight}px · ${node.strokeAlign || 'INSIDE'}`]);
    }
    // 效果
    if (node.effects && node.effects.length > 0) {
      node.effects.forEach((e, i) => {
        switch (e.type) {
          case 'DROP_SHADOW':
            rows.push([i === 0 ? '阴影' : `阴影${i + 1}`, `offset(${e.offsetX},${e.offsetY}) blur=${e.radius} ${e.color || ''}`]);
            break;
          case 'LAYER_BLUR':
            rows.push([i === 0 ? '模糊' : `模糊${i + 1}`, `${e.radius}px`]);
            break;
          case 'BACKGROUND_BLUR':
            rows.push(['背景模糊', `${e.radius}px`]);
            break;
        }
      });
    }

    const tableRows = rows.map(([k, v]) =>
      `<tr><td>${k}</td><td>${v}</td></tr>`
    ).join('');

    // 子元素列表
    let childrenHtml = '';
    if (node.children && node.children.length > 0) {
      const items = node.children.map(c =>
        `<li>${c.name} <span class="muted">(${c.type})</span></li>`
      ).join('');
      childrenHtml = `
        <h3>子元素 (${node.children.length})</h3>
        <ul>${items}</ul>
      `;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    padding: 16px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
  }
  h3 { font-size: 14px; margin: 12px 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 5px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  td:first-child { color: #888; width: 90px; white-space: nowrap; vertical-align: top; }
  code { font-family: var(--vscode-editor-font-family); font-size: 11px; background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  .muted { color: #888; }
  ul { padding-left: 20px; margin: 4px 0; }
  li { padding: 2px 0; }
  button {
    margin: 16px 0; padding: 8px 18px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 4px; cursor: pointer;
    font-size: 13px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .badge { display: inline-block; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 6px; border-radius: 8px; font-size: 11px; margin-left: 4px; }
</style>
</head>
<body>
  <h3>📐 ${this.escapeHtml(node.name)} <span class="badge">${node.type}</span></h3>
  <table>${tableRows}</table>
  ${childrenHtml}
  <button onclick="insertToChat()">📋 插入到 Copilot 对话</button>
  <script>
    const vscode = acquireVsCodeApi();
    function insertToChat() {
      vscode.postMessage({ command: 'insertToChat' });
    }
  </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
