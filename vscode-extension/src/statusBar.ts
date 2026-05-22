import * as vscode from 'vscode';
import { FigmaNode } from './nodeStore';

export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = 'figma-mcp.openInspector';
    this.item.tooltip = '点击打开 Figma Design Inspector';
    this.setIdle();
    this.item.show();
    context.subscriptions.push(this.item);
  }

  update(node: FigmaNode | null): void {
    if (!node) {
      this.setIdle();
      return;
    }
    const size = node.width !== undefined
      ? ` ${Math.round(node.width)}×${Math.round(node.height!)}`
      : '';
    this.item.text = `$(symbol-color) ${node.name} · ${node.type}${size}`;
    this.item.backgroundColor = undefined;
  }

  private setIdle(): void {
    this.item.text = '$(symbol-color) Figma: 未选中';
    this.item.backgroundColor = undefined;
  }
}
