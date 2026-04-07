import * as path from 'path' ;
import * as fs from 'fs' ;
import { BrowserWindow, dialog, Menu, MenuItem } from "electron";
import { SCBase } from "./scbase";
import { SyncClient } from "../sync/syncclient";
import { TCPClient } from "../sync/tcpclient";
import { PacketObj } from "../sync/packetobj";
import { PacketType } from "../sync/packettypes";
import { MatchTablet, PlayoffAssignment, TeamTablet } from "../project/tabletmgr";
import { kMatchAlliances } from '../../shared/playoffs';
import { IPCAppType, IPCAutoPlanItem, IPCAutoSelectorItem, IPCForm, IPCFormScoutData, IPCImageItem, IPCNamedDataValue, IPCPlayoffStatus, IPCScoutResult, IPCScoutResults, IPCSection, IPCTabletDefn } from "../../shared/ipc";
import { createSyncSessionId, logSync, packetSummary, SyncTraceContext } from "../sync/syncdiag";
import {
    parseFormPayload,
    parseHelloResponsePayload,
    parseImagesPayload,
    parseMatchAssignmentsPayload,
    parsePlayoffAssignmentsPayload,
    parsePlayoffStatusPayload,
    parseScoutHelloPayload,
    parseScoutResultArrayPayload,
    parseTabletsPayload,
    parseTeamAssignmentsPayload,
    stringifyScoutHelloPayload,
    stringifyScoutResultsPayload,
    stringifyStringArrayPayload,
    summarizeValidationErrors,
    validateScoutSyncPreflight,
} from "../../shared/synccontract";

export class SCScoutInfo {
    public tablet_? : string ;
    public purpose_? : string ;
    public uuid_? : string ;
    public evname_? : string ;
    public teamform_? : any ;
    public matchform_? : any ;
    public teamlist_? : TeamTablet[] ;
    public matchlist_? : MatchTablet[] ;
    public results_ : IPCScoutResult[] ;
    public team_results_cache_ : IPCScoutResult[] ;
    public playoff_assignments_? : PlayoffAssignment[] ;
    public playoff_status_? : IPCPlayoffStatus ;

    constructor() {
        this.results_ = [] ;
        this.team_results_cache_ = [] ;
    }
}

export class SCScout extends SCBase {
    private static readonly last_event_setting = "lastevent" ;
    private static readonly SYNC_IPADDR = 'SYNC_IPADDR' ;
    private static readonly SYNC_PORT = 'SYNC_PORT' ;
    private static readonly defaultSyncIPAddr = '192.168.1.1' ;
    private static readonly defaultSyncPort = 45455 ;

    private static readonly viewPlayoffs: string = 'view-playoffs' ;
    private static readonly syncEventLocal: string = "sync-event-local" ;
    private static readonly syncEventRemote: string = "sync-event-remote" ;
    private static readonly syncEventWiFi: string = "sync-event-wifi" ;
    private static readonly syncEventIPAddr: string = "sync-event-ipaddr" ;
    private static readonly resetCurrentMatch: string = "reset-current-match" ;
    private static readonly resetTablet: string = "reset-tablet" ;
    private static readonly resizeWindow: string = "resize-window" ;
    private static readonly showTeams: string = 'show-teams' ;
    private static readonly showFullTeamNames: string = 'show-full-team-names' ;
    private static readonly reverseImage: string = 'reverse' ;


    private info_ : SCScoutInfo = new SCScoutInfo() ;

    private resultPromiseResolve_ ? : () => void ;
    private pending_result_request_item_?: string ;
    private tablets_?: IPCTabletDefn[] ;
    private conn_?: SyncClient ;
    private current_scout_? : string ;
    private alliance_? : string ;
    private next_cmd_? : string ;
    private reversed_ : boolean = false ;
    private reverseImage_: MenuItem | undefined ;
    private show_teams_item_ : MenuItem | undefined ;
    private show_full_team_names_item_ : MenuItem | undefined ;
    private sync_client_? : SyncClient ;
    private show_teams_ : boolean = false ;
    private show_full_team_names_ : boolean = false ;
    private tablet_data_send_timer_?: NodeJS.Timeout ;

    private ipaddr_: string = SCScout.defaultSyncIPAddr ;
    private port_ : number = SCScout.defaultSyncPort ;
    private team_number_ : number = 1425 ;
    private sync_trace_? : SyncTraceContext ;

    private match_results_received_ : boolean = false ;
    private team_results_received_ : boolean = false ;
    private team_form_received_ : boolean = false ;
    private match_form_received_ : boolean = false ;
    private match_list_received_ : boolean = false ;
    private team_list_received_ : boolean = false ;
    private playoff_assignment_received_ : boolean = false ;
    private playoff_status_received_ : boolean = false ;

    public constructor(win: BrowserWindow, args: string[]) {
        super(win, 'scout') ;

        this.checkLastEvent() ;

        if (this.hasSetting(SCScout.showTeams)) {
            this.show_teams_ = this.getSetting(SCScout.showTeams) ;
        }

        if (this.hasSetting(SCScout.showFullTeamNames)) {
            this.show_full_team_names_ = this.getSetting(SCScout.showFullTeamNames) ;
        }

        if (this.hasSetting(SCScout.SYNC_IPADDR)) {
            let value = this.getSetting(SCScout.SYNC_IPADDR) ;
            if (typeof value === 'string' && value.length > 0) {
                this.ipaddr_ = value ;
            }
        }

        if (this.hasSetting(SCScout.SYNC_PORT)) {
            let value = this.getSetting(SCScout.SYNC_PORT) ;
            if (typeof value === 'number' && value > 0) {
                this.port_ = value ;
            }
        }
    }

    public get applicationType() : IPCAppType { 
        return 'scout' ;
    }
    
    public basePage() : string  {
        return "content/main.html"
    }

    public canQuit(): boolean {
        return true ;
    }

    public close() : void {
    }
    
    public sendNavData() : any {
        let treedata : any[] = [] ;

        if (this.info_.purpose_) {
            let navstuff ;
            if (this.info_.purpose_ === 'team' && this.info_.teamlist_) {
                navstuff = this.populateNavTeams() ;
            }
            else {
                navstuff = this.populateNavMatches() ;
            }
            treedata = [...treedata, ...navstuff] ;
        }
        this.sendToRenderer('send-nav-data', treedata);
    }

    private ready() {
        this.setViewString() ;
    }

    public windowCreated() {
        this.win_.on('ready-to-show', this.ready.bind(this)) ;
    }

    private populateNavTeams() : any[] {
        let ret : any[] = [] ;

        for(let t of this.info_.teamlist_!) {      
            if (t.tablet === this.info_.tablet_) {
                let title = "Team: " + t.team ;
                if (this.show_teams_) {
                    title += ' (' + t.name + ')' ;
                }
                
                let teamName = undefined;
                if (this.show_full_team_names_) {
                    teamName = t.name.length > 64 ? t.name.substring(0, 61) + "..." : t.name;
                }
                
                ret.push({type: 'item', command: 'st-' + t.team, title: title, number: t.team, teamName: teamName}) ;
            }
        }

        ret.sort((a,b) : number => { 
            if (a.number < b.number) {
                return -1 ;
            }
            else if (a.number > b.number) {
                return 1 ;
            }

            return 0 ;
        }) ;
        return ret ;
    }

