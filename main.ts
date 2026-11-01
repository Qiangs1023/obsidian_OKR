import {
	ItemView,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	WorkspaceLeaf,
	setIcon,
} from "obsidian";

const VIEW_TYPE_OKR = "okr-dashboard-view";
type Screen = "dashboard" | "objectives" | "projects" | "tasks";
type OkrKind = "objective" | "key_result" | "project" | "task";

interface OkrSettings {
	baseFolder: string;
	objectiveFolder: string;
	keyResultFolder: string;
	projectFolder: string;
	taskFolder: string;
	objectiveTemplate: string;
	keyResultTemplate: string;
	projectTemplate: string;
	taskTemplate: string;
}

const DEFAULT_SETTINGS: OkrSettings = {
	baseFolder: "00_OKR",
	objectiveFolder: "00_OKR/04_Objectives",
	keyResultFolder: "00_OKR/03_Key Results",
	projectFolder: "00_OKR/02_Projects",
	taskFolder: "00_OKR/01_Tasks",
	objectiveTemplate: "",
	keyResultTemplate: "",
	projectTemplate: "",
	taskTemplate: "",
};

interface OkrNote {
	file: TFile;
	kind: OkrKind;
	status: string;
	due: string;
	project: string;
	keyResults: string[];
	objective: string;
	current: string;
	target: string;
	unit: string;
}

