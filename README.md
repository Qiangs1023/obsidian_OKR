# OKR Dashboard

**用 Markdown 管理目标、关键结果、项目和每日任务。**

OKR Dashboard 把 OKR 与日常行动放在同一个 Obsidian 工作流中。笔记仍是普通 Markdown 文件，使用 YAML 属性记录类型和状态，通过 Obsidian 双向链接关联目标、KR、项目与任务。

> 插件仍在早期开发阶段。界面和数据格式可能继续调整；发布到社区插件市场前，请先在测试库验证。

## 功能

- 每日仪表盘汇总今天、逾期、本周任务和项目进度。
- 手机与桌面布局按插件面板宽度自适应。
- 快速创建任务、目标、关键结果和项目。
- 从任务卡片打开对应笔记，或直接完成、调整日期。
- 项目同时显示任务完成率和关联 KR 的进展。
- 任务可按状态筛选、按日期排序，并按项目、KR 或状态分组。
- 四类笔记分别设置读取/创建目录和 Markdown 模板。
- 数据保存在本地 Markdown 笔记中，不使用外部服务。

## 安装

### 社区插件市场

插件通过 Obsidian 社区插件目录审核并发布后，可在 **设置 → 第三方插件 → 浏览** 搜索 `OKR Dashboard` 安装。

### 手动安装

1. 从项目的 GitHub Releases 下载 `manifest.json`、`main.js` 和 `styles.css`。
2. 在当前库的 `.obsidian/plugins/obsidian-okr/` 中放入这三个文件。
3. 在 Obsidian **设置 → 第三方插件** 中启用 OKR Dashboard。

## 开始使用

打开 **设置 → 第三方插件 → OKR Dashboard**，为目标、关键结果、项目、任务分别选择：

- **文档目录**：库内相对路径。插件只从相应类型设置的目录读取，并将新文档写入该目录。
- **模板文件**：选择库内 Markdown 文件作为创建模板；留空时使用插件内置的简易笔记格式。

模板正文可使用 `{{title}}` 和 `{{date}}` 占位符。创建时插件会替换占位符，并补齐 `type`、`status` 等 OKR 属性。

打开仪表盘：点击 Obsidian 左侧工具栏的靶心图标，或在命令面板执行 **OKR Dashboard: Open dashboard**。

## 笔记属性

插件按 `type` 识别以下笔记：

| 类型 | `type` 值 | 常用属性 |
|---|---|---|
| 目标 | `objective` | `status`、`period` |
| 关键结果 | `key_result` | `status`、`objective`、`metric`、`start`、`current`、`target`、`unit` |
| 项目 | `project` | `status`、`key_results`、`start_date`、`due_date` |
| 任务 | `task` | `status`、`due`、`project`、`key_results` |

关联字段使用 Obsidian wikilink，例如：

```yaml
---
type: task
status: todo
due: 2026-10-31
project: "[[优化发布流程]]"
key_results:
  - "[[KR-减少延期项目]]"
---
```

任务状态支持 `todo`（等待中）、`doing`（进行中）、`done`（已完成）和 `cancelled`（已取消）。

## 隐私与数据

插件只在当前 Obsidian 库中读取和修改你指定目录里的 Markdown 文件及插件设置，不会将笔记内容发送到网络服务。完成和改期操作更新任务的 YAML 属性，保留正文内容。

## 开发

```sh
npm install
npm run dev
```

生产构建：

```sh
npm run build
```

## 反馈与问题

请在项目的 GitHub Issues 中报告问题或提交功能建议。