    private areAlliancesValid() : boolean {
        if (!this.info_.playoff_status_ || !this.info_.playoff_status_.alliances) {
            return false;
        }

        let alliances = this.info_.playoff_status_.alliances ;
        if (!Array.isArray(alliances) || alliances.length !== 8) {
            return false;
        }

        for(let all of alliances) {
            if (!all || !all.teams || !Array.isArray(all.teams) || all.teams.length !== 3) {
                return false ;
            }

            if (!all.teams[0] || !all.teams[1] || !all.teams[2]) {
                return false ;
            }
        }

        return true ;
    }

    private populateNavMatches() : any[] {
        let ret : any[] = [] ;

        let ofinterest: any[] = [] ;
        for(let t of this.info_.matchlist_!) {
            if (t.tablet === this.info_.tablet_) {
                ofinterest.push(t) ;
            }
        }
        ofinterest.sort((a, b) => { return this.sortCompFun(a, b) ;}) ;


        if (this.areAlliancesValid()) {
            ret.push({
                type: 'item',
                command: SCScout.viewPlayoffs,
                title: 'View Playoffs'
            }) ;
        }

        for(let t of ofinterest) {
            let mtype:string = t.comp_level ;
            
            let cmd: string = 'sm-' + t.comp_level + '-' + t.set_number + '-' + t.match_number + '-' + t.teamnumber ;
            let title: string ;
            title = mtype.toUpperCase() + '-' + t.match_number + ' - ' + t.set_number + '-' + t.teamnumber ;
            if (this.show_teams_) {
                title += ' (' + t.teamname + ')' ;
            }
            
            let teamName = undefined;
            if (this.show_full_team_names_) {
                teamName = t.teamname.length > 64 ? t.teamname.substring(0, 61) + "..." : t.teamname;
            }
            
            ret.push({type: 'item', command: cmd, title: title, teamName: teamName}) ;
        }
        return ret ;
    }

    public syncError(err: Error) {
        this.logSync('error', 'ScoutSyncError', {
            message: err.message,
            state: this.getSyncStateSnapshot(),
        }) ;
        dialog.showMessageBoxSync(this.win_, {
            title: 'Synchronization Error',
            message: 'Error synchronizing - ' + err.message,
        }) ;
        this.sync_client_ = undefined ;
    }

    public syncDone() {
        this.logSync('info', 'ScoutSyncDone', {
            state: this.getSyncStateSnapshot(),
        }) ;
        this.sync_client_ = undefined ;
    }

    private optionallyGetResults() : Promise<void> {
        if (this.current_scout_) {
            return this.getCurrentResults() ;
        }
        else {
            return Promise.resolve() ;
        }
    }

    public executeCommand(cmd: string) : void {   
        if (cmd === SCScout.resetCurrentMatch) {
            this.executeCommandInternal(cmd) ;
            return ;
        }

        this.optionallyGetResults()
        .then(() => {
            this.executeCommandInternal(cmd) ;
        })
        .catch((err) => {
            this.logger_.error('cannot get results before command', err) ; 
        }) ;
    }

    private executeCommandInternal(cmd: string) : void {
        if (cmd === SCScout.syncEventLocal) {
            this.setViewString() ;
            this.current_scout_ = undefined ;
            this.beginSyncTrace('local', '127.0.0.1', this.port_) ;
            this.sync_client_ = new TCPClient(this.logger_, '127.0.0.1') ;
            this.sync_client_.on('close', this.syncDone.bind(this)) ; 
            this.sync_client_.on('error', this.syncError.bind(this)) ;

            this.match_results_received_ = false ;
            this.team_results_received_ = false ;
            this.syncClient(this.sync_client_) ;
        }
        else if (cmd === SCScout.syncEventRemote) {
            this.setViewString() ;
            this.current_scout_ = undefined ;
            this.beginSyncTrace('cable', SCScout.defaultSyncIPAddr, this.port_) ;
            this.sync_client_ = new TCPClient(this.logger_, SCScout.defaultSyncIPAddr, this.port_) ;
            this.sync_client_.on('close', this.syncDone.bind(this)) ; 
            this.sync_client_.on('error', this.syncError.bind(this)) ;

            this.match_results_received_ = false ;
            this.team_results_received_ = false ;
            this.syncClient(this.sync_client_) ;
        }
        else if (cmd === SCScout.syncEventWiFi) {
            this.setViewString() ;
            this.current_scout_ = undefined ;
            this.beginSyncTrace('wifi', this.ipaddr_, this.port_) ;
            this.sync_client_ = new TCPClient(this.logger_, this.ipaddr_, this.port_) ;
            this.sync_client_.on('close', this.syncDone.bind(this)) ; 
            this.sync_client_.on('error', this.syncError.bind(this)) ;

            this.match_results_received_ = false ;
            this.team_results_received_ = false ;
            this.syncClient(this.sync_client_) ;
        }      
        else if (cmd === SCScout.syncEventIPAddr) {
            this.logSync('info', 'ScoutSyncManualAddressRequested') ;
            this.setView('sync-ipaddr') ;
        }
        else if (cmd === SCScout.resetCurrentMatch) {
            this.resetCurrentMatchCmd() ;
        }
        else if (cmd === SCScout.resetTablet) {
            this.resetTabletCmd() ;
        }
        else if (cmd === SCScout.resizeWindow) {
            this.sendToRenderer('resize-window') ;
        }
        else if (cmd === SCScout.showTeams) {
            this.show_teams_ = !this.show_teams_ ;
            if (this.show_teams_item_) {
                this.show_teams_item_.checked = this.show_teams_ ;
            }
            this.setSetting(SCScout.showTeams, this.show_teams_) ;
            this.sendNavData() ;
        }
        else if (cmd === SCScout.showFullTeamNames) {
            this.show_full_team_names_ = !this.show_full_team_names_ ;
            if (this.show_full_team_names_item_) {
                this.show_full_team_names_item_.checked = this.show_full_team_names_ ;
            }
            this.setSetting(SCScout.showFullTeamNames, this.show_full_team_names_) ;
            this.sendNavData() ;
        }
        else if (cmd === SCScout.reverseImage) {
            this.reverseImage() ;
        }
        else if (cmd === SCScout.viewPlayoffs) {
            this.setView('playoffs', this.info_.playoff_status_)
        }
        else if (cmd.startsWith('st-')) {
            this.scoutTeam(cmd) ;
        }
        else if (cmd.startsWith('sm-')) {
            this.scoutMatch(cmd) ;
        }
    }

    public syncIPAddrWithAddr(ipaddr: string, port: number) {
        this.setViewString() ;
        this.current_scout_ = undefined ;
        this.ipaddr_ = ipaddr ;
        this.port_ = port ;
        this.beginSyncTrace('manual-ip', ipaddr, port) ;
        this.setSetting(SCScout.SYNC_IPADDR, this.ipaddr_) ;
        this.setSetting(SCScout.SYNC_PORT, this.port_) ;
        this.sync_client_ = new TCPClient(this.logger_, ipaddr, port) ;
        this.sync_client_.on('close', this.syncDone.bind(this)) ; 
        this.sync_client_.on('error', this.syncError.bind(this)) ;

        this.match_results_received_ = false ;
        this.team_results_received_ = false ;
        this.syncClient(this.sync_client_) ;
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

        this.unsetSettings(SCScout.last_event_setting) ;
        this.tablets_ = undefined ;
        this.current_scout_ = undefined ;
        this.info_.purpose_ = undefined ;
        this.info_.tablet_ = undefined ;
        this.info_.results_ = [];
        this.info_.team_results_cache_ = [] ;
        this.info_.uuid_ = undefined ;
        this.info_.evname_ = undefined ;
        this.info_.teamform_ = undefined ;
        this.info_.matchform_ = undefined ;
        this.info_.teamlist_ = undefined ;
        this.info_.matchlist_ = undefined ;
        this.info_.playoff_assignments_ = undefined ;
        this.info_.playoff_status_ = undefined ;
        this.match_results_received_ = false ;
        this.team_results_received_ = false ;
        this.team_form_received_ = false ;
        this.match_form_received_ = false ;
        this.match_list_received_ = false ;
        this.team_list_received_ = false ;
        this.playoff_assignment_received_ = false ;
        this.playoff_status_received_ = false ;

        this.sendToRenderer('tablet-title', 'NOT ASSIGNED') ;

        this.sendNavData() ;
        this.setView('empty') ;

        this.image_mgr_.removeAllImages() ;
    }

