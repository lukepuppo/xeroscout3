import * as path from "path";
import * as fs from "fs";
import { BrowserWindow, dialog, Menu, MenuItem } from "electron";
import { SyncClient } from "../sync/syncclient";
import { TCPClient } from "../sync/tcpclient";
import { PacketObj } from "../sync/packetobj";
import { PacketType } from "../sync/packettypes";
import { Project } from "../project/project";
import { SCCoachCentralBaseApp } from "./sccoachcentralbase";
import { IPCAppType, IPCAutoPlanItem, IPCAutoSelectorItem, IPCForm, IPCImageItem, IPCPickListConfig, IPCSyncedImageData } from "../../shared/ipc";
import {
    parseFormPayload,
    parseHelloResponsePayload,
    parseImagesPayload,
    parseProjectInfoPayload,
    stringifyCoachGraphsPayload,
    stringifyCoachPicklistsPayload,
    stringifyStringArrayPayload,
    summarizeValidationErrors,
    validateCoachSyncPreflight,
} from "../../shared/synccontract";

export class SCCoach extends SCCoachCentralBaseApp {
    private static readonly lastEventLoaded: string = 'coach-last-event-loaded' ;
    private static readonly syncIPAddrSetting: string = 'coach-sync-ipaddr' ;
    private static readonly syncPortSetting: string = 'coach-sync-port' ;
    private static readonly picklistCacheSetting: string = 'coach-picklist-config-cache' ;
    private static readonly defaultSyncIPAddr = '192.168.1.1' ;
    private static readonly defaultSyncPort = 45455 ;

    private static readonly viewInit: string = 'view-init' ;
	private static readonly viewTeamStatus: string = 'view-team-status';
	private static readonly viewTeamDB: string = 'view-team-db';
	private static readonly viewMatchStatus: string = 'view-match-status';
	private static readonly viewMatchDB: string = 'view-match-db';
	private static readonly viewSingleTeamSummary: string = 'view-single-team-summary' ;
	private static readonly viewAutoAnalysis: string = 'view-auto-analysis' ;
    private static readonly viewScouterAccuracy: string = 'view-scouter-accuracy' ;
    private static readonly viewXeroMatchSim: string = 'view-match-sim' ;
    private static readonly viewPicklist: string = 'view-picklist' ;
	private static readonly viewPlayoffs: string = 'view-playoffs' ;
    private static readonly resetTablet: string = "reset-tablet" ;    
    private static readonly viewTeamForm: string = 'view-team-form';
    private static readonly viewMatchForm: string = 'view-match-form';
	private static readonly viewFormulas: string = 'view-formulas';    

    private static readonly syncEventLocal: string = "sync-event-local" ;
    private static readonly syncEventRemote: string = "sync-event-remote" ;
    private static readonly syncEventWiFi: string = "sync-event-wifi" ;
    private static readonly syncEventIPAddr: string = "sync-event-ipaddr" ;

    private sync_client_? : SyncClient ;    
    private sync_project_file_ : string = '' ;
    private sync_ipaddr_ : string = SCCoach.defaultSyncIPAddr ;
    private sync_port_ : number = SCCoach.defaultSyncPort ;

    private team_form_?: IPCForm ;
    private match_form_?: IPCForm ;
    private awaiting_images_: boolean = false ;
    private sync_finalized_: boolean = false ;

    public constructor(win: BrowserWindow, args: string[]) {
        super(win, 'coach') ;

        if (this.hasSetting(SCCoach.syncIPAddrSetting)) {
            let value = this.getSetting(SCCoach.syncIPAddrSetting) ;
            if (typeof value === 'string' && value.length > 0) {
                this.sync_ipaddr_ = value ;
            }
        }

        if (this.hasSetting(SCCoach.syncPortSetting)) {
            let value = this.getSetting(SCCoach.syncPortSetting) ;
            if (typeof value === 'number' && value > 0) {
                this.sync_port_ = value ;
            }
        }
    }

    public get applicationType() : IPCAppType { 
        return 'coach' ;
    }

	public mainWindowLoaded(): void {
		this.appInit() ;

        let lastevent = this.getSetting(SCCoach.lastEventLoaded) ;
        if (lastevent && typeof lastevent === 'string' && lastevent.length > 0) {
            let evfile = path.join(lastevent, 'event.json') ;
            this.openEvent(evfile)
            .then(() => { 
                this.sendNavData() ;
            })
        }
    }    

