import * as vscode from 'vscode';
import { NodeStore, FigmaNode, FormattedPaint, FormattedEffect } from './nodeStore';

// ── 工具函数 ──────────────────────────────────────────────

function formatNodeDetailed(node: FigmaNode): string {
  const lines: string[] = [
    `## Figma 节点：${node.name}`,
    `- 类型：${node.type}`,
    `- ID：${node.id}`,
  ];

  if (node.width !== undefined) {
    lines.push(`- 尺寸：${Math.round(node.width)} × ${Math.round(node.height!)} px`);
  }
  if (node.x !== undefined) {
    lines.push(`- 位置：x=${Math.round(node.x)}, y=${Math.round(node.y!)}`);
    if (node.rotation) lines.push(`- 旋转：${node.rotation}°`);
  }
  if (node.parentName) {
    lines.push(`- 父节点：${node.parentName} (${node.parentType})`);
  }
  if (node.visible === false) lines.push(`- 可见：否`);
  if (node.locked) lines.push(`- 锁定：是`);
  if (node.boundVariables && Object.keys(node.boundVariables).length > 0) {
    lines.push(`- 绑定变量：${Object.entries(node.boundVariables).map(([k, v]) => `${k}(${v.length})`).join(', ')}`);
  }

  // 填充
  if (node.fillColor) {
    lines.push(`- 填充颜色：${node.fillColor}`);
  } else if (node.fills && node.fills.length > 0) {
    const parts = node.fills.map(f => {
      if (f.color) return f.color;
      if (f.gradientType) return `${f.gradientType}(${f.gradientStops?.length ?? 0} 个色标)`;
      return f.type;
    });
    lines.push(`- 填充：${parts.join(', ')}`);
  }

  // 描边
  if (node.strokes && node.strokes.length > 0 && node.strokeWeight && node.strokeWeight > 0) {
    const sc = node.strokes.map(f => f.color || f.type).join(', ');
    lines.push(`- 描边：${sc} · ${node.strokeWeight}px · ${node.strokeAlign || 'INSIDE'}`);
    if (node.dashPattern && node.dashPattern.length > 0) {
      lines.push(`  - 虚线：[${node.dashPattern.join(', ')}]`);
    }
  }

  // 效果
  if (node.effects && node.effects.length > 0) {
    node.effects.forEach(e => {
      switch (e.type) {
        case 'DROP_SHADOW':
          lines.push(`- 阴影：offset(${e.offsetX}, ${e.offsetY}) blur=${e.radius}${e.spread ? ` spread=${e.spread}` : ''} ${e.color || ''}`);
          break;
        case 'INNER_SHADOW':
          lines.push(`- 内阴影：offset(${e.offsetX}, ${e.offsetY}) blur=${e.radius}`);
          break;
        case 'LAYER_BLUR':
          lines.push(`- 模糊：${e.radius}px`);
          break;
        case 'BACKGROUND_BLUR':
          lines.push(`- 背景模糊：${e.radius}px`);
          break;
      }
    });
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    lines.push(`- 不透明度：${Math.round(node.opacity * 100)}%`);
  }
  if (node.blendMode) {
    lines.push(`- 混合模式：${node.blendMode}`);
  }
  if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    lines.push(`- 圆角：${node.cornerRadius}px`);
  } else if (node.topLeftRadius !== undefined) {
    lines.push(`- 圆角：TL=${node.topLeftRadius} TR=${node.topRightRadius} BR=${node.bottomRightRadius} BL=${node.bottomLeftRadius}`);
  }
  if (node.clipsContent) lines.push(`- 裁切内容：是`);
  if (node.isMask) lines.push(`- 蒙版：${node.maskType || 'ALPHA'}`);

  // 文字
  if (node.characters) {
    const preview = node.characters.length > 200 ? node.characters.slice(0, 200) + '…' : node.characters;
    lines.push(`- 文字内容："${preview}"`);
  }
  if (node.fontSize !== undefined) {
    lines.push(`- 字体大小：${node.fontSize}px`);
  }
  if (node.fontName) {
    lines.push(`- 字体：${node.fontName.family} ${node.fontName.style}`);
  }
  if (node.lineHeight !== undefined) {
    const lh = typeof node.lineHeight === 'number'
      ? `${node.lineHeight}px`
      : `${node.lineHeight.value}${node.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`;
    lines.push(`- 行高：${lh}`);
  }
  if (node.letterSpacing !== undefined) {
    const ls = typeof node.letterSpacing === 'number'
      ? `${node.letterSpacing}px`
      : `${node.letterSpacing.value}${node.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`;
    lines.push(`- 字间距：${ls}`);
  }
  if (node.textDecoration && node.textDecoration !== 'NONE') lines.push(`- 装饰：${node.textDecoration}`);
  if (node.textCase && node.textCase !== 'ORIGINAL') lines.push(`- 大小写：${node.textCase}`);
  if (node.maxLines !== undefined) lines.push(`- 最大行数：${node.maxLines}`);

  // Auto Layout
  if (node.layoutMode) {
    lines.push(`- 自动布局：${node.layoutMode}`);
    lines.push(`  - 主轴对齐：${node.primaryAxisAlignItems}`);
    lines.push(`  - 交叉轴对齐：${node.counterAxisAlignItems}`);
    if (node.layoutWrap && node.layoutWrap !== 'NO_WRAP') lines.push(`  - 换行：${node.layoutWrap}`);
    lines.push(`  - 间距：${node.itemSpacing}px${node.counterAxisSpacing !== undefined ? ` / 交叉轴: ${node.counterAxisSpacing}px` : ''}`);
    lines.push(`  - 内边距：↑${node.paddingTop} →${node.paddingRight} ↓${node.paddingBottom} ←${node.paddingLeft}`);
    if (node.layoutSizingHorizontal) {
      lines.push(`  - 尺寸：H=${node.layoutSizingHorizontal} V=${node.layoutSizingVertical}`);
    }
  }

  // 约束
  if (node.constraints) {
    lines.push(`- 约束：水平=${node.constraints.horizontal} 垂直=${node.constraints.vertical}`);
  }

  // 组件
  if (node.componentId) {
    lines.push(`- 主组件 ID：${node.componentId}`);
    if (node.mainComponentName) {
      lines.push(`- 主组件名称：${node.mainComponentName}`);
    }
  }
  if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
    const props = Object.entries(node.componentProperties)
      .map(([k, v]) => `\`${k}\` = ${JSON.stringify(v.value)} (${v.type})`)
      .join('<br>');
    lines.push(`- 组件属性：${props}`);
  }

  // 渲染边界
  if (node.renderBounds) {
    lines.push(`- 渲染边界：${Math.round(node.renderBounds.width)} × ${Math.round(node.renderBounds.height)} px`);
  }

  // 子元素
  if (node.children && node.children.length) {
    lines.push(`- 子元素（${node.children.length} 个）：`);
    node.children.slice(0, 30).forEach(c => {
      const info = c.characters
        ? `"${c.characters.slice(0, 50)}" ${c.fontSize ? c.fontSize + 'px' : ''}`
        : c.width ? `${Math.round(c.width)}×${Math.round(c.height!)}` : '';
      lines.push(`  - ${c.name} (${c.type}) ${info}`);
    });
    if (node.children.length > 30) {
      lines.push(`  - ... 还有 ${node.children.length - 30} 个子元素`);
    }
  }

  return lines.join('\n');
}