    private resetCurrentMatchCmd() {
        if (!this.current_scout_ || !this.current_scout_.startsWith('sm-')) {
            dialog.showMessageBoxSync(this.win_, {
                title: 'Reset Match Data',
                type: 'warning',
                message: 'No active match is selected to reset.',
            }) ;
            return ;
        }

        const matchItem = this.current_scout_ ;
        this.deleteResults(matchItem) ;
        this.writeEventFile() ;
        this.logSync('info', 'ScoutCurrentMatchReset', {
            item: matchItem,
            remainingResults: this.info_.results_.length,
        }) ;

        this.sendToRenderer('send-nav-highlight', matchItem) ;
        this.sendForm('match') ;
    }

    private scoutTeam(team: string, force: boolean = false) {
        this.optionallyGetResults()
        .then(() => {
            //
            // About to scout a new team, be sure that is what we want to do.
            //
            let data: IPCScoutResult | undefined = this.getOneScoutResults(team) ;
            if (!data) {
                let ans = dialog.showMessageBoxSync(
                    {
                      title: 'Scout New Team?',
                      type: 'warning',
                      buttons: ['Yes', 'No'],
                      message: 'You are about to scout a new team.  Do you want to continue?',
                    }) ;
                if (ans === 1) {
                    this.sendToRenderer('send-nav-highlight', undefined) ;
                    this.setViewString() ;
                    return ;
                }
            }

            this.sendToRenderer('send-nav-highlight', team) ;
            this.current_scout_ = team;
            this.setView('form-scout', 'team') ;
        })
        .catch((err) => {
            this.logger_.error('cannot get results before scouting team', err) ; 
        }) ;
    }

    private scoutMatch(match: string, force: boolean = false) {
        this.optionallyGetResults()
        .then(() => {
            this.alliance_ = this.getAllianceFromMatch(match) ;
            if (!this.alliance_) {
                dialog.showMessageBox(this.win_, {
                    title: 'Internal Error', 
                    message: 'Internal Error - no alliance from match'
                }) ;
            }
            else {
                //
                // About to scout a new match, be sure that is what we want to do.
                //
                let data: IPCScoutResult | undefined = this.getOneScoutResults(match) ;
                if (!data) {
                    let ans = dialog.showMessageBoxSync(
                        {
                          title: 'Scout New Team?',
                          type: 'warning',
                          buttons: ['Yes', 'No'],
                          message: 'You are about to scout a new team.  Do you want to continue?',
                        }) ;
                    if (ans === 1) {
                        this.sendToRenderer('send-nav-highlight', undefined) ;
                        this.setViewString() ;
                        return ;
                    }
                }
                this.sendToRenderer('send-nav-highlight', match) ;
                this.current_scout_ = match ;
                this.setView('form-scout', 'match') ;
            }
        })
        .catch((err) => {
            this.logger_.error('cannot get results before scouting match', err) ; 
        }) ;
    }

    private getAllianceFromMatch(match: string) : string | undefined {
        let ret: string | undefined ;
        
        for(let m of this.info_.matchlist_!) {
            let cmd: string = 'sm-' + m.comp_level + '-' + m.set_number + '-' + m.match_number + '-' + m.teamnumber ;
            if (cmd === match) {
                ret = m.alliance ;
                break ;
            }
        }

        return ret;
    }

    private filterResults(res: IPCNamedDataValue[]) : IPCNamedDataValue[] {
        let ret: IPCNamedDataValue[] = [] ;

        for(let r of res) {
            if (r && r.value !== undefined && r.value !== null) {
                let value = (r as any).value ;
                if (value.value !== undefined && value.value !== null) {
                    ret.push(r) ;
                }
            }
        }

        return ret ;
    }

    private isValidScoutItemId(item: string | undefined) : item is string {
        if (!item || item.trim().length === 0) {
            return false ;
        }

        if (/^st-\d+$/.test(item)) {
            return true ;
        }

        const match = /^sm-([^-]+)-(\d+)-(\d+)-(\d+)$/.exec(item) ;
        if (!match) {
            return false ;
        }

        const level = match[1] ;
        if (!['qm', 'sf', 'f'].includes(level)) {
            return false ;
        }

        return Number(match[2]) > 0 && Number(match[3]) > 0 && Number(match[4]) > 0 ;
    }

    public provideResults(res: IPCNamedDataValue[], scoutItem?: string) {
        const effectiveScoutItem = scoutItem ?? this.pending_result_request_item_ ?? this.current_scout_ ;
        this.logSync('debug', 'ScoutProvideResults', {
            currentScout: this.current_scout_,
            requestedScoutItem: scoutItem,
            pendingRequestedScoutItem: this.pending_result_request_item_ ?? null,
            effectiveScoutItem: effectiveScoutItem,
            resultCount: res.length,
        }) ;

        if (!this.isValidScoutItemId(effectiveScoutItem)) {
            this.logSync('warn', 'ScoutProvideResultsDropped', {
                reason: 'invalid-current-scout-item',
                currentScout: this.current_scout_,
                requestedScoutItem: scoutItem,
            }) ;
            this.sendToRenderer('set-status-title', 'Invalid Local Scout State') ;
            this.sendToRenderer('set-status-visible', true) ;
            this.sendToRenderer('set-status-text', 'Cannot save scouting results because no valid scout item is active. Please reopen the item and try again.') ;
            this.sendToRenderer('set-status-close-button-visible', true) ;

            if (this.resultPromiseResolve_) {
                this.resultPromiseResolve_() ;
                this.resultPromiseResolve_ = undefined ;
            }
            this.pending_result_request_item_ = undefined ;
            return ;
        }

        this.addResults(effectiveScoutItem, this.filterResults(res)) ;
        this.writeEventFile() ;
        this.logger_.silly('provideResults:' + effectiveScoutItem, res) ;

        if (this.resultPromiseResolve_) {
            // If there is a promise waiting for results, resolve it now.
            this.resultPromiseResolve_() ;
            this.resultPromiseResolve_ = undefined ;
        }
        this.pending_result_request_item_ = undefined ;
    }

    public sendForm(type: string) {
        if (this.current_scout_ === undefined) {
            throw new Error('No current scout set - cannot send form') ;
        }

        let data: IPCScoutResult | undefined = this.getOneScoutResults(this.current_scout_!) ;
        let good : boolean = true ;
        let ret : IPCFormScoutData = {
            message: undefined,
            reversed: this.reversed_,
            color: this.alliance_,
            title: this.current_scout_,
            draftKey: this.createDraftKey(type, this.current_scout_),
            initialValues: this.cloneNamedDataValues(data?.data) ?? [],
            eventUuid: this.info_.uuid_,
            scoutItem: this.current_scout_,
        }

        if (type === 'team') {
            ret.form = this.info_.teamform_
        }
        else if (type === 'match') {
            ret.form = this.info_.matchform_ ;
            let teamScoutItem = this.getTeamScoutItemFromMatch(this.current_scout_) ;
            if (teamScoutItem) {
                ret.activeTeamResult = this.cloneScoutResult(this.getTeamResultFromCache(teamScoutItem)) ;
                if (!ret.activeTeamResult) {
                    ret.activeTeamResult = this.cloneScoutResult(this.getOneScoutResults(teamScoutItem)) ;
                }
            }
        }
        else {
            ret.message = 'Invalid form type requested' ;
            good = false ;
        }

        if (good) {
            this.sendToRenderer('send-form', ret);
        }
    }