    private openEvent(evfile: string) : Promise<void> {
        let ret = new Promise<void>( (resolve, reject) => {
            let d = new Date() ;
            Project.openEvent(this.logger_, evfile, d.getFullYear(), this.applicationType)
            .then( (proj: Project) => {
                    this.project = proj ;
                    this.applyCachedPicklistConfigs() ;
                    resolve() ;
                } )
                .catch( (err: Error) => {
                    dialog.showErrorBox('Error Opening Event', 'There was an error reopening the last event:\n' + err.message) ;
                    this.logger_.error('Error opening event: ' + err.message) ;
                    reject(err) ;
                } ) ;          
        } ) ;

        return ret ;
    }
    
    public basePage() : string  {
        return "content/main.html"
    }
    
    public canQuit(): boolean {
        return true ;
    }

    public close() : void {
        if (this.project) {
            this.setSetting(SCCoach.lastEventLoaded, this.project.location) ;
        }
    }

	public sendNavData(): void {
		let treedata = [];
		let dims = 40 ;

		if (this.project) {
			treedata.push({
				type: "icon",
				command: SCCoach.viewInit,
				title: "Event Info",
				icon: this.getIconData('info.png'),
				width: dims,
				height: dims
			});
			treedata.push({ type: "separator", title: "Teams" });
            treedata.push({
                type: "icon",
                command: SCCoach.viewTeamForm,
                title: "Team Form",
                icon: this.getIconData('form.png'),
                width: dims,
                height: dims
            });            
            treedata.push({
                type: "icon",
                command: SCCoach.viewTeamStatus,
                title: "Team Status",
                icon: this.getIconData('status.png'),
                width: dims,
                height: dims					
            });
            treedata.push({
                type: "icon",
                command: SCCoach.viewTeamDB,
                title: "Team Data",
                icon: this.getIconData('data.png'),
                width: dims,
                height: dims					
            });

			treedata.push({ type: "separator", title: "Match" });
            treedata.push({
                type: "icon",
                command: SCCoach.viewMatchForm,
                title: "MatchForm",
                icon: this.getIconData('form.png'),
                width: dims,
                height: dims
            });
            treedata.push({
                type: "icon",
                command: SCCoach.viewMatchStatus,
                title: "Match Status",
                icon: this.getIconData('status.png'),
                width: dims,
                height: dims					
            });
            treedata.push({
                type: "icon",
                command: SCCoach.viewMatchDB,
                title: "Match Data",
                icon: this.getIconData('data.png'),
                width: dims,
                height: dims					
            });

            treedata.push({
                type: 'icon',
                command: SCCoach.viewPlayoffs,
                title: "Playoffs",
                icon: this.getIconData('playoffs.png'),
                width: dims,
                height: dims	
            });					

			treedata.push({ type: "separator", title: "Analysis" });

            treedata.push({
                type: 'icon',
                command: SCCoach.viewFormulas,
                title: "Formulas",
                icon: this.getIconData('formula.png'),
                width: dims,
                height: dims	
            });	            
			
            treedata.push({
                type: 'icon',
                command: SCCoach.viewPicklist,
                title: "Picklist",
                icon: this.getIconData('picklist.png'),
                width: dims,
                height: dims	
            });

            treedata.push({
                type: 'icon',
                command: SCCoach.viewSingleTeamSummary,
                title: "Single Team View",
                icon: this.getIconData('singleteam.png'),
                width: dims,
                height: dims						
            });
            treedata.push({
                type: 'icon',
                command: SCCoach.viewAutoAnalysis,
                title: "Auto Analysis",
                icon: this.getIconData('preview.png'),
                width: dims,
                height: dims
            });
            treedata.push({
                type: 'icon',
                command: SCCoach.viewScouterAccuracy,
                title: "Scouter Accuracy",
                icon: this.getIconData('bar-graph.png'),
                width: dims,
                height: dims
            });
            treedata.push({
                type: 'icon',
                command: SCCoach.viewXeroMatchSim,
                title: "Match-Prediction",
                icon: this.getIconData('Prediction.png'),
                width: dims,
                height: dims
            });
		}

		this.sendToRenderer("send-nav-data", treedata);
    }   

    public windowCreated(): void {
    }