function extractTokens(node: FigmaNode, format: string): string {
  const tokens: Record<string, string> = {};

  // 颜色 — 使用已格式化的 fillColor
  if (node.fillColor) {
    tokens['color-primary'] = node.fillColor;
  } else if (node.fills && node.fills.length > 0) {
    node.fills.forEach((f, i) => {
      if (f.color) {
        const key = i === 0 ? 'color-primary' : `color-fill-${i}`;
        tokens[key] = f.color;
      }
    });
  }

  // 字体
  if (node.fontSize !== undefined) {
    tokens['font-size'] = `${node.fontSize}px`;
  }
  if (node.fontName) {
    tokens['font-family'] = node.fontName.family;
  }
  if (node.lineHeight !== undefined) {
    tokens['line-height'] = typeof node.lineHeight === 'number'
      ? `${node.lineHeight}px`
      : `${node.lineHeight.value}${node.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`;
  }
  if (node.letterSpacing !== undefined) {
    tokens['letter-spacing'] = typeof node.letterSpacing === 'number'
      ? `${node.letterSpacing}px`
      : `${node.letterSpacing.value}${node.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`;
  }

  // 尺寸
  if (node.width !== undefined) {
    tokens['width'] = `${Math.round(node.width)}px`;
    tokens['height'] = `${Math.round(node.height!)}px`;
  }

  // 间距
  if (node.paddingTop !== undefined) { tokens['padding-top'] = `${node.paddingTop}px`; }
  if (node.paddingRight !== undefined) { tokens['padding-right'] = `${node.paddingRight}px`; }
  if (node.paddingBottom !== undefined) { tokens['padding-bottom'] = `${node.paddingBottom}px`; }
  if (node.paddingLeft !== undefined) { tokens['padding-left'] = `${node.paddingLeft}px`; }
  if (node.itemSpacing !== undefined) { tokens['gap'] = `${node.itemSpacing}px`; }

  // 圆角
  if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    tokens['border-radius'] = `${node.cornerRadius}px`;
  } else if (node.topLeftRadius !== undefined) {
    tokens['border-radius'] = `${node.topLeftRadius}px ${node.topRightRadius}px ${node.bottomRightRadius}px ${node.bottomLeftRadius}px`;
  }

  // 阴影
  if (node.effects && node.effects.length > 0) {
    const shadow = node.effects.find(e => e.type === 'DROP_SHADOW');
    if (shadow) {
      tokens['box-shadow'] = `${shadow.offsetX || 0}px ${shadow.offsetY || 0}px ${shadow.radius || 0}px ${shadow.spread ? shadow.spread + 'px ' : ''}${shadow.color || 'rgba(0,0,0,0.25)'}`;
    }
  }

  switch (format) {
    case 'css':
      return `:root {\n${Object.entries(tokens)
        .map(([k, v]) => `  --${k}: ${v};`)
        .join('\n')}\n}`;
    case 'tailwind':
      // 生成 tailwind.config.js theme.extend 格式
      const colors: Record<string, string> = {};
      const fontSizes: Record<string, string> = {};
      const spacings: Record<string, string> = {};
      const borderRadius: Record<string, string> = {};

      for (const [k, v] of Object.entries(tokens)) {
        if (k.startsWith('color')) {
          colors[k] = v;
        } else if (k === 'font-size') {
          fontSizes['design'] = v;
        } else if (k === 'font-family') {
          // font-family 单独处理
        } else if (k === 'gap' || k.startsWith('padding') || k === 'width' || k === 'height') {
          spacings[k] = v;
        } else if (k === 'border-radius') {
          borderRadius['design'] = v;
        }
      }

      const ext: Record<string, unknown> = {};
      if (Object.keys(colors).length) ext.colors = colors;
      if (Object.keys(fontSizes).length) ext.fontSize = fontSizes;
      if (Object.keys(spacings).length) ext.spacing = spacings;
      if (Object.keys(borderRadius).length) ext.borderRadius = borderRadius;
      if (tokens['font-family']) ext.fontFamily = { design: [tokens['font-family'], 'sans-serif'] };

      return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: ${JSON.stringify(ext, null, 6).replace(/\n/g, '\n    ')}\n  }\n}`;
    default: // json
      return JSON.stringify(tokens, null, 2);
  }
}

// ── 注册 ──────────────────────────────────────────────────

export function registerLmTools(
  context: vscode.ExtensionContext,
  store: NodeStore,
): void {

  // Tool 1: figma_get_selection
  context.subscriptions.push(
    vscode.lm.registerTool('figma_get_selection', {
      async invoke(
        _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
        _token: vscode.CancellationToken,
      ): Promise<vscode.LanguageModelToolResult> {
        const node = store.getSelection();
        if (!node) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              '当前 Figma 中没有选中任何节点。请在 Figma Desktop 中打开设计稿并安装 "Figma Selection MCP" 插件，然后选中一个节点。'
            ),
          ]);
        }

        const full = store.getFullMessage();
        const raw = JSON.stringify(full ?? node, null, 2);
        const cappedRaw = raw.length > 30000 ? `${raw.slice(0, 30000)}\n...\n/* JSON too long, truncated */` : raw;

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(formatNodeDetailed(node)),
          new vscode.LanguageModelTextPart(`\n\n### 原始结构(JSON)\n\n\`\`\`json\n${cappedRaw}\n\`\`\``),
        ]);
      },
    }),
  );

  // Tool 2: figma_get_design_tokens
  context.subscriptions.push(
    vscode.lm.registerTool('figma_get_design_tokens', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ format?: string }>,
        _token: vscode.CancellationToken,
      ): Promise<vscode.LanguageModelToolResult> {
        const node = store.getSelection();
        if (!node) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('没有选中节点，无法提取 Token。'),
          ]);
        }
        const format = options.input?.format ?? 'css';
        const tokens = extractTokens(node, format);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(tokens),
        ]);
      },
    }),
  );

  // Tool 3: figma_get_children
  context.subscriptions.push(
    vscode.lm.registerTool('figma_get_children', {
      async invoke(
        options: vscode.LanguageModelToolInvocationOptions<{ nodeId?: string }>,
        _token: vscode.CancellationToken,
      ): Promise<vscode.LanguageModelToolResult> {
        const node = store.getSelection();
        if (!node || !node.children || node.children.length === 0) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('当前节点没有子元素或未选中节点。'),
          ]);
        }
        const list = node.children
          .map(c => `- ${c.name} (${c.type}) id:${c.id}`)
          .join('\n');
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `子元素列表 (共 ${node.children.length} 个):\n${list}`
          ),
        ]);
      },
    }),
  );
}
