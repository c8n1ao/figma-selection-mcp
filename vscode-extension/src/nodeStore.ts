import { EventEmitter } from 'events';

/**
 * Figma 节点的完整数据结构 — 递归深度提取。
 */

// ── 子类型 ─────────────────────────────────────────────────

export interface FormattedPaint {
  type: string;
  visible: boolean;
  opacity?: number;
  blendMode?: string;
  color?: string;
  gradientType?: string;
  gradientStops?: Array<{ position: number; color: string }>;
  gradientTransform?: number[][];
  imageHash?: string;
  scaleMode?: string;
  imageTransform?: number[][];
  imageFilters?: unknown;
  boundVariable?: { type: string; id: string };
}

export interface FormattedEffect {
  type: string;
  visible: boolean;
  radius?: number;
  offsetX?: number;
  offsetY?: number;
  spread?: number;
  color?: string;
  blendMode?: string;
}

export interface LayoutGridItem {
  pattern: string;
  visible: boolean;
  color?: string;
  opacity?: number;
  sectionSize?: number;
  gutterSize?: number;
  count?: number;
  offset?: number;
  alignment?: string;
  numSections?: number;
}

export interface ExportSetting {
  format: string;
  suffix: string;
  constraint: { type: string; value: number } | null;
}

export interface StyledTextSegment {
  start: number;
  end: number;
  fontSize?: number;
  fontName?: { family: string; style: string };
  fillColor?: string;
  textDecoration?: string;
}

// ── 主类型（递归） ─────────────────────────────────────────

export interface FigmaNode {
  // 身份
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  locked?: boolean;

  // 父节点
  parentId?: string;
  parentName?: string;
  parentType?: string;
  parentWidth?: number;
  parentHeight?: number;

  // 尺寸
  width?: number;
  height?: number;

  // 最小/最大尺寸
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;

  // 位置 — 绝对（相对于页面原点）
  x?: number;
  y?: number;
  rotation?: number;

  // 位置 — 相对于直接父节点
  relX?: number;
  relY?: number;
  relX_fromMatrix?: number;
  relY_fromMatrix?: number;

  // 位置 — 相对于页面
  pageX?: number;
  pageY?: number;

  // 渲染边界
  renderBounds?: { x: number; y: number; width: number; height: number };

  // 约束（作为 Frame 子节点时）
  constraints?: { horizontal: string; vertical: string };

  // 填充
  fills?: FormattedPaint[];
  fillColor?: string;             // 第一个 SOLID 填充的快捷色值
  fillStyleId?: string;           // 填充样式引用
  fillStyleName?: string;

  // 描边
  strokes?: FormattedPaint[];
  strokeWeight?: number;
  strokeAlign?: string;
  strokeTopWeight?: number;
  strokeBottomWeight?: number;
  strokeLeftWeight?: number;
  strokeRightWeight?: number;
  strokeCap?: string;
  strokeJoin?: string;
  dashPattern?: number[];
  miterLimit?: number;
  strokeStyleId?: string;
  strokeStyleName?: string;

  // 效果
  effects?: FormattedEffect[];
  effectStyleId?: string;
  effectStyleName?: string;

  // 外观
  opacity?: number;
  blendMode?: string;

  // 圆角
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomRightRadius?: number;
  bottomLeftRadius?: number;
  cornerSmoothing?: number;

  // 裁切 / 蒙版
  clipsContent?: boolean;
  isMask?: boolean;
  maskType?: string;

  // 导出设置
  exportSettings?: ExportSetting[];

  // ── 文字 ──
  characters?: string;
  fontSize?: number;
  fontName?: { family: string; style: string };
  fontVariations?: Record<string, number>;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: number | { unit: string; value: number };
  lineHeightPercent?: number;
  letterSpacing?: number | { unit: string; value: number };
  textDecoration?: string;
  textCase?: string;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  maxLines?: number;
  textAutoResize?: string;
  hasMissingFont?: boolean;
  leadingTrim?: string;
  hyperlink?: { type: string; value: string } | null;
  textStyleId?: string;
  textStyleName?: string;
  textTruncation?: string;
  textStyledSegments?: StyledTextSegment[];

  // ── 形状 ──
  arcData?: { startingAngle: number; endingAngle: number; innerRadius: number };
  pointCount?: number;
  innerRadius?: number;
  vectorNetwork?: { vertexCount: number; segmentCount: number };
  vectorPaths?: number;

  // ── Auto Layout ──
  layoutMode?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutWrap?: string;
  counterAxisSpacing?: number;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  primaryAxisSizingMode?: string;
  counterAxisSizingMode?: string;
  layoutGrids?: LayoutGridItem[];
  gridStyleId?: string;
  gridStyleName?: string;

  // ── 组件 ──
  componentId?: string;
  mainComponentName?: string;
  mainComponentKey?: string;
  componentProperties?: Record<string, { type: string; value: unknown }>;
  variantProperties?: Record<string, string>;
  exposedInstances?: Array<{ id: string; name: string; mainComponentName?: string }>;
  variantGroupProperties?: Record<string, string[]>;
  componentKey?: string;
  description?: string;

  // ── 递归子元素 ──
  children?: FigmaNode[];
  childrenTruncated?: boolean;
  childrenTotal?: number;
}

export interface SelectionMessage {
  event: string;
  timestamp: number;
  pageId: string;
  pageName: string;
  count: number;
  primary: FigmaNode | null;
  others: Array<{ id: string; name: string; type: string }>;
}

/**
 * Figma 导出的完整上下文（节点属性 + PNG 截图）
 */
export interface ContextMessage {
  event: 'context';
  timestamp: number;
  nodeId: string;
  nodeName: string;
  pageId: string;
  pageName: string;
  /** 节点完整属性 JSON */
  node: FigmaNode;
  /** PNG 截图 Base64（不含 data URI 前缀） */
  pngBase64: string;
  /** 导出倍率 */
  scale: number;
}

/**
 * 节点数据缓存。同时作为 EventEmitter 广播变化。
 */
export class NodeStore extends EventEmitter {
  private lastSelection: SelectionMessage | null = null;
  private lastContext: ContextMessage | null = null;
  private bridgePort: number | null = null;
  private _connected = false;

  // ── 写入 ────────────────────────────────────────────────

  setSelection(msg: SelectionMessage): void {
    this.lastSelection = msg;
    this.emit('change', msg.primary);
  }

  setPort(port: number): void {
    this.bridgePort = port;
  }

  setConnected(connected: boolean): void {
    this._connected = connected;
  }

  setContext(msg: ContextMessage): void {
    this.lastContext = msg;
    this.emit('context', msg);
  }

  // ── 读取 ────────────────────────────────────────────────

  getSelection(): FigmaNode | null {
    return this.lastSelection?.primary ?? null;
  }

  getFullMessage(): SelectionMessage | null {
    return this.lastSelection;
  }

  getContext(): ContextMessage | null {
    return this.lastContext;
  }

  getPort(): number | null {
    return this.bridgePort;
  }

  isConnected(): boolean {
    return this._connected;
  }

  // ── 事件 ────────────────────────────────────────────────

  onSelectionChange(callback: (node: FigmaNode | null) => void): void {
    this.on('change', callback);
  }

  offSelectionChange(callback: (node: FigmaNode | null) => void): void {
    this.off('change', callback);
  }

  onContext(callback: (msg: ContextMessage) => void): void {
    this.on('context', callback);
  }

  // ── 清理 ────────────────────────────────────────────────

  clear(): void {
    this.lastSelection = null;
    this.lastContext = null;
    this.removeAllListeners();
  }
}