    public executeCommand(cmd: string) : void {
        if (cmd === SCCoach.syncEventLocal) {
            this.sync_client_ = new TCPClient(this.logger_, '127.0.0.1') ;
            this.sync_client_.on('close', this.syncDone.bind(this)) ; 
            this.sync_client_.on('error', this.syncError.bind(this)) ;
            this.syncCoach() ;            
        }
        else if (cmd === SCCoach.syncEventRemote) {
            this.sync_client_ = new TCPClient(this.logger_, SCCoach.defaultSyncIPAddr, this.sync_port_) ;
            this.sync_client_?.on('close', this.syncDone.bind(this)) ; 
            this.sync_client_?.on('error', this.syncError.bind(this)) ;
            this.syncCoach() ;
        }
        else if (cmd === SCCoach.syncEventWiFi) {
            this.setView('sync-ipaddr') ;
        }      
        else if (cmd === SCCoach.syncEventIPAddr) {
            this.setView('sync-ipaddr') ;
        }
        else if (cmd === SCCoach.resetTablet) {
            this.resetTabletCmd() ;
        }
        else if (cmd === SCCoach.viewInit) {
            this.setView('info') ;
		} else if (cmd === SCCoach.viewTeamForm) {
			this.setView('form-scout', 'team');
		} else if (cmd === SCCoach.viewMatchForm) {
			this.setView('form-scout', 'match');
		}        
        else if (cmd === SCCoach.viewTeamStatus) {
            this.setView("team-status");
        }
        else if (cmd === SCCoach.viewTeamDB) {
            this.setView("team-db");
        }
        else if (cmd === SCCoach.viewMatchStatus) {
            this.setView("match-status");
        }
        else if (cmd === SCCoach.viewMatchDB) {
            this.setView("match-db");
        }
        else if (cmd === SCCoach.viewFormulas) {
            this.setView("formulas");
        }
        else if (cmd === SCCoach.viewSingleTeamSummary) {
            this.setView("singleteam");
        }
        else if (cmd === SCCoach.viewAutoAnalysis) {
            this.setView("auto-analysis");
        }
        else if (cmd === SCCoach.viewScouterAccuracy) {
            this.setView("scouter-accuracy");
        }
        else if (cmd === SCCoach.viewPicklist) {
            this.setView("picklist");
        }
        else if (cmd === SCCoach.viewXeroMatchSim) {
            this.setView("Match-Prediction");
        }
        else {
            dialog.showErrorBox('Unknown Command', `The command '${cmd}' is not recognized by SCCoach.`) ;
        }
    }