    private createDraftKey(type: string, scoutItem: string) : string {
        let parts = [
            'scout',
            this.info_.uuid_ || 'nouuid',
            this.info_.tablet_ || 'notablet',
            type || 'notype',
            scoutItem || 'noscoutitem',
        ] ;

        return parts.join(':') ;
    }

    public sendImageData(image: string) {
		super.sendImageData(image) ;
	}

    public sendMatchForm() {
        let ret = {
            formjson: null,
            title: "",
            errormsg: "",
        } ;

        if (this.info_.matchform_) {
            ret.formjson = this.info_.matchform_ ;
            if (this.current_scout_) {
                ret.title = this.current_scout_ ;
            }
            else {
                ret.title = 'UNKNOWN' ;
            }
            this.sendToRenderer('send-match-form', ret) ;
        }

        let data: any = this.getOneScoutResults(this.current_scout_!) ;
        this.logger_.silly('sendTeamForm/send-result-values: ' + this.current_scout_, data) ;
        if (data) {
            this.sendToRenderer('send-result-values', data) ;
        }
    }

    private getOneScoutResults(scout: string) : IPCScoutResult | undefined {
        for(let result of this.info_.results_) {
            if (result.item === scout) {
                return result ;
            }
        }
        return undefined ;
    }

    private deleteResults(scout: string) {
        for(let i = 0 ; i < this.info_.results_.length ; i++) {
            if (this.info_.results_[i].item && this.info_.results_[i].item === scout) {
                this.info_.results_.splice(i, 1) ;
                break ;
            }
        }
    }
    
    private addResults(scout: string, result: IPCNamedDataValue[]) {
        if (!this.isValidScoutItemId(scout)) {
            this.logSync('warn', 'ScoutAddResultsDropped', {
                reason: 'invalid-scout-item-id',
                scout: scout,
            }) ;
            return ;
        }

        let resobj : IPCScoutResult = {
            item: scout,
            data: this.cloneNamedDataValues(result) ?? []
        } ;

        //
        // Optionally delete result if it already exists, we are providing new data.
        //
        this.deleteResults(scout) ;
        this.info_.results_.push(resobj) ;
        if (scout.startsWith('st-')) {
            this.cacheTeamResult(resobj) ;
        }
    }

    private getCurrentResults() : Promise<void> {
        let ret = new Promise<void>((resolve, reject) => {
            this.resultPromiseResolve_ = resolve ;
            this.pending_result_request_item_ = this.current_scout_ ;
            this.sendToRenderer('request-results', { scoutItem: this.current_scout_ }) ;
        }) ;
        return ret;
    }

    private buildScoutResultsPayload() : IPCScoutResults {
        return {
            tablet: this.info_.tablet_!,
            purpose: this.info_.purpose_!,
            results: this.info_.results_
        } ;
    }

    private findFirstResultIndexFromErrors(errors: string[]) : number | undefined {
        for (let err of errors) {
            let match = /results\[(\d+)\]/.exec(err) ;
            if (match) {
                return +match[1] ;
            }
        }

        return undefined ;
    }

    private buildValidationDiagnosticDump(title: string, errors: string[]) : string | undefined {
        if (title !== 'Invalid Local Sync Data') {
            return undefined ;
        }

        let index = this.findFirstResultIndexFromErrors(errors) ;
        let failingResult = undefined ;
        if (index !== undefined && index >= 0 && index < this.info_.results_.length) {
            failingResult = this.info_.results_[index] ;
        }

        let dump = {
            title: title,
            errors: errors,
            currentScout: this.current_scout_ ?? null,
            tablet: this.info_.tablet_,
            purpose: this.info_.purpose_,
            eventUuid: this.info_.uuid_,
            resultsCount: this.info_.results_.length,
            failingResultIndex: index,
            failingResult: failingResult,
        } ;

        return JSON.stringify(dump, null, 2) ;
    }

    private showSyncValidationError(title: string, errors: string[]) {
        let message = summarizeValidationErrors(errors) ;
        let dump = this.buildValidationDiagnosticDump(title, errors) ;
        if (dump) {
            message += '\n\nDiagnostic JSON (copy/paste):\n' + dump ;
        }

        this.logSync('error', 'ScoutSyncValidationFailed', {
            title: title,
            errorCount: errors.length,
            errors: errors,
        }) ;
        this.sendToRenderer('set-status-title', title) ;
        this.sendToRenderer('set-status-visible', true) ;
        this.sendToRenderer('set-status-text', message) ;
        this.sendToRenderer('set-status-close-button-visible', true) ;
    }

    private syncClient(conn: SyncClient) {
        this.optionallyGetResults()
        .then(() => {
            if (this.info_.tablet_ && this.info_.purpose_) {
                const preflight = validateScoutSyncPreflight(this.buildScoutResultsPayload()) ;
                if (!preflight.ok) {
                    this.showSyncValidationError('Invalid Local Sync Data', preflight.errors) ;
                    return ;
                }
            }

            this.match_results_received_ = false ;
            this.team_results_received_ = false ;
            this.team_form_received_ = false ;
            this.match_form_received_ = false ;
            this.match_list_received_ = false ;
            this.team_list_received_ = false ;
            this.playoff_assignment_received_ = false ;
            this.playoff_status_received_ = false ;

            this.conn_ = conn ;
            this.refreshSyncTrace() ;
            this.conn_.setTraceContext(this.sync_trace_) ;
            this.logSync('info', 'ScoutSyncConnectAttempt', {
                connector: conn.name(),
                state: this.getSyncStateSnapshot(),
            }) ;
            conn.connect()
                .then(async ()=> {
                    this.logSync('info', 'ScoutSyncConnected', {
                        connector: conn.name(),
                    }) ;
                    let data = new Uint8Array(0) ;

                    if (this.info_.tablet_ && this.info_.purpose_) {
                        let obj = {
                            name: this.info_.tablet_,
                            purpose: this.info_.purpose_
                        }
                        const helloPayload = stringifyScoutHelloPayload(obj) ;
                        if (!helloPayload.ok) {
                            this.showSyncValidationError('Invalid Local Sync Data', helloPayload.errors) ;
                            this.conn_?.close() ;
                            return ;
                        }
                        data = Buffer.from(helloPayload.value) ;
                    }
                    this.refreshSyncTrace() ;
                    this.conn_!.setTraceContext(this.sync_trace_) ;

                    this.conn_!.on('close', () => {
                        this.logSync('info', 'ScoutConnectionClosed') ;
                        this.conn_ = undefined ;
                    }) ;

                    let p: PacketObj = new PacketObj(PacketType.HelloFromScouter, data) ;

                    this.conn_!.on('error', (err: Error) => {
                        let msg: string = "" ;
                        let a: any = err as any ;
                        if (a.errors) {
                            for(let cerror of a.errors) {
                                this.logger_.info('ScouterSync: error from connection \'' + conn.name() + '\' - ' + cerror.message) ;
                                msg += cerror.message + '\n' ;
                            }
                        }
                        else {
                            this.logger_.info('ScouterSync: error from connection \'' + conn.name() + '\' - ' + err.message) ;
                            msg = err.message ;
                        }

                        this.logSync('error', 'ScoutConnectionError', {
                            message: msg,
                            state: this.getSyncStateSnapshot(),
                        }) ;
                        this.sendToRenderer('set-status-title', 'Error Connecting To XeroScout Central') ;
                        this.sendToRenderer('set-status-visible', true) ;
                        this.sendToRenderer('set-status-text', msg) ;
                        this.sendToRenderer('set-status-close-button-visible', true) ;
                    }) ;

                    this.conn_!.on('packet', (p: PacketObj) => {
                        this.syncTablet(p) ;
                    }) ;

                    this.logSync('info', 'ScoutHandshakeSendHello', packetSummary(p)) ;
                    await this.conn_!.send(p) ;
                })
                .catch((err) => {
                    this.logSync('error', 'ScoutConnectFailed', {
                        message: err.message,
                        state: this.getSyncStateSnapshot(),
                    }) ;
                }) ;
        })
        .catch((err) => {
            this.logSync('error', 'ScoutPreSyncResultsFailed', {
                message: err.message,
            }) ;
        }) ;
    }

