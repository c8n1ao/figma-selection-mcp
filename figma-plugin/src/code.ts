/// <reference types="@figma/plugin-typings" />

// ═══════════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════════

function safeGet<T>(fn: () => T): T | undefined {
  try { return fn(); } catch { return undefined; }
}

function rgbaToHex(color: { r: number; g: number; b: number; a?: number }): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return color.a !== undefined && color.a < 1
    ? `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}${toHex(color.a)}`
    : `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function rounded(v: number, decimals = 2): number {
  const m = 10 ** decimals;
  return Math.round(v * m) / m;
}

// ═══════════════════════════════════════════════════════════
// 填充格式化
// ═══════════════════════════════════════════════════════════

function formatPaint(paint: Paint): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: paint.type,
    visible: paint.visible !== false,
  };
  const opacity = (paint as SolidPaint).opacity;
  if (opacity !== undefined && opacity < 1) base.opacity = rounded(opacity);

  // 混合模式
  if ('blendMode' in paint && paint.blendMode !== 'NORMAL' && paint.blendMode !== 'PASS_THROUGH') {
    base.blendMode = paint.blendMode;
  }

  if (paint.type === 'SOLID') {
    base.color = rgbaToHex(paint.color);
    // 绑定变量信息（设计 Token）
    if (paint.boundVariables?.color) {
      base.boundVariable = {
        type: 'COLOR',
        id: paint.boundVariables.color.id,
      };
    }
  } else if (
    paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' ||
    paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND'
  ) {
    base.gradientType = paint.type;
    base.gradientStops = paint.gradientStops.map(s => ({
      position: rounded(s.position),
      color: rgbaToHex(s.color),
    }));
    base.gradientTransform = safeGet(() => {
      const g = paint.gradientTransform;
      if (!g) return undefined;
      return [[g[0][0], g[0][1], g[0][2]], [g[1][0], g[1][1], g[1][2]]];
    });
  } else if (paint.type === 'IMAGE') {
    base.imageHash = safeGet(() => paint.imageHash);
    base.scaleMode = paint.scaleMode;
    if (paint.imageTransform) {
      base.imageTransform = safeGet(() => {
        const g = paint.imageTransform;
        if (!g) return undefined;
        return [[g[0][0], g[0][1], g[0][2]], [g[1][0], g[1][1], g[1][2]]];
      });
    }
    if (paint.filters) {
      base.imageFilters = paint.filters;
    }
  }

  return base;
}

// ═══════════════════════════════════════════════════════════
// 效果格式化
// ═══════════════════════════════════════════════════════════

function formatEffect(effect: Effect): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: effect.type,
    visible: effect.visible !== false,
  };
  if ('radius' in effect) base.radius = effect.radius;
  if ('offset' in effect && effect.offset) {
    base.offsetX = effect.offset.x;
    base.offsetY = effect.offset.y;
  }
  if ('spread' in effect) base.spread = effect.spread;
  if ('color' in effect && effect.color) {
    base.color = rgbaToHex(effect.color);
  }
  if ('blendMode' in effect && effect.blendMode !== 'NORMAL') {
    base.blendMode = effect.blendMode;
  }
  return base;
}

// ═══════════════════════════════════════════════════════════
// 布局网格格式化
// ═══════════════════════════════════════════════════════════

function formatLayoutGrids(grids: readonly LayoutGrid[]): Record<string, unknown>[] {
  return grids.map(g => {
    const item: Record<string, unknown> = {
      pattern: g.pattern,
      visible: g.visible !== false,
    };
    if ('color' in g && g.color) {
      item.color = rgbaToHex(g.color);
      item.opacity = rounded(g.color.a ?? 1);
    }
    if ('sectionSize' in g) item.sectionSize = g.sectionSize;
    if ('gutterSize' in g) item.gutterSize = g.gutterSize;
    if ('count' in g) item.count = g.count;
    if ('offset' in g) item.offset = g.offset;
    if ('alignment' in g) item.alignment = g.alignment;
    if ('numSections' in g) item.numSections = g.numSections;
    return item;
  });
}

// ═══════════════════════════════════════════════════════════
// 变换矩阵 → 角度
// ═══════════════════════════════════════════════════════════

function getRotationFromTransform(t: Transform): number {
  return rounded(Math.atan2(t[1][0], t[0][0]) * (180 / Math.PI));
}

// ═══════════════════════════════════════════════════════════
// 核心：递归深度提取节点
// ═══════════════════════════════════════════════════════════
// depth=0: 根节点（用户选中的），全部属性
// depth=1: 直接子节点，全部属性，子节点的子节点仅摘要
// depth=2: 孙节点，仅摘要

function extractNode(node: SceneNode, depth = 0): Record<string, unknown> {
  // ── 身份 ──
  const base: Record<string, unknown> = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible !== false,
    locked: node.locked,
  };

  // ── 父节点信息 ──
  const parent = node.parent;
  if (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    base.parentId = parent.id;
    base.parentName = parent.name;
    base.parentType = parent.type;
    // 父节点尺寸（用于计算相对位置和约束参照）
    if ('width' in parent && typeof parent.width === 'number') {
      base.parentWidth = parent.width;
      base.parentHeight = parent.height;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 尺寸 & 位置系统
  // ═══════════════════════════════════════════════════════════

  if ('width' in node && typeof node.width === 'number') {
    base.width = rounded(node.width);
    base.height = rounded(node.height!);
  }

  if ('absoluteTransform' in node) {
    const t = node.absoluteTransform;
    const absX = rounded(t[0][2]);
    const absY = rounded(t[1][2]);
    base.x = absX;
    base.y = absY;

    // 旋转
    const rotation = getRotationFromTransform(t);
    if (Math.abs(rotation) > 0.01) base.rotation = rotation;

    // 相对于父节点的位置
    if (parent && 'absoluteTransform' in parent && (parent.type as string) !== 'PAGE') {
      const pt = parent.absoluteTransform;
      const relX = rounded(absX - pt[0][2]);
      const relY = rounded(absY - pt[1][2]);
      base.relX = relX;
      base.relY = relY;
    }

    // 相对于页面（同一级——页面内）
    const page = safeGet(() => figma.currentPage);
    if (page && page.id !== parent?.id) {
      // page 没有 absoluteTransform，页面原点就是 (0,0)，所以绝对位置即页面内位置
      base.pageX = absX;
      base.pageY = absY;
    }
  }

  // 相对变换矩阵（相对于父节点）
  if ('relativeTransform' in node) {
    const rt = node.relativeTransform;
    base.relX_fromMatrix = rounded(rt[0][2]);
    base.relY_fromMatrix = rounded(rt[1][2]);
  }

  // 绝对渲染边界
  if ('absoluteRenderBounds' in node && node.absoluteRenderBounds) {
    const rb = node.absoluteRenderBounds;
    base.renderBounds = {
      x: rounded(rb.x),
      y: rounded(rb.y),
      width: rounded(rb.width),
      height: rounded(rb.height),
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 约束（作为 Frame 内子节点时）
  // ═══════════════════════════════════════════════════════════

  if ('constraints' in node) {
    base.constraints = {
      horizontal: node.constraints.horizontal,
      vertical: node.constraints.vertical,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 填充
  // ═══════════════════════════════════════════════════════════

  if ('fills' in node) {
    const fills = (node as GeometryMixin).fills as readonly Paint[];
    if (fills.length > 0) {
      const visibleFills = fills.filter(f => f.visible !== false);
      base.fills = visibleFills.map(formatPaint);
      // 快捷：第一个纯色填充
      if (visibleFills.length > 0 && visibleFills[0].type === 'SOLID') {
        base.fillColor = rgbaToHex(visibleFills[0].color);
      }
    } else {
      base.fills = [];
    }
  }

  // 填充样式引用
  if ('fillStyleId' in node && typeof node.fillStyleId === 'string') {
    base.fillStyleId = node.fillStyleId;
    base.fillStyleName = safeGet(() => figma.getStyleById(node.fillStyleId as string)?.name);
  }

  // ═══════════════════════════════════════════════════════════
  // 描边
  // ═══════════════════════════════════════════════════════════

  if ('strokes' in node && 'strokeWeight' in node) {
    const strokes = (node as GeometryMixin).strokes as readonly Paint[];
    if (strokes.length > 0) {
      base.strokes = strokes.filter(f => f.visible !== false).map(formatPaint);
    }
    const sw = (node as any).strokeWeight as number;
    base.strokeWeight = sw;

    if (sw > 0) {
      base.strokeAlign = (node as any).strokeAlign || 'INSIDE';
      // 四边独立描边权重
      if ('strokeTopWeight' in node) {
        base.strokeTopWeight = (node as any).strokeTopWeight;
        base.strokeBottomWeight = (node as any).strokeBottomWeight;
        base.strokeLeftWeight = (node as any).strokeLeftWeight;
        base.strokeRightWeight = (node as any).strokeRightWeight;
      }
      base.strokeCap = safeGet(() => (node as any).strokeCap);
      base.strokeJoin = safeGet(() => (node as any).strokeJoin);
      base.dashPattern = safeGet(() => (node as any).dashPattern as number[]);
      base.miterLimit = safeGet(() => (node as any).miterLimit);
    }
  }

  // 描边样式引用
  if ('strokeStyleId' in node && typeof node.strokeStyleId === 'string') {
    base.strokeStyleId = node.strokeStyleId;
    base.strokeStyleName = safeGet(() => figma.getStyleById(node.strokeStyleId as string)?.name);
  }

  // ═══════════════════════════════════════════════════════════
  // 效果
  // ═══════════════════════════════════════════════════════════

  if ('effects' in node) {
    const effects = (node as BlendMixin).effects;
    if (effects.length > 0) {
      base.effects = effects.filter(e => e.visible !== false).map(formatEffect);
    } else {
      base.effects = [];
    }
  }

  // 效果样式引用
  if ('effectStyleId' in node && typeof node.effectStyleId === 'string') {
    base.effectStyleId = node.effectStyleId;
    base.effectStyleName = safeGet(() => figma.getStyleById(node.effectStyleId as string)?.name);
  }

  // ═══════════════════════════════════════════════════════════
  // 不透明度 / 混合模式
  // ═══════════════════════════════════════════════════════════

  if ('opacity' in node && node.opacity < 1) {
    base.opacity = rounded(node.opacity);
  }
  if ('blendMode' in node && node.blendMode !== 'PASS_THROUGH' && node.blendMode !== 'NORMAL') {
    base.blendMode = node.blendMode;
  }

  // ═══════════════════════════════════════════════════════════
  // 圆角
  // ═══════════════════════════════════════════════════════════

  if ('cornerRadius' in node && typeof node.cornerRadius === 'number') {
    base.cornerRadius = rounded(node.cornerRadius);
  }
  // 独立四角（优先，会覆盖 uniform cornerRadius）
  if ('topLeftRadius' in node) {
    base.topLeftRadius = rounded(node.topLeftRadius);
    base.topRightRadius = rounded(node.topRightRadius);
    base.bottomRightRadius = rounded(node.bottomRightRadius);
    base.bottomLeftRadius = rounded(node.bottomLeftRadius);
  }
  // cornerSmoothing（iOS 风格圆角）
  if ('cornerSmoothing' in node && node.cornerSmoothing > 0) {
    base.cornerSmoothing = rounded(node.cornerSmoothing);
  }

  // ═══════════════════════════════════════════════════════════
  // 裁切 / 蒙版
  // ═══════════════════════════════════════════════════════════

  if ('clipsContent' in node) {
    base.clipsContent = node.clipsContent;
  }
  if ('isMask' in node && node.isMask) {
    base.isMask = true;
    base.maskType = (node as any).maskType || 'ALPHA';
  }

  // ═══════════════════════════════════════════════════════════
  // 导出设置
  // ═══════════════════════════════════════════════════════════

  if ('exportSettings' in node && node.exportSettings.length > 0) {
    base.exportSettings = node.exportSettings.map(e => {
      const item: Record<string, unknown> = { format: e.format, suffix: e.suffix || '' };
      if ('constraint' in e && e.constraint) {
        item.constraint = { type: e.constraint.type, value: e.constraint.value };
      }
      return item;
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 文字节点
  // ═══════════════════════════════════════════════════════════

  if (node.type === 'TEXT') {
    base.characters = node.characters;
    base.fontSize = node.fontSize;

    base.fontName = safeGet(() => ({
      family: (node.fontName as FontName).family,
      style: (node.fontName as FontName).style,
    }));

    // 可变字体
    base.fontVariations = safeGet(() => {
      const fv = (node as any).fontVariations;
      if (!fv || !Array.isArray(fv)) return undefined;
      const result: Record<string, number> = {};
      for (const axis of fv) result[axis.axisName] = axis.value;
      return result;
    });

    base.textAlignHorizontal = node.textAlignHorizontal;
    base.textAlignVertical = node.textAlignVertical;

    // 行高
    const lh = safeGet(() => node.lineHeight);
    if (lh !== undefined && lh !== figma.mixed) {
      base.lineHeight = typeof lh === 'object' && 'unit' in lh && lh.unit !== 'AUTO'
        ? { unit: lh.unit, value: rounded((lh as { value: number }).value) }
        : typeof lh === 'number' ? rounded(lh) : undefined;
      // 百分比转数值
      if (base.lineHeight && typeof base.lineHeight === 'object' && 'unit' in (base.lineHeight as any) && (base.lineHeight as any).unit === 'PERCENT') {
        base.lineHeightPercent = (base.lineHeight as any).value;
      }
    }

    // 字间距
    const ls = safeGet(() => node.letterSpacing);
    if (ls !== undefined && ls !== figma.mixed) {
      base.letterSpacing = typeof ls === 'object' && 'unit' in ls
        ? { unit: ls.unit, value: rounded((ls as { value: number }).value) }
        : typeof ls === 'number' ? rounded(ls) : undefined;
    }

    base.textDecoration = node.textDecoration;
    base.textCase = node.textCase;
    base.paragraphSpacing = safeGet(() => {
      const ps = node.paragraphSpacing;
      return typeof ps === 'number' ? rounded(ps) : undefined;
    });
    base.paragraphIndent = safeGet(() => {
      const pi = node.paragraphIndent;
      return typeof pi === 'number' ? rounded(pi) : undefined;
    });
    base.maxLines = safeGet(() => node.maxLines);
    base.textAutoResize = node.textAutoResize;
    base.hasMissingFont = node.hasMissingFont;
    base.leadingTrim = safeGet(() => node.leadingTrim);
    base.hyperlink = safeGet(() => {
      const hl = node.hyperlink;
      if (!hl || hl === figma.mixed) return undefined;
      return { type: (hl as HyperlinkTarget).type, value: (hl as HyperlinkTarget).value };
    });

    // 文本样式引用
    if (node.textStyleId && typeof node.textStyleId === 'string') {
      base.textStyleId = node.textStyleId;
      base.textStyleName = safeGet(() => figma.getStyleById(node.textStyleId as string)?.name);
    }

    // 文本截断模式
    if ('textTruncation' in node) {
      base.textTruncation = node.textTruncation;
    }

    // 分段样式
    if (depth === 0 && node.characters.length < 2000) {
      base.textStyledSegments = safeGet(() => node.getStyledTextSegments([
        'fontSize', 'fontName', 'fontWeight', 'fills',
        'textDecoration', 'textCase', 'lineHeight', 'letterSpacing',
      ]).map(seg => ({
        start: seg.start,
        end: seg.end,
        ...(seg.fontSize !== undefined ? { fontSize: seg.fontSize } : {}),
        ...(seg.fontName ? {
          fontName: { family: seg.fontName.family, style: seg.fontName.style },
        } : {}),
        ...(seg.fills && seg.fills.length > 0 && seg.fills[0].type === 'SOLID'
          ? { fillColor: rgbaToHex((seg.fills[0] as SolidPaint).color) }
          : {}),
        ...(seg.textDecoration ? { textDecoration: seg.textDecoration } : {}),
      })));
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 形状节点特有属性
  // ═══════════════════════════════════════════════════════════

  if (node.type === 'ELLIPSE') {
    base.arcData = safeGet(() => {
      const a = (node as EllipseNode).arcData;
      return {
        startingAngle: rounded(a.startingAngle),
        endingAngle: rounded(a.endingAngle),
        innerRadius: rounded(a.innerRadius),
      };
    });
  }

  if (node.type === 'POLYGON' || node.type === 'STAR') {
    base.pointCount = safeGet(() => (node as PolygonNode | StarNode).pointCount);
    base.innerRadius = safeGet(() => (node as StarNode).innerRadius);
  }

  if (node.type === 'VECTOR' || node.type === 'LINE') {
    base.vectorNetwork = safeGet(() => {
      if (!('vectorNetwork' in node)) return undefined;
      const vn = (node as VectorNode).vectorNetwork;
      return {
        vertexCount: vn.vertices.length,
        segmentCount: vn.segments.length,
      };
    });
    if ('vectorPaths' in node) {
      base.vectorPaths = safeGet(() => (node as VectorNode).vectorPaths.length);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 自动布局 (Auto Layout / Flexbox)
  // ═══════════════════════════════════════════════════════════

  if ('layoutMode' in node && (node as FrameNode).layoutMode !== 'NONE') {
    const fl = node as FrameNode;
    base.layoutMode = fl.layoutMode;
    base.primaryAxisAlignItems = fl.primaryAxisAlignItems;
    base.counterAxisAlignItems = fl.counterAxisAlignItems;
    base.paddingLeft = fl.paddingLeft;
    base.paddingRight = fl.paddingRight;
    base.paddingTop = fl.paddingTop;
    base.paddingBottom = fl.paddingBottom;
    base.itemSpacing = fl.itemSpacing;

    // 自动布局高级属性
    base.layoutWrap = safeGet(() => fl.layoutWrap) || 'NO_WRAP';
    if (fl.counterAxisSpacing !== null && fl.counterAxisSpacing !== undefined) {
      base.counterAxisSpacing = fl.counterAxisSpacing;
    }
    base.layoutSizingHorizontal = safeGet(() => fl.layoutSizingHorizontal);
    base.layoutSizingVertical = safeGet(() => fl.layoutSizingVertical);
    base.primaryAxisSizingMode = safeGet(() => fl.primaryAxisSizingMode);
    base.counterAxisSizingMode = safeGet(() => fl.counterAxisSizingMode);
    // 最小/最大尺寸
    if (fl.minWidth !== null) base.minWidth = fl.minWidth;
    if (fl.maxWidth !== null) base.maxWidth = fl.maxWidth;
    if (fl.minHeight !== null) base.minHeight = fl.minHeight;
    if (fl.maxHeight !== null) base.maxHeight = fl.maxHeight;

    // 布局网格
    if (fl.layoutGrids && fl.layoutGrids.length > 0) {
      base.layoutGrids = formatLayoutGrids(fl.layoutGrids);
    }
    if ('gridStyleId' in fl && typeof fl.gridStyleId === 'string') {
      base.gridStyleId = fl.gridStyleId;
      base.gridStyleName = safeGet(() => figma.getStyleById(fl.gridStyleId as string)?.name);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 组件实例
  // ═══════════════════════════════════════════════════════════

  if (node.type === 'INSTANCE') {
    base.componentId = node.mainComponent?.id;
    base.mainComponentName = node.mainComponent?.name;
    base.mainComponentKey = safeGet(() => node.mainComponent?.key);

    // 组件属性
    base.componentProperties = safeGet(() => {
      const props: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(node.componentProperties)) {
        props[name] = { type: value.type, value: value.value };
      }
      return Object.keys(props).length > 0 ? props : undefined;
    });

    // Variant 属性
    base.variantProperties = safeGet(() => {
      if (!node.variantProperties) return undefined;
      const vp: Record<string, string> = {};
      for (const [k, v] of Object.entries(node.variantProperties)) {
        vp[k] = v;
      }
      return vp;
    });

    // 暴露的实例节点
    if (depth === 0) {
      base.exposedInstances = safeGet(() => {
        const instances = node.findAllWithCriteria({ types: ['INSTANCE'] });
        return instances.slice(0, 50).map(i => ({
          id: i.id,
          name: i.name,
          mainComponentName: i.mainComponent?.name,
        }));
      });
    }
  }

  // 组件集
  if (node.type === 'COMPONENT_SET') {
    base.variantGroupProperties = safeGet(() => {
      if (!node.variantGroupProperties) return undefined;
      const vgp: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(node.variantGroupProperties)) {
        vgp[k] = v.values;
      }
      return vgp;
    });
  }

  // 组件（主组件定义）
  if (node.type === 'COMPONENT') {
    base.componentKey = safeGet(() => node.key);
    base.description = safeGet(() => node.description) || undefined;
  }

  // ═══════════════════════════════════════════════════════════
  // 子元素 — 递归提取（深度控制）
  // ═══════════════════════════════════════════════════════════

  if ('children' in node && (node as ChildrenMixin).children.length > 0) {
    const children = (node as ChildrenMixin).children;
    const maxChildren = 50; // 最多递归提取 50 个直接子节点

    if (depth <= 1) {
      // depth 0 或 1：完整提取每个子节点，子节点的子节点只给摘要
      base.children = children.slice(0, maxChildren).map(c => extractNode(c, depth + 1));
      if (children.length > maxChildren) {
        base.childrenTruncated = true;
        base.childrenTotal = children.length;
      }
    } else {
      // depth >= 2：仅摘要（孙子节点及更深的）
      base.children = children.slice(0, maxChildren).map(c => makeChildSummary(c));
    }
  }

  return base;
}

// ═══════════════════════════════════════════════════════════
// 子节点摘要（不递归）
// ═══════════════════════════════════════════════════════════

function makeChildSummary(c: SceneNode): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: c.id,
    name: c.name,
    type: c.type,
    visible: c.visible !== false,
  };
  if ('width' in c && typeof c.width === 'number') {
    summary.width = rounded(c.width);
    summary.height = rounded(c.height!);
  }
  if ('absoluteTransform' in c) {
    summary.x = rounded(c.absoluteTransform[0][2]);
    summary.y = rounded(c.absoluteTransform[1][2]);

    // 相对于父节点的位置
    if (c.parent && 'absoluteTransform' in c.parent && (c.parent.type as string) !== 'PAGE') {
      summary.relX = rounded(summary.x as number - c.parent.absoluteTransform[0][2]);
      summary.relY = rounded(summary.y as number - c.parent.absoluteTransform[1][2]);
    }
  }
  if (c.type === 'TEXT' && 'characters' in c) {
    summary.characters = c.characters;
    summary.fontSize = c.fontSize;
  }
  if ('opacity' in c && c.opacity < 1) {
    summary.opacity = rounded(c.opacity);
  }
  // 子节点数量统计
  if ('children' in c && (c as ChildrenMixin).children.length > 0) {
    summary.childCount = (c as ChildrenMixin).children.length;
  }
  return summary;
}

// ── 启动时显示 UI ──────────────────────────────────────────
figma.showUI(__html__, {
  width: 280,
  height: 80,
  title: 'Selection MCP',
});

// ── 初始化时发送一次当前状态 ──────────────────────────────
function sendInit(): void {
  figma.ui.postMessage({
    event: 'init',
    connected: true,
  });
}

sendInit();

// ── 监听选中变化 ──────────────────────────────────────────
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  const payload = {
    event: 'selectionchange',
    timestamp: Date.now(),
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    count: selection.length,
    primary: selection[0] ? extractNode(selection[0]) : null,
    others: selection.slice(1).map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
    })),
  };
  figma.ui.postMessage(payload);
});

// ── 接收 VS Code 指令 ─────────────────────────────────────
figma.ui.onmessage = async (msg: { event: string;[key: string]: unknown }) => {
  if (msg.event === 'exportContext') {
    await handleExportContext();
  }
};

/**
 * 导出当前选中节点的完整上下文（属性 + PNG 截图）
 */
async function handleExportContext(): Promise<void> {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    figma.ui.postMessage({
      event: 'contextError',
      error: 'No node selected in Figma',
    });
    return;
  }

  const node = selection[0];
  // 需要 exportAsync 能力（Frame/Component/Instance/Group/Text 等均可）
  const exportable = node as unknown as { exportAsync?: (settings: ExportSettings) => Promise<Uint8Array> };
  if (typeof exportable.exportAsync !== 'function') {
    figma.ui.postMessage({
      event: 'contextError',
      error: `Node type "${node.type}" does not support PNG export`,
    });
    return;
  }

  try {
    const scale = 2; // 2x 导出保证 Retina 清晰度
    const pngBytes = await exportable.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: scale },
    });

    // 转换为 Base64
    const pngBase64 = bytesToBase64(pngBytes);

    const payload = {
      event: 'context',
      timestamp: Date.now(),
      nodeId: node.id,
      nodeName: node.name,
      pageId: figma.currentPage.id,
      pageName: figma.currentPage.name,
      node: extractNode(node, 0),
      pngBase64,
      scale,
    };

    figma.ui.postMessage(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.ui.postMessage({
      event: 'contextError',
      error: `Export failed: ${message}`,
    });
  }
}

// Uint8Array → Base64（纯算法，不依赖 btoa）
function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const len = bytes.length;
  let result = '';
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < len ? chars[b3 & 63] : '=';
  }
  return result;
}