    public createMenu() : Menu | null {
        let ret: Menu | null = new Menu() ;

        let filemenu: MenuItem = new MenuItem( {
            type: 'submenu',
            label: 'File',
            role: 'fileMenu'
        }) ;

        let synctcpitem: MenuItem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event Local (127.0.0.1)',
            click: () => { this.executeCommand(SCCoach.syncEventLocal)}
        }) ;
        filemenu.submenu?.insert(0, synctcpitem) ;

        synctcpitem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event Cable (192.168.1.1)',
            click: () => { this.executeCommand(SCCoach.syncEventRemote)}
        }) ;
        filemenu.submenu?.insert(1, synctcpitem) ;

        synctcpitem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event WiFi (mDNS)',
            click: () => { this.executeCommand(SCCoach.syncEventWiFi)}
        }) ;
        filemenu.submenu?.insert(2, synctcpitem) ;    
        
        synctcpitem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event IP Address (Manual)',
            click: () => { this.executeCommand(SCCoach.syncEventIPAddr)}
        }) ;
        filemenu.submenu?.insert(3, synctcpitem) ;          

        filemenu.submenu?.insert(4, new MenuItem({type: 'separator'}));        

        ret.append(filemenu) ;

        let resetmenu: MenuItem = new MenuItem({
            type: 'submenu',
            label: 'Reset',
            submenu: new Menu()
        }) ;

        let resetitem: MenuItem = new MenuItem( {
            type: 'normal',
            label: 'Reset Tablet',
            click: () => { this.executeCommand(SCCoach.resetTablet)}
        }) ;
        resetmenu.submenu?.insert(0, resetitem) ;
        ret.append(resetmenu);          

        let helpmenu: MenuItem = new MenuItem({
            type: 'submenu',
            label: 'Help',
            submenu: new Menu(),
        }) ;

        helpmenu.submenu?.append(new MenuItem({
            type: 'normal',
            label: 'Check For Updates',
            click: () => { this.checkForUpdates() ; }
        })) ;

        helpmenu.submenu?.append(new MenuItem({
            type: 'normal',
            label: 'About',
            click: () => { this.showAbout() ; }
        })) ;
        ret.append(helpmenu) ;

        return ret ;
    }    

    private syncDone() : void {
    }

    private syncError(err: Error) : void {
        this.logger_.error('Sync error: ' + err.message) ;
    }

    public syncIPAddrWithAddr(ipaddr: string, port: number) {
        this.sync_ipaddr_ = ipaddr ;
        this.sync_port_ = port ;
        this.setSetting(SCCoach.syncIPAddrSetting, this.sync_ipaddr_) ;
        this.setSetting(SCCoach.syncPortSetting, this.sync_port_) ;
        this.sync_client_ = new TCPClient(this.logger_, ipaddr, port) ;
        this.sync_client_?.on('close', this.syncDone.bind(this)) ; 
        this.sync_client_?.on('error', this.syncError.bind(this)) ;
        this.syncCoach() ;
    }

    private resetTabletCmd() {
        let ans = dialog.showMessageBoxSync(
            {
              title: 'Reset Tablet',
              type: 'question',
              buttons: ['Yes', 'No'],
              message: `This operation will reset the tablet and all data will be lost unless you have sync'ed with the central server.\nDo you want to continue?`,
            }) ;
        if (ans === 1) {
            return ;
        }

        this.project = undefined ;
        this.unsetSettings(SCCoach.lastEventLoaded) ;
        this.image_mgr_.removeAllImages() ;
        this.sendNavData() ;
        this.setView('text', 'No Event Loaded') ;
    }

    private syncCoach() : void {
        this.team_form_ = undefined ;
        this.match_form_ = undefined ;
        this.awaiting_images_ = false ;
        this.sync_finalized_ = false ;

        const configs = this.project?.graph_mgr_?.coachConfigs || [] ;
        const picklists = this.project?.picklist_mgr_?.coachesPicklists || [] ;
        const preflight = validateCoachSyncPreflight(configs, picklists) ;
        if (!preflight.ok) {
            this.showSyncValidationError('Invalid Local Sync Data', preflight.errors) ;
            return ;
        }

        this.sync_client_!.connect()
            .then(async ()=> {
                this.logger_.info(`ScouterSync: connected to server ' ${this.sync_client_!.name()}'`) ;
                let data = new Uint8Array(0) ;

                this.sync_client_!.on('close', () => {
                    this.logger_.info('ScouterSync: connection closed') ;
                    this.sync_client_ = undefined ;
                }) ;
                
                let p: PacketObj = new PacketObj(PacketType.HelloFromCoach, data) ;
                this.sync_client_!.on('error', (err: Error) => {
                    let msg: string = "" ;
                    let a: any = err as any ;
                    if (a.errors) {
                        for(let cerror of a.errors) {
                            this.logger_.info('ScouterSync: error from connection \'' + this.sync_client_!.name() + '\' - ' + cerror.message) ;
                            msg += cerror.message + '\n' ;
                        }
                    }
                    else {
                        this.logger_.info('ScouterSync: error from connection \'' + this.sync_client_!.name() + '\' - ' + err.message) ;
                        msg = err.message ;
                    }

                    this.sendToRenderer('set-status-title', 'Error Connecting To XeroScout Central') ;
                    this.sendToRenderer('set-status-visible', true) ;
                    this.sendToRenderer('set-status-text', msg) ;
                    this.sendToRenderer('set-status-close-button-visible', true) ;
                }) ;

                this.sync_client_!.on('packet', (p: PacketObj) => {
                    this.syncTablet(p) ;
                }) ;

                await this.sync_client_!.send(p) ;
                
            })
            .catch((err) => {
            this.logger_.error('Error connecting to sync server: ' + err.message) ;
            }) ;
    }

    private showSyncValidationError(title: string, errors: string[]) : void {
        dialog.showErrorBox(title, summarizeValidationErrors(errors)) ;
        this.logger_.error(`${title}: ${errors.join(" | ")}`) ;
    }

    private normalizeImageName(name: string) : string {
        let ret = (name ?? '').trim() ;
        if (ret.length === 0) {
            return '' ;
        }

        if (/\.(png|webp)$/i.test(ret)) {
            ret = ret.replace(/\.(png|webp)$/i, '') ;
        }

        return ret.trim() ;
    }

    private collectRequiredImagesFromForm(form: IPCForm) : string[] {
        let ret: string[] = [] ;

        for (let section of form.sections || []) {
            for (let item of section.items || []) {
                if (!item || typeof (item as any).type !== 'string') {
                    continue ;
                }

                if (item.type === 'image') {
                    let imitem = item as IPCImageItem ;
                    let img = this.normalizeImageName(imitem.image) ;
                    if (img.length > 0) {
                        ret.push(img) ;
                    }
                }
                else if (item.type === 'autoplan') {
                    let apitem = item as IPCAutoPlanItem ;
                    let img = this.normalizeImageName(apitem.fieldImage) ;
                    if (img.length > 0) {
                        ret.push(img) ;
                    }
                }
                else if (item.type === 'autoselector') {
                    let asitem = item as IPCAutoSelectorItem ;
                    let img = this.normalizeImageName(asitem.fieldImage) ;
                    if (img.length > 0) {
                        ret.push(img) ;
                    }
                }
            }
        }

        return [...new Set(ret)] ;
    }

    private computeMissingImages() : string[] {
        let required: string[] = [] ;
        if (this.team_form_) {
            required = [...required, ...this.collectRequiredImagesFromForm(this.team_form_)] ;
        }
        if (this.match_form_) {
            required = [...required, ...this.collectRequiredImagesFromForm(this.match_form_)] ;
        }

        let ret: string[] = [] ;
        for (let img of [...new Set(required)]) {
            if (img.length === 0) {
                continue ;
            }
            if (!this.image_mgr_.hasImage(img)) {
                ret.push(img) ;
            }
        }

        return ret ;
    }

    private maybeRequestImagesOrCompleteSync() : void {
        let missing = this.computeMissingImages() ;
        if (missing.length > 0) {
            const serialized = stringifyStringArrayPayload(missing, 'RequestImages') ;
            if (!serialized.ok) {
                this.showSyncValidationError('Invalid Local Sync Data', serialized.errors) ;
                return ;
            }
            this.awaiting_images_ = true ;
            let payload = Buffer.from(serialized.value, 'utf-8') ;
            this.sync_client_!.send(new PacketObj(PacketType.RequestImages, payload)) ;
        }
        else {
            this.completeSync() ;
        }
    }

    private completeSync() : void {
        if (this.sync_finalized_) {
            return ;
        }

        this.sync_finalized_ = true ;
        this.sync_client_!.send(new PacketObj(PacketType.GoodbyeFromCoach, new Uint8Array(0))) ;
        this.finishSync() ;
    }

    private syncTablet(p: PacketObj) : void {
        let obj : any ;
        let str: string ;
        let data: Uint8Array ;

        switch(p.type_) {
            case PacketType.HelloFromCoach:
                this.receiveHello(p) ;
                let configs = this.project?.graph_mgr_?.coachConfigs || [] ;
                let configPayload = stringifyCoachGraphsPayload(configs) ;
                if (!configPayload.ok) {
                    this.showSyncValidationError('Invalid Local Sync Data', configPayload.errors) ;
                    this.sync_client_?.close() ;
                    return ;
                }
                str = configPayload.value ;
                data = new Uint8Array(Buffer.from(str)) ;
                p = new PacketObj(PacketType.ProvideCoachGraphs, data) ;
                this.sync_client_!.send(p) ;
                break ;

            case PacketType.ReceivedCoachGraphcs:
                this.logger_.debug('SyncTablet: received ReceivedCoachGraphcs packet') ;
                let picklists = this.project?.picklist_mgr_?.coachesPicklists || [] ;
                let picklistPayload = stringifyCoachPicklistsPayload(picklists) ;
                if (!picklistPayload.ok) {
                    this.showSyncValidationError('Invalid Local Sync Data', picklistPayload.errors) ;
                    this.sync_client_?.close() ;
                    return ;
                }
                str = picklistPayload.value ;
                data = new Uint8Array(Buffer.from(str)) ;
                p = new PacketObj(PacketType.ProvideCoachPickLists, data) ;
                this.sync_client_!.send(p) ;
                break ;
                
                
            case PacketType.ReceivedCoachPickLists:
                this.logger_.debug('SyncTablet: received ReceivedCoachPickLists packet') ;
                p = new PacketObj(PacketType.RequestProject, new Uint8Array(0)) ;
                this.sync_client_!.send(p) ;                
                break ;

            case PacketType.Error:
                this.logger_.error('SyncTablet: received Error packet: ' + p.payloadAsString()) ;
                dialog.showErrorBox('Synchronization Error', p.payloadAsString()) ;
                p = new PacketObj(PacketType.GoodbyeFromCoach, new Uint8Array(0)) ;
                this.sync_client_!.send(p) ;                   
                break ;
            case PacketType.ProvideProject:
                if (!this.receiveProject(p)) {
                    this.sync_client_?.close() ;
                    return ;
                }
                p = new PacketObj(PacketType.RequestTeamDB, new Uint8Array(0)) ;
                this.sync_client_!.send(p) ;                
                break ;

            case PacketType.ProvideTeamDB:
                this.receiveTeamDB(p) ;
                p = new PacketObj(PacketType.RequestMatchDB, new Uint8Array(0)) ;
                this.sync_client_!.send(p) ;                
                break ;

            case PacketType.ProvideMatchDB:
                this.receiveMatchDB(p) ;
                p = new PacketObj(PacketType.RequestTeamForm, new Uint8Array(0)) ;
                this.sync_client_!.send(p) ;                 
                break ;

            case PacketType.ProvideTeamForm:
                this.logger_.debug('SyncTablet: received ProvideTeamForm packet') ;
                {
                    const parsed = parseFormPayload(p.payloadAsString(), 'ProvideTeamForm') ;
                    if (!parsed.ok) {
                        this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                        return ;
                    }
                    this.team_form_ = parsed.value ;
                }
                this.receiveTeamForm(p) ;
                p = new PacketObj(PacketType.RequestMatchForm, new Uint8Array(0)) ;
                this.sync_client_!.send(p) ;                 
                break ;

            case PacketType.ProvideMatchForm:
                this.logger_.debug('SyncTablet: received ProvideMatchForm packet') ;
                {
                    const parsed = parseFormPayload(p.payloadAsString(), 'ProvideMatchForm') ;
                    if (!parsed.ok) {
                        this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                        return ;
                    }
                    this.match_form_ = parsed.value ;
                }
                this.receiveMatchForm(p) ;
                this.maybeRequestImagesOrCompleteSync() ;
                break ;

            case PacketType.ProvideImages:
                {
                    const parsed = parseImagesPayload(p.payloadAsString()) ;
                    if (!parsed.ok) {
                        this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                        return ;
                    }

                    for (let imname of Object.keys(parsed.value)) {
                        let norm = this.normalizeImageName(imname) ;
                        if (norm.length > 0) {
                            const result = this.image_mgr_.addSyncedImage(norm, parsed.value[imname]) ;
                            if (!result.ok) {
                                this.logger_.warn(`SyncTablet: skipping synced image '${norm}' - ${result.reason}`) ;
                            }
                        }
                    }
                }
                this.awaiting_images_ = false ;
                this.completeSync() ;
                break ;
        }
    }

    private finishSync() : void {
        let evfile = path.join(this.sync_project_file_, 'event.json') ;
        this.openEvent(evfile)
        .then(() => {
            let form = path.join(this.sync_project_file_, 'match.json') ;
            this.project?.form_mgr_?.setMatchForm(form) ;

            form = path.join(this.sync_project_file_, 'team.json') ;
            this.project?.form_mgr_?.setTeamForm(form) ;

            this.sync_project_file_ = '' ;
            this.sendNavData() ;
        }) ;
    }

    private receiveHello(p: PacketObj) : void {
        this.logger_.debug('SyncTablet: received HelloFromCoach packet') ;
        const parsed = parseHelloResponsePayload(p.payloadAsString(), 'HelloFromCoach') ;
        if (!parsed.ok) {
            this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
            this.sync_client_?.close() ;
            return ;
        }

        let obj = parsed.value ;
        if (this.project && this.project.info?.uuid_ && obj.uuid !== this.project.info.uuid_) {
            dialog.showMessageBoxSync(this.win_, {
                title: 'Synchronization Error',
                message: 'The connected event does not match the currently loaded event.\nReset the Coach tablet to sync to this new event.',
                type: 'error'
            }) ;
            this.sync_client_!!.close() ;
            return ;
        }
    }

    private receiveTeamForm(p: PacketObj) : void {
        let str : string = p.payloadAsString() ;
        let fname = path.join(this.sync_project_file_, 'team.json') ;
        fs.writeFileSync(fname, str) ;
    }

    private receiveMatchForm(p: PacketObj) : void {
        let str : string = p.payloadAsString() ;
        let fname = path.join(this.sync_project_file_, 'match.json') ;
        fs.writeFileSync(fname, str) ;
    }

    private receiveProject(p: PacketObj) : boolean {
        this.logger_.debug('SyncTablet: received ProvideProject packet') ;        
        let str : string = p.payloadAsString() ;
        const parsed = parseProjectInfoPayload(str) ;
        if (!parsed.ok) {
            this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
            return false ;
        }
        let info : any = parsed.value ;
        this.sync_project_file_ = this.getProjectDir(info) ;

        if (!fs.existsSync(this.sync_project_file_)) {
            fs.mkdirSync(this.sync_project_file_, { recursive: true }) ;
        }

        fs.writeFileSync(path.join(this.sync_project_file_, 'event.json'), str) ;
        return true ;
    }

    public override savePicklistConfig(configs: IPCPickListConfig[]) {
        if (this.project) {
            super.savePicklistConfig(configs) ;
            this.clearCoachPicklistCache() ;
        }
        else {
            this.cacheCoachPicklistConfigs(configs) ;
        }
    }

    private receiveTeamDB(p: PacketObj) : void {
        this.logger_.debug('SyncTablet: received ProvideTeamDB packet') ;        
        let fname = path.join(this.sync_project_file_, 'team.db') ;
        fs.writeFileSync(fname, p.data_) ;
    }

    private receiveMatchDB(p: PacketObj) : void {
        this.logger_.debug('SyncTablet: received ProvideMatchDB packet') ;        
        let fname = path.join(this.sync_project_file_, 'match.db') ;
        fs.writeFileSync(fname, p.data_) ;        
    }

    private getProjectDir(info:any) : string {
        let dir : string = path.join(this.appdir_, 'projects', info.uuid_) ;
        return dir ;
    }

    private cacheCoachPicklistConfigs(configs: IPCPickListConfig[]) : void {
        const coachConfigs = configs.filter((cfg) => cfg.owner === 'coach') ;
        if (coachConfigs.length === 0) {
            return ;
        }

        const cache = this.readCoachPicklistCache() ;
        for (const cfg of coachConfigs) {
            cache[cfg.name] = JSON.parse(JSON.stringify(cfg)) as IPCPickListConfig ;
        }
        this.writeCoachPicklistCache(cache) ;
    }

    private readCoachPicklistCache() : Record<string, IPCPickListConfig> {
        const stored = this.getSetting(SCCoach.picklistCacheSetting) ;
        if (stored && typeof stored === 'object') {
            try {
                return JSON.parse(JSON.stringify(stored)) as Record<string, IPCPickListConfig> ;
            }
            catch {
            }
        }
        return {} ;
    }

    private writeCoachPicklistCache(cache: Record<string, IPCPickListConfig>) : void {
        this.setSetting(SCCoach.picklistCacheSetting, cache) ;
    }

    private clearCoachPicklistCache() : void {
        this.writeCoachPicklistCache({}) ;
    }

    private applyCachedPicklistConfigs() : void {
        if (!this.project || !this.project.picklist_mgr_) {
            return ;
        }

        const cache = this.readCoachPicklistCache() ;
        const names = Object.keys(cache) ;
        if (names.length === 0) {
            return ;
        }

        const coachCacheConfigs = names
            .map((name) => cache[name])
            .filter((cfg): cfg is IPCPickListConfig => !!cfg && cfg.owner === 'coach') ;

        if (coachCacheConfigs.length === 0) {
            this.clearCoachPicklistCache() ;
            return ;
        }

        const centralConfigs = this.project.picklist_mgr_.centralPicklists || [] ;
        const existingCoachConfigs = this.project.picklist_mgr_.coachesPicklists || [] ;
        const remainingCoachConfigs = existingCoachConfigs.filter((cfg) => !cache[cfg.name]) ;
        const finalCoachConfigs = [...remainingCoachConfigs, ...coachCacheConfigs] ;
        const fullConfigs = [...centralConfigs, ...finalCoachConfigs] ;

        super.savePicklistConfig(fullConfigs) ;
        this.clearCoachPicklistCache() ;
    }
}
