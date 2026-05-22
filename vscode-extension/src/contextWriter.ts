import * as fs from 'node:fs';
import * as path from 'node:path';
import { ContextMessage, FigmaNode } from './nodeStore';

/**
 * 将 Figma 上下文数据（属性 + 截图）写入工作区作为 Markdown + PNG 文件。
 *
 * 输出结构：
 *   {workspaceDir}/.figma-context/
 *     node-{id}-{timestamp}.md
 *     node-{id}-{timestamp}.png
 *
 * Markdown 内容包含：
 *   - PNG 截图引用（可在 VS Code 中预览）
 *   - 完整的节点属性树（折叠式 Markdown）
 */

interface WriteResult {
  /** Markdown 文件的绝对路径 */
  mdPath: string;
  /** PNG 文件的绝对路径 */
  pngPath: string;
  /** 相对于工作区根目录的 Markdown 路径（用于 @引用） */
  relativeMdPath: string;
}

export function writeContextToWorkspace(
  workspaceDir: string,
  context: ContextMessage,
): WriteResult {
  const timestamp = Date.now();
  const safeName = context.nodeName.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_]/g, '_').slice(0, 40);
  const baseName = `node-${safeName}-${timestamp}`;
  const contextDir = path.join(workspaceDir, '.figma-context');

  // 确保目录存在
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }

  // ── 写入 PNG（仅当有数据时） ─────────────────────────────
  let pngPath = '';
  if (context.pngBase64 && context.pngBase64.length > 0) {
    pngPath = path.join(contextDir, `${baseName}.png`);
    const pngBuffer = Buffer.from(context.pngBase64, 'base64');
    fs.writeFileSync(pngPath, pngBuffer);
  }

  // ── 生成 Markdown ───────────────────────────────────────
  const mdContent = buildContextMarkdown(context, !!pngPath);
  const mdPath = path.join(contextDir, `${baseName}.md`);
  fs.writeFileSync(mdPath, mdContent, 'utf8');

  return {
    mdPath,
    pngPath,
    relativeMdPath: `.figma-context/${baseName}.md`,
  };
}

/**
 * 清理旧的上下文文件（保留最近 10 个）
 */
