import { contextBridge, ipcRenderer,  } from 'electron';

const receiveWrapperMap = new Map<string, Map<any, (event: Electron.IpcRendererEvent, ...args: any[]) => void>>() ;

// Create a type that should contain all the data we need to expose in the
// renderer process using `contextBridge`.

// export type scoutingAPI = {
// }

//
// Expose our functions in the `api` namespace of the renderer `Window`.
//
contextBridge.exposeInMainWorld( 'scoutingAPI', {
  //
  // These go from the render process to the main process
  //
	    send: (channel: string, data: any) => {
	      let validChannels = [
        'splitter-changed',               // apps/xeroapp.ts
        'get-nav-data',                   // xeronav.ts
        'client-log',                    // renderer/src/utils/xerologger.ts
        'sync-ipaddr',                    // views/syncipaddr/syncipaddr.ts
        'get-info-data',                  // views/infoview.ts
        'get-formulas',                   // views/dataset/datasetedit.ts, views/dbview/dbview.ts, views/formulas/formulas.ts
        'delete-formula',                 // views/formulas/formulas.ts
        'rename-formula',                 // views/formulas/formulas.ts
        'update-formula',                 // views/formulas/formulas.ts
        'get-datasets',                   // views/dataset/datasetedit.ts, views/singleteam/singleteamview.ts
        'update-datasets',                // views/dataset/datasetedit.ts
        'generate-random-data',           // views/infoview.ts
        'set-event-name',                 // views/infoview.ts
        'get-event-data',                 // views/selectevent.ts
        'get-tablet-data',                // views/assigntablets.ts, views/selecttablet/selecttablet.ts
        'set-tablet-data',                // views/assigntablets.ts
        'get-team-data',                  // views/editteams/editteamsview.ts, views/editmatches/editmatchesview.ts
        'set-team-data',                  // views/editteams/editteamsview.ts
        'get-match-data',                 // views/editmatches/editmatchesview.ts
        'set-match-data',                 // views/editmatches/editmatchesview.ts
        'load-ba-event-data',             // views/selectevent.ts
        'execute-command',                // xeronav.ts, views/infoview.ts, views/editteams/editteamsview.ts, views/editmatches/editmatchesview.ts
        'get-form',                       // views/forms/editformview.ts, views/forms/scoutformview.ts
        'get-image-data',                 // apps/imagesrc.ts
        'get-image-names',                // apps/imagesrc.ts - NO HANDLER IN main.ts
        'save-form',                      // views/forms/editformview.ts
        'get-match-db',                   // views/dbview/dbview.ts
        'update-match-db',                // views/dbview/dbview.ts
        'send-match-col-config',          // views/dbview/dbview.ts
        'get-team-db',                    // views/dbview/dbview.ts
        'update-team-db',                 // views/dbview/dbview.ts
        'send-team-col-config',           // views/dbview/dbview.ts
        'get-team-status',                // views/teamstatus.ts
        'get-match-status',               // views/matchstatus.ts
        'set-tablet-name-purpose',        // views/selecttablet/selecttablet.ts
	        'provide-result',                 // views/forms/scoutformview.ts

	        'get-preview-match-db',           // views/forms/scoutformview.ts (central match form preview)
	        'update-preview-match-db',        // views/forms/scoutformview.ts (central match form preview)
	        'reset-preview-match-db',         // views/forms/scoutformview.ts (central match form preview)

        'get-match-field-list',           // views/formulas/formulas.ts
        'get-team-field-list',            // views/formulas/formulas.ts
        'get-auto-analysis-data',         // views/autoanalysis/autoanalysisview.ts
        'get-auto-analysis-configs',      // views/autoanalysis/autoanalysisview.ts
        'update-auto-analysis-configs',   // views/autoanalysis/autoanalysisview.ts
        'get-team-list',                  // views/playoffs/playoffs.ts
        'get-hint-db',                    // apps/hintmgr.ts
        'set-hint-hidden',                // apps/hintmgr.ts
        'get-playoff-status',             // views/playoffs/playoffs.ts
        'set-alliance-teams',             // views/playoffs/playoffs.ts
        'set-playoff-match-outcome',      // views/playoffs/playoffs.ts
        'get-match-format-formulas',      // views/dbview/dbview.ts
        'get-team-format-formulas',       // views/dbview/dbview.ts
        'set-match-format-formulas',      // views/dbview/dbview.ts
        'set-team-format-formulas',       // views/dbview/dbview.ts

        'get-single-team-configs',        // views/singleteam/singleteamview.ts
        'update-single-team-configs',     // views/singleteam/singleteamview.ts
        'get-matchsim-configs',           // views/matchpred/matchsim.ts
        'update-matchsim-configs',        // views/matchpred/matchsim.ts
        'get-multi-team-configs',         // views/multiteam/multiteamview.ts
        'update-multi-team-configs',      // views/multiteam/multiteamview.ts
        'get-match-configs',              // views/matchgraphs/matchgraphsview.ts
        'update-match-configs',           // views/matchgraphs/matchgraphsview.ts
        'get-chart-data',                 // views/matchgraphs/matchgraphsview.ts\
        
        'get-picklist-configs',            // views/picklist/picklistview.ts
        'save-picklist-config',           // views/picklist/picklistview.ts
        'get-picklist-data',              // views/picklist/picklistview.ts
        'prompt-string-request',          // views/autoanalysis/autoanalysisview.ts
        'prompt-string-response',         // apps/xeroapp.ts
        'get-match-predictor-data',       // views/matchpred/matchsim.ts
        'updater:check',                  // app update actions
        'updater:install',                // app update actions
        'updater:get-status',             // app update actions
	      ];
      if (validChannels.includes(channel)) {
        if (data) {
          ipcRenderer.send(channel, data);
        }
        else {
          ipcRenderer.send(channel) ;
        }
      }
  },

  //
  // These go from the main process to the renderer process
  //
  receiveOff: (channel: string, func:any) => {
    const wrappers = receiveWrapperMap.get(channel) ;
    const wrapper = wrappers?.get(func) ;
    if (wrapper) {
      ipcRenderer.off(channel, wrapper) ;
      wrappers!.delete(func) ;
      if (wrappers!.size === 0) {
        receiveWrapperMap.delete(channel) ;
      }
    }
  },

	  receive: (channel: string, func:any) => {
	      let validChannels = [
        'update-main-window-view',      // main/apps/scbase.ts
        'send-app-status',              // main/apps/sccentral.ts, main/apps/scscout.ts
        'send-nav-data',                // main/apps/sccentral.ts, main/apps/scscout.ts
        'send-nav-highlight',           // main/apps/scscout.ts
        'send-info-data',               // main/apps/sccentral.ts
        'send-formulas',                // main/apps/sccentral.ts
        'send-datasets',                // main/apps/sccentral.ts
        'send-event-data',              // main/apps/sccentral.ts
        'send-tablet-data',             // main/apps/sccentral.ts, main/apps/scscout.ts
        'send-team-data',               // main/apps/sccentral.ts
        'send-match-data',              // main/apps/sccentral.ts
        'send-form',                    // main/apps/sccentral.ts, main/apps/scscout.ts
        'send-images',                  // main/apps/scbase.ts, main/apps/sccentral.ts
        'send-image-data',              // main/apps/scbase.ts, main/apps/scscout.ts
        'send-initial-values',          // main/apps/scscout.ts
        'send-team-status',             // main/apps/sccentral.ts
        'send-match-status',            // main/apps/sccentral.ts
        'send-match-db',                // main/apps/sccentral.ts
	        'send-team-db',                 // main/apps/sccentral.ts
	        'send-preview-match-db',        // main/apps/sccentral.ts
        'xero-app-init',                // main/apps/scbase.ts
        'set-status-text',              // main/apps/sccentral.ts, main/apps/scscout.ts
        'set-status-html',              // main/apps/sccentral.ts
        'set-status-title',             // main/apps/sccentral.ts, main/apps/scscout.ts
        'set-status-visible',           // main/apps/sccentral.ts, main/apps/scscout.ts
        'set-status-close-button-visible', // main/apps/sccentral.ts, main/apps/scscout.ts
        'request-results',              // main/apps/scscout.ts
        'send-team-list',               // main/apps/sccentral.ts
        'send-team-field-list',         // main/apps/sccentral.ts
        'send-auto-analysis-data',      // main/apps/sccoachcentralbase.ts
        'send-auto-analysis-configs',   // main/apps/sccoachcentralbase.ts
        'send-match-field-list',        // main/apps/sccentral.ts
        'send-match-list',              // main/apps/sccentral.ts
        'send-stored-graph-list',       // main/apps/sccentral.ts
        'tablet-title',                 // main/apps/scscout.ts
        'resize-window',                // main/apps/scscout.ts

        'send-single-team-data',        // main/apps/sccentral.ts
        'send-hint-db',                 // main/apps/sccentral.ts
        'send-playoff-status',          // main/apps/sccentral.ts
        'send-match-format-formulas',   // main/apps/sccentral.ts
        'send-team-format-formulas',    // main/apps/sccentral.ts

        'send-single-team-configs',     // main/apps/sccentral.ts
        'send-matchsim-configs',        // main/apps/sccoachcentralbase.ts
        'send-multi-team-configs',      // main/apps/sccentral.ts
        'send-match-configs',           // main/apps/sccentral.ts
        'send-chart-data',              // main/apps/sccentral.ts

        'send-picklist-data',           // main/apps/sccentral.ts
        'send-picklist-configs',        // main/apps/sccentral.ts
        'prompt-string-request',        // main/apps/sccentral.ts
        'prompt-string-response',       // main/ipchandlers.ts
        'send-match-predictor-data',    // main/apps/sccoachcentralbase.ts
        'updater-status',               // app updater
      ];
      if (validChannels.includes(channel)) {
        let wrappers = receiveWrapperMap.get(channel) ;
        if (!wrappers) {
          wrappers = new Map() ;
          receiveWrapperMap.set(channel, wrappers) ;
        }

        if (wrappers.has(func)) {
          return ;
        }

        const wrapper = (event: Electron.IpcRendererEvent, ...args: any[]) => func(args[0][0]) ;
        wrappers.set(func, wrapper) ;
        ipcRenderer.on(channel, wrapper);
      }
  }
}) ;

contextBridge.exposeInMainWorld('updaterAPI', {
  checkForUpdates: () => ipcRenderer.send('updater:check'),
  installUpdate: () => ipcRenderer.send('updater:install'),
  requestStatus: () => ipcRenderer.send('updater:get-status'),
  onStatus: (func: any) => {
    const channel = 'updater-status';
    let wrappers = receiveWrapperMap.get(channel) ;
    if (!wrappers) {
      wrappers = new Map() ;
      receiveWrapperMap.set(channel, wrappers) ;
    }

    if (wrappers.has(func)) {
      return ;
    }

    const wrapper = (_event: Electron.IpcRendererEvent, ...args: any[]) => func(args[0][0]) ;
    wrappers.set(func, wrapper) ;
    ipcRenderer.on(channel, wrapper) ;
  },
  offStatus: (func: any) => {
    const channel = 'updater-status';
    const wrappers = receiveWrapperMap.get(channel) ;
    const wrapper = wrappers?.get(func) ;
    if (wrapper) {
      ipcRenderer.off(channel, wrapper) ;
      wrappers!.delete(func) ;
      if (wrappers!.size === 0) {
        receiveWrapperMap.delete(channel) ;
      }
    }
  }
}) ;