function localDate(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function startOfWeek(date = new Date()): Date {
	const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const daysSinceMonday = (start.getDay() + 6) % 7;
	start.setDate(start.getDate() - daysSinceMonday);
	return start;
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

function frontmatterLinks(value: unknown): string[] {
	if (!value) return [];
	const values = Array.isArray(value) ? value : [value];
	return values.flatMap((item) => {
		if (typeof item !== "string") return [];
		const match = item.match(/^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]$/);
		return match ? [match[1]] : [];
	});
}

function linkName(link: string): string {
	return link.split("/").pop()?.replace(/\.md$/i, "") ?? link;
}

function readKind(value: unknown): OkrKind | null {
	return value === "objective" || value === "key_result" || value === "project" || value === "task" ? value : null;
}

export default class OkrPlugin extends Plugin {
	settings: OkrSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(VIEW_TYPE_OKR, (leaf) => new OkrView(leaf, this));
		this.addRibbonIcon("target", "Open OKR dashboard", () => void this.activateView());
		this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.activateView() });
		this.addCommand({ id: "create-task", name: "Create task", callback: () => this.openCreateModal("task") });
		this.addSettingTab(new OkrSettingTab(this.app, this));
		this.registerEvent(this.app.metadataCache.on("changed", () => this.refreshView()));
		this.registerEvent(this.app.vault.on("create", () => this.refreshView()));
		this.registerEvent(this.app.vault.on("delete", () => this.refreshView()));
		this.registerEvent(this.app.vault.on("rename", () => this.refreshView()));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_OKR);
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData() as Partial<OkrSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
		// Migrate the older root + child-folder settings to full vault-relative paths.
		if (saved?.baseFolder) {
			for (const key of ["objectiveFolder", "keyResultFolder", "projectFolder", "taskFolder"] as const) {
				const value = saved[key];
				if (value && !value.startsWith(`${saved.baseFolder}/`)) this.settings[key] = `${saved.baseFolder}/${value}`;
			}
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.refreshView();
	}

	async activateView(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_OKR)[0];
		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_OKR, active: true });
		}
		await this.app.workspace.revealLeaf(leaf);
	}

	refreshView(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OKR)) {
			if (leaf.view instanceof OkrView) leaf.view.render();
		}
	}

	getNotes(): OkrNote[] {
		const folderForKind: Record<OkrKind, string> = {
			objective: this.settings.objectiveFolder,
			key_result: this.settings.keyResultFolder,
			project: this.settings.projectFolder,
			task: this.settings.taskFolder,
		};
		return this.app.vault.getMarkdownFiles().filter((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const kind = readKind(frontmatter?.type);
			if (!kind) return false;
			const folder = folderForKind[kind].replace(/^\/+|\/+$/g, "");
			return !!folder && file.path.startsWith(`${folder}/`);
		}).flatMap((file) => {
			const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
			const kind = readKind(frontmatter?.type);
			if (!kind) return [];
			const keyResults = frontmatterLinks(frontmatter?.key_results ?? frontmatter?.key_result);
			return [{
				file,
				kind,
				status: String(frontmatter?.status ?? "todo"),
				due: String(frontmatter?.due ?? ""),
				project: frontmatterLinks(frontmatter?.project)[0] ?? "",
				keyResults,
				objective: frontmatterLinks(frontmatter?.objective)[0] ?? "",
				current: frontmatter?.current == null ? "" : String(frontmatter.current),
				target: frontmatter?.target == null ? "" : String(frontmatter.target),
				unit: String(frontmatter?.unit ?? ""),
			}];
		});
	}

	async setTaskStatus(file: TFile, status: string): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.status = status;
		});
	}

	async createNote(kind: OkrKind, title: string, values: Record<string, string | string[]>): Promise<TFile> {
		const folderKey: Record<OkrKind, string> = {
			objective: this.settings.objectiveFolder,
			key_result: this.settings.keyResultFolder,
			project: this.settings.projectFolder,
			task: this.settings.taskFolder,
		};
		const folder = folderKey[kind].replace(/^\/+|\/+$/g, "");
		await this.ensureFolder(folder);
		const safeTitle = title.trim().replace(/[\\/:*?"<>|#^[\]]/g, "-");
		const path = `${folder}/${safeTitle || this.kindLabel(kind)}.md`;
		if (this.app.vault.getAbstractFileByPath(path)) throw new Error("A note with this name already exists in the selected folder.");
		const templateKey: Record<OkrKind, string> = {
			objective: this.settings.objectiveTemplate,
			key_result: this.settings.keyResultTemplate,
			project: this.settings.projectTemplate,
			task: this.settings.taskTemplate,
		};
		const templatePath = templateKey[kind].trim();
		let content = `# ${safeTitle || this.kindLabel(kind)}\n\n`;
		if (templatePath) {
			const template = this.app.vault.getAbstractFileByPath(templatePath);
			if (!(template instanceof TFile)) throw new Error(`找不到模板文件：${templatePath}`);
			content = (await this.app.vault.read(template)).replace(/\{\{title\}\}/g, safeTitle).replace(/\{\{date\}\}/g, localDate());
		}
		const file = await this.app.vault.create(path, content);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			frontmatter.type = kind;
			frontmatter.status = values.status || (kind === "task" ? "todo" : "active");
			for (const [key, value] of Object.entries(values)) {
				if (key === "status" || value === "") continue;
				if (key === "project" || key === "objective") frontmatter[key] = `[[${value}]]`;
				else if (key === "key_results") frontmatter[key] = (Array.isArray(value) ? value : [value]).filter(Boolean).map((item) => `[[${item}]]`);
				else frontmatter[key] = value;
			}
		});
		return file;
	}

	private async ensureFolder(path: string): Promise<void> {
		if (!path || this.app.vault.getAbstractFileByPath(path)) return;
		const parts = path.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
		}
	}

	kindLabel(kind: OkrKind): string {
		return { objective: "Objective", key_result: "Key Result", project: "Project", task: "Task" }[kind];
	}

	openCreateModal(kind: OkrKind, onCreated?: () => void): void {
		new CreateNoteModal(this.app, this, kind, onCreated).open();
	}

	async openNote(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}
}

