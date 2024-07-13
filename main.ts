import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl } from 'obsidian';

// Remember to rename these classes and interfaces!

interface LocationDatabaseSettings {
	entryFolder: string;
}

const DEFAULT_SETTINGS: LocationDatabaseSettings = {
	entryFolder: '/'
}

export default class LocationDatabase extends Plugin {
	settings: LocationDatabaseSettings;

	async createNewLocationEntry() {

		let mapsUrl = null;
		navigator.clipboard.readText().then(async (text) => {
			// TODO: add expand pattern to understand google maps links
			const urlPattern = /^(https?):\/\/maps\.apple\.com[^\s]*$/i;
			if (urlPattern.test(text)) {
				// The clipboard contains a valid URL
				mapsUrl = text;
			} else {
				// The clipboard does not contain a valid URL
				// Prompt the user to enter their maps URL
				let modal = new URLModal(this.app);
				try {
					mapsUrl = await modal.getURL();
					if (!urlPattern.test(mapsUrl)) {
						new Notice("Invalid maps URL", 3000);
						return;
					}
				} catch {
					return;
				}
			}
			// Got a valid URL
			// parse url args
			const url = new URL(mapsUrl);
			const args = new URLSearchParams(url.search);

			const title = args.get("q") ?? "New Location";
			const address = args.get("address") ?? "NO ADDRESS";
			const coordinates = args.get("ll") ?? "NO COORDINIATES";

			// Use the cartes.io API to get an image of a marker at the coordinates
			// create cartes.io map
			// POST request to https://cartes.io/api/maps with title set to title
			const mapData = {
				title: title,
				privacy: "unlisted",
				users_can_create_markers: "yes"
			};

			let resp = await requestUrl(
				{
					method: 'post',
					url: 'https://cartes.io/api/maps',
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json',
					},
					body: JSON.stringify(mapData),
				});
			const result = JSON.parse(resp.text);
			const uuid = result.uuid;


			// POST request to https://cartes.io/api/maps/{uuid}/markers with lat and lng set
			const markerData = {
				lat: Number(coordinates.split(',')[0]),
				lng: Number(coordinates.split(',')[1]),
				category_name: "Marker"
			};

			console.log(requestUrl(
				{
					method: 'post',
					url: `https://cartes.io/api/maps/${uuid}/markers`,
					headers: {
						'Content-Type': 'application/json',
						'Accept': 'application/json',
					},
					body: JSON.stringify(markerData),
				}));
				console.log(JSON.stringify(markerData));

			// Create new note at location specified in settings
			const folderPath = this.settings.entryFolder;
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				new Notice(`Folder ${folderPath} does not exist`);
				return;
			}

			const fileName = `${title}.md`;
			const filePath = `${folderPath}/${fileName}`;
			const fileExists = await this.app.vault.adapter.exists(filePath);
			if (fileExists) {
				new Notice(`File ${fileName} already exists`);
				return;
			}

			const frontmatter = `---
Location: "[${title}](${mapsUrl})"
title: ${title}
address: ${address}
coordinates: ${coordinates}
image: https://cartes.io/api/maps/${uuid}/images/static?zoom=11
---
`;
			const content = frontmatter + "\n";
			await this.app.vault.create(filePath, content);
			new Notice(`New location entry created: ${fileName}`);

		}).catch((error) => {
			// Failed to read from clipboard
			console.error('Error reading clipboard:', error);
		});
	}

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			'map-pinned',
			'New Location',
			() => {
				this.createNewLocationEntry()
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'add-new-location-entry',
			name: 'Add a new location entry',
			callback: () => {
				this.createNewLocationEntry();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new LocationDatabaseSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
class URLModal extends Modal {
	urlInput: string;
	resolvePromise: (url: string) => void;
	rejectPromise: (reason?: any) => void;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h1', { text: 'Enter URL' });
		new Setting(contentEl)
			.setName("Maps URL")
			.addText((text) =>
				text.onChange((value) => {
					this.urlInput = value;
				}));

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Create")
					.setCta()
					.onClick(() => {
						this.resolvePromise(this.urlInput);
						this.close();
					}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		if (this.rejectPromise) {
			this.rejectPromise();
		}
	}

	getURL(): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
			this.open();
		});
	}
}

class LocationDatabaseSettingTab extends PluginSettingTab {
	plugin: LocationDatabase;

	constructor(app: App, plugin: LocationDatabase) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Location entry folder')
			.setDesc('Where to save your location entry files to')
			.addText(text => text
				.setPlaceholder('/locations')
				.setValue(this.plugin.settings.entryFolder)
				.onChange(async (value) => {
					this.plugin.settings.entryFolder = value;
					await this.plugin.saveSettings();
				}));
	}
}
