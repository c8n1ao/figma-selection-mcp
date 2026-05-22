# Figma Selection MCP — 操作测试文档

> 将 Figma 选中节点的设计数据实时同步到 VS Code Copilot，实现 Design-to-Code 零摩擦。

---

## 目录

- [架构概览](#架构概览)
- [环境准备](#环境准备)
- [构建项目](#构建项目)
- [测试方法 1：独立链路测试（无需 VS Code / Figma）](#测试方法-1独立链路测试无需-vs-code--figma)
- [测试方法 2：Mock Figma Client（VS Code 扩展开发模式）](#测试方法-2mock-figma-clientvs-code-扩展开发模式)
- [测试方法 3：全链路集成（Figma Plugin + VS Code 扩展）](#测试方法-3全链路集成figma-plugin--vs-code-扩展)
- [功能验证清单](#功能验证清单)
- [故障排除](#故障排除)

---

## 架构概览

```
┌───────────────────┐                    ┌──────────────────────┐                    ┌─────────────────┐
│   Figma Desktop   │                    │     VS Code 扩展       │                    │  Copilot Chat   │
│                   │    WebSocket       │                      │    LM Tools API   │                 │
│  ┌─────────────┐  │  ws://127.0.0.1   │  ┌────────────────┐  │  ──────────────►  │  @figma 参与者  │
│  │ code.ts     │──┼──────────────────►│  │ BridgeServer   │  │                    │                 │
│  │ (选中监听)   │  │   :9877          │  │ (纯 Node.js WS) │  │  ┌──────────────┐ │  figma_get_     │
│  └─────────────┘  │                    │  └───────┬────────┘  │  │ lmTools.ts   │ │  selection      │
│  ┌─────────────┐  │                    │          │           │  │ (3 个 Tool)  │ │                 │
│  │ ui.html     │  │                    │  ┌───────▼────────┐  │  └──────────────┘ │  figma_get_     │
│  │ (WS 桥接)    │──┼───────────────────►│  │  NodeStore     │  │                    │  design_tokens  │
│  └─────────────┘  │                    │  │  (数据缓存)     │──┤  ┌──────────────┐ │                 │
│                   │                    │  └───────┬────────┘  │  │ chatParti-   │ │  figma_get_     │
└───────────────────┘                    │          │           │  │ cipant.ts    │ │  children       │
                                         │  ┌───────▼────────┐  │  └──────────────┘ │                 │
                                         │  │ StatusBar +    │  │                    │                 │
                                         │  │ InspectorPanel │  │                    │                 │
                                         │  └────────────────┘  │                    │                 │
                                         └──────────────────────┘                    └─────────────────┘
```

### 组件清单

| 组件 | 路径 | 职责 |
|------|------|------|
| Figma Plugin 主逻辑 | `figma-plugin/src/code.ts` | 监听 `selectionchange` 事件，提取节点属性 |
| Figma Plugin UI | `figma-plugin/ui.html` | WebSocket 客户端，将消息转发到 VS Code |
| WebSocket 桥接服务 | `vscode-extension/src/bridgeServer.ts` | 零依赖 RFC 6455 WebSocket Server |
| 数据缓存 | `vscode-extension/src/nodeStore.ts` | 缓存最新选中数据，事件广播 |
| LM Tools 注册 | `vscode-extension/src/lmTools.ts` | 注册 3 个 Copilot Language Model Tool |
| Chat Participant | `vscode-extension/src/chatParticipant.ts` | `@figma` 聊天参与者 |
| 状态栏 | `vscode-extension/src/statusBar.ts` | 右下角状态栏显示当前选中节点 |
| Inspector 面板 | `vscode-extension/src/inspectorPanel.ts` | Webview 面板展示节点全部属性 |
| 上下文写入 | `vscode-extension/src/contextWriter.ts` | 将选中节点写为 .figma-context/*.md + PNG |
| 独立测试 | `vscode-extension/test/standalone-test.ts` | 不依赖 VS Code 的链路测试 |
| Mock 客户端 | `vscode-extension/test/mock-figma-client.ts` | 模拟 Figma 发送选中数据 |

---

## 环境准备

### 必需条件

| 工具 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | ≥ 18 | — |
| npm | ≥ 9 | — |
| VS Code | ≥ 1.96.0 | — |
| Figma Desktop | 最新版（仅测试方法 3 需要） | **免费版 Figma Design 即可，不需要 Dev Mode** |

> 💡 **关于 Figma Dev Mode**：本插件运行在 Figma **Design** 编辑器中（`manifest.json` 中 `editorType` 设置为 `"figma"`），通过标准 Plugin API 读取选中节点数据，**完全免费、不需要付费订阅**。Dev Mode（`"dev"`）是 Figma 的一个独立付费模式，用于查看设计 Token 和代码片段，与本插件的功能无关。

### 安装依赖

```bash
cd figma-selection-mcp
npm install
```

此命令会同时安装 `figma-plugin` 和 `vscode-extension` 两个 workspace 的依赖。

---

## 构建项目

```bash
# 一键构建所有 workspace
npm run build

# 或分别构建
npm run build:figma      # 仅构建 Figma Plugin
npm run build:extension   # 仅构建 VS Code 扩展

# 清理构建产物
npm run clean
```

构建产物位置：

| 产物 | 路径 |
|------|------|
| Figma Plugin JS | `figma-plugin/dist/code.js` |
| VS Code 扩展 JS | `vscode-extension/dist/*.js` |

---

## 测试方法 1：独立链路测试（无需 VS Code / Figma）

> **最快速的验证方式**。在纯 Node.js 环境中启动 BridgeServer，发送模拟 Figma 数据，自动验证 NodeStore 接收结果。

### 步骤

```bash
# 确保已构建
npm run build

# 运行独立测试
npm run test -w vscode-extension
```

### 预期输出

```
╔══════════════════════════════════════════╗
║  Figma Selection MCP — 独立链路测试      ║
╚══════════════════════════════════════════╝

🚀 启动 BridgeServer...
✅ BridgeServer 已启动在 ws://127.0.0.1:9877

🔌 连接 Mock Figma Client...
✅ WebSocket 已连接

📤 发送测试数据...

── 发送: Header 导航栏 ──
  📩 NodeStore 收到: Header (FRAME) 375×64px
     子元素: Logo, Menu Icon
     颜色: #FFFFFF
── 发送: Primary Button 按钮 ──
  📩 NodeStore 收到: Primary Button (FRAME) 120×44px
     子元素: Label
     颜色: #3A7EF7
── 发送: Title 文字 ──
  📩 NodeStore 收到: Title (TEXT) 200×28px
     颜色: #1A1A1A

══════════════════════════════════════════
📊 测试结果
══════════════════════════════════════════
  ✅ 第1条: 期望 "Header" → 收到 "Header"
  ✅ 第2条: 期望 "Primary Button" → 收到 "Primary Button"
  ✅ 第3条: 期望 "Title" → 收到 "Title"

🎉 全部测试通过！BridgeServer ↔ Mock Client 链路正常。
```

### 测试的数据场景

| 场景 | 节点类型 | 包含属性 |
|------|---------|---------|
| Header 导航栏 | FRAME | Auto Layout, Drop Shadow, 2 个子元素, 白色填充 |
| Primary Button 按钮 | FRAME | Auto Layout, Corner Radius, 蓝色填充 (#3A7EF7) |
| Title 文字 | TEXT | fontSize: 20, Inter Semi Bold, lineHeight: 28px |

### 测试通过后

独立链路测试通过说明 **BridgeServer + NodeStore 核心逻辑正确**。

继续验证：
- **测试方法 2** — 在 VS Code 扩展开发环境中用 Mock 客户端模拟 Figma，观察状态栏和 Inspector 面板
- **测试方法 3** — 连接真实 Figma Desktop + VS Code 进行全链路集成

### 若不通过

```bash
# 单独启动 BridgeServer 手动排查
npm run start:bridge -w vscode-extension
# 另一个终端发送测试数据
echo '{"event":"selectionchange","timestamp":123,"pageId":"0:1","pageName":"Page 1","count":1,"primary":{"id":"x:1","name":"Test","type":"FRAME","width":100,"height":50},"others":[]}' | websocat ws://127.0.0.1:9877
```

---

## 测试方法 2：Mock Figma Client（VS Code 扩展开发模式）

> 在 VS Code 扩展开发环境中运行，用 Mock 客户端模拟 Figma 发送数据，可观察状态栏、Inspector Panel 和 LM Tools 的实际表现。

### 步骤

**第一步：启动扩展开发模式**

1. 在 VS Code 中打开项目
2. 按 `F5`（或 `fn+F5`）
3. 在弹出的下拉菜单中选择 **"VS Code Extension Development (Figma MCP)"**
4. 等待扩展开发窗口（Extension Dev Host）弹出
5. 观察右下角状态栏出现 `$(symbol-color) Figma: 未选中`

**第二步：运行 Mock 客户端发送数据**

```bash
# 在终端中运行（不是在 Extension Dev Host 终端）
npm run test:mock -w vscode-extension

# 或指定自定义端口（默认 9877）
npx ts-node -P vscode-extension/test/tsconfig.json vscode-extension/test/mock-figma-client.ts 9877
```

### 预期效果

发送数据后，应在 Extension Dev Host 窗口中观察：

| 位置 | 期望表现 |
|------|---------|
| **状态栏右下角** | 显示 `$(symbol-color) Header · FRAME 375×64` |
| **Inpector Panel** | `Ctrl+Shift+P` → `Figma: Open Design Inspector`，表格显示完整属性 |
| **@figma Chat** | `Ctrl+Shift+I` 打开 Copilot Chat，输入 `@figma selection`，返回节点 Markdown 表格 |
| **LM Tools** | 在 Agent 模式下说 "帮我实现 Figma 选中的组件"，触发 `figma_get_selection` |

### 手动触发

在 Extension Dev Host 中：

```
Ctrl+Shift+P → Figma: Open Design Inspector    # 打开 Inspector 面板
Ctrl+Shift+P → Figma: Insert Selection to Chat # 复制节点信息到剪贴板
```

---

## 测试方法 3：全链路集成（Figma Plugin + VS Code 扩展）

> 最真实的使用场景：在 Figma Desktop 中选中节点 → VS Code 实时显示。

### 第一步：安装 Figma Plugin

1. 打开 Figma Desktop
2. 在 Figma 中右键 → **Plugins** → **Development** → **Import plugin from manifest...**
3. 选择 `figma-plugin/manifest.json`
4. 导入完成后，插件出现在 **Plugins → Development → Figma Selection MCP**

或者在 Figma 中直接拖拽 `figma-plugin/manifest.json` 到画布。

### 第二步：启动 VS Code 扩展

1. 在 VS Code 中按 `F5` → 选择 **"VS Code Extension Development (Figma MCP)"**
2. 等待状态栏显示 `$(symbol-color) Figma: 未选中`

### 第三步：激活 Figma Plugin

1. 在 Figma 中：菜单栏 → **Plugins** → **Development** → **Figma Selection MCP**
2. 弹出一个 280×80 的小窗口，显示连接状态
3. 状态指示灯：🟢 Connected（连接成功） / 🔴 Disconnected（未连接） / 🟠 Connecting…（连接中）

### 第四步：验证同步

1. 在 Figma 中选中任意设计节点（Frame、Text、Component 等）
2. 观察 VS Code 右下角状态栏 → 立即显示节点名称、类型、尺寸
3. `Ctrl+Shift+P` → **Figma: Open Design Inspector** → 右侧面板展示完整属性
4. Copilot Chat 中选择 Agent 模式 → 输入"帮我实现 Figma 选中的组件" → **Copilot 自动调用 LM Tools 获取详细数据**

### 数据流时序

```
Figma 用户选中节点
    │
    ▼
code.ts: selectionchange 事件
    │ figma.ui.postMessage(payload)
    ▼
ui.html: window.onmessage 接收
    │ WebSocket.send(JSON.stringify(msg))
    ▼
BridgeServer: handleUpgrade / parseFrame
    │ store.setSelection(msg)
    ▼
NodeStore: emit('change', node)
    │
    ├──► StatusBarManager.update(node)
    ├──► InspectorPanel.render(node)
    ├──► lmTools: 下次 Copilot 调用时返回
    └──► chatParticipant: @figma 查询时返回
```

---

## 功能验证清单

### 链路测试

- [ ] `npm run test -w vscode-extension` 全部通过（3 条测试全 ✅）

### Figma Plugin

- [ ] `figma-plugin/manifest.json` 可正常导入 Figma Desktop
- [ ] 插件 UI 显示连接状态（🟢/🔴/🟠）
- [ ] 选中不同类型的节点（Frame、Text、Component Instance）均正确提取属性
- [ ] 多选时 other 数组包含其他节点摘要
- [ ] 切换不同页面时 pageId/pageName 更新
- [ ] 无选中时 primary 为 null
- [ ] WebSocket 连接断开后 5 秒自动重连
- [ ] WebSocket 消息积压队列在重连后自动发送

### VS Code 扩展

- [ ] `F5` 启动扩展开发模式，BridgeServer 正常监听
- [ ] 状态栏显示 `Figma: 未选中`（初始化状态）
- [ ] 收到选中后状态栏显示节点名称 + 类型 + 尺寸
- [ ] `Figma: Open Design Inspector` 打开 Webview 面板
- [ ] Inspector Panel 实时更新（选中变化时自动刷新）
- [ ] `Figma: Insert Selection to Chat` 复制到剪贴板
- [ ] `@figma selection` 返回 Markdown 格式节点属性
- [ ] `@figma token` 返回 CSS 变量格式 Design Token
- [ ] `@figma children` 返回子元素列表
- [ ] Copilot Agent 模式下自动调用 3 个 LM Tools

### 节点属性提取

| 属性 | Frame | Text | Component Instance |
|------|-------|------|-------------------|
| id / name / type | ✅ | ✅ | ✅ |
| width / height | ✅ | ✅ | ✅ |
| x / y | ✅ | ✅ | ✅ |
| fills (颜色) | ✅ | ✅ | ✅ |
| strokes (描边) | ✅ | ✅ | — |
| effects (阴影/模糊) | ✅ | ✅ | — |
| opacity | ✅ | ✅ | ✅ |
| cornerRadius | ✅ | — | — |
| characters (文字内容) | — | ✅ | — |
| fontSize / fontName | — | ✅ | — |
| lineHeight / letterSpacing | — | ✅ | — |
| textAlignHorizontal / Vertical | — | ✅ | — |
| children (子元素摘要) | ✅ | ✅ | ✅ |
| layoutMode (Auto Layout) | ✅ | — | — |
| componentId / mainComponentName | — | — | ✅ |

---

## 故障排除

### 问题：`npm run build` 失败

```bash
# 清理后重试
npm run clean
npm install
npm run build
```

### 问题：独立测试连接被拒 (ECONNREFUSED)

```
❌ 测试失败: WebSocket 连接失败: connect ECONNREFUSED 127.0.0.1:9877
```

**原因**：端口 9877 被占用或权限不足。

**解决**：
```bash
# 查看端口占用
lsof -i :9877
# 终止占用进程
kill -9 <PID>
# 重试测试
npm run test -w vscode-extension
```

### 问题：Figma Plugin 显示 Disconnected

**可能原因**：
1. VS Code 扩展未启动（F5 开发模式未激活）
2. 端口不匹配（BridgeServer 可能使用了 9878-9887 之间的备用端口）
3. 防火墙阻止了 localhost 连接

**解决**：
1. 确认 VS Code 中 Alt+F12 打开输出面板，选择 "Figma Selection MCP"，查看日志
2. 尝试在 ui.html 中修改 `WS_BASE_PORT` 为 BridgeServer 实际使用的端口
3. 检查系统防火墙设置

### 问题：Inspector Panel 显示 "在 Figma 中选中一个节点"

**原因**：NodeStore 中无缓存数据（Figma Plugin 未发送或 Bridge 未收到）。

**排查步骤**：
1. 检查 Figma Plugin UI 是否显示 Connected
2. 在 Figma 中选中一个节点后，检查 VS Code 输出面板日志
3. 运行 `npm run test:mock -w vscode-extension` 测试纯 VS Code 侧链路

### 问题：Copilot 未自动调用 LM Tools

**原因**：Model description 未触发或 Copilot 不了解此工具。

**解决**：
- 使用 Agent 模式（而非 Ask/Edit 模式）
- 明确说 "帮我实现 Figma 中当前选中的设计组件"
- 或手动在 `@figma` 聊天参与者中查询

### 问题：`@figma` Chat Participant 不显示

**原因**：`media/figma-icon.svg` 缺失（已修复，确保 `npm run build:extension` 后存在）。

**验证**：
```bash
ls -la vscode-extension/media/figma-icon.svg
```

---

## 构建脚本快速参考

```bash
# 在项目根目录
npm run build              # 构建所有
npm run build:figma        # 仅构建 Figma Plugin
npm run build:extension    # 仅构建 VS Code 扩展
npm run test               # 运行独立链路测试
npm run test -w vscode-extension     # 同上（workspace 形式）
npm run test:mock -w vscode-extension # Mock Figma Client
npm run clean              # 清理 dist 目录
```

---

## 项目结构

```
figma-selection-mcp/
├── package.json              # 根 workspace 配置
├── figma-plugin/
│   ├── manifest.json         # Figma Plugin 声明
│   ├── package.json
│   ├── tsconfig.json
│   ├── ui.html               # WebSocket 桥接 UI
│   ├── dist/code.js          # 构建产物
│   └── src/
│       └── code.ts           # 选中监听 + 节点提取
└── vscode-extension/
    ├── package.json           # 扩展声明（命令、Chat Participant、LM Tools）
    ├── tsconfig.json
    ├── media/
    │   └── figma-icon.svg     # Chat Participant 图标
    ├── dist/                  # 构建产物
    ├── src/
    │   ├── extension.ts       # 激活入口
    │   ├── bridgeServer.ts    # WebSocket Server（零依赖）
    │   ├── nodeStore.ts       # 数据缓存 + EventEmitter
    │   ├── lmTools.ts         # Copilot LM Tool 注册
    │   ├── chatParticipant.ts # @figma 聊天参与者
    │   ├── statusBar.ts       # 状态栏管理
    │   ├── contextWriter.ts     # 上下文文件写入（.figma-context/）
    │   └── inspectorPanel.ts  # Webview Inspector 面板
    └── test/
        ├── tsconfig.json
        ├── standalone-test.ts   # 独立链路测试
        └── mock-figma-client.ts # Mock Figma 客户端
```

---

> 📐 **Figma Selection MCP** — 让设计稿与代码之间再无摩擦。