class OkrView extends ItemView {
	private screen: Screen = "dashboard";
	private taskFilter = "all";
	private taskSort = "asc";
	private taskGroup = "none";
	private root: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private plugin: OkrPlugin) {
		super(leaf);
		this.root = this.containerEl.children[1] as HTMLElement;
	}

	getViewType(): string { return VIEW_TYPE_OKR; }
	getDisplayText(): string { return "OKR"; }
	getIcon(): string { return "target"; }

	async onOpen(): Promise<void> { this.render(); }
	async onClose(): Promise<void> { this.root.empty(); }

	render(): void {
		this.root.empty();
		this.root.addClass("okr-view-root");
		const shell = this.root.createDiv({ cls: "okr-shell" });
		this.renderNavigation(shell);
		const content = shell.createDiv({ cls: "okr-content" });
		if (this.screen === "dashboard") this.renderDashboard(content);
		else if (this.screen === "objectives") this.renderCollection(content, "objective");
		else if (this.screen === "projects") this.renderCollection(content, "project");
		else this.renderTasks(content);
	}

	private renderNavigation(shell: HTMLElement): void {
		const nav = shell.createDiv({ cls: "okr-nav" });
		const brand = nav.createDiv({ cls: "okr-brand" });
		setIcon(brand.createSpan(), "target");
		brand.createSpan({ text: "OKR" });
		const links: Array<{ screen: Screen; label: string; icon: string }> = [
			{ screen: "dashboard", label: "仪表盘", icon: "layout-dashboard" },
			{ screen: "tasks", label: "任务", icon: "check-square" },
			{ screen: "projects", label: "项目", icon: "folder-kanban" },
			{ screen: "objectives", label: "目标", icon: "trophy" },
		];
		for (const item of links) {
			const button = nav.createEl("button", { cls: `okr-nav-item${this.screen === item.screen ? " is-active" : ""}` });
			setIcon(button.createSpan(), item.icon);
			button.createSpan({ text: item.label });
			button.addEventListener("click", () => { this.screen = item.screen; this.render(); });
		}
		const spacer = nav.createDiv({ cls: "okr-nav-spacer" });
		spacer.setAttr("aria-hidden", "true");
		const create = nav.createEl("button", { cls: "okr-primary-button okr-nav-create" });
		setIcon(create.createSpan(), "plus");
		create.createSpan({ text: "新建任务" });
		create.addEventListener("click", () => this.plugin.openCreateModal("task", () => this.render()));
	}

	private renderHeader(container: HTMLElement, title: string, subtitle: string): HTMLElement {
		const header = container.createDiv({ cls: "okr-page-header" });
		const heading = header.createDiv();
		heading.createEl("h1", { text: title });
		heading.createEl("p", { text: subtitle });
		const actions = header.createDiv({ cls: "okr-header-actions" });
		const add = actions.createEl("button", { cls: "okr-primary-button", text: "＋ 新建" });
		add.addEventListener("click", () => this.plugin.openCreateModal(this.screen === "objectives" ? "objective" : this.screen === "projects" ? "project" : "task", () => this.render()));
		return actions;
	}

	private renderDashboard(container: HTMLElement): void {
		const today = localDate();
		const weekStart = localDate(startOfWeek());
		const weekEnd = localDate(addDays(startOfWeek(), 6));
		const notes = this.plugin.getNotes();
		const tasks = notes.filter((note) => note.kind === "task" && note.status !== "done" && note.status !== "cancelled");
		const actions = this.renderHeader(container, "仪表盘", `${today} · 今天开始推进重要的事`);
		const quick = actions.createEl("button", { cls: "okr-secondary-button", text: "＋ 快速任务" });
		quick.addEventListener("click", () => this.plugin.openCreateModal("task", () => this.render()));
		const grid = container.createDiv({ cls: "okr-dashboard-grid" });
		const taskArea = grid.createDiv({ cls: "okr-task-area" });
		const projectArea = grid.createDiv({ cls: "okr-project-area" });
		this.renderTaskSection(taskArea, "今天", "sun", tasks.filter((task) => task.due === today), "今天没有安排的任务");
		this.renderTaskSection(taskArea, "逾期", "clock-alert", tasks.filter((task) => task.due && task.due < today), "没有逾期任务");
		this.renderTaskSection(taskArea, "本周", "calendar-days", tasks.filter((task) => task.due >= weekStart && task.due <= weekEnd && task.due !== today), "本周没有其他任务");
		this.renderProjects(projectArea, notes);
	}

	private renderTaskSection(container: HTMLElement, title: string, icon: string, tasks: OkrNote[], emptyText: string): void {
		const section = container.createDiv({ cls: "okr-section" });
		const heading = section.createDiv({ cls: "okr-section-heading" });
		setIcon(heading.createSpan(), icon);
		heading.createEl("h2", { text: title });
		heading.createSpan({ cls: "okr-count", text: String(tasks.length) });
		if (!tasks.length) {
			section.createDiv({ cls: "okr-empty-inline", text: emptyText });
			return;
		}
		const list = section.createDiv({ cls: "okr-task-list" });
		for (const task of tasks) this.renderTaskRow(list, task);
	}

	private renderTaskRow(container: HTMLElement, task: OkrNote): void {
		const row = container.createDiv({ cls: "okr-task-row" });
		const checkbox = row.createEl("button", { cls: "okr-checkbox", attr: { "aria-label": "标记完成" } });
		setIcon(checkbox, task.status === "doing" ? "circle-dot" : "circle");
		checkbox.addEventListener("click", async (event) => {
			event.stopPropagation();
			await this.plugin.setTaskStatus(task.file, "done");
			this.render();
		});
		const detail = row.createDiv({ cls: "okr-task-detail" });
		const title = detail.createEl("button", { cls: "okr-link-button okr-task-title", text: task.file.basename });
		title.addEventListener("click", () => void this.plugin.openNote(task.file));
		const meta = detail.createDiv({ cls: "okr-task-meta" });
		if (task.project) meta.createSpan({ cls: "okr-chip", text: linkName(task.project) });
		for (const keyResult of task.keyResults.slice(0, 2)) meta.createSpan({ cls: "okr-chip", text: linkName(keyResult) });
		if (task.due) meta.createSpan({ cls: "okr-date", text: task.due });
		const menu = row.createEl("select", { cls: "okr-task-reschedule", attr: { "aria-label": "调整日期" } });
		menu.createEl("option", { text: "⋯", value: "" });
		menu.createEl("option", { text: "今天", value: localDate() });
		menu.createEl("option", { text: "明天", value: localDate(addDays(new Date(), 1)) });
		menu.createEl("option", { text: "下周一", value: localDate(addDays(startOfWeek(), 7)) });
		menu.createEl("option", { text: "无日期", value: "__clear" });
		menu.addEventListener("change", async () => {
			if (!menu.value) return;
			await this.app.fileManager.processFrontMatter(task.file, (fm) => {
				if (menu.value === "__clear") delete fm.due;
				else fm.due = menu.value;
			});
			this.render();
		});
	}

	private renderProjects(container: HTMLElement, notes: OkrNote[]): void {
		const projects = notes.filter((note) => note.kind === "project" && note.status !== "completed" && note.status !== "cancelled");
		const heading = container.createDiv({ cls: "okr-section-heading okr-project-heading" });
		setIcon(heading.createSpan(), "folder-kanban");
		heading.createEl("h2", { text: "项目进度" });
		if (!projects.length) {
			container.createDiv({ cls: "okr-empty-card", text: "还没有进行中的项目。新建项目后，进度会显示在这里。" });
			return;
		}
		const projectGrid = container.createDiv({ cls: "okr-project-list" });
		for (const project of projects) {
			const projectTasks = notes.filter((note) => note.kind === "task" && note.project && linkName(note.project) === project.file.basename);
			const done = projectTasks.filter((task) => task.status === "done").length;
			const percent = projectTasks.length ? Math.round((done / projectTasks.length) * 100) : 0;
			const card = projectGrid.createDiv({ cls: "okr-project-card" });
			const title = card.createEl("button", { cls: "okr-link-button okr-project-title", text: project.file.basename });
			title.addEventListener("click", () => void this.plugin.openNote(project.file));
			card.createDiv({ cls: "okr-project-status", text: project.status === "in_progress" ? "进行中" : project.status });
			const progressLabel = card.createDiv({ cls: "okr-progress-label" });
			progressLabel.createSpan({ text: "任务完成率" });
			progressLabel.createSpan({ text: projectTasks.length ? `${done}/${projectTasks.length} · ${percent}%` : "暂无任务" });
			const progress = card.createDiv({ cls: "okr-progress-track" });
			progress.createDiv({ cls: "okr-progress-fill", attr: { style: `width: ${percent}%` } });
			if (project.keyResults.length) {
				const krList = card.createDiv({ cls: "okr-kr-list" });
				for (const link of project.keyResults) {
					const kr = notes.find((note) => note.kind === "key_result" && note.file.basename === linkName(link));
					const krRow = krList.createDiv({ cls: "okr-kr-row" });
					krRow.createSpan({ text: linkName(link) });
					krRow.createSpan({ text: kr && kr.current && kr.target ? `${kr.current}${kr.unit} → ${kr.target}${kr.unit}` : kr?.status ?? "未设置进展" });
				}
			} else card.createDiv({ cls: "okr-unlinked", text: "尚未关联关键结果" });
		}
	}

	private renderCollection(container: HTMLElement, kind: "objective" | "project"): void {
		const notes = this.plugin.getNotes().filter((note) => note.kind === kind);
		const title = kind === "objective" ? "目标" : "项目";
		const actions = this.renderHeader(container, title, kind === "objective" ? "持续关注真正重要的方向" : "查看每个项目的行动和结果");
		if (kind === "objective") {
			const addKr = actions.createEl("button", { cls: "okr-secondary-button", text: "＋ 新建 KR" });
			addKr.addEventListener("click", () => this.plugin.openCreateModal("key_result", () => this.render()));
		}
		if (!notes.length) {
			container.createDiv({ cls: "okr-empty-card", text: `还没有${title}。点击右上角新建，或在库中创建带有 type: ${kind} 属性的 Markdown 笔记。` });
			return;
		}
		const cards = container.createDiv({ cls: kind === "objective" ? "okr-objective-list" : "okr-collection-grid" });
		for (const note of notes) {
			const card = cards.createDiv({ cls: kind === "objective" ? "okr-objective-card" : "okr-collection-card" });
			const titleButton = card.createEl("button", { cls: "okr-link-button okr-project-title", text: note.file.basename });
			titleButton.addEventListener("click", () => void this.plugin.openNote(note.file));
			card.createDiv({ cls: "okr-muted", text: note.status });
			if (kind === "objective") {
				const krList = card.createDiv({ cls: "okr-objective-krs" });
				const krs = this.plugin.getNotes().filter((kr) => kr.kind === "key_result" && kr.objective && linkName(kr.objective) === note.file.basename);
				for (const kr of krs) {
					const row = krList.createEl("button", { cls: "okr-link-button okr-related-row", text: kr.file.basename });
					row.addEventListener("click", () => void this.plugin.openNote(kr.file));
					if (kr.current && kr.target) row.createSpan({ cls: "okr-kr-value", text: `${kr.current}${kr.unit} / ${kr.target}${kr.unit}` });
				}
			} else {
				const projectTasks = this.plugin.getNotes().filter((task) => task.kind === "task" && linkName(task.project) === note.file.basename);
				const done = projectTasks.filter((task) => task.status === "done").length;
				card.createDiv({ cls: "okr-related-row", text: `任务 ${done}/${projectTasks.length} 完成` });
				for (const krLink of note.keyResults) card.createDiv({ cls: "okr-related-row", text: `KR · ${linkName(krLink)}` });
			}
		}
	}

	private renderTasks(container: HTMLElement): void {
		const allTasks = this.plugin.getNotes().filter((note) => note.kind === "task");
		const today = localDate();
		const weekStart = localDate(startOfWeek());
		const weekEnd = localDate(addDays(startOfWeek(), 6));
		const actions = this.renderHeader(container, "任务", "按状态、日期和关联对象查看任务");
		const controls = container.createDiv({ cls: "okr-task-controls" });
		const filter = controls.createEl("select", { cls: "okr-filter", attr: { "aria-label": "按状态筛选" } });
		for (const [value, label] of [["all", "全部状态"], ["todo", "等待中"], ["doing", "进行中"], ["cancelled", "已取消"], ["done", "已完成"]]) filter.createEl("option", { value, text: label });
		filter.value = this.taskFilter;
		filter.addEventListener("change", () => { this.taskFilter = filter.value; this.render(); });
		const sort = controls.createEl("select", { cls: "okr-filter", attr: { "aria-label": "日期排序" } });
		sort.createEl("option", { value: "asc", text: "日期从早到晚" });
		sort.createEl("option", { value: "desc", text: "日期从晚到早" });
		sort.value = this.taskSort;
		sort.addEventListener("change", () => { this.taskSort = sort.value; this.render(); });
		const group = controls.createEl("select", { cls: "okr-filter", attr: { "aria-label": "分组方式" } });
		for (const [value, label] of [["none", "不分组"], ["project", "按项目分组"], ["key_result", "按关键结果分组"], ["status", "按状态分组"]]) group.createEl("option", { value, text: label });
		group.value = this.taskGroup;
		group.addEventListener("change", () => { this.taskGroup = group.value; this.render(); });
		const tasks = allTasks.filter((task) => {
			if (this.taskFilter !== "all") return task.status === this.taskFilter;
			return true;
		});
		tasks.sort((a, b) => this.taskSort === "asc" ? a.due.localeCompare(b.due) : b.due.localeCompare(a.due));
		if (!tasks.length) {
			container.createDiv({ cls: "okr-empty-card", text: "这里还没有符合条件的任务。" });
			return;
		}
		if (this.taskGroup === "none") {
			const list = container.createDiv({ cls: "okr-task-list okr-all-task-list" });
			for (const task of tasks) this.renderTaskRow(list, task);
			return;
		}
		const groups = new Map<string, OkrNote[]>();
		for (const task of tasks) {
			const key = this.taskGroup === "project" ? (task.project ? linkName(task.project) : "未关联项目") : this.taskGroup === "key_result" ? (task.keyResults[0] ? linkName(task.keyResults[0]) : "未关联关键结果") : task.status;
			groups.set(key, [...(groups.get(key) ?? []), task]);
		}
		for (const [name, groupTasks] of groups) {
			container.createEl("h2", { cls: "okr-task-group-title", text: name });
			const list = container.createDiv({ cls: "okr-task-list okr-all-task-list" });
			for (const task of groupTasks) this.renderTaskRow(list, task);
		}
	}
}

