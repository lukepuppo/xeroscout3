import Papa from "papaparse";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
	import { BlueAlliance } from "../extnet/ba";
	import { Project } from "../project/project";
	import { BrowserWindow, dialog, Menu, MenuItem, shell } from "electron";
import { TCPSyncServer } from "../sync/tcpserver";
import { PacketObj } from "../sync/packetobj";
import { PacketType } from "../sync/packettypes";
import { MatchDataModel } from "../model/matchmodel";
import { BAEvent, BAMatch, BATeam } from "../extnet/badata";
import { TeamDataModel } from "../model/teammodel";
import { StatBotics } from "../extnet/statbotics";
import { TabletData } from "../project/tabletmgr";
import { ManualMatchData } from "../project/matchmgr";
	import { FormManager } from "../project/formmgr";
import { IPCAppType, IPCChange, IPCCheckDBViewFormula, IPCColumnDesc, IPCDatabaseData, IPCDataSet, IPCGraphConfig, IPCNamedDataValue, IPCPickListConfig, IPCProjColumnsConfig, IPCPromptStringRequest, IPCPromptStringResponse, IPCScoutResult, IPCScoutResults, IPCSyncedImageData, IPCTeamInfo, IPCTypedDataValue } from "../../shared/ipc";
	import { UDPBroadcast } from "../sync/udpbroadcast";
	import { SCCoachCentralBaseApp } from "./sccoachcentralbase";
import { createSyncSessionId, logSync, packetSummary, SyncTraceContext } from "../sync/syncdiag";
import {
	parseCoachGraphsPayload,
	parseCoachPicklistsPayload,
	parseRequestedNamesPayload,
	parseScoutHelloPayload,
	parseScoutResultsPayload,
	stringifyImagesPayload,
	stringifyHelloResponsePayload,
	stringifyMatchAssignmentsPayload,
	stringifyPlayoffAssignmentsPayload,
	stringifyPlayoffStatusPayload,
	stringifyProjectInfoPayload,
	stringifyScoutResultArrayPayload,
	stringifyTeamAssignmentsPayload,
	stringifyTabletsPayload,
	summarizeValidationErrors,
} from "../../shared/synccontract";

export class SCCentral extends SCCoachCentralBaseApp {
	private static readonly recentFilesSetting: string = "recent-files";

	private static readonly matchStatusFields: string[] = [
		"comp_level",
		"set_number",
		"match_number",
		"team_key",
		"r1",
		"r2",
		"r3",
		"b1",
		"b2",
		"b3",
	];

	private static readonly createMatchForm: string = 'create-match-form' ;
	private static readonly editMatchForm: string = 'edit-match-form' ;
	private static readonly createTeamForm: string = 'create-team-form' ;
	private static readonly editTeamForm: string = 'edit-team-form' ;
	private static readonly openExistingEvent: string = 'open-existing';
	private static readonly closeEvent: string = 'close-event';
	private static readonly createNewEvent: string = 'create-new';
	private static readonly selectTeamForm: string = 'select-team-form';
	private static readonly selectMatchForm: string = 'select-match-form';
	private static readonly assignTablets: string = 'assign-tablets';
	private static readonly loadBAEvent: string = 'load-ba-event';
	private static readonly viewInit: string = 'view-init';
	private static readonly viewDataSets: string = 'view-datasets';
	private static readonly viewPicklist: string = 'view-picklist' ;
	private static readonly lockEvent: string = 'lock-event';
	private static readonly editTeams: string = 'edit-teams';
	private static readonly editMatches: string = 'edit-matches';
	private static readonly importTeams: string = 'import-teams';
	private static readonly importMatches: string = 'import-matches';
	private static readonly viewTeamForm: string = 'view-team-form';
	private static readonly viewTeamStatus: string = 'view-team-status';
	private static readonly viewTeamDB: string = 'view-team-db';
	private static readonly viewMatchForm: string = 'view-match-form';
	private static readonly viewMatchStatus: string = 'view-match-status';
	private static readonly viewMatchDB: string = 'view-match-db';
	private static readonly viewHelp: string = 'view-help';
	private static readonly viewAbout: string = 'view-about';
	private static readonly viewFormulas: string = 'view-formulas';
	private static readonly viewSingleTeamSummary: string = 'view-single-team-summary' ;
	private static readonly viewAutoAnalysis: string = 'view-auto-analysis' ;
	private static readonly viewPlayoffs: string = 'view-playoffs' ;
	private static readonly viewScouterAccuracy: string = 'view-scouter-accuracy' ;
	private static readonly clearExternalDownload: string = 'clear-external-download' ;
	private static readonly viewXeroMatchSim: string = 'view-match-sim';


	private ba_?: BlueAlliance = undefined;
	private statbotics_?: StatBotics = undefined;
	private baloading_: boolean;
	private bacount_ : number ;
	private tcpsyncserver_?: TCPSyncServer = undefined;
	private baevents_?: BAEvent[];
	private menuitems_: Map<string, MenuItem> = new Map<string, MenuItem>();
	private year_?: number;
	private msg_?: string;
	private redMenuItem_ : MenuItem | undefined ;
	private blueMenuItem_ : MenuItem | undefined ;
	private reverseImage_: MenuItem | undefined ;
	private importImage_ : MenuItem | undefined ;
		private lastformview_? : string ;
		private preview_match_db_col_cfg_: IPCProjColumnsConfig = { columns: [], frozenColumnCount: 0 } ;
		private preview_match_db_col_descs_: IPCColumnDesc[] = [] ;
		private preview_match_db_values_: Map<string, IPCTypedDataValue> = new Map<string, IPCTypedDataValue>() ;
		private preview_match_db_schema_key_: string = '' ;
		private synctype_ : string = 'data' ;
	private team_number_ : number =  1425 ;
	private udp_broadcast_ : UDPBroadcast | undefined = undefined ;
	private packetHandlers_ : Map<PacketType, (obj: PacketObj) => Promise<PacketObj | undefined> | PacketObj | undefined> = new Map<PacketType, (obj: PacketObj) => Promise<PacketObj | undefined> | PacketObj | undefined>() ;
	private external_download_in_progress_ : boolean = false ;
	private tablets_syncing_ : boolean = false ;
	private promptResolvers : Map<string, (value: string | undefined) => void> = new Map() ;
	private external_download_timeout_: NodeJS.Timeout | undefined = undefined ;
	private sync_trace_? : SyncTraceContext ;

	constructor(win: BrowserWindow, args: string[]) {
		super(win, 'central');

		this.baloading_ = false ;
		this.bacount_ = 0 ;

		for (let arg of args) {
			if (arg.startsWith('--year:')) {
				this.year_ = +arg.substring(7);
			}
		}

		if (!this.year_) {
			let dt = new Date();
			this.year_ = dt.getFullYear();
		}

		this.statbotics_ = new StatBotics(this.year_);
		this.tryConnectBlueAlliance() ;
		this.initPacketHandlers() ;
	}

	public mainWindowLoaded(): void {
		this.appInit() ;
		
		let index = process.argv.indexOf('central') ;
		if (index < process.argv.length - 1) {
			Project.openEvent(this.logger_, process.argv[index + 1], this.year_!, this.applicationType	)
			.then((p) => {
				this.addRecent(p.location);
				this.project = p;
				this.sendHintDB() ;
				this.updateMenuState(true);
				if (this.project.info?.locked_) {
					this.startSyncServer();
				}
				this.setView("info");
				this.sendNavData();
			})
			.catch((err) => {
				let errobj: Error = err as Error;
				dialog.showErrorBox("Open Project Error", errobj.message);
				this.setView('text', 'No Event Loaded') ;
			});			
		}
		else {
			let recents = this.getSetting(SCCentral.recentFilesSetting);
			if (recents && Array.isArray(recents) && recents.length > 0) {
				let fpath = path.join(recents[0], 'event.json');
				if (fs.existsSync(fpath)) {
					Project.openEvent(this.logger_, fpath, this.year_!, this.applicationType)
					.then((p) => {
						this.addRecent(p.location);
						this.project = p;
						this.sendHintDB() ;
						this.updateMenuState(true);
						if (this.project.info?.locked_) {
							this.startSyncServer();
						}
						this.setView("info");
						this.sendNavData();
					})
					.catch((err) => {
						let errobj: Error = err as Error;
						dialog.showErrorBox("Open Project Error", errobj.message);
						this.setView('text', 'No Event Loaded') ;
					});
				}
				else {
					this.setView('text', 'No Event Loaded') ;
				}
			}
			else {
				this.setView('text', 'No Event Loaded') ;
			}
		}

		let v = this.getVersion('application') ;
		this.sendToRenderer('send-app-status', { 
			left: this.getProgramTitle(),
			middle: undefined,
			right: 'Connecting To Blue Alliance...',
		}) ;
	}

	private findPrimaryIPAddress() : string {
		let ret: string = 'unknown' ;
		let ipaddrs = os.networkInterfaces() ;
		for(let key of Object.keys(ipaddrs)) {	
			let ifaces = ipaddrs[key] ;
			if (ifaces) {
				for(let iface of ifaces!) {
					if (iface.family === 'IPv4' && !iface.internal) {
						ret = iface.address ;
						break ;
					}
				}
			}
		}

		return ret;
	}

	private getProgramTitle() : string {
		let v = this.getVersion('application') ;
		return `Xero Central ${this.versionToString(v)} (${this.findPrimaryIPAddress()})`
	}

	private tryAgain() {
		setTimeout(() => {
			this.logger_.info(`trying to connect (${this.bacount_}) to blue alliance again`) ;
			this.tryConnectBlueAlliance() ;
		}, 5000) ;
	}

	private async tryConnectBlueAlliance() {
		this.baloading_ = true;
		this.ba_ = new BlueAlliance(this.year_);
		this.bacount_++ ;
		this.ba_.init()
			.then((up) => {
				if (!up) {
					this.ba_ = undefined;
					this.sendToRenderer('send-app-status', { right: 'Blue Alliance not available - trying again' }) ;
					this.tryAgain() ;
				} else {
					this.sendToRenderer('send-app-status', { right: 'Blue Alliance connected' }) ;
					this.logger_.info('connected to the blue alliance site') ;
					this.baloading_ = false;
				}
			})
			.catch((err) => {
				this.sendToRenderer('send-app-status', { right: `Blue Alliance error - ${err.message} - trying again` }) ;
				this.tryAgain() ;
			});		
	}