export function cleanOldContexts(workspaceDir: string): void {
  const contextDir = path.join(workspaceDir, '.figma-context');
  if (!fs.existsSync(contextDir)) return;

  try {
    const files = fs.readdirSync(contextDir)
      .filter(f => f.endsWith('.md') || f.endsWith('.png'))
      .map(f => ({
        name: f,
        time: fs.statSync(path.join(contextDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time);

    // 按时间戳分组，保留最近 10 组
    const seen = new Set<string>();
    let kept = 0;
    for (const f of files) {
      const base = f.name.replace(/\.(md|png)$/, '');
      if (kept < 10) {
        seen.add(base);
        if (!f.name.endsWith('.png')) kept++;
      } else if (!seen.has(base)) {
        fs.unlinkSync(path.join(contextDir, f.name));
      }
    }
  } catch {
    // 静默失败，清理不是关键功能
  }
}

// ═══════════════════════════════════════════════════════════
// Markdown 生成
// ═══════════════════════════════════════════════════════════

function buildContextMarkdown(ctx: ContextMessage, hasPng = false): string {
  const node = ctx.node;
  const lines: string[] = [
    `# Figma 节点：${node.name}`,
    ``,
    `> **类型**: ${node.type} &nbsp;|&nbsp; **ID**: \`${node.id}\` &nbsp;|&nbsp; **页面**: ${ctx.pageName}`,
    `> **导出时间**: ${new Date(ctx.timestamp).toLocaleString('zh-CN')} &nbsp;|&nbsp; **倍率**: ${ctx.scale}x`,
    ``,
  ];

  // ── 截图 ──
  if (hasPng) {
    lines.push(`## 📸 截图`);
    lines.push(``);
    lines.push(`![](${baseNameFromPath(ctx)}.png)`);
    lines.push(``);
  } else {
    lines.push(`> ⚠️ 截图未生成（Figma 未连接或导出超时）。请确保 Figma Plugin 已启动后重试。`);
    lines.push(``);
  }

  // ── 尺寸与位置 ──
  lines.push(`## 📐 尺寸与位置`);
  lines.push(``);
  lines.push(`| 属性 | 值 |`);
  lines.push(`|------|-----|`);
  if (node.width !== undefined) {
    lines.push(`| 尺寸 | ${node.width} × ${node.height} px |`);
  }
  if (node.x !== undefined) {
    lines.push(`| 绝对位置 | x=${node.x}, y=${node.y} |`);
    if (node.rotation) lines.push(`| 旋转 | ${node.rotation}° |`);
  }
  if (node.relX !== undefined) {
    lines.push(`| 相对父节点 | x=${node.relX}, y=${node.relY} |`);
  }
  if (node.parentName) {
    lines.push(`| 父节点 | ${node.parentName} (${node.parentType})${node.parentWidth ? ` ${node.parentWidth}×${node.parentHeight}px` : ''} |`);
  }
  if (node.renderBounds) {
    lines.push(`| 渲染边界 | ${node.renderBounds.width} × ${node.renderBounds.height} px |`);
  }
  if (node.constraints) {
    lines.push(`| 约束 | H=${node.constraints.horizontal} V=${node.constraints.vertical} |`);
  }
  lines.push(``);

  // ── 外观 ──
  const hasAppearance = node.fillColor || (node.fills && node.fills.length) ||
    (node.strokes && node.strokes.length) || (node.effects && node.effects.length) ||
    node.opacity !== undefined || node.blendMode || node.cornerRadius !== undefined;
  if (hasAppearance) {
    lines.push(`## 🎨 外观`);
    lines.push(``);
    lines.push(`| 属性 | 值 |`);
    lines.push(`|------|-----|`);

    if (node.fillColor) {
      lines.push(`| 填充 | ${node.fillColor} |`);
    } else if (node.fills?.length) {
      const parts = node.fills.map(f => f.color || f.gradientType || f.type).join(', ');
      lines.push(`| 填充 | ${parts} |`);
    }
    if (node.fillStyleName) lines.push(`| 填充样式 | ${node.fillStyleName} |`);

    if (node.strokes?.length && (node.strokeWeight ?? 0) > 0) {
      const sc = node.strokes.map(f => f.color || f.type).join(', ');
      lines.push(`| 描边 | ${sc} · ${node.strokeWeight}px · ${node.strokeAlign || 'INSIDE'} |`);
      if (node.dashPattern?.length) lines.push(`| 虚线 | [${node.dashPattern.join(', ')}] |`);
    }
    if (node.strokeStyleName) lines.push(`| 描边样式 | ${node.strokeStyleName} |`);

    if (node.effects?.length) {
      node.effects.forEach(e => {
        switch (e.type) {
          case 'DROP_SHADOW':
            lines.push(`| 阴影 | offset(${e.offsetX},${e.offsetY}) blur=${e.radius}${e.spread ? ` spread=${e.spread}` : ''} ${e.color || ''} |`);
            break;
          case 'LAYER_BLUR':
            lines.push(`| 模糊 | ${e.radius}px |`);
            break;
          case 'BACKGROUND_BLUR':
            lines.push(`| 背景模糊 | ${e.radius}px |`);
            break;
          case 'INNER_SHADOW':
            lines.push(`| 内阴影 | offset(${e.offsetX},${e.offsetY}) blur=${e.radius} |`);
            break;
        }
      });
    }

    if (node.opacity !== undefined && node.opacity < 1) {
      lines.push(`| 不透明度 | ${Math.round(node.opacity * 100)}% |`);
    }
    if (node.blendMode) lines.push(`| 混合模式 | ${node.blendMode} |`);

    if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
      lines.push(`| 圆角 | ${node.cornerRadius}px |`);
    } else if (node.topLeftRadius !== undefined) {
      lines.push(`| 圆角 | TL=${node.topLeftRadius} TR=${node.topRightRadius} BR=${node.bottomRightRadius} BL=${node.bottomLeftRadius} |`);
    }
    if (node.cornerSmoothing !== undefined && node.cornerSmoothing > 0) {
      lines.push(`| 圆角平滑度 | ${node.cornerSmoothing} |`);
    }
    lines.push(``);
  }

  // ── 文字 ──
  if (node.characters !== undefined) {
    lines.push(`## 🔤 文字属性`);
    lines.push(``);
    lines.push(`| 属性 | 值 |`);
    lines.push(`|------|-----|`);

    const preview = node.characters.length > 200 ? node.characters.slice(0, 200) + '…' : node.characters;
    lines.push(`| 内容 | "${preview}" |`);
    if (node.fontSize !== undefined) lines.push(`| 字号 | ${node.fontSize}px |`);
    if (node.fontName) lines.push(`| 字体 | ${node.fontName.family} ${node.fontName.style} |`);
    if (node.lineHeight) {
      const lh = typeof node.lineHeight === 'number'
        ? `${node.lineHeight}px`
        : `${node.lineHeight.value}${node.lineHeight.unit === 'PIXELS' ? 'px' : '%'}`;
      lines.push(`| 行高 | ${lh} |`);
    }
    if (node.letterSpacing) {
      const ls = typeof node.letterSpacing === 'number'
        ? `${node.letterSpacing}px`
        : `${node.letterSpacing.value}${node.letterSpacing.unit === 'PIXELS' ? 'px' : '%'}`;
      lines.push(`| 字间距 | ${ls} |`);
    }
    if (node.textAlignHorizontal) lines.push(`| 水平对齐 | ${node.textAlignHorizontal} |`);
    if (node.textAlignVertical) lines.push(`| 垂直对齐 | ${node.textAlignVertical} |`);
    if (node.textDecoration && node.textDecoration !== 'NONE') lines.push(`| 装饰 | ${node.textDecoration} |`);
    if (node.textCase && node.textCase !== 'ORIGINAL') lines.push(`| 大小写 | ${node.textCase} |`);
    if (node.maxLines !== undefined) lines.push(`| 最大行 | ${node.maxLines} |`);
    if (node.hyperlink) lines.push(`| 超链接 | ${node.hyperlink.value} |`);
    if (node.textStyleName) lines.push(`| 文字样式 | ${node.textStyleName} |`);
    lines.push(``);
  }

  // ── Auto Layout ──
  if (node.layoutMode) {
    lines.push(`## 📏 自动布局 (Auto Layout)`);
    lines.push(``);
    lines.push(`| 属性 | 值 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 方向 | ${node.layoutMode} |`);
    lines.push(`| 主轴对齐 | ${node.primaryAxisAlignItems} |`);
    lines.push(`| 交叉轴对齐 | ${node.counterAxisAlignItems} |`);
    lines.push(`| 内边距 | ↑${node.paddingTop} →${node.paddingRight} ↓${node.paddingBottom} ←${node.paddingLeft} |`);
    lines.push(`| 间距 | ${node.itemSpacing}px${node.counterAxisSpacing !== undefined ? ` / 交叉轴: ${node.counterAxisSpacing}px` : ''} |`);
    if (node.layoutWrap && node.layoutWrap !== 'NO_WRAP') {
      lines.push(`| 换行 | ${node.layoutWrap} |`);
    }
    if (node.layoutSizingHorizontal) {
      lines.push(`| 尺寸模式 | H: ${node.layoutSizingHorizontal}, V: ${node.layoutSizingVertical} |`);
    }
    if (node.minWidth !== undefined) lines.push(`| 最小宽度 | ${node.minWidth} |`);
    if (node.maxWidth !== undefined) lines.push(`| 最大宽度 | ${node.maxWidth} |`);
    if (node.minHeight !== undefined) lines.push(`| 最小高度 | ${node.minHeight} |`);
    if (node.maxHeight !== undefined) lines.push(`| 最大高度 | ${node.maxHeight} |`);
    lines.push(``);
  }

  // ── 布局网格 ──
  if (node.layoutGrids?.length) {
    lines.push(`## 📊 布局网格`);
    lines.push(``);
    node.layoutGrids.forEach((g, i) => {
      lines.push(`**网格 ${i + 1}**: ${g.pattern} &nbsp;|&nbsp;${g.count ? `${g.count} 列` : ''}${g.sectionSize ? `section=${g.sectionSize}px` : ''}${g.gutterSize ? ` gutter=${g.gutterSize}px` : ''}${g.offset ? ` offset=${g.offset}px` : ''}`);
    });
    lines.push(``);
  }

  // ── 子元素（递归） ──
  if (node.children?.length) {
    lines.push(`## 👶 子元素`);
    lines.push(``);
    if (node.childrenTruncated) {
      lines.push(`> ⚠️ 子元素过多（共 ${node.childrenTotal} 个），仅展示前 50 个。`);
      lines.push(``);
    }
    lines.push(`| # | 名称 | 类型 | 尺寸 | 位置 | 信息 |`);
    lines.push(`|---|------|------|------|------|------|`);
    node.children.forEach((c, i) => {
      const size = c.width ? `${c.width}×${c.height}` : '—';
      const pos = c.relX !== undefined ? `(${c.relX}, ${c.relY})` : '—';
      const info = c.characters
        ? `📝 "${(c.characters || '').slice(0, 30)}" ${c.fontSize ? c.fontSize + 'px' : ''}`
        : c.fillColor ? `🎨 ${c.fillColor}` : '';
      lines.push(`| ${i + 1} | ${c.name} | ${c.type} | ${size} | ${pos} | ${info} |`);
    });
    lines.push(``);

    // 递归展示含有子节点的子元素
    const nestedChildren = node.children.filter(c => c.children?.length);
    if (nestedChildren.length > 0) {
      for (const nc of nestedChildren.slice(0, 10)) {
        lines.push(`<details>`);
        lines.push(`<summary><b>${nc.name}</b> (${nc.type}) — 包含 ${nc.children!.length} 个子元素</summary>`);
        lines.push(``);
        lines.push(renderChildDetails(nc, 1));
        lines.push(`</details>`);
        lines.push(``);
      }
    }
  }

  // ── 组件信息 ──
  if (node.componentId || node.componentKey) {
    lines.push(`## 🧩 组件信息`);
    lines.push(``);
    if (node.componentId) lines.push(`- **实例来源**: ${node.mainComponentName || node.componentId}`);
    if (node.componentKey) lines.push(`- **组件 Key**: \`${node.componentKey}\``);
    if (node.description) lines.push(`- **描述**: ${node.description}`);
    if (node.componentProperties && Object.keys(node.componentProperties).length > 0) {
      lines.push(`- **组件属性**:`);
      for (const [k, v] of Object.entries(node.componentProperties)) {
        lines.push(`  - \`${k}\` = ${JSON.stringify(v.value)} (${v.type})`);
      }
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*由 Figma Selection MCP 自动生成*`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════
// 辅助
// ═══════════════════════════════════════════════════════════

function baseNameFromPath(ctx: ContextMessage): string {
  const safeName = ctx.nodeName.replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_]/g, '_').slice(0, 40);
  return `node-${safeName}-${ctx.timestamp}`;
}

function renderChildDetails(node: FigmaNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  lines.push(`${indent}- **${node.name}** (${node.type}) ${node.width ? `${node.width}×${node.height}px` : ''}`);
  if (node.characters) lines.push(`${indent}  - 文字: "${(node.characters as string).slice(0, 50)}"`);
  if (node.fillColor) lines.push(`${indent}  - 颜色: ${node.fillColor}`);
  if (node.relX !== undefined) lines.push(`${indent}  - 位置: (${node.relX}, ${node.relY})`);

  if (node.children?.length) {
    for (const c of node.children.slice(0, 15)) {
      lines.push(`${indent}  - ${c.name} (${c.type}) ${c.width ? `${c.width}×${c.height}` : ''}`);
    }
    if (node.children.length > 15) {
      lines.push(`${indent}  - ... 还有 ${node.children.length - 15} 个`);
    }
  }
  return lines.join('\n');
}

// 重新导出选择器
export { buildContextMarkdown };