class CreateNoteModal extends Modal {
	private title = "";
	private due = "";
	private status = "";
	private project = "";
	private objective = "";
	private keyResults = new Set<string>();
	private fieldArea: HTMLElement;

	constructor(app: OkrPlugin["app"], private plugin: OkrPlugin, private kind: OkrKind, private onCreated?: () => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("okr-modal");
		const { contentEl } = this;
		contentEl.createEl("h2", { text: `新建${this.plugin.kindLabel(this.kind)}` });
		new Setting(contentEl).setName("名称").addText((text) => text.setPlaceholder("写一个清晰的名称").onChange((value) => { this.title = value; }));
		this.fieldArea = contentEl.createDiv({ cls: "okr-modal-fields" });
		if (this.kind === "task") this.renderTaskFields();
		if (this.kind === "key_result") this.renderKrFields();
		if (this.kind === "project") this.renderProjectFields();
		new Setting(contentEl).addButton((button) => button.setButtonText("创建笔记").setCta().onClick(() => void this.submit()));
	}

	private renderTaskFields(): void {
		new Setting(this.fieldArea).setName("计划日期").addText((text) => {
			text.inputEl.type = "date";
			text.onChange((value) => { this.due = value; });
		});
		const projects = this.plugin.getNotes().filter((note) => note.kind === "project");
		new Setting(this.fieldArea).setName("所属项目").addDropdown((dropdown) => {
			dropdown.addOption("", "无项目");
			for (const project of projects) dropdown.addOption(project.file.basename, project.file.basename);
			dropdown.onChange((value) => { this.project = value; });
		});
		const krs = this.plugin.getNotes().filter((note) => note.kind === "key_result");
		const krSetting = new Setting(this.fieldArea).setName("关联 KR");
		const select = krSetting.controlEl.createEl("select", { attr: { multiple: "true" } });
		select.addClass("okr-multi-select");
		for (const kr of krs) select.createEl("option", { value: kr.file.basename, text: kr.file.basename });
		select.addEventListener("change", () => {
			this.keyResults = new Set(Array.from(select.selectedOptions).map((option) => option.value));
		});
	}