    private uuidToFileName(uuid: string) : string {
        return uuid ;
    }

    private syncTablet(p: PacketObj) {
        let ret = true ;
        this.logSync('info', 'ScoutPacketReceived', packetSummary(p)) ;

        if (p.type_ === PacketType.HelloFromScouter) {
            const parsed = parseHelloResponsePayload(p.payloadAsString(), 'HelloFromScouter') ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                this.conn_?.close() ;
                return ;
            }

            const obj = parsed.value ;
                if (this.info_.uuid_ && obj.uuid !== this.info_.uuid_) {
                    //
                    // We have an event loaded and it does not match
                    //
                    this.logSync('warn', 'ScoutSyncEventMismatch', {
                        localEventUuid: this.info_.uuid_,
                        remoteEventUuid: obj.uuid,
                    }) ;
                    this.sendToRenderer('set-status-title', 'Error Connecting To XeroScout Central') ;
                    this.sendToRenderer('set-status-visible', true) ;
                    this.sendToRenderer('set-status-text', 'The loaded event does not match event being synced - reset the tablet to sync to this new event.') ;
                    this.sendToRenderer('set-status-close-button-visible', true) ;
                    this.conn_!.close() ;
                    return ;
                }

                if (this.info_.tablet_) {
                    //
                    // The current tablet already has an identity.  See if we are missing things ...
                    //
                    this.logSync('info', 'ScoutHelloAcceptedExistingTablet', {
                        remoteEventUuid: obj.uuid,
                        remoteEventName: obj.name,
                    }) ;
                    this.getMissingData() ;
                    if (!this.info_.evname_) {
                        this.info_.evname_ = obj.name ;
                    }
                }
                else {
                    this.info_.uuid_ = obj.uuid ;
                    this.info_.evname_ = obj.name;
                    let p: PacketObj = new PacketObj(PacketType.RequestTablets) ;
                    this.refreshSyncTrace() ;
                    this.logSync('info', 'ScoutRequestingTablets', packetSummary(p)) ;
                    this.conn_!.send(p) ;
                }
        }
        else if (p.type_ === PacketType.ProvideTablets) {
            const parsed = parseTabletsPayload(p.payloadAsString()) ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            this.tablets_ = parsed.value ;
            this.logSync('info', 'ScoutTabletsReceived', {
                tabletCount: this.tablets_?.length ?? 0,
            }) ;
            this.setView('select-tablet') ;
        }
        else if (p.type_ === PacketType.ProvideTeamForm) {
            const parsed = parseFormPayload(p.payloadAsString(), 'ProvideTeamForm') ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            this.info_.teamform_ = parsed.value ;
            this.team_form_received_ = true ;
            this.writeEventFile() ;
            ret = this.getMissingData() ;            
        }
        else if (p.type_ === PacketType.ProvideMatchForm) {
            const parsed = parseFormPayload(p.payloadAsString(), 'ProvideMatchForm') ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            this.info_.matchform_ = parsed.value ;
            this.match_form_received_ = true ;
            this.writeEventFile() ;
            ret = this.getMissingData() ;  
        }
        else if (p.type_ === PacketType.ProvideTeamList) {
            const parsed = parseTeamAssignmentsPayload(p.payloadAsString()) ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            this.info_.teamlist_ = parsed.value as TeamTablet[] ;
            this.team_list_received_ = true ;
            this.writeEventFile() ;
            ret = this.getMissingData() ;  
        }
        else if (p.type_ === PacketType.ProvidePlayoffAssignments) {
            const parsed = parsePlayoffAssignmentsPayload(p.payloadAsString()) ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            let obj = parsed.value ;
            if (obj !== null) {
                this.info_.playoff_assignments_ = obj as PlayoffAssignment[] ;
                this.writeEventFile() ;
                this.checkPlayoffMatchGeneration();
            }
            else {
                this.info_.playoff_assignments_ = undefined ;
                this.logSync('info', 'ScoutPlayoffAssignmentsUnavailable') ;
            }

            this.playoff_assignment_received_ = true ;
            this.getMissingData() ;
        }
        else if (p.type_ === PacketType.ProvidePlayoffStatus) {
            const parsed = parsePlayoffStatusPayload(p.payloadAsString()) ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            let obj = parsed.value ;
            if (obj !== null) {
                this.info_.playoff_status_ = obj ;
                this.writeEventFile() ;
                this.checkPlayoffMatchGeneration();                
            }
            else {
                this.info_.playoff_status_ = undefined ;
                this.logSync('info', 'ScoutPlayoffStatusUnavailable') ;
            }

            this.playoff_status_received_ = true ;
            this.getMissingData() ;
        }        
        else if (p.type_ === PacketType.ProvideMatchList) {
            const parsed = parseMatchAssignmentsPayload(p.payloadAsString()) ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            this.info_.matchlist_ = parsed.value as MatchTablet[] ;
            this.match_list_received_ = true ;
            this.writeEventFile() ;
            ret = this.getMissingData() ;  
        }
        else if (p.type_ === PacketType.ProvideImages) {
            const parsed = parseImagesPayload(p.payloadAsString()) ;
            if (!parsed.ok) {
                this.logSync('warn', 'ScoutProvideImagesInvalidShape', {
                    errors: parsed.errors,
                }) ;
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                ret = this.getMissingData() ;
                return ;
            }

            const obj = parsed.value ;
            for (let imname of Object.keys(obj)) {
                const result = this.image_mgr_.addSyncedImage(imname, obj[imname]) ;
                if (!result.ok) {
                    this.logger_.warn(`SyncTablet: skipping synced image '${imname}' - ${result.reason}`) ;
                }
            }
            ret = this.getMissingData() ;  
        }
        else if (p.type_ === PacketType.ProvideMatchResults) {
            const parsed = parseScoutResultArrayPayload(p.payloadAsString(), 'ProvideMatchResults') ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            if (this.info_.purpose_ === 'match') {
                let obj = parsed.value ;
                for(let res of obj) {
                    if (res.item && !this.getOneScoutResults(res.item)) {
                        this.addResults(res.item, res.data) ;
                    }
                }
            }
            this.match_results_received_ = true ;
            this.writeEventFile() ;
            ret = this.getMissingData() ;  
        }
        else if (p.type_ === PacketType.ProvideTeamResults) {
            const parsed = parseScoutResultArrayPayload(p.payloadAsString(), 'ProvideTeamResults') ;
            if (!parsed.ok) {
                this.showSyncValidationError('Invalid Sync Data From Central', parsed.errors) ;
                return ;
            }
            let obj = parsed.value ;
            for(let res of obj) {
                if (!res.item) {
                    continue ;
                }
                this.cacheTeamResult(res) ;
                if (this.info_.purpose_ === 'team') {
                    if (!this.getOneScoutResults(res.item)) {
                        this.addResults(res.item, res.data) ;
                    }
                }
            }
            this.team_results_received_ = true ;
            this.writeEventFile() ;
            ret = this.getMissingData() ;  
        }
        else if (p.type_ === PacketType.GoodbyeFromScouter) {
            this.conn_?.close() ;
        }
        else if (p.type_ === PacketType.ReceivedResults) {
            this.logSync('info', 'ScoutResultsAcknowledged', {
                tablet: this.info_.tablet_,
            }) ;
            this.conn_?.send(new PacketObj(PacketType.GoodbyeFromScouter, Buffer.from(this.info_.tablet_!))) ;
            this.conn_?.close() ;
        }
        else if (p.type_ === PacketType.Error) {
            this.logSync('error', 'ScoutReceivedErrorPacket', {
                payload: p.payloadAsString(),
            }) ;
            this.sendToRenderer('set-status-title', 'Error Syncing With XeroScout Central') ;
            this.sendToRenderer('set-status-visible', true) ;
            this.sendToRenderer('set-status-text', p.payloadAsString()) ;
            this.sendToRenderer('set-status-close-button-visible', true) ;
        }
    }

    private sendScoutingData() {
        let obj : IPCScoutResults = this.buildScoutResultsPayload() ;
        let serialized = stringifyScoutResultsPayload(obj) ;
        if (!serialized.ok) {
            this.showSyncValidationError('Invalid Local Sync Data', serialized.errors) ;
            this.conn_?.close() ;
            return ;
        }

        let jsonstr = serialized.value ;
        this.logSync('info', 'ScoutSendingResults', {
            tablet: obj.tablet,
            purpose: obj.purpose,
            resultCount: obj.results.length,
            payloadBytes: Buffer.byteLength(jsonstr),
        }) ;
        this.conn_?.send(new PacketObj(PacketType.ProvideResults, Buffer.from(jsonstr))) ;
    }

    private needMatchResults() : string[] {
        let ret : string[] = [] ;

        for(let m of this.info_.matchlist_!) {
            let cmd: string = 'sm-' + m.comp_level + '-' + m.set_number + '-' + m.match_number + '-' + m.teamnumber ;
            if (this.info_.results_) {
                let res: IPCScoutResult | undefined = this.getOneScoutResults(cmd) ;
                if (!res) {
                    ret.push(cmd) ;
                }
            }
        }
        return ret ;
    }

    private needTeamResults() : string[] {
        let ret : string[] = [] ;

        if (this.info_.purpose_ === 'match') {
            for(let t of this.info_.teamlist_!) {
                ret.push('st-' + t.team) ;
            }
            return ret ;
        }

        for(let t of this.info_.teamlist_!) {
            let cmd: string = 'st-' + t.team ;
            if (this.info_.team_results_cache_) {
                let res: IPCScoutResult | undefined = this.getTeamResultFromCache(cmd) ;
                if (!res) {
                    ret.push(cmd) ;
                }
            }
        }
        return ret ;
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

    private getRequiredImagesFromSection(section: IPCSection) : string[] {
        let ret : string [] = [] ;
        for(let item of section.items) {
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

        return [...new Set(ret)] ;
    }

    private getRequiredImagesFromForm(form: IPCForm) : string[] {
        let ret : string[] = [] ;
        for(let section of form.sections) {
            ret = [...ret, ... this.getRequiredImagesFromSection(section)];
        }

        return ret ;
    }

    private needImages() : string [] {
        let images: string[] = [ 
                ...this.getRequiredImagesFromForm(this.info_.teamform_), 
                ... this.getRequiredImagesFromForm(this.info_.matchform_)] ;

        let imlist = [...new Set(images)];
        let ret: string[] = [] ;

        for(let im of imlist) {
            if (!this.image_mgr_.hasImage(im)) {
                ret.push(im) ;
            }
        }

        return ret ;
    }

    private getMissingData() {
        let ret: boolean = false ;
        this.refreshSyncTrace() ;

        if (!this.team_form_received_) {
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestTeamForm',
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestTeamForm)) ;
            ret = true ;
        }
        else if (!this.match_form_received_) {
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestMatchForm',
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestMatchForm)) ;
            ret = true ;
        }
        else if (!this.match_list_received_) {
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestMatchList',
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestMatchList)) ;
            ret = true ;
        }
        else if (!this.team_list_received_) {
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestTeamList',
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestTeamList)) ;
            ret = true ;
        }
        else if (!this.match_results_received_ && this.needMatchResults().length > 0) {
            const missing = this.needMatchResults() ;
            const payload = stringifyStringArrayPayload(missing, 'RequestMatchResults') ;
            if (!payload.ok) {
                this.showSyncValidationError('Invalid Local Sync Data', payload.errors) ;
                return ret ;
            }
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestMatchResults',
                requestedCount: missing.length,
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestMatchResults, Buffer.from(payload.value))) ;
            ret = true ;
        }
        else if (!this.team_results_received_ && this.needTeamResults().length > 0) {
            const missing = this.needTeamResults() ;
            const payload = stringifyStringArrayPayload(missing, 'RequestTeamResults') ;
            if (!payload.ok) {
                this.showSyncValidationError('Invalid Local Sync Data', payload.errors) ;
                return ret ;
            }
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestTeamResults',
                requestedCount: missing.length,
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestTeamResults, Buffer.from(payload.value))) ;
            ret = true ;
        }
        else if (this.needImages().length > 0) {
            const missing = this.needImages() ;
            const payload = stringifyStringArrayPayload(missing, 'RequestImages') ;
            if (!payload.ok) {
                this.showSyncValidationError('Invalid Local Sync Data', payload.errors) ;
                return ret ;
            }
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestImages',
                requestedCount: missing.length,
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestImages, Buffer.from(payload.value))) ;
            ret = true ;            
        }
        else if (!this.info_.playoff_assignments_ && !this.playoff_assignment_received_) {
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestPlayoffAssignments',
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestPlayoffAssignments)) ;
            ret = true ;              
        }
        else if (!this.playoff_status_received_) {
            this.logSync('debug', 'ScoutMissingDataRequest', {
                nextRequest: 'RequestPlayoffStatus',
                state: this.getSyncStateSnapshot(),
            }) ;
            this.conn_?.send(new PacketObj(PacketType.RequestPlayoffStatus)) ;
            ret = true ;              
        }

        if (!ret) {
            this.logSync('info', 'ScoutMissingDataComplete', {
                state: this.getSyncStateSnapshot(),
            }) ;
            this.checkPlayoffMatchGeneration() ;
            this.sendNavData() ;
            this.setViewString() ;
            this.sendScoutingData() ;
        }

        return ret ;
    }

    public mainWindowLoaded(): void {
        this.appInit() ;
        this.setViewString() ;
        
        let v = this.getVersion('application') ;
        this.sendToRenderer('send-app-status', { 
            left: `Xero Scouter ${this.versionToString(v)}`,
            middle: this.info_.evname_ ? this.info_.evname_ : 'No Event Loaded',
            right: this.info_.uuid_ ? this.info_.uuid_ : ''
        }) ;
    }    

    private setViewString() {
        if (this.info_.uuid_) {
            this.sendToRenderer('tablet-title', this.info_.tablet_) ;
        }
        else {
            this.setView('text', 'No Event Loaded') ;
        }
    }

    private reverseImage() {
        this.reversed_ = this.reverseImage_!.checked ;
        this.current_scout_ = undefined ;
        if (this.info_.uuid_) {
            this.setViewString() ;
        }
        else {
            this.setView('empty') ;
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
            click: () => { this.executeCommand(SCScout.syncEventLocal)}
        }) ;
        filemenu.submenu?.insert(0, synctcpitem) ;

        synctcpitem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event Cable (192.168.1.1)',
            click: () => { this.executeCommand(SCScout.syncEventRemote)}
        }) ;
        filemenu.submenu?.insert(1, synctcpitem) ;

        synctcpitem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event WiFi (mDNS)',
            click: () => { this.executeCommand(SCScout.syncEventWiFi)}
        }) ;
        filemenu.submenu?.insert(2, synctcpitem) ;    
        
        synctcpitem = new MenuItem( {
            type: 'normal',
            label: 'Sync Event IP Address (Manual)',
            click: () => { this.executeCommand(SCScout.syncEventIPAddr)}
        }) ;
        filemenu.submenu?.insert(3, synctcpitem) ;          

        filemenu.submenu?.insert(4, new MenuItem({type: 'separator'}));        

        ret.append(filemenu) ;

        let editmenu: MenuItem = new MenuItem({
            type: 'submenu',
            role: 'editMenu',
            label: 'Edit',
        }) ;
        ret.append(editmenu) ;

        let resetmenu: MenuItem = new MenuItem({
            type: 'submenu',
            label: 'Reset',
            submenu: new Menu()
        }) ;

        let resetitem: MenuItem = new MenuItem( {
            type: 'normal',
            label: 'Reset Current Match',
            click: () => { this.executeCommand(SCScout.resetCurrentMatch)}
        }) ;
        resetmenu.submenu?.insert(0, resetitem) ;

        resetitem = new MenuItem( {
            type: 'normal',
            label: 'Reset Tablet',
            click: () => { this.executeCommand(SCScout.resetTablet)}
        }) ;
        resetmenu.submenu?.insert(1, resetitem) ;
        ret.append(resetmenu);    

        let optionmenu: MenuItem = new MenuItem({
            type: 'submenu',
            label: 'Options',
            submenu: new Menu()
        }) ;
    
        this.reverseImage_ = new MenuItem({
            type: 'checkbox',
            label: 'Reverse',
            checked: false,
            click: () => { this.executeCommand(SCScout.reverseImage)}
          }) ;
        optionmenu.submenu!.append(this.reverseImage_) ;
        ret.append(optionmenu);        
        
        let viewmenu: MenuItem = new MenuItem( {
            type: 'submenu',
            role: 'viewMenu'
        }) ;
        viewmenu.submenu?.append(new MenuItem({type: 'separator'}));

        viewmenu.submenu?.append(new MenuItem({
            type: 'normal',
            label: 'Resize Window',
            click: () => { this.executeCommand(SCScout.resizeWindow)}
        })) ;

        this.show_teams_item_ = new MenuItem({
            type: 'checkbox',
            label: 'Show Teams',
            click: () => { this.executeCommand(SCScout.showTeams)}
        }) ;
        if (this.show_teams_) {
            this.show_teams_item_.checked = true ;
        }
        viewmenu.submenu?.append(this.show_teams_item_) ;

        viewmenu.submenu?.append(new MenuItem({type: 'separator'}));

        this.show_full_team_names_item_ = new MenuItem({
            type: 'checkbox',
            label: 'Show Full Team Names',
            click: () => { this.executeCommand(SCScout.showFullTeamNames)}
        }) ;
        if (this.show_full_team_names_) {
            this.show_full_team_names_item_.checked = true ;
        }
        viewmenu.submenu?.append(this.show_full_team_names_item_) ;
        ret.append(viewmenu) ;

        let helpmenu: MenuItem = new MenuItem( {
            type: 'submenu',
            label: 'Help',
            submenu: new Menu(),
        }) ;

        helpmenu.submenu?.append(new MenuItem({
            type: 'normal',
            label: 'Check For Updates',
            click: () => { this.checkForUpdates() ; }
        })) ;

        let aboutitem: MenuItem = new MenuItem( {
            type: 'normal',
            label: 'About',
            click: () => { this.showAbout() }
        }) ;
        helpmenu.submenu?.append(aboutitem) ;

        ret.append(helpmenu) ;

        return ret;
    }    

    public sendTabletData() : void {
        if (!this.tablets_) {
            return ;
        }

        if (this.tablet_data_send_timer_) {
            return ;
        }

        // Defer the reply one turn so the select-tablet view can finish attaching
        // its element before the dialog tries to position relative to it.
        this.tablet_data_send_timer_ = setTimeout(() => {
            this.tablet_data_send_timer_ = undefined ;
            if (this.tablets_) {
                this.sendToRenderer('send-tablet-data', this.tablets_) ;
            }
        }, 0) ;
    }

    public setTabletNamePurpose(name: string, purpose: string) : void {
        this.tablets_ = undefined ;
        this.info_.tablet_ = name ;
        this.info_.purpose_ = purpose ;
        this.refreshSyncTrace() ;
        this.logSync('info', 'ScoutTabletAssigned', {
            tablet: name,
            purpose: purpose,
        }) ;

        this.sendToRenderer('tablet-title', this.info_.tablet_) ;

        this.writeEventFile() ;
        this.getMissingData() ;
    }

    private checkLastEvent() {
        if (this.hasSetting(SCScout.last_event_setting)) {
            try {
                let fname = this.getSetting(SCScout.last_event_setting) ;
                let fullpath: string = path.join(this.appdir_, fname) ;
                this.readEventFile(fullpath) ;
            }
            catch(err) {
                let errobj: Error = err as Error ;
                dialog.showMessageBoxSync(this.win_, {
                    title: 'Error starting scout computer',
                    message: 'Error reading default event - this tablet has been reset.\nError: ' + errobj.message
                }) ;
                this.resetTabletCmd() ;
            }
        }
    }

    private readEventFile(fullpath: string) : Error | undefined {
        let ret : Error | undefined = undefined ;

        const rawData = fs.readFileSync(fullpath, 'utf-8');
        this.info_ = JSON.parse(rawData) as SCScoutInfo ;
        if (!this.info_.results_) {
            this.info_.results_ = [] ;
        }
        if (!this.info_.team_results_cache_) {
            this.info_.team_results_cache_ = [] ;
        }

        return ret ;
    }

    private getTeamScoutItemFromMatch(matchItem: string) : string | undefined {
        let match = /^sm-[^-]+-\d+-\d+-(\d+)$/.exec(matchItem) ;
        if (!match) {
            return undefined ;
        }
        return 'st-' + match[1] ;
    }

    private getTeamResultFromCache(item: string) : IPCScoutResult | undefined {
        for(let result of this.info_.team_results_cache_) {
            if (result.item === item) {
                return this.cloneScoutResult(result) ;
            }
        }
        return undefined ;
    }

    private cacheTeamResult(result: IPCScoutResult) {
        if (!result.item || !result.item.startsWith('st-')) {
            return ;
        }

        const cloned = this.cloneScoutResult(result) ;
        if (!cloned) {
            return ;
        }

        for(let i = 0 ; i < this.info_.team_results_cache_.length ; i++) {
            if (this.info_.team_results_cache_[i].item === result.item) {
                this.info_.team_results_cache_[i] = cloned ;
                return ;
            }
        }

        this.info_.team_results_cache_.push(cloned) ;
    }

    private cloneNamedDataValues(values?: IPCNamedDataValue[]) : IPCNamedDataValue[] | undefined {
        if (!values) {
            return undefined ;
        }

        return JSON.parse(JSON.stringify(values)) as IPCNamedDataValue[] ;
    }

    private cloneScoutResult(result?: IPCScoutResult) : IPCScoutResult | undefined {
        if (!result) {
            return undefined ;
        }

        return JSON.parse(JSON.stringify(result)) as IPCScoutResult ;
    }

    private writeEventFile() : Error | undefined {
        let ret : Error | undefined ;

        let filename = this.uuidToFileName(this.info_.uuid_!) ;
        this.setSetting(SCScout.last_event_setting, filename) ;

        const jsonString = JSON.stringify(this.info_);
        let projfile = path.join(this.appdir_, filename) ;
        fs.writeFile(projfile, jsonString, (err) => {
            if (err) {
                this.unsetSettings(SCScout.last_event_setting) ;
                fs.rmSync(projfile) ;   
                ret = err ;
            }
        });
        return ret;
    }

    private beginSyncTrace(pathName: string, host: string, port: number) {
        this.sync_trace_ = {
            sessionId: createSyncSessionId(),
            role: 'scout',
            transport: 'tcp',
            path: pathName,
            host: host,
            port: port,
            tablet: this.info_.tablet_,
            purpose: this.info_.purpose_,
            eventUuid: this.info_.uuid_,
        } ;
        this.logSync('info', 'ScoutSyncSessionStarted', {
            state: this.getSyncStateSnapshot(),
        }) ;
    }

    private refreshSyncTrace() {
        if (!this.sync_trace_) {
            return ;
        }

        this.sync_trace_.tablet = this.info_.tablet_ ;
        this.sync_trace_.purpose = this.info_.purpose_ ;
        this.sync_trace_.eventUuid = this.info_.uuid_ ;
    }

    private getSyncStateSnapshot() {
        return {
            tablet: this.info_.tablet_,
            purpose: this.info_.purpose_,
            eventUuid: this.info_.uuid_,
            teamFormReceived: this.team_form_received_,
            matchFormReceived: this.match_form_received_,
            teamListReceived: this.team_list_received_,
            matchListReceived: this.match_list_received_,
            teamResultsReceived: this.team_results_received_,
            matchResultsReceived: this.match_results_received_,
            playoffAssignmentsReceived: this.playoff_assignment_received_,
            playoffStatusReceived: this.playoff_status_received_,
        } ;
    }

    private logSync(level: 'error' | 'warn' | 'info' | 'debug' | 'silly', event: string, extra?: Record<string, unknown>) {
        this.refreshSyncTrace() ;
        logSync(this.logger_, level, event, this.sync_trace_, extra) ;
    }

    private target2Alliance(target: string) : number | undefined {
        let ret: string = target ;

        if (target.startsWith('a')) {
            ret = target.substring(1) ;
        } else if (target.startsWith('l') || target.startsWith('w')) {
            let match = +target.substring(1) ;
            if (this.info_.playoff_status_ && this.info_.playoff_status_.outcomes) {
                let outcome = this.info_.playoff_status_.outcomes["m" + match.toString() as keyof IPCPlayoffStatus['outcomes']] ;
                if (outcome) {
                    if (target.startsWith('l')) {
                        ret = outcome.loser.toString() ;
                    } else if (target.startsWith('w')) {
                        ret = outcome.winner.toString() ;
                    }
                }
            }
        }

        if (/^a-zA-Z.*/.test(ret)) {
            return undefined ;
        } ;

        return +ret ;
    }

    private findPlayoffMatchAssignment(match: number) : PlayoffAssignment | undefined {
        if (!Array.isArray(this.info_.playoff_assignments_)) {
            return undefined ;
        }

        for(let a of this.info_.playoff_assignments_!) {
            if (a.match === match && a.tablet === this.info_.tablet_) {
                return a ;
            }
        }

        return undefined ;
    }

    private findMatchInList(match: number) : MatchTablet | undefined {
        for(let m of this.info_.matchlist_!) {
            if (m.comp_level === 'sf' && m.set_number === match && m.match_number === 1 && m.tablet === this.info_.tablet_) {
                return m ;
            }

            if (m.comp_level === 'f' && m.set_number === 1 && m.match_number === match - 13 && m.tablet === this.info_.tablet_) {
                return m ;
            }
        }

        return undefined ;
    }

    private findTeam(alliance: number, target: number) : number | undefined {
        if (this.info_.playoff_status_ && this.info_.playoff_status_.alliances) {
            if (Array.isArray(this.info_.playoff_status_.alliances) && this.info_.playoff_status_.alliances.length > alliance - 1) {
                let allianceData = this.info_.playoff_status_.alliances[alliance - 1] ;
                if (allianceData && Array.isArray(allianceData.teams) && allianceData.teams.length > target) {
                    return allianceData.teams[target] ;
                }
            }
        }

        return undefined ;
    }

    private createMatchFromAlliance(match: number, ralliance: number, balliance: number) {
        let a: PlayoffAssignment | undefined = this.findPlayoffMatchAssignment(match) ;
        if (!a) {
            // No assignment for this match, nothing to do.
            return ;
        }

        if (this.findMatchInList(match)) {
            // It's already in the list, no need to create it.
            return ;
        }

        let team = this.findTeam(a.alliance === 'red' ? ralliance : balliance, a.which) ;
        if (!team) {
            return ;
        }

        let mtype = (match < 14) ? 'sf' : 'f' ;
        let setno = (match < 14) ? match  : 1 ;
        let matchno = (match < 14) ? 1 : match - 13 ;
        let ma = new MatchTablet(mtype, matchno, setno, a.alliance, team, '?', this.info_.tablet_!) ;
        this.info_.matchlist_!.push(ma) ;

        this.writeEventFile() ;
    }

    private checkPlayoffMatchGeneration() {
        if (!Array.isArray(this.info_.playoff_assignments_)) {
            this.logSync('debug', 'ScoutPlayoffMatchGenerationSkipped', {
                reason: 'no-playoff-assignments',
            }) ;
            return ;
        }

        if (!this.info_.playoff_status_) {
            this.logSync('debug', 'ScoutPlayoffMatchGenerationSkipped', {
                reason: 'no-playoff-status',
            }) ;
            return ;
        }

        for(let m = 1 ; m <= 16 ; m++) {
            let match = kMatchAlliances[m-1] ;
            let ralliance = this.target2Alliance(match[0]) ;
            let balliance = this.target2Alliance(match[1]) ;

            if (ralliance && balliance) {
                this.createMatchFromAlliance(m, ralliance, balliance) ;
            }
        }

        this.sendNavData() ;
        this.setViewString() ;
    }   

    public setPlayoffMatchOutcome(match: number, winner: number, loser: number) : void {
        if (this.info_.playoff_status_) {
            let str = `m${match}` as keyof typeof this.info_.playoff_status_.outcomes ;
            this.info_.playoff_status_.outcomes[str] = {
                winner: winner,
                loser: loser,
            } ;
            this.checkPlayoffMatchGeneration() ;
            this.setView('playoffs', this.info_.playoff_status_)            
            this.writeEventFile() ;
            this.sendNavData() ;
        }
    }

    // Implementation of abstract promptString method - Scout app does not support user prompts
    public async promptString(title: string, message: string, defaultValue?: string, placeholder?: string): Promise<string | undefined> {
        // Scout app does not support user input prompts, always return undefined
        return Promise.resolve(undefined);
    }
}