	public get applicationType(): IPCAppType {
		return 'central';
	}

	public basePage(): string {
		return 'content/main.html';
	}

	public close() : void {
		// Clear any pending external download timeouts
		if (this.external_download_timeout_) {
			clearTimeout(this.external_download_timeout_);
			this.external_download_timeout_ = undefined;
		}
	}

	public canQuit(): boolean {
		let ret: boolean = true;
		
		if (this.project && this.project.data_mgr_) {
			ret = this.project.data_mgr_.close() ;
		}
		return ret;
	}

	private updateView() : boolean {
		let ret: boolean = false ;

		if (this.lastview_ && this.lastview_ === 'formview' && this.lastformview_) {
			this.setView('formview', this.lastformview_) ;
			ret = true ;
		}

		return ret ;
	}

	private colorMenuItem(color: string) {
		this.color = color ;

		if (!this.updateView()) {
			if (this.project) {
				this.setView('info') ;
			}
			else {

				this.setView('empty') ;
			}
		}
	}

	private reverseImage() {
		this.reversed = this.reverseImage_!.checked ;
		if (!this.updateView()) {
			if (this.project) {
				this.setView('info') ;
			}
			else {

				this.setView('empty') ;
			}
		}
	}

	public createMenu(): Menu | null {
		let ret: Menu | null = new Menu();
		let index = 0;

		let filemenu: MenuItem = new MenuItem({
			type: 'submenu',
			label: 'File',
			role: 'fileMenu',
		});

		let createitem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Create Event ...',
			id: 'create-event',
			click: () => {
				this.executeCommand(SCCentral.createNewEvent);
			},
		});
		filemenu.submenu!.insert(index++, createitem);
		this.menuitems_.set('file/create', createitem);

		let openitem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Open Event ...',
			id: 'open-event',
			click: () => {
				this.executeCommand(SCCentral.openExistingEvent);
			},
		});
		filemenu.submenu!.insert(index++, openitem);
		this.menuitems_.set('file/open', openitem);

		if (this.hasSetting(SCCentral.recentFilesSetting)) {
			let recent: MenuItem = new MenuItem({
				type: 'submenu',
				label: 'Recent',
				submenu: new Menu(),
				click: () => {
					this.executeCommand(SCCentral.openExistingEvent);
				},
			});
			filemenu.submenu!.insert(index++, recent);

			let recents = this.getSetting(SCCentral.recentFilesSetting);

			for (let one of recents) {
				let item: MenuItem = new MenuItem({
					type: 'normal',
					label: one,
					click: () => {
						let evpath = path.join(one, 'event.json');
						Project.openEvent(this.logger_, evpath, this.year_!, this.applicationType)
							.then((p) => {
								this.addRecent(p.location);
								this.project = p;
								this.sendHintDB() ;
								this.updateMenuState(true);
								if (this.project  && this.project.isLocked) {
									this.startSyncServer();
								}
								this.setView('info');
								this.sendNavData();
							})
							.catch((err) => {
								let errobj: Error = err as Error;
								dialog.showErrorBox('Open Project Error', errobj.message);
							});
					},
				});
				recent.submenu!.append(item);
			}
		}

		filemenu.submenu!.insert(index++, new MenuItem({ type: 'separator' }));

		let closeitem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Close Event',
			id: 'close-event',
			enabled: false,
			click: () => {
				this.executeCommand(SCCentral.closeEvent);
			},
		});
		filemenu.submenu!.insert(index++, closeitem);
		this.menuitems_.set('file/close', closeitem);

		ret.append(filemenu);

		let imagemenu: MenuItem = new MenuItem({
			type: 'submenu',
			label: 'Images',
			submenu: new Menu()
		}) ;

		this.importImage_ = new MenuItem({
			type: 'normal',
			label: 'Import ...',
			click: this.importImage.bind(this)
		}) ;
		imagemenu.submenu!.append(this.importImage_) ;
		ret.append(imagemenu) ;

		let optionmenu: MenuItem = new MenuItem({
			type: 'submenu',
			label: 'Options',
			submenu: new Menu()
		}) ;

		this.blueMenuItem_ = new MenuItem({
			type: 'radio',
			label: 'Blue',
			click: this.colorMenuItem.bind(this, 'blue')
		}) ;
		optionmenu.submenu!.append(this.blueMenuItem_) ;

		this.redMenuItem_ = new MenuItem({
			type: 'radio',
			label: 'Red',
			click: this.colorMenuItem.bind(this, 'red')
		}) ;
		optionmenu.submenu!.append(this.redMenuItem_) ;

		this.reverseImage_ = new MenuItem({
			type: 'checkbox',
			label: 'Reverse',
			checked: false,
			click: this.reverseImage.bind(this)
		}) ;
		optionmenu.submenu!.append(this.reverseImage_) ;
		ret.append(optionmenu);

		let datamenu: MenuItem = new MenuItem({
			type: 'submenu',
			label: 'Data',
			submenu: new Menu(),
		});

		let downloadBAData: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Import Data From Blue Alliance',
			enabled: false,
			click: () => {
				this.importBlueAllianceData();
			},
		});
		datamenu.submenu?.append(downloadBAData);
		this.menuitems_.set('data/loadbadata', downloadBAData);

		let downloadSTData: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Import Data From Statbotics',
			enabled: false,
			click: () => {
				this.importStatboticsData().catch(err => {
					this.logger_.error(`Error importing Statbotics data: ${err.message}`);
				});
			},
		});
		datamenu.submenu?.append(downloadSTData);
		this.menuitems_.set('data/loadstdata', downloadSTData);

		let importGraphDefns: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Import Graph Definitions',
			enabled: false,
			click: () => {
				// this.importGraphDefinitions();
			},
		});
		datamenu.submenu?.append(importGraphDefns);
		this.menuitems_.set('data/graphdefn', importGraphDefns);		

		datamenu.submenu?.append(new MenuItem({ type: 'separator' }));

		let clearDownloadItem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Clear Stuck External Download',
			enabled: true,
			click: () => {
				this.executeCommand(SCCentral.clearExternalDownload);
			},
		});
		datamenu.submenu?.append(clearDownloadItem);
		this.menuitems_.set('data/cleardownload', clearDownloadItem);

		datamenu.submenu?.append(new MenuItem({ type: 'separator' }));

		let exportTeamData: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Export Team Data',
			enabled: false,
			click: () => {
				this.doExportData(TeamDataModel.TableName);
			},
		});
		datamenu.submenu?.append(exportTeamData);
		this.menuitems_.set('data/exportteam', exportTeamData);

		let exportMatchData: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Export Match Data',
			enabled: false,
			click: () => {
				this.doExportData(MatchDataModel.TableName);
			},
		});
		datamenu.submenu?.append(exportMatchData);
		this.menuitems_.set('data/exportmatch', exportMatchData);
	
		let exportPicklistData = new MenuItem({
			type: 'normal',
			label: 'Export All Picklist Data',
			enabled: false,
			click: () => {
				// this.doExportPicklist();
			},
		});
		datamenu.submenu?.append(exportPicklistData);
		this.menuitems_.set('data/exportpicklist', exportPicklistData);

		datamenu.submenu?.append(new MenuItem({ type: 'separator' }));
		let importFormulas = new MenuItem({
			type: 'normal',
			label: 'Import Formulas',
			enabled: false,
			click: () => {
				this.importFormulasFromFile();
			},
		});
		datamenu.submenu?.append(importFormulas);
		this.menuitems_.set('data/importformulas', importFormulas);

		let exportFormulas = new MenuItem({
			type: 'normal',
			label: 'Export Formulas',
			enabled: false,
			click: () => {
				this.exportFormulasToFile();
			},
		});
		datamenu.submenu?.append(exportFormulas);
		this.menuitems_.set('data/exportformulas', exportFormulas);

		ret.append(datamenu);

		let viewmenu: MenuItem = new MenuItem({
			type: 'submenu',
			role: 'viewMenu',
		});
		ret.append(viewmenu);

		let helpmenu: MenuItem = new MenuItem({
			type: 'submenu',
			label: 'Help',
			submenu: new Menu(),
		});

		let helpitem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Help',
			id: 'help-help',
			click: () => {
				this.executeCommand(SCCentral.viewHelp);
			},
		});
		helpmenu.submenu!.append(helpitem);

		let updateitem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'Check For Updates',
			id: 'help-check-updates',
			click: () => {
				this.checkForUpdates();
			},
		});
		helpmenu.submenu!.append(updateitem);

		let aboutitem: MenuItem = new MenuItem({
			type: 'normal',
			label: 'About',
			id: 'help-about',
			click: () => {
				this.executeCommand(SCCentral.viewAbout);
			},
		});
		helpmenu.submenu!.append(aboutitem);

		ret.append(helpmenu);

		return ret;
	}

	public windowCreated(): void {
	}

	private enableMenuItem(item: string, state: boolean) {
		if (this.menuitems_.has(item)) {
			this.menuitems_.get(item)!.enabled = state;
		}
	}

	private updateMenuState(hasEvent: boolean) {
		let items: string[] = [
			'data/exportmatch',
			'data/exportteam',
			'data/loadbadata',
			'data/loadstdata',
			'data/exportpicklist',
			'data/graphdefn',
			'file/close',
			'data/importformulas',
			'data/exportformulas',
		];
		for (let item of items) {
			this.enableMenuItem(item, hasEvent);
		}
	}


	public saveForm(type: string, contents: any) {
		this.project!.form_mgr_!.saveForm(type, contents) ;
	}

	public importImage() {
		dialog.showOpenDialog(this.win_, {
			title: 'Import image(s)',
			filters: [
				{ name: 'PNGFiles', extensions: ['png'] },
				{ name: 'All Files', extensions: ['*']}
			],
			properties: [
				'openFile',
				'multiSelections',
			]
		}).then(result => {	
			if (!result.canceled) {
				let imported = 0 ;
				for (const file of result.filePaths) {
					let name = this.image_mgr_.addImage(file) ;
					if (typeof name === 'string') {
						imported++ ;
					}
					else {
						dialog.showErrorBox(
							'Error',
							'Error loading external image, no image directory set'
						);
						return ;
					}
				}

				if (imported > 0) {
					this.sendToRenderer('send-images', this.image_mgr_.getImageNames()) ;
				}
			}
		}) ;		
	}

	public renameDataSet(oldname: string, newname: string) : void {
		this.project?.dataset_mgr_?.renameDataSet(oldname, newname) ;
		this.sendDataSets() ;
	}

	public updateDataSet(ds: IPCDataSet[]) : void {
		this.project?.dataset_mgr_?.updateDataSet(ds) ;
	}

	public sendTabletData(): void {
		if (this.project) {
			this.sendToRenderer('send-tablet-data', this.project.tablet_mgr_!.getTablets());
		}
	}

	public setTabletData(data: TabletData[]) {
		if (this.project) {
			this.project?.tablet_mgr_?.setTabletData(data);
			this.setView('info') ;
		}
	}

	public setTeamData(data: IPCTeamInfo[]) {
		this.project?.team_mgr_?.setTeamData(data);
		this.setView('info');
	}

	public setEventName(data: any) {
		this.project?.setEventName(data);
	}

	public setMatchData(data: ManualMatchData[]) {
		this.project?.match_mgr_?.setMatchData(data);
		this.setView('info') ;
	}

	public updateMatchDB(changes: IPCChange[]) {
		this.project?.data_mgr_?.updateMatchDB(changes);
	}

	public updateTeamDB(changes: IPCChange[]) {
		this.project?.data_mgr_?.updateTeamDB(changes);
	}

	public sendEventData(): void {
		if (this.project && this.isBAAvailable()) {
			this.ba_?.getEvents()
				.then((frcevs: BAEvent[]) => {
					this.baevents_ = frcevs;
					this.sendToRenderer('send-event-data', frcevs);
				})
				.catch((err) => {
					this.ba_ = undefined ;
					this.tryConnectBlueAlliance() ;
					this.setView('info');
					
					let errobj: Error = err as Error;
					dialog.showMessageBoxSync(this.win_, {
						title: 'Load Blue Alliance Event',
						message: errobj.message,
					});

				});
		} else {
			dialog.showErrorBox(
				'Load Blue Alliance Event',
				'The Blue Alliance site is not available'
			);
			this.setView('info') ;
		}
	}

	public async loadBaEventDataError(): Promise<void> {
		this.sendToRenderer('set-status-title', 'Blue Alliance Error');
		this.sendToRenderer('set-status-html','Error importing data - invalid request from renderer - internal error'
		);
		this.sendToRenderer('set-status-close-button-visible', true);
		this.setView('info');
	}

	public async loadBaEventData(key: string): Promise<void> {
		// Check if tablets are syncing
		if (this.tablets_syncing_) {
			dialog.showErrorBox(
				'Load Blue Alliance Event',
				'Cannot download data while tablets are syncing. Please wait for tablet sync to complete and try again.'
			);
			return;
		}

		// Check if another external download is already in progress
		if (this.external_download_in_progress_) {
			dialog.showErrorBox(
				'Load Blue Alliance Event',
				'Another external download is already in progress. Please wait for it to complete and try again.'
			);
			return;
		}

		if (!this.isBAAvailable()) {
			dialog.showErrorBox(
				'Load Blue Alliance Event',
				'The Blue Alliance site is not available.'
			);
			return;
		}

		// Set external download flag with timeout protection
		this.setExternalDownloadInProgress(`Blue Alliance Event: ${key}`);

		let fev: BAEvent | undefined = this.getEventFromKey(key);
		if (fev) {
			this.sendToRenderer('set-status-title','Loading event "' + fev.name + '"');
			this.msg_ = "";

			try {
				await this.project!.loadBAEvent(
					this.ba_!,
					this.statbotics_!,
					fev,
					(text) => {
						this.appendStatusText(text);
					}
				);
				this.sendToRenderer("set-status-close-button-visible", true);
				this.sendNavData();
				this.setView("info");
			} catch (err) {
				let errobj = err as Error;
				this.sendToRenderer("set-status-visible", true);
				this.sendToRenderer("set-status-title", "Blue Alliance Error");
				this.sendToRenderer("set-status-html","Error importing data - " + errobj.message
				);
				this.sendToRenderer("set-status-close-button-visible", true);
				this.setView("info");
			} finally {
				// Clear external download flag
				this.clearExternalDownloadInProgress(`Blue Alliance Event: ${key}`);
			}
		} else {
			// Clear external download flag
			this.clearExternalDownloadInProgress(`Blue Alliance Event: ${key} (not found)`);
			this.sendToRenderer("set-status-title", "Blue Alliance Error");
			this.sendToRenderer("set-status-html","Error importing data - no event with key '" + key + "' was found");
			this.sendToRenderer("set-status-close-button-visible", true);
			this.setView("info");
		}
	}

	public async promptString(title: string, message: string, defaultValue?: string, placeholder?: string) : Promise<string | undefined> {
		return new Promise<string | undefined>((resolve) => {
			const requestId = Math.random().toString(36).substring(2, 15);
			
			// Store the resolver function to call when we get the response
			this.promptResolvers.set(requestId, resolve);
			
			// Send request to renderer
			const request: IPCPromptStringRequest = {
				id: requestId,
				title,
				message,
				defaultValue,
				placeholder
			};
			
			this.sendToRenderer("prompt-string-request", request);
		});
	}

	private async importBlueAllianceData() {
		// Check if tablets are syncing
		if (this.tablets_syncing_) {
			let html = "Cannot download data while tablets are syncing. Please wait for tablet sync to complete and try again.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		// Check if another external download is already in progress
		if (this.external_download_in_progress_) {
			let html = "Another external download is already in progress. Please wait for it to complete and try again.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		if (!this.project) {
			let html = "Must create or open a project to import data.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		if (!this.isBAAvailable()) {
			let html = "The Blue Alliance site is not available.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		// Set external download flag with timeout protection
		this.setExternalDownloadInProgress("Blue Alliance Data Import");

		let fev: BAEvent | undefined = this.project?.info?.frcev_;
		if (fev) {

			if (!fev.key) {
				let key = await this.promptString('Blue Alliance Event Key', 'Enter the Blue Alliance event key (e.g. 2024miket)', '');
				if (key) {
					fev.key = key;
					// Save the project immediately after setting the key so it's available for future use
					this.project!.writeEventFile();
				} else {
					// User cancelled, stop the import
					this.clearExternalDownloadInProgress("Blue Alliance Data Import (cancelled)");
					return;
				}
			}

			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title","Loading match data") ;
			this.msg_ = "";
			this.sendToRenderer("set-status-html","Requesting match data from the Blue Alliance ...");
			this.project!.loadExternalBAData(
				this.ba_!,
				fev,
				(text) => {
					this.appendStatusText(text);
				}
			)
			.then(() => {
				this.appendStatusText("All data loaded");
				this.sendToRenderer("set-status-close-button-visible", true);
				this.project!.writeEventFile() ;
			})
			.catch((err) => {
				this.appendStatusText("<br><br>Error loading data - " + err.message);
				this.sendToRenderer("set-status-close-button-visible", true);
				this.project!.writeEventFile() ;				
			})
			.finally(() => {
				// Clear external download flag
				this.clearExternalDownloadInProgress("Blue Alliance Data Import");
			});
		} else {
			// Clear external download flag
			this.clearExternalDownloadInProgress("Blue Alliance Data Import (no event)");
			let html = "The event is not a blue alliance event";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Load Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
		}
	}	

	private async importStatboticsData() {
		// Check if tablets are syncing
		if (this.tablets_syncing_) {
			let html = "Cannot download data while tablets are syncing. Please wait for tablet sync to complete and try again.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		// Check if another external download is already in progress
		if (this.external_download_in_progress_) {
			let html = "Another external download is already in progress. Please wait for it to complete and try again.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		if (!this.project) {
			let html = "Must create or open a project to import data.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		if (!this.isBAAvailable()) {
			let html = "The Statbotics site is not available.";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Error Importing Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
			return;
		}

		// Set external download flag with timeout protection
		this.setExternalDownloadInProgress("Statbotics Data Import");

		let fev: BAEvent | undefined = this.project?.info?.frcev_;
		if (fev) {

			if (!fev.key) {
				let key = await this.promptString('Blue Alliance Event Key', 'Enter the Blue Alliance event key (e.g. 2024miket)', '');
				if (key) {
					fev.key = key;
					// Save the project immediately after setting the key so it's available for future use
					this.project!.writeEventFile();
				} else {
					// User cancelled, stop the import
					this.clearExternalDownloadInProgress("Statbotics Data Import (cancelled)");
					return;
				}
			}

			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer(
				"set-status-title",
				"Loading match data for event '" + fev.name + "'"
			);
			this.msg_ = "";
			this.sendToRenderer(
				"set-status-html",
				"Requesting match data from the Blue Alliance ..."
			);
			this.project!.loadExternalSTData(
				this.statbotics_!,
				fev,
				(text) => {
					this.appendStatusText(text);
				}
			)
			.then(() => {
				this.appendStatusText("All data loaded");
				this.sendToRenderer("set-status-close-button-visible", true);
			})
			.catch((err) => {
				this.appendStatusText("<br><br>Error loading data - " + err.message);
				this.sendToRenderer("set-status-close-button-visible", true);
			})
			.finally(() => {
				// Clear external download flag
				this.clearExternalDownloadInProgress("Statbotics Data Import");
			});
		} else {
			// Clear external download flag
			this.clearExternalDownloadInProgress("Statbotics Data Import (no event)");
			// Clear external download flag
			this.clearExternalDownloadInProgress("Statbotics Data Import (no event)");
			let html = "The event is not a blue alliance event";
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer("set-status-title", "Load Match Data");
			this.sendToRenderer("set-status-html", html);
			this.sendToRenderer("set-status-close-button-visible", true);
		}
	}

	private appendStatusText(text: string) {
		this.msg_ += text;
		this.sendToRenderer("set-status-html", this.msg_);
	}

	private getEventFromKey(key: string): BAEvent | undefined {
		let ret: BAEvent | undefined = undefined;

		if (this.baevents_) {
			ret = this.baevents_.find((element) => element.key === key);
		}

		return ret;
	}

	private isBAAvailable(): boolean {
		return this.ba_ !== undefined && !this.baloading_;
	}

	public sendNavData(): void {
		let treedata = [];
		let dims = 40 ;

		treedata.push({ type: "separator", title: "General" });
		treedata.push({ 
			type: "icon", 
			command: SCCentral.viewHelp, 
			title: "Help",
			icon: this.getIconData('help.png'),
			width: dims,
			height: dims
		});
		if (this.project) {
			treedata.push({
				type: "icon",
				command: SCCentral.viewInit,
				title: "Event Info",
				icon: this.getIconData('info.png'),
				width: dims,
				height: dims
			});
			treedata.push({ type: "separator", title: "Teams" });
			if (this.project.form_mgr_?.hasTeamForm()) {
				treedata.push({
					type: "icon",
					command: SCCentral.viewTeamForm,
					title: "Team Form",
					icon: this.getIconData('form.png'),
					width: dims,
					height: dims
				});
			}
			if (this.project.info?.locked_) {
				treedata.push({
					type: "icon",
					command: SCCentral.viewTeamStatus,
					title: "Team Status",
					icon: this.getIconData('status.png'),
					width: dims,
					height: dims					
				});
				treedata.push({
					type: "icon",
					command: SCCentral.viewTeamDB,
					title: "Team Data",
					icon: this.getIconData('data.png'),
					width: dims,
					height: dims					
				});
			}

			treedata.push({ type: "separator", title: "Match" });

			if (this.project.form_mgr_?.hasMatchForm()) {			
				treedata.push({
					type: "icon",
					command: SCCentral.viewMatchForm,
					title: "MatchForm",
					icon: this.getIconData('form.png'),
					width: dims,
					height: dims
				});
			}
			if (this.project.info?.locked_) {
				treedata.push({
					type: "icon",
					command: SCCentral.viewMatchStatus,
					title: "Match Status",
					icon: this.getIconData('status.png'),
					width: dims,
					height: dims					
				});
				treedata.push({
					type: "icon",
					command: SCCentral.viewMatchDB,
					title: "Match Data",
					icon: this.getIconData('data.png'),
					width: dims,
					height: dims					
				});

				treedata.push({
					type: 'icon',
					command: SCCentral.viewPlayoffs,
					title: "Playoffs",
					icon: this.getIconData('playoffs.png'),
					width: dims,
					height: dims	
				});					
			}

			treedata.push({ type: "separator", title: "Analysis" });
			
			if (this.project.info?.locked_) {
				treedata.push({
					type: 'icon',
					command: SCCentral.viewFormulas,
					title: "Formulas",
					icon: this.getIconData('formula.png'),
					width: dims,
					height: dims	
				});			

				treedata.push({
					type: "icon",
					command: SCCentral.viewDataSets,
					title: "Data Sets",
					icon: this.getIconData('dataset.png'),
					width: dims,
					height: dims	
				});

				treedata.push({
					type: 'icon',
					command: SCCentral.viewPicklist,
					title: "Picklist",
					icon: this.getIconData('picklist.png'),
					width: dims,
					height: dims	
				});

				treedata.push({
					type: 'icon',
					command: SCCentral.viewSingleTeamSummary,
					title: "Single Team View",
					icon: this.getIconData('singleteam.png'),
					width: dims,
					height: dims						
				});
				treedata.push({
					type: 'icon',
					command: SCCentral.viewAutoAnalysis,
					title: "Auto Analysis",
					icon: this.getIconData('preview.png'),
					width: dims,
					height: dims
				});
				treedata.push({
					type: 'icon',
					command: SCCentral.viewScouterAccuracy,
					title: "Scouter Accuracy",
					icon: this.getIconData('bar-graph.png'),
					width: dims,
					height: dims
				});
				treedata.push({  
					type: "icon",  
					command: SCCentral.viewXeroMatchSim,  
					title: "Match-Prediction",  
					icon: this.getIconData('Prediction.png'),  
					width: dims,  
					height: dims  
				});
			}
		}

		this.sendToRenderer("send-nav-data", treedata);
	}

	public executeCommand(cmd: string): void {
		if (cmd === SCCentral.viewHelp) {
			shell.openExternal(
				"https://www.xerosw.org/doku.php?id=software:xeroscout2"
			);
		} else if (cmd === SCCentral.viewAbout) {
			this.showAbout();
		} else if (cmd === SCCentral.createNewEvent) {
			this.createEvent(this.year_!);
		} else if (cmd === SCCentral.openExistingEvent) {
			this.openEvent(this.year_!);
		} else if (cmd === SCCentral.closeEvent) {
			this.closeEvent();
		} else if (cmd === SCCentral.selectMatchForm) {
			this.selectMatchForm();
		} else if (cmd === SCCentral.selectTeamForm) {
			this.selectTeamForm();
		} else if (cmd === SCCentral.loadBAEvent) {
			this.loadBAEvent();
		} else if (cmd === SCCentral.assignTablets) {
			this.setView("assign-tablets");
		} else if (cmd === SCCentral.viewInit) {
			this.sendNavData();			
			this.setView("info");
		} else if (cmd === SCCentral.viewPicklist) {
			this.setView('picklist') ;
		} else if (cmd === SCCentral.viewDataSets) {
			this.setView('datasets') ;
		} else if (cmd === SCCentral.lockEvent) {
			this.sendToRenderer("set-status-title","Locking event");
			this.sendToRenderer("set-status-visible", true);
			this.sendToRenderer('set-status-text', 'Locking event ...') ;
			this.project!.lockEvent()
				.then(() => {
					this.startSyncServer();
					this.setView("info");
					this.sendNavData();
					this.sendToRenderer('set-status-text', 'Locking event ... done') ;
					this.sendToRenderer("set-status-close-button-visible", true);
				})
				.catch((err) => {
					let errobj = err as Error ;
					this.setView("info");
					this.sendNavData();
					this.sendToRenderer('set-status-html', 'Error: ' + errobj.message) ;
					this.sendToRenderer("set-status-close-button-visible", true) ;	
				}) ;
		} else if (cmd === SCCentral.editTeams) {
			this.setView("edit-teams");
		} else if (cmd === SCCentral.editMatches) {
			this.setView("edit-matches");
		} else if (cmd === SCCentral.importTeams) {
			this.importTeams();
		} else if (cmd === SCCentral.importMatches) {
			this.importMatches();
		} else if (cmd === SCCentral.viewTeamForm) {
			this.setFormView('team');
		} else if (cmd === SCCentral.viewMatchForm) {
			this.setFormView('match');
		} else if (cmd === SCCentral.viewTeamStatus) {
			if (!this.project?.tablet_mgr_?.hasTeamAssignments()) {
				this.sendToRenderer(
					"update-main-window-view",
					"empty",
					"Scouting schedule not generated yet"
				);
			} else {
				this.setView("team-status");
			}
		} else if (cmd === SCCentral.viewMatchStatus) {
			if (!this.project?.tablet_mgr_?.hasMatchAssignments()) {
				this.sendToRenderer(
					"update-main-window-view",
					"empty",
					"Scouting schedule not generated yet"
				);
			} else {
				this.setView('match-status');
			}
		} else if (cmd === SCCentral.viewMatchDB) {
			this.setView("match-db");
		} else if (cmd === SCCentral.viewTeamDB) {
			this.setView("team-db");
		} else if (cmd === SCCentral.viewFormulas) {
			this.setView("formulas") ;
		} else if (cmd === SCCentral.viewPlayoffs) {
			this.setView("playoffs", null) ;
		} else if (cmd === SCCentral.viewSingleTeamSummary) {
			this.setView("singleteam") ;
		} else if (cmd === SCCentral.viewAutoAnalysis) {
			this.setView("auto-analysis") ;
		} else if (cmd === SCCentral.viewScouterAccuracy) {
			this.setView("scouter-accuracy") ;
		}
		else if (cmd === SCCentral.clearExternalDownload) {
			this.forceClearExternalDownload();
		}
		else if (cmd === SCCentral.createMatchForm) {
			if (this.project && this.project.form_mgr_) {
				if (this.project.form_mgr_.createMatchForm()) {
					this.executeCommand(SCCentral.editMatchForm) ;
				}
			}
		}
		else if (cmd === SCCentral.createTeamForm) {
			if (this.project && this.project.form_mgr_) {
				if (this.project.form_mgr_.createTeamForm()) {
					this.executeCommand(SCCentral.editTeamForm) ;
				}
			}
		}
		else if (cmd === SCCentral.editMatchForm) {
			this.setFormEdit('match') ;
		}
		else if (cmd === SCCentral.editTeamForm) {
			this.setFormEdit('team') ;
		} else if (cmd === SCCentral.viewXeroMatchSim) {
			this.setView('Match-Prediction') ;
		}
	}

	private setFormView(view: string) {
		this.lastformview_ = view ;
		this.setView('form-scout', view);
	}

	private ensurePreviewMatchDBSchema() : boolean {
		if (!this.project || !this.project.isInitialized() || !this.project.form_mgr_?.hasMatchForm()) {
			return false ;
		}

		let cols = this.project.form_mgr_!.extractMatchFormFields() ;
		if (cols instanceof Error) {
			this.logger_.error('error extracting match form fields for preview match DB', cols) ;
			return false ;
		}

		let schema_key = cols.map((c) => `${c.name}:${c.type}`).join('|') ;
		if (schema_key !== this.preview_match_db_schema_key_) {
			this.preview_match_db_schema_key_ = schema_key ;
			this.preview_match_db_col_descs_ = cols ;
			this.preview_match_db_col_cfg_ = {
				frozenColumnCount: 0,
				columns: cols.map((c) => {
					return {
						name: c.name,
						width: -1,
						hidden: c.name.endsWith('_segments'),
					};
				}),
			} ;
			this.preview_match_db_values_.clear() ;
		}

		return true ;
	}

	public resetPreviewMatchDB() : void {
		this.preview_match_db_values_.clear() ;
		this.sendPreviewMatchDB() ;
	}

	public updatePreviewMatchDB(values: IPCNamedDataValue[]) : void {
		if (!this.ensurePreviewMatchDBSchema()) {
			return ;
		}

		let names = new Set(this.preview_match_db_col_descs_.map((c) => c.name)) ;
		for (let one of values) {
			if (one && typeof one.tag === 'string' && one.value && names.has(one.tag)) {
				this.preview_match_db_values_.set(one.tag, one.value) ;
			}
		}
	}

	public sendPreviewMatchDB() : void {
		if (!this.ensurePreviewMatchDBSchema()) {
			return ;
		}

		let row : any = {} ;
		for (let col of this.preview_match_db_col_descs_) {
			row[col.name] = this.preview_match_db_values_.get(col.name) || { type: 'null', value: null } ;
		}

		let dataobj : IPCDatabaseData = {
			column_configurations: this.preview_match_db_col_cfg_,
			column_definitions: this.preview_match_db_col_descs_,
			keycols: [],
			data: [row],
		};

		this.sendToRenderer('send-preview-match-db', dataobj) ;
	}

	private setFormEdit(name: string) {
		this.lastformview_ = name ;
		this.setView('form-edit', name);
	}

	private importTeams() {
		var path = dialog.showOpenDialog({
			title: "Import Teams",
			message: "Select teams CVS file",
			filters: [
				{
					extensions: ["csv"],
					name: "CSV File",
				},
			],
			properties: ["openFile"],
		});

		path
			.then((pathname) => {
				if (!pathname.canceled) {
					this.importTeamsFromFile(pathname.filePaths[0]);
				}
			})
			.catch((err) => {
				dialog.showErrorBox("Import Teams Error", err.message);
			});
	}

	private importMatches() {
		var path = dialog.showOpenDialog({
			title: "Import Matches",
			message: "Select Matches CVS file",
			filters: [
				{
					extensions: ["csv"],
					name: "CSV File",
				},
			],
			properties: ["openFile"],
		});

		path
			.then((pathname) => {
				if (!pathname.canceled) {
					this.importMatchesFromFile(pathname.filePaths[0]);
				}
			})
			.catch((err) => {
				dialog.showErrorBox("Import Matches Error", err.message);
			});
	}

	private importTeamsFromFile(filename: string) {
		interface TeamData {
			number_: Number;
			nickname_: string;
		}

		const file = fs.readFileSync(filename, "utf8");

		Papa.parse(file, {
			header: true,
			skipEmptyLines: true,
			transformHeader(header, index) {
				let ret = header;

				if (index == 0) {
					ret = "team_number";
				} else if (index == 1) {
					ret = "nickname";
				}

				return ret;
			},
			complete: (results) => {
				let data: BATeam[] = [];
				for (let one of results.data) {
					let entry = one as any;
					let obj: BATeam = {
						key: entry.team_number,
						team_number: +entry.team_number,
						nickname: entry.nickname,
						name: entry.nickname,
						school_name: "",
						city: "",
						state_prov: "",
						country: "",
						address: "",
						postal_code: "",
						gmaps_place_id: "",
						gmaps_url: "",
						lat: 0,
						lng: 0,
						location_name: "",
						website: "",
						rookie_year: 1962,
					};
					data.push(obj);
				}
				this.sendToRenderer("send-team-data", data);
			},
			error: (error: any) => {
				let errobj: Error = error as Error;
				dialog.showErrorBox("Error Importing Teams", errobj.message);
			},
		});
	}

	private transformData(data: any[]): any[] {
		let result: any[] = [];

		for (let entry of data) {
			let obj = {
				type_: entry.type_,
				number_: entry.number_,
				red_: [entry.r1_, entry.r2_, entry.r3_],
				blue_: [entry.b1_, entry.b2_, entry.b3_],
			};

			result.push(obj);
		}

		return result;
	}

	private importMatchesFromFile(filename: string) {
		const file = fs.readFileSync(filename, "utf8");

		Papa.parse(file, {
			header: true,
			skipEmptyLines: true,
			transformHeader(header, index) {
				let ret = header;

				if (index === 0) {
					ret = "comp_level";
				} else if (index === 1) {
					ret = "set_number";
				} else if (index === 2) {
					ret = "match_number";
				} else if (index === 3) {
					ret = "r1_";
				} else if (index === 4) {
					ret = "r2_";
				} else if (index === 5) {
					ret = "r3_";
				} else if (index === 6) {
					ret = "b1_";
				} else if (index === 7) {
					ret = "b2_";
				} else if (index === 8) {
					ret = "b3_";
				}

				return ret;
			},
			complete: (results) => {
				let matches: BAMatch[] = [];
				for (let one of results.data) {
					let oneobj = one as any;
					let obj: BAMatch = {
						key: "",
						comp_level: oneobj.comp_level,
						set_number: oneobj.set_number,
						match_number: oneobj.match_number,
						alliances: {
							red: {
								team_keys: [oneobj.r1_, oneobj.r2_, oneobj.r3_],
							},
							blue: {
								team_keys: [oneobj.b1_, oneobj.b2_, oneobj.b3_],
							},
						},
					};
					matches.push(obj);
				}
				this.sendMatchDataInternal(matches);
			},
			error: (error: any) => {
				let errobj: Error = error as Error;
				dialog.showErrorBox("Error Importing Teams", errobj.message);
			},
		});
	}

	private loadBAEvent() {
		if (this.isBAAvailable()) {
			this.ba_?.getEvents()
				.then((frcevs) => {
					this.sendToRenderer("send-event-data", frcevs);
				})
				.catch((err) => {
					let errobj: Error = err as Error;
					dialog.showMessageBoxSync(this.win_, {
						title: "Load Blue Alliance Event",
						message: errobj.message,
					});
					this.setView("info");
				});
		}
	}

	private createEvent(year: number) : Promise<void> {
		let ret = new Promise<void>((resolve, reject) => {
			var path = dialog.showOpenDialog({
				properties: ["openDirectory", "createDirectory"],
			});

			path
				.then((pathname) => {
					if (!pathname.canceled) {
						Project.createEvent(this.logger_, pathname.filePaths[0], year, this.applicationType)
							.then((p) => { 
								this.addRecent(p.location);
								this.project = p;
								this.sendHintDB() ;
								this.updateMenuState(true);
								this.setView("info");
								this.sendNavData();
								resolve() ;
							})
							.catch((err) => {
								let errobj: Error = err as Error;
								dialog.showErrorBox("Create Project Error", errobj.message);
								reject(err) ;
							});
					}
				})
				.catch((err) => {
					dialog.showErrorBox("Create Event Error", err.message);
				});
		}) ;

		return ret ;
	}

	private addRecent(path: string) {
		let recents: string[] = [];

		if (this.hasSetting(SCCentral.recentFilesSetting)) {
			recents = this.getSetting(SCCentral.recentFilesSetting);
		}

		let index = recents.indexOf(path);
		if (index !== -1) {
			recents.splice(index, 1);
		}

		recents.unshift(path);
		if (recents.length > 5) {
			recents.splice(5);
		}

		this.setSetting(SCCentral.recentFilesSetting, recents);
	}

	private selectTeamForm() {
		var path = dialog.showOpenDialog({
			title: "Select Team Form",
			message: "Select team scouting form",
			filters: [
				{
					extensions: ["json"],
					name: "JSON file for team scouting form",
				},
				{
					extensions: ["html"],
					name: "HTML file for team scouting form",
				},
			],
			properties: ["openFile"],
		});

		path.then((pathname) => {
			if (!pathname.canceled) {
				let result = FormManager.validateForm(pathname.filePaths[0], "team") ;
				if (result.length > 0) {
					dialog.showErrorBox("Team Form Error", 'Error processing team form file:\n' + result.join('\n'));
				}
				else {
					let setResult = this.project!.setTeamForm(pathname.filePaths[0]);
					if (setResult instanceof Error) {
						dialog.showErrorBox("Team Form Error", 'Error processing team form file: ' + setResult.message);
					}
					else {
						this.sendNavData() ;
					}					
				}
				this.setView("info");
			}
		});
	}

	private selectMatchForm() {
		var path = dialog.showOpenDialog({
			title: "Select Match Form",
			message: "Select match scouting form",
			filters: [
				{
					extensions: ["json"],
					name: "JSON file for match scouting form",
				},
				{
					extensions: ["html"],
					name: "HTML file for match scouting form",
				},
			],
			properties: ["openFile"],
		});

		path.then((pathname) => {
			if (!pathname.canceled) {
				let result = FormManager.validateForm(pathname.filePaths[0], "match");
				if (result.length > 0) {
					dialog.showErrorBox("Match Form Error", 'Error processing match form file:\n' + result.join('\n'));
				}
				else {
					let setResult = this.project!.setMatchForm(pathname.filePaths[0]);
					if (setResult instanceof Error) {
						dialog.showErrorBox("Match Form Error", 'Error processing match form file: ' + setResult.message);
					}
					else {
						this.sendNavData() ;
					}
				}
				this.setView("info");
			}
		});
	}

	private closeEvent() {
		if (this.project) {
			this.project.closeEvent();
			this.project = undefined;
			this.updateMenuState(false);
			this.sendNavData();
			this.setView("empty");
		}
	}

	private openEvent(year: number) {
		var path = dialog.showOpenDialog({
			title: "Event descriptor file",
			message: "Select event descriptor file",
			filters: [
				{
					extensions: ["json"],
					name: "JSON File for event descriptor",
				},
			],
			properties: ["openFile"],
		});

		path
			.then((pathname) => {
				if (!pathname.canceled) {
					Project.openEvent(this.logger_, pathname.filePaths[0], year, this.applicationType)
						.then((p) => {
							this.addRecent(p.location);
							this.project = p;
							this.sendHintDB() ;
							this.updateMenuState(true);
							if (this.project.info?.locked_) {
								this.startSyncServer();
							}
							this.setView("info");
							this.sendNavData();
						})
						.catch((err) => {
							let errobj: Error = err as Error;
							dialog.showErrorBox("Open Project Error", errobj.message);
						});
				}
			})
			.catch((err) => {
				dialog.showErrorBox("Open Event Error", err.message);
			});
	}

	// #region Sync Server Packet Processing

	private initPacketHandlers() { 
		this.packetHandlers_.set(PacketType.HelloFromScouter, this.handleRequestHelloFromScouter.bind(this)) ;
		this.packetHandlers_.set(PacketType.HelloFromCoach, this.handleRequestHelloFromCoach.bind(this)) ;
		this.packetHandlers_.set(PacketType.RequestImages, this.handleRequestRequestImages.bind(this)) ;
		this.packetHandlers_.set(PacketType.RequestMatchResults, this.handleRequestMatchResults.bind(this));
		this.packetHandlers_.set(PacketType.RequestTeamResults, this.handleRequestTeamResults.bind(this));
		this.packetHandlers_.set(PacketType.RequestTablets, this.handleRequestTablets.bind(this));
		this.packetHandlers_.set(PacketType.RequestTeamForm, this.handleRequestTeamForm.bind(this));
		this.packetHandlers_.set(PacketType.RequestMatchForm, this.handleRequestMatchForm.bind(this));
		this.packetHandlers_.set(PacketType.RequestTeamList, this.handleRequestTeamList.bind(this));
		this.packetHandlers_.set(PacketType.RequestPlayoffAssignments, this.handleRequestPlayoffAssignments.bind(this));
		this.packetHandlers_.set(PacketType.RequestPlayoffStatus, this.handleRequestPlayoffStatus.bind(this));
		this.packetHandlers_.set(PacketType.RequestMatchList, this.handleRequestMatchList.bind(this));
		this.packetHandlers_.set(PacketType.ProvideResults, this.handleProvideResults.bind(this));
		this.packetHandlers_.set(PacketType.RequestProject, this.handleRequestProject.bind(this));
		this.packetHandlers_.set(PacketType.RequestTeamDB, this.handleRequestTeamDB.bind(this));
		this.packetHandlers_.set(PacketType.RequestMatchDB, this.handleRequestMatchDB.bind(this));
		this.packetHandlers_.set(PacketType.GoodbyeFromCoach, this.handleGoodbyeFromCoach.bind(this));
		this.packetHandlers_.set(PacketType.GoodbyeFromScouter, this.handleGoodbyeFromScouter.bind(this));
		this.packetHandlers_.set(PacketType.ProvideCoachGraphs, this.handleProvideCoachGraphs.bind(this));
		this.packetHandlers_.set(PacketType.ProvideCoachPickLists, this.handleProvideCoachPickLists.bind(this));
	}

	private async processPacket(p: PacketObj): Promise<PacketObj | undefined> {
		this.logSync('info', 'CentralPacketReceived', packetSummary(p)) ;
		const handler = this.packetHandlers_.get(p.type_);
		if (handler) {
			this.logSync('debug', 'CentralPacketDispatch', {
				handlerPacketType: p.type_,
				handlerPacketName: PacketType[p.type_],
			}) ;
			return await handler.call(this, p);
		}
		
		// Handle unknown packet types
		dialog.showErrorBox("Internal Error #4", "Invalid packet type received");
		return new PacketObj(
			PacketType.Error,
			Buffer.from("internal error #4 - invalid packet type received")
		);
	}

	private handleProvideCoachGraphs(p: PacketObj): PacketObj {
		let parsed = parseCoachGraphsPayload(p.payloadAsString()) ;
		if (!parsed.ok) {
			return this.validationErrorPacket('ProvideCoachGraphs', parsed.errors) ;
		}
		let obj = parsed.value ;
		this.project!.graph_mgr_!.coachConfigs = obj ;
		return new PacketObj(PacketType.ReceivedCoachGraphcs, Buffer.from("OK", "utf-8"));
	}

	private handleProvideCoachPickLists(p: PacketObj): PacketObj {
		let parsed = parseCoachPicklistsPayload(p.payloadAsString()) ;
		if (!parsed.ok) {
			return this.validationErrorPacket('ProvideCoachPickLists', parsed.errors) ;
		}
		let obj = parsed.value as IPCPickListConfig[] ;
		const coachOwned = obj.filter((cfg) => cfg.owner === 'coach') ;
		this.project!.picklist_mgr_!.coachesPicklists = coachOwned ;
		return new PacketObj(PacketType.ReceivedCoachPickLists, Buffer.from("OK", "utf-8"));
	}

	private validationErrorPacket(packetName: string, errors: string[]) : PacketObj {
		this.logSync('warn', 'CentralSyncValidationFailed', {
			packet: packetName,
			errorCount: errors.length,
			errors: errors,
		}) ;
		return new PacketObj(PacketType.Error, Buffer.from(`${packetName} validation failed:\n${summarizeValidationErrors(errors)}`, "utf-8")) ;
	}

	private handleRequestHelloFromScouter(p: PacketObj): PacketObj {
		this.startSyncTrace('scout', p) ;
		// Check if external download is in progress
		if (this.external_download_in_progress_) {
			this.logSync('warn', 'CentralHelloRejected', {
				reason: 'external-download-in-progress',
			}) ;
			return new PacketObj(
				PacketType.Error,
				Buffer.from("Central is busy downloading data from external sites. Please try syncing again after the download is complete.", "utf-8")
			);
		}

		// Set tablets syncing flag
		this.tablets_syncing_ = true;

		this.synctype_ = 'data' ;
		if (p.data_.length > 0) {
			let parsed = parseScoutHelloPayload(p.payloadAsString()) ;
			if (!parsed.ok) {
				return this.validationErrorPacket('HelloFromScouter', parsed.errors) ;
			}
			this.logSync('info', 'CentralHelloPayload', parsed.value) ;
		}

		let evname;

		if (this.project?.info?.frcev_?.name) {
			evname = this.project.info.frcev_.name;
		} else if (this.project?.info?.name_) {
			evname = this.project?.info?.name_;
		}
		else {
			evname = "Unknown Event" ;
		}

		let evid = {
			uuid: this.project?.info?.uuid_,
			name: evname,
		};
		this.logSync('info', 'CentralHelloAccepted', {
			eventUuid: evid.uuid,
			eventName: evid.name,
		}) ;
		let helloPayload = stringifyHelloResponsePayload(evid, 'HelloFromScouter') ;
		if (!helloPayload.ok) {
			return this.validationErrorPacket('HelloFromScouter', helloPayload.errors) ;
		}
		let uuidbuf = Buffer.from(helloPayload.value, "utf-8");
		return new PacketObj(PacketType.HelloFromScouter, uuidbuf);
	}

	private handleRequestHelloFromCoach(p: PacketObj): PacketObj {
		this.startSyncTrace('coach', p) ;
		let resp: PacketObj ;

		if (!this.project) {
			this.logSync('warn', 'CentralCoachHelloRejected', {
				reason: 'no-project-loaded',
			}) ;
			resp = new PacketObj(
				PacketType.Error,
				Buffer.from("no event loaded on central", "utf-8")
			);				
		}
		else if (!this.project	.info!.locked_) {
			this.logSync('warn', 'CentralCoachHelloRejected', {
				reason: 'project-not-locked',
			}) ;
			resp = new PacketObj(
				PacketType.Error,
				Buffer.from("event on central is not locked", "utf-8")
			);		
		}
		else {			
			this.synctype_ = 'coach' ;
			if (p.data_.length > 0) {
				return this.validationErrorPacket('HelloFromCoach', ['HelloFromCoach must not contain a JSON payload']) ;
			}

			let evname;

			if (this.project?.info?.frcev_?.name) {
				evname = this.project.info.frcev_.name;
			} else if (this.project?.info?.name_) {
				evname = this.project?.info?.name_;
			}
			else {
				evname = "Unknown Event" ;
			}

			let evid = {
				uuid: this.project?.info?.uuid_,
				name: evname,
			};
			this.logSync('info', 'CentralCoachHelloAccepted', {
				eventUuid: evid.uuid,
				eventName: evid.name,
			}) ;
			let helloPayload = stringifyHelloResponsePayload(evid, 'HelloFromCoach') ;
			if (!helloPayload.ok) {
				return this.validationErrorPacket('HelloFromCoach', helloPayload.errors) ;
			}
			let uuidbuf = Buffer.from(helloPayload.value, "utf-8");
			resp = new PacketObj(PacketType.HelloFromCoach, uuidbuf);
		}

		return resp ;
	}

	private handleRequestRequestImages(p: PacketObj): PacketObj {
		let requested = parseRequestedNamesPayload(p.payloadAsString(), 'RequestImages') ;
		if (!requested.ok) {
			return this.validationErrorPacket('RequestImages', requested.errors) ;
		}
		let obj : string[] = requested.value ;
		this.logSync('info', 'CentralProvideImages', {
			requestedCount: obj.length,
		}) ;
		let retdata : { [name: string]: IPCSyncedImageData } = {} ;

		for(let img of obj) {
			let info = this.image_mgr_.getImageInfo(img) ;
			if (!info) {
				info = this.image_mgr_.getImageInfo('missing') ;
			}
			if (info) {
				retdata[img] = {
					data: fs.readFileSync(info.path).toString('base64'),
					mimeType: info.mimeType,
					extension: info.extension,
				} ;
			}
		}

		let data: Uint8Array = new Uint8Array(0);
		let imagePayload = stringifyImagesPayload(retdata) ;
		if (!imagePayload.ok) {
			return this.validationErrorPacket('ProvideImages', imagePayload.errors) ;
		}
		let msg : string = imagePayload.value ;
		data = Buffer.from(msg, "utf-8");
		return new PacketObj(PacketType.ProvideImages, data);
	}	

	private handleRequestMatchResults(p: PacketObj): PacketObj {
		let requested = parseRequestedNamesPayload(p.payloadAsString(), 'RequestMatchResults') ;
		if (!requested.ok) {
			return this.validationErrorPacket('RequestMatchResults', requested.errors) ;
		}
		let obj : string[] = requested.value ;
		this.logSync('info', 'CentralProvideMatchResults', {
			requestedCount: obj.length,
		}) ;
		let results : IPCScoutResult[] = [] ;

		for(let match of obj) {
			let one = this.project!.data_mgr_!.getMatchResult(match) ;
			if (one) {
				results.push(one) ;
			}
		}
		let payload = stringifyScoutResultArrayPayload(results, 'ProvideMatchResults') ;
		if (!payload.ok) {
			return this.validationErrorPacket('ProvideMatchResults', payload.errors) ;
		}
		let msg: string = payload.value ;
		return new PacketObj(PacketType.ProvideMatchResults, Buffer.from(msg, "utf-8"));
	}

	private handleRequestTeamResults(p: PacketObj): PacketObj {
		let requested = parseRequestedNamesPayload(p.payloadAsString(), 'RequestTeamResults') ;
		if (!requested.ok) {
			return this.validationErrorPacket('RequestTeamResults', requested.errors) ;
		}
		let obj : string[] = requested.value ;
		this.logSync('info', 'CentralProvideTeamResults', {
			requestedCount: obj.length,
		}) ;
		let results : IPCScoutResult[] = [] ;

		for(let team of obj) {
			let one = this.project!.data_mgr_!.getTeamResult(team) ;
			if (one) {
				results.push(one) ;
			}
		}
		let payload = stringifyScoutResultArrayPayload(results, 'ProvideTeamResults') ;
		if (!payload.ok) {
			return this.validationErrorPacket('ProvideTeamResults', payload.errors) ;
		}
		let msg: string = payload.value ;
		return new PacketObj(PacketType.ProvideTeamResults, Buffer.from(msg, "utf-8"));
	}

	private handleRequestTablets(p: PacketObj): PacketObj {
		this.synctype_ = "initialize" ;
		this.logSync('info', 'CentralProvideTabletsStart') ;
		let data: Uint8Array = new Uint8Array(0);
		if (this.project && this.project.tablet_mgr_?.areTabletsValid()) {
			let tablets: any[] = [];

			for (let t of this.project?.tablet_mgr_!.getTablets()) {
				if (!t.assigned) {
					tablets.push({ name: t.name, purpose: t.purpose });
				}
			}

			let tabletPayload = stringifyTabletsPayload(tablets) ;
			if (!tabletPayload.ok) {
				return this.validationErrorPacket('ProvideTablets', tabletPayload.errors) ;
			}
			let msg: string = tabletPayload.value;
			this.logSync('info', 'CentralProvideTabletsReady', {
				tabletCount: tablets.length,
			}) ;
			data = Buffer.from(msg, "utf-8");
		}
		return new PacketObj(PacketType.ProvideTablets, data);
	}

	private handleRequestTeamForm(p: PacketObj): PacketObj {
		let formPath = this.project?.form_mgr_?.getTeamFormFullPath() ;
		if (formPath && this.project?.form_mgr_?.hasTeamForm()) {
			let errors = FormManager.validateForm(formPath, "team") ;
			if (errors.length > 0) {
				let msg = "central team form is invalid:\n" + errors.join("\n") ;
				this.logSync('warn', 'CentralProvideTeamFormRejected', {
					message: msg,
				}) ;
				return new PacketObj(PacketType.Error, Buffer.from(msg, "utf-8")) ;
			}

			let jsonstr = fs.readFileSync(formPath).toString();
			return new PacketObj(PacketType.ProvideTeamForm, Buffer.from(jsonstr, "utf8"));
		}
		else {
			dialog.showErrorBox(
				"Internal Error #1",
				"No team form is defined but event is locked"
			);
			return new PacketObj(
				PacketType.Error,
				Buffer.from("internal error #1 - no team form", "utf-8")
			);
		}
	}

	private handleRequestMatchForm(p: PacketObj): PacketObj {
		let formPath = this.project?.form_mgr_?.getMatchFormFullPath() ;
		if (formPath && this.project?.form_mgr_?.hasMatchForm()) {
			let errors = FormManager.validateForm(formPath, "match") ;
			if (errors.length > 0) {
				let msg = "central match form is invalid:\n" + errors.join("\n") ;
				this.logSync('warn', 'CentralProvideMatchFormRejected', {
					message: msg,
				}) ;
				return new PacketObj(PacketType.Error, Buffer.from(msg, "utf-8")) ;
			}

			let jsonstr = fs.readFileSync(formPath).toString();
			return new PacketObj(PacketType.ProvideMatchForm, Buffer.from(jsonstr, "utf8"));
		}
		else {
			dialog.showErrorBox(
				"Internal Error #1",
				"No match form is defined but event is locked"
			);
			return new PacketObj(
				PacketType.Error,
				Buffer.from("internal error #1 - no match form", "utf-8")
			);
		}
	}

	private handleRequestTeamList(p: PacketObj): PacketObj {
		if (this.project?.tablet_mgr_?.hasTeamAssignments()) {
			let serialized = stringifyTeamAssignmentsPayload(this.project?.tablet_mgr_?.getTeamAssignments());
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvideTeamList', serialized.errors) ;
			}
			let str = serialized.value;
			return new PacketObj(PacketType.ProvideTeamList, Buffer.from(str));
		} else {
			dialog.showErrorBox(
				"Internal Error #2",
				"No team list has been generated for a locked event"
			);
			return new PacketObj(
				PacketType.Error,
				Buffer.from(
					"internal error #2 - no team list generated for a locked event",
					"utf-8"
				)
			);
		}
	}

	private handleRequestPlayoffAssignments(p: PacketObj): PacketObj {
		if (this.project?.tablet_mgr_?.hasPlayoffAssignments()) {
			let serialized = stringifyPlayoffAssignmentsPayload(this.project?.tablet_mgr_?.getPlayoffAssignments());
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvidePlayoffAssignments', serialized.errors) ;
			}
			let str = serialized.value;
			return new PacketObj(PacketType.ProvidePlayoffAssignments, Buffer.from(str));
		} else {
			let serialized = stringifyPlayoffAssignmentsPayload(null) ;
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvidePlayoffAssignments', serialized.errors) ;
			}
			let str = serialized.value ;
			return new PacketObj(PacketType.ProvidePlayoffAssignments, Buffer.from(str));				
		}
	}

	private handleRequestPlayoffStatus(p: PacketObj): PacketObj {
		if (this.project?.playoff_mgr_?.hasPlayoffStatus()) {
			let serialized = stringifyPlayoffStatusPayload(this.project?.playoff_mgr_?.info) ;
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvidePlayoffStatus', serialized.errors) ;
			}
			let str = serialized.value ;
			return new PacketObj(PacketType.ProvidePlayoffStatus, Buffer.from(str));
		} else {
			let serialized = stringifyPlayoffStatusPayload(null) ;
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvidePlayoffStatus', serialized.errors) ;
			}
			let str = serialized.value ;
			return new PacketObj(PacketType.ProvidePlayoffStatus, Buffer.from(str));
		}
	}

	private handleRequestMatchList(p: PacketObj): PacketObj {
		if (this.project?.tablet_mgr_?.hasMatchAssignments()) {
			let serialized = stringifyMatchAssignmentsPayload(this.project?.tablet_mgr_?.getMatchAssignments());
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvideMatchList', serialized.errors) ;
			}
			let str = serialized.value;
			return new PacketObj(PacketType.ProvideMatchList, Buffer.from(str));
		} else {
			let str = JSON.stringify([]) ;
			return new PacketObj(PacketType.ProvideMatchList, Buffer.from(str));
		}
	}

	private async handleProvideResults(p: PacketObj): Promise<PacketObj> {
		try {
			let parsed = parseScoutResultsPayload(p.payloadAsString()) ;
			if (!parsed.ok) {
				return this.validationErrorPacket('ProvideResults', parsed.errors) ;
			}
			let obj : IPCScoutResults = parsed.value ;
			this.logSync('info', 'CentralResultsReceived', {
				tablet: obj.tablet,
				purpose: obj.purpose,
				resultCount: obj.results.length,
				payloadBytes: p.data_.length,
			}) ;
			const count = await this.project!.data_mgr_!.processResults(obj) ;
			this.logger_.info(`processed ${count} synced ${obj.purpose} results from tablet '${obj.tablet}'`) ;
			this.logSync('info', 'CentralResultsProcessed', {
				tablet: obj.tablet,
				purpose: obj.purpose,
				processedCount: count,
			}) ;
			if (this.project!.tablet_mgr_!.isTabletTeam(obj.tablet)) {
				this.setView("team-status");
			} else {
				this.setView("match-status");
			}
			return new PacketObj(PacketType.ReceivedResults);
		} catch (err) {
			const errobj = err as Error ;
			this.logSync('error', 'CentralResultsProcessingFailed', {
				message: errobj.message,
				payloadBytes: p.data_.length,
			}) ;
			dialog.showErrorBox(
				"Internal Error #3",
				"Error processing results: " + errobj.message
			);
			return new PacketObj(
				PacketType.Error,
				Buffer.from(errobj.message || "error processing results", "utf-8")
			);
		}
	}

	private handleRequestProject(p: PacketObj): PacketObj | undefined {
		if (this.project) {
			let serialized = stringifyProjectInfoPayload(this.project.info) ;
			if (!serialized.ok) {
				return this.validationErrorPacket('ProvideProject', serialized.errors) ;
			}
			let msg = serialized.value ;
			return new PacketObj(PacketType.ProvideProject, Buffer.from(msg, "utf-8"));
		}
		return undefined;
	}

	private handleRequestTeamDB(p: PacketObj): PacketObj | undefined {
		if (this.project) {
			let data = this.project.data_mgr_!.getTeamDBEncoded() ;
			return new PacketObj(PacketType.ProvideTeamDB, data) ;
		}
		return undefined;
	}

	private handleRequestMatchDB(p: PacketObj): PacketObj | undefined {
		if (this.project) {
			let data = this.project.data_mgr_!.getMatchDBEncoded() ;
			return new PacketObj(PacketType.ProvideMatchDB, data) ;
		}
		return undefined;
	}

	private handleGoodbyeFromCoach(p: PacketObj): PacketObj | undefined {
		this.logSync('info', 'CentralCoachGoodbyeReceived', {
			payload: p.payloadAsString(),
		}) ;
		let msg: string ;
		msg = `Coach tablet has sucessfully synchronized scouting data with this host, all data transferred` ;

		dialog.showMessageBox(this.win_, {
			title: "Synchronization Complete",
			message: msg,
			type: "info",
		});
		return undefined;
	}

	private handleGoodbyeFromScouter(p: PacketObj): PacketObj | undefined {
		// Clear tablets syncing flag
		this.tablets_syncing_ = false;
		this.logSync('info', 'CentralScoutGoodbyeReceived', {
			syncType: this.synctype_,
			tablet: p.payloadAsString(),
		}) ;

		let msg: string ;
		if (this.synctype_ === "initialize") {
			msg = "Tablet '" + p.payloadAsString() + "' has sucessfully completed synchronization and is ready to use";
		}
		else {
			msg = `Tablet '${p.payloadAsString()}' has sucessfully synchronized scouting data with this host, new records added` ;
		}

		dialog.showMessageBox(this.win_, {
			title: "Synchronization Complete",
			message: msg,
			type: "info",
		});
		return undefined;
	}

	private startSyncServer() {
		if (!this.tcpsyncserver_) {
			this.tcpsyncserver_ = new TCPSyncServer(this.logger_);
			this.tcpsyncserver_.setTraceContext({
				sessionId: 'central-server',
				role: 'central',
				transport: 'tcp',
				path: 'server',
				port: 45455,
			}) ;
			this.tcpsyncserver_
				.init()
				.then(() => {
					this.logger_.info("TCPSyncServer: initialization completed sucessfully");
					this.logSync('info', 'CentralSyncServerStarted', {
						port: this.tcpsyncserver_?.port,
					}) ;
				})
				.catch((err) => {
					let errobj: Error = err;
					this.logSync('error', 'CentralSyncServerStartFailed', {
						message: errobj.message,
					}) ;
					dialog.showErrorBox("TCP Sync", "Cannot start TCP sync - " + err.message);
				});
				this.tcpsyncserver_.on("packet", async (p: PacketObj) => {
					let reply: PacketObj | undefined = await this.processPacket(p);
					if (reply) {
						this.logSync('info', 'CentralPacketReply', packetSummary(reply)) ;
						this.tcpsyncserver_!.send(reply).then(() => {
							if (reply.type_ === PacketType.Error) {
								this.tablets_syncing_ = false; // Clear flag on error
								this.tcpsyncserver_!.shutdownClient();
							}
						});
					} else {
						this.tablets_syncing_ = false; // Clear flag on shutdown
						this.tcpsyncserver_?.shutdownClient();
					}
				});

			this.tcpsyncserver_.on("error", (err) => {
				this.tablets_syncing_ = false; // Clear flag on error
				this.logSync('error', 'CentralSyncServerError', {
					message: err.message,
				}) ;
				this.tcpsyncserver_?.shutdownClient();
				dialog.showMessageBox(this.win_, {
					message: "Error syncing client - " + err.message,
					title: "Client Sync Error",
				});
			});
		}

		if (!this.udp_broadcast_) {
			this.udp_broadcast_ = new UDPBroadcast(this.logger_, this.findPrimaryIPAddress(), this.team_number_, 5000) ;
			this.udp_broadcast_.start() ;
			this.logSync('info', 'CentralBroadcastStarted', {
				host: this.findPrimaryIPAddress(),
			}) ;
		}
	}
	// #endregion

	private setExternalDownloadInProgress(operation: string) {
		if (this.external_download_in_progress_) {
			this.logger_.warn(`Attempting to start external download (${operation}) while another download is already in progress`);
		}
		
		this.external_download_in_progress_ = true;
		this.logger_.info(`External download started: ${operation}`);
		
		// Set a timeout to automatically clear the flag if download hangs (30 minutes)
		this.external_download_timeout_ = setTimeout(() => {
			this.logger_.error(`External download timeout reached for: ${operation}. Forcing clear of download flag.`);
			this.clearExternalDownloadInProgress(`${operation} (timeout)`);
		}, 30 * 60 * 1000); // 30 minutes
	}

	private clearExternalDownloadInProgress(operation: string) {
		this.external_download_in_progress_ = false;
		this.logger_.info(`External download completed: ${operation}`);
		
		if (this.external_download_timeout_) {
			clearTimeout(this.external_download_timeout_);
			this.external_download_timeout_ = undefined;
		}
	}

	private forceClearExternalDownload() {
		if (this.external_download_in_progress_) {
			this.logger_.warn("Manually clearing stuck external download");
			this.clearExternalDownloadInProgress("Manual Clear");
			dialog.showMessageBox(this.win_, {
				title: "External Download Cleared",
				message: "The external download flag has been manually cleared. You can now start new downloads.",
				type: "info",
			});
		} else {
			dialog.showMessageBox(this.win_, {
				title: "No Download In Progress",
				message: "No external download is currently in progress.",
				type: "info",
			});
		}
	}

	public generateRandomData() {
		if (this.lastview_ && this.lastview_ === 'info') {
			if (this.project && this.project.isInitialized() && this.project.isLocked) {
				let ans = dialog.showMessageBoxSync(
					{
					  title: 'Generate Random Data',
					  type: 'question',
					  buttons: ['Yes', 'No'],
					  message: `This operation will generate random data for all teams and matches in the event. This will overwrite any existing data. Do you want to continue?`,
					}) ;
				if (ans === 1) {
					return ;
				}
				this.project!.generateRandomData()
					.then(() => {
						dialog.showMessageBox(this.win_, {
							title: "Random Data",
							message: "Random data generated",
						});
					})
					.catch((err) => {
						let errobj: Error = err as Error ;
						dialog.showMessageBox(this.win_, {
							title: "Random Data Error",
							message: `Error generating random data - ${errobj.message}`
						});
					}) ;
			} else {
				dialog.showMessageBox(this.win_, {
					title: "Random Data Error",
					message: "You can only generate data for an opened and locked project",
				});
			}
		}
	}

	private importFormulasFromFileWithPath(path: string) {
		if (this.project && this.project.isInitialized()) {
			try {
				let data = fs.readFileSync(path, 'utf-8') ;
				const obj = JSON.parse(data) ;
				const mgr = this.project!.formula_mgr_! ;
				const names = mgr.getImportFormulaNames(obj) ;
				const collisions = names.filter((name) => mgr.hasFormula(name)) ;

				let duplicatePolicy: 'keep' | 'overwrite' = 'keep' ;
				if (collisions.length > 0) {
					const shown = collisions.slice(0, 10) ;
					const extra = collisions.length > shown.length ? `\n...and ${collisions.length - shown.length} more` : '' ;
					const button = dialog.showMessageBoxSync(this.win_, {
						title: 'Import Formulas',
						type: 'question',
						buttons: ['Keep Original', 'Overwrite', 'Cancel'],
						defaultId: 0,
						cancelId: 2,
						message: `Found ${collisions.length} duplicate formula name(s).`,
						detail: `Duplicates:\n${shown.join('\n')}${extra}\n\nChoose how to handle duplicates for this import.`,
					}) ;

					if (button === 2) {
						return ;
					}

					duplicatePolicy = button === 1 ? 'overwrite' : 'keep' ;
				}

				const result = mgr.importFormulas(obj, { duplicatePolicy: duplicatePolicy }) ;
				const warningText = result.warnings.length > 0
					? `\nWarnings:\n${result.warnings.slice(0, 5).join('\n')}${result.warnings.length > 5 ? `\n...and ${result.warnings.length - 5} more` : ''}`
					: '' ;

				dialog.showMessageBox(this.win_, {
					title: 'Import Formulas',
					type: 'info',
					message: 'Formula import complete.',
					detail: `Read: ${result.read}\nAdded: ${result.added}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}\nInvalid: ${result.invalid}${warningText}`,
				}) ;
			}
			catch(err) {
				let errobj = err as Error ;
				dialog.showErrorBox("Could not import formulas", errobj.message);
			}
		}
	}

	private importFormulasFromFile() {
		dialog.showOpenDialog(this.win_, {
			title: 'Import formulas from file',
			filters: [
				{ name: 'JSON Files', extensions: ['json'] },
				{ name: 'All Files', extensions: ['*']}
			],
			properties: [
				'openFile',
			]
		}).then(result => {	
			if (!result.canceled) {
				this.importFormulasFromFileWithPath(result.filePaths[0]) ;
			}
		}) ;
	}

	private exportFormulasToFile() {
		if (!this.project || !this.project.isInitialized()) {
			dialog.showErrorBox('Export Formulas', 'No event has been loaded - cannot export formulas');
			return ;
		}

		dialog.showSaveDialog(this.win_, {
			title: 'Export formulas to file',
			defaultPath: 'formulas.json',
			filters: [
				{ name: 'JSON Files', extensions: ['json'] },
				{ name: 'All Files', extensions: ['*']}
			],
			properties: [
				'showOverwriteConfirmation',
			]
		}).then(result => {
			if (!result.canceled && result.filePath) {
				try {
					const payload = this.project!.formula_mgr_!.exportFormulas() ;
					fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8') ;
					dialog.showMessageBox(this.win_, {
						title: 'Export Formulas',
						type: 'info',
						message: 'Formula export complete.',
						detail: `Exported ${payload.formulas.length} formula(s) to:\n${result.filePath}`,
					}) ;
				}
				catch(err) {
					let errobj = err as Error ;
					dialog.showErrorBox('Export Formulas Error', errobj.message) ;
				}
			}
		}) ;
	}

	public sendHintDB(){
		if (this.project && this.project.isInitialized()) {
			let db = this.project!.getHintDb(this.content_dir_) ;
			this.sendToRenderer('send-hint-db', db) ;
		}
	}

	public setHintHidden(id: string) {
		if (this.project && this.project.isInitialized()) {
			this.project!.setHintHidden(id) ;
		}
	}


	public setTeamFormatFormulas(formulas: IPCCheckDBViewFormula[]) {
		if (this.project && this.project.isInitialized()) {
			this.project.data_mgr_!.setTeamFormatFormulas(formulas)
		}
	}	
	
	public setMatchFormatFormulas(formulas: IPCCheckDBViewFormula[]) {
		if (this.project && this.project.isInitialized()) {
			this.project.data_mgr_!.setMatchFormatFormulas(formulas)
		}
	}

	// Handle the response from the renderer
	public handlePromptStringResponse(response: IPCPromptStringResponse): void {
		if (this.promptResolvers && this.promptResolvers.has(response.id)) {
			const resolver = this.promptResolvers.get(response.id);
			this.promptResolvers.delete(response.id);
			if (resolver) {
				resolver(response.value);
			}
		}
	}

	private startSyncTrace(pathName: 'scout' | 'coach', packet: PacketObj) {
		let payload : any = undefined ;
		try {
			payload = packet.data_.length > 0 ? JSON.parse(packet.payloadAsString()) : undefined ;
		}
		catch {
			payload = undefined ;
		}

		this.sync_trace_ = {
			sessionId: createSyncSessionId(),
			role: 'central',
			transport: 'tcp',
			path: pathName,
			port: this.tcpsyncserver_?.port,
			tablet: payload?.name,
			purpose: payload?.purpose,
			eventUuid: this.project?.info?.uuid_,
		} ;

		this.tcpsyncserver_?.setTraceContext(this.sync_trace_) ;
		this.logSync('info', 'CentralSyncSessionStarted', {
			syncType: pathName,
			projectLoaded: this.project !== undefined,
			projectLocked: this.project?.info?.locked_,
		}) ;
	}

	private logSync(level: 'error' | 'warn' | 'info' | 'debug' | 'silly', event: string, extra?: Record<string, unknown>) {
		if (this.sync_trace_) {
			this.sync_trace_.eventUuid = this.project?.info?.uuid_ ;
		}
		logSync(this.logger_, level, event, this.sync_trace_, extra) ;
	}
}