	private renderKrFields(): void {
		const objectives = this.plugin.getNotes().filter((note) => note.kind === "objective");
		new Setting(this.fieldArea).setName("所属目标").addDropdown((dropdown) => {
			dropdown.addOption("", "选择目标");
			for (const objective of objectives) dropdown.addOption(objective.file.basename, objective.file.basename);
			dropdown.onChange((value) => { this.objective = value; });
		});
		for (const [key, label, placeholder] of [["metric", "衡量指标", "例如：项目按期率"], ["start", "起始值", "数值"], ["current", "当前值", "数值"], ["target", "目标值", "数值"], ["unit", "单位", "例如：%"]]) {
			new Setting(this.fieldArea).setName(label).addText((text) => text.setPlaceholder(placeholder).onChange((value) => { this.values[key] = value; }));
		}
	}

	private values: Record<string, string> = {};

	private renderProjectFields(): void {
		const krs = this.plugin.getNotes().filter((note) => note.kind === "key_result");
		const krSetting = new Setting(this.fieldArea).setName("关联 KR");
		const select = krSetting.controlEl.createEl("select", { attr: { multiple: "true" } });
		select.addClass("okr-multi-select");
		for (const kr of krs) select.createEl("option", { value: kr.file.basename, text: kr.file.basename });
		select.addEventListener("change", () => { this.keyResults = new Set(Array.from(select.selectedOptions).map((option) => option.value)); });
	}

