import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, requestUrl } from 'obsidian';

// Remember to rename these classes and interfaces!

interface LocationDatabaseSettings {
	entryFolder: string;
}

const DEFAULT_SETTINGS: LocationDatabaseSettings = {
	entryFolder: '/'
}

export default class LocationDatabase extends Plugin {
	settings: LocationDatabaseSettings;

	async addLocationFileFromUrl(mapsUrl: string){
			// Got a valid URL
			// parse url args
			const url = new URL(mapsUrl);
			const args = new URLSearchParams(url.search);

			const title = args.get("q") ?? "New Location";
			const address = args.get("address") ?? "NO ADDRESS";
			const coordinates = args.get("ll") ?? "NO COORDINIATES";

			try {

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
						throw: true
					});
				const result = JSON.parse(resp.text);
				const uuid = result.uuid;


				// POST request to https://cartes.io/api/maps/{uuid}/markers with lat and lng set
				const markerData = {
					lat: Number(coordinates.split(',')[0]),
					lng: Number(coordinates.split(',')[1]),
					category_name: "Marker"
				};
				
				requestUrl(
					{
						method: 'post',
						url: `https://cartes.io/api/maps/${uuid}/markers`,
						headers: {
							'Content-Type': 'application/json',
							'Accept': 'application/json',
						},
						body: JSON.stringify(markerData),
						throw: true
					});

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
				const content = `\n
<iframe src="https://app.cartes.io/maps/${uuid}/embed?type=map&lat=${coordinates.split(',')[0]}&lng=${coordinates.split(',')[1]}&zoom=11" 
width="100%" 
height="600" 
frameborder="0"></iframe>`;
				try { 
					await this.app.vault.create(filePath, frontmatter + content);
				} catch {
					// overrite existing file
					const file = this.app.vault.getAbstractFileByPath(filePath) as TFile;
					await this.app.vault.modify(file, frontmatter + content);
				}
				new Notice(`New location entry created: ${fileName}`);
			} catch(e) {
				new Notice(`Failed to create entry for ${title}. You may be rate limited, try again later`);
				throw e;
			}
	}

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
			this.addLocationFileFromUrl(mapsUrl);

		}).catch((error) => {
			// Failed to read from clipboard
			console.error('Error reading clipboard:', error);
		});
	}

	// This function should find any malformed data and regerate the file if needed
	async updateAllLocationEntries(){
		// Get all files from the designated folder
		const folderPath = this.settings.entryFolder;
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!folder || !(folder instanceof TFolder)) {
			new Notice(`Folder ${folderPath} does not exist`);
			return;
		}
		const files = (folder as TFolder).children;

		// loop over each file
		for (const abs_file of files) {
			if(abs_file instanceof TFolder){
				continue;
			}
			let file = abs_file as TFile;
			// parse the URL from location property in the frontmatter. the url is a markdown url
			let content = await this.app.vault.read(file);
			const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
			const frontmatterMatch = content.match(frontmatterRegex);
			if (!frontmatterMatch) {
				continue;
			}
			// remove frontmatter from content
			content = content.replace(frontmatterMatch[0],'');

			const frontmatter = frontmatterMatch[1];
			const locationRegex = /Location: "\[.*\]\((.*)\)"/;
			const locationMatch = frontmatter.match(locationRegex);
			if (!locationMatch) {
				continue;
			}
			const locationUrl = locationMatch[1];

			// parse the map uuid from the image property
			const imageRegex = /image: https:\/\/cartes.io\/api\/maps\/(.*)\/images\/static/;
			const imageMatch = frontmatter.match(imageRegex);
			let mapUuid;
			if (imageMatch) {
				mapUuid = imageMatch[1];
			} else {
				mapUuid = false;
			}
			

			// if there is no mapUuid, must regenerate the whole file
			if (!mapUuid) {
				// rename the current entry to have (old) at the end to save backup
				const oldFileName = file.basename;
				const newFileName = `${oldFileName} (old)`;
				const newPath = `${folderPath}/${newFileName}`;
				await this.app.vault.rename(file, newPath);

				try {
					await this.addLocationFileFromUrl(locationUrl);
					// Delete backup
					const fileToDelete = this.app.vault.getAbstractFileByPath(newPath);
					if (fileToDelete) {
						await this.app.vault.delete(fileToDelete);
					} else {
						new Notice(`File ${newPath} does not exist`);
					}
				} catch (error) {
					await this.app.vault.rename(file, `${folderPath}/${oldFileName}.md`);
				}
			}

			// Check if the map embed is missing
			if (content.trim() == ""){
				// get coordinates from url
				const url = new URL(locationUrl);
				const args = new URLSearchParams(url.search);
				const coordinates = args.get("ll");

				if(!coordinates){
					new Notice(`No coordinates found in URL: ${locationUrl}`);
					continue;
				}
				
				const mapEmbed = `<iframe src="https://app.cartes.io/maps/${mapUuid}/embed?type=map&lat=${coordinates.split(',')[0]}&lng=${coordinates.split(',')[1]}&zoom=11" 
					width="100%" 
					height="600" 
					frameborder="0"></iframe>`;

				// add to file
				const newContent = content + mapEmbed;
				await this.app.vault.modify(file, "---\n" + frontmatter + "\n---\n" + newContent);
			}
		}
	}

	async onload() {
		await this.loadSettings();

		// Ribbon button for new location
		const ribbonIconEl = this.addRibbonIcon(
			'map-pinned',
			'New Location',
			() => {
				this.createNewLocationEntry()
			}
		);
		

		// Add a command for a new entry
		this.addCommand({
			id: 'add-new-location-entry',
			name: 'Add a new location entry',
			callback: () => {
				this.createNewLocationEntry();
			}
		});

		// Add a command for updating existing entries in case new features are added
		this.addCommand({
			id: 'update-location-entries',
			name: 'Update location entries',
			callback: () => {
				this.updateAllLocationEntries();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new LocationDatabaseSettingTab(this.app, this));
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