	private async submit(): Promise<void> {
		if (!this.title.trim()) {
			new Notice("请先填写名称");
			return;
		}
		try {
			const fields: Record<string, string | string[]> = { ...this.values };
			if (this.kind === "task") {
				fields.status = "todo";
				fields.due = this.due;
				fields.project = this.project;
				fields.key_results = [...this.keyResults];
			}
			if (this.kind === "key_result") {
				fields.objective = this.objective;
				fields.status = "active";
			}
			if (this.kind === "project") {
				fields.status = "in_progress";
				fields.key_results = [...this.keyResults];
			}
			if (this.kind === "objective") fields.status = "active";
			const file = await this.plugin.createNote(this.kind, this.title, fields);
			new Notice(`${this.plugin.kindLabel(this.kind)}已创建`);
			this.close();
			this.onCreated?.();
			await this.plugin.openNote(file);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "创建失败");
		}
	}

	onClose(): void { this.contentEl.empty(); }
}

class OkrSettingTab extends PluginSettingTab {
	constructor(app: OkrPlugin["app"], private plugin: OkrPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "OKR 文档目录与模板" });
		containerEl.createEl("p", { text: "目录和模板路径均使用当前 Obsidian 库内的相对路径。每类文档只从对应目录读取，新建时也写入该目录。" });
		const folderSettings: Array<["objectiveFolder" | "keyResultFolder" | "projectFolder" | "taskFolder", string]> = [
			["objectiveFolder", "目标目录"],
			["keyResultFolder", "关键结果目录"],
			["projectFolder", "项目目录"],
			["taskFolder", "任务目录"],
		];
		const vaultFolders = this.plugin.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder).map((folder) => folder.path);
		for (const [key, label] of folderSettings) {
			const setting = new Setting(containerEl).setName(label).setDesc("选择已有文件夹，或输入库内相对路径");
			setting.addDropdown((dropdown) => {
				dropdown.addOption("", "选择目录…");
				[...new Set([...vaultFolders, this.plugin.settings[key]].filter(Boolean))].sort().forEach((path) => dropdown.addOption(path, path));
				dropdown.setValue(this.plugin.settings[key]);
				dropdown.onChange(async (value) => {
					if (!value) return;
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				});
			});
			setting.addText((text) => {
				text.setPlaceholder("例如：00_OKR/04_Objectives").setValue(this.plugin.settings[key]);
				text.inputEl.addEventListener("blur", () => {
					const value = text.getValue().trim().replace(/^\/+|\/+$/g, "");
					if (value && value !== this.plugin.settings[key]) {
						this.plugin.settings[key] = value;
						void this.plugin.saveSettings();
					}
				});
			});
		}

		containerEl.createEl("h3", { text: "模板文件" });
		containerEl.createEl("p", { text: "选择你在 Obsidian 中创建的 Markdown 模板。模板可使用 {{title}} 和 {{date}} 占位符；创建时插件会补齐或更新 OKR 属性。留空则使用插件内置的简易笔记格式。" });
		const templateSettings: Array<["objectiveTemplate" | "keyResultTemplate" | "projectTemplate" | "taskTemplate", string]> = [
			["objectiveTemplate", "目标模板"],
			["keyResultTemplate", "关键结果模板"],
			["projectTemplate", "项目模板"],
			["taskTemplate", "任务模板"],
		];
		const markdownFiles = this.plugin.app.vault.getMarkdownFiles().map((file) => file.path).sort();
		for (const [key, label] of templateSettings) {
			const setting = new Setting(containerEl).setName(label).setDesc("选择库内 Markdown 文件作为模板，或填写相对路径");
			setting.addDropdown((dropdown) => {
				dropdown.addOption("", "不使用模板");
				[...new Set([...markdownFiles, this.plugin.settings[key]].filter(Boolean))].sort().forEach((path) => dropdown.addOption(path, path));
				dropdown.setValue(this.plugin.settings[key]);
				dropdown.onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
				});
			});
			setting.addText((text) => {
				text.setPlaceholder("例如：Templates/OKR/任务.md").setValue(this.plugin.settings[key]);
				text.inputEl.addEventListener("blur", () => {
					const value = text.getValue().trim();
					if (value !== this.plugin.settings[key]) {
						this.plugin.settings[key] = value;
						void this.plugin.saveSettings();
					}
				});
			});
		}
	}
}
