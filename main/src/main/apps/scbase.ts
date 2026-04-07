import { app, BrowserWindow, dialog,Menu, } from "electron";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as winston from "winston";
import * as crypto from "crypto";
import settings from "electron-settings";
import { ImageManager } from "../imagemgr";
import { IPCAppInit, IPCAppType, IPCImageResponse, IPCSetView } from "../../shared/ipc";
import { appUpdater } from "../updater";

export interface XeroVersion {
	major: number;
	minor: number;
	patch: number;
}

export abstract class SCBase {
	private static readonly appdirName = ".xeroscout";
	private static readonly attribution: string =
				"Icons from Flaticon.com (https://www.flaticon.com/)\n" + 
				"Images from Freepik.com (https://www.freepik.com/)" ;

	protected typestr_: IPCAppType;
	protected win_: BrowserWindow;
	protected appdir_: string;
	protected content_dir_: string ;
	protected image_mgr_ : ImageManager ;
	public logger_: winston.Logger;
	public lastview_?: string ;
    protected logfileName_: string ;

	protected constructor(win: BrowserWindow, type: IPCAppType) {
		this.typestr_ = type;
		this.win_ = win;
		this.appdir_ = path.join(os.homedir(), SCBase.appdirName);
		this.content_dir_ = path.join(process.cwd(), 'content') ;
		this.image_mgr_ = new ImageManager(type, type === 'central' ? path.join(this.content_dir_, 'images') : undefined) ;

		if (!fs.existsSync(this.appdir_)) {
			fs.mkdirSync(this.appdir_);
		}

		let logdir = path.join(this.appdir_, "logs");
		if (!fs.existsSync(logdir)) {
			fs.mkdirSync(logdir);
		}

		let logfileName;

		if (this.isDevelop) {
			logfileName = path.join(logdir, "xeroscout-" + this.typestr_ + ".txt");
		} else {
			logfileName = this.createUniqueFilename(
				logdir,
				"xeroscout-" + this.typestr_
			);
			logfileName += ".txt";
		}

		if (fs.existsSync(logfileName)) {
			fs.rmSync(logfileName);
		}

		this.logfileName_ = logfileName;

		const normalizeStructuredLog = winston.format((info) => {
			if (typeof info.message === 'object' && info.message !== null && !Array.isArray(info.message)) {
				const messageObject = info.message as Record<string, unknown> ;
				info.message = typeof messageObject.message === 'string' ? messageObject.message : JSON.stringify(messageObject) ;
				for (const [key, value] of Object.entries(messageObject)) {
					if (key !== 'message' && !(key in info)) {
						(info as Record<string, unknown>)[key] = value ;
					}
				}
			}
			return info ;
		});

		this.logger_ = winston.createLogger({
			level: this.isDevelop ? "silly" : "info",
			format: winston.format.combine(
				normalizeStructuredLog(),
				winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss" }),
				winston.format.printf(
					(info) => {
						const rest: Record<string, unknown> = {} ;
						for (const [key, value] of Object.entries(info)) {
							if (!['timestamp', 'level', 'message'].includes(key) && value !== undefined) {
								rest[key] = value ;
							}
						}

						return `${JSON.stringify({
							timestamp: info.timestamp,
							level: info.level,
							message: info.message,
							...rest,
						})}` ;
					}
				)
			),
			transports: [new winston.transports.File({ filename: logfileName })],
		});

		this.logger_.info("AppStart", {
			logFile: this.logfileName_,
			appType: this.typestr_,
			electronVersion: this.getVersion("electron"),
			application: this.getVersion("application"),
			nodejs: this.getVersion("nodejs"),
		});
	}

	public abstract basePage(): string;
	public abstract sendNavData(): void;
	public abstract executeCommand(cmd: string): void;
	public abstract createMenu(): Menu | null;
	public abstract windowCreated(): void;
	public abstract canQuit(): boolean;
	public abstract close() : void ;

	// Abstract method to be implemented by derived classes for prompting user input
	public abstract promptString(title: string, message: string, defaultValue?: string, placeholder?: string): Promise<string | undefined>;

	// process.vesions.node
	// process.version

	public getVersion(type: string): XeroVersion {
		let str = "0.0.0";
		let ret = {
			major: -1,
			minor: -1,
			patch: -1,
		};

		if (type === "electron") {
			str = process.version.substring(1);
		} else if (type === "node") {
			str = process.versions.node as string;
		} else if (type === "application") {
			str = app.getVersion();
		}

		if (str) {
			let comps = str.split(".");
			if (comps.length === 3) {
				ret.major = +comps[0];
				ret.minor = +comps[1];
				ret.patch = +comps[2];
			}
		}

		return ret;
	}

	public sendImages() {
		this.sendToRenderer('send-images', this.image_mgr_.getImageNames()) ;
	}

	public sendImageData(image: string) {
		let ret = this.getImageResponse(image) ;
		if (!ret.data) {
			ret = this.getImageResponse('missing', image) ;
		}
		this.sendToRenderer('send-image-data', ret) ;
	}	

	protected versionToString(v: XeroVersion) {
		return v.major + "." + v.minor + "." + v.patch;
	}

	protected showAbout() {
		let msg = "";
		msg +=
			"Welcome to XeroScout Generation 2, an electron based scouting system.\n\n";
		msg += "Versions:\n";
		msg +=
			"     XeroScout 2: " +
			this.versionToString(this.getVersion("application")) +
			"\n";
		msg +=
			"     Electron: " +
			this.versionToString(this.getVersion("electron")) +
			"\n";
		msg += "     Node: " + this.versionToString(this.getVersion("node")) + "\n";
		msg += "\n\n" + SCBase.attribution;
		let options = {
			// type: 'info',
			title: "XeroScout 2",
			message: msg,
		};
		dialog.showMessageBoxSync(this.win_, options);
	}

	protected checkForUpdates() {
		appUpdater.checkForUpdates() ;
	}

	public setSetting(name: string, value: any) {
		settings.setSync(name, value);
	}

	public getSetting(name: string): any {
		return settings.getSync(name);
	}

	public hasSetting(name: string): boolean {
		return settings.hasSync(name);
	}

	public unsetSettings(name: string) {
		settings.unset(name);
	}

	public static stripKeyString(key: string | number) : string {
		let ret : string ;

		if (typeof key === 'number') {
			ret = key.toString() ;
		}
		else {
			ret = key ;
			if (key.startsWith('frc')) {
				ret = key.substring(3) ;
			}
		}
		return ret ;
	}

	public static keyToTeamNumber(key: string) {
		let ret: number = -1;
		let m1 = /^frc[0-9]+$/;
		let m2 = /^[0-9]+$/;
		let m3 = /^frc-[0-9]+$/;

		if (m1.test(key)) {
			ret = +key.substring(3);
		} else if (m2.test(key)) {
			ret = +key;
		}
		else if (m3.test(key)) {
			ret = +key.substring(4) ;
		}

		return ret;
	}

	public logClientMessage(obj: any) {
		const msg = typeof obj?.message === 'string' ? obj.message : 'renderer-log' ;
		const metadata = {
			source: 'renderer',
			rendererType: obj?.type,
			rendererArgs: obj?.args,
			stack: obj?.stack,
			view: obj?.view,
			location: obj?.location,
			fileName: obj?.fileName,
			line: obj?.line,
			column: obj?.column,
		} ;

		if (obj.type === 'silly') {
			this.logger_.silly(`RendererLog:${msg}`, metadata) ;
		}
		if (obj.type === 'info') {
			this.logger_.info(`RendererLog:${msg}`, metadata) ;
		}
		else if (obj.type === 'debug') {
			this.logger_.debug(`RendererLog:${msg}`, metadata) ;
		}
		if (obj.type === 'warn') {
			this.logger_.warn(`RendererLog:${msg}`, metadata) ;
		}
		if (obj.type === 'error') {
			this.logger_.error(`RendererLog:${msg}`, metadata) ;
		}
	}

	public get isDevelop(): boolean {
		//
		// So, if the path to the executable contains both cygwin64 and my home directory, then
		// we are developing the application.  This puts the program in development mode which
		// primarily puts the log files in the home directory of the source instead of buried down
		// in the users home directory
		//

		if (process.env.XERODEVELOP) {
			return true ;
		}
		
		return (
			process.argv[0].indexOf("cygwin64") != -1 &&
			process.argv[0].indexOf("butch") != -1
		);
	}

	public get applicationType(): IPCAppType {
		throw new Error("Method not implemented - must be overridden in subclass.");
	}

	public mainWindowLoaded() : void {
	}

	public sendToRenderer(ev: string, ...args: any) {
		let argval: any[] = args ;

		this.logger_.silly({
			message: "main -> renderer",
			args: {
				event: ev,
				eventArgs: this.summarizeRendererArgs(argval)
			},
		});

		this.win_.webContents.send(ev, args);
	}

	private summarizeRendererArgs(args: any[]) : string {
		try {
			const summary = args.map((arg) => this.summarizeRendererArg(arg)) ;
			return JSON.stringify(summary).substring(0, 256) ;
		}
		catch {
			return '[unavailable]' ;
		}
	}

	private summarizeRendererArg(arg: any) : any {
		if (Array.isArray(arg)) {
			return { type: 'array', length: arg.length } ;
		}

		if (arg && typeof arg === 'object') {
			const summary: Record<string, any> = {
				type: 'object',
			} ;

			if (Array.isArray(arg.data)) {
				summary.rows = arg.data.length ;
			}

			if (Array.isArray(arg.column_definitions)) {
				summary.columns = arg.column_definitions.length ;
			}

			if (Array.isArray(arg.keycols)) {
				summary.keycols = arg.keycols.length ;
			}

			if (typeof arg.view === 'string') {
				summary.view = arg.view ;
			}

			if (typeof arg.title === 'string') {
				summary.title = arg.title ;
			}

			if (Object.keys(summary).length > 1) {
				return summary ;
			}

			return { type: 'object' } ;
		}

		return arg ;
	}

	protected setView(view: string, ...args: any[]) {
		this.lastview_ = view ;
		
		args.unshift(view) ;
		let obj : IPCSetView = {
			view: view,
			args: args[1],
		} ;

		this.sendToRenderer("update-main-window-view", obj);
	}

	private createUniqueFilename(
		directory: string,
		prefix: string = "file"
	): string {
		const timestamp = Date.now();
		const randomString = crypto.randomBytes(8).toString("hex");
		const filename = `${prefix}-${timestamp}-${randomString}`;
		const fullPath = path.join(directory, filename);

		// Check if the file already exists
		if (fs.existsSync(fullPath)) {
			// If it does, try again recursively
			return this.createUniqueFilename(directory, prefix);
		} else {
			return fullPath;
		}
	}

	private mapMatchType(mtype: string): number {
		let ret: number = -1;

		if (mtype === "f") {
			ret = 3;
		} else if (mtype === "sf") {
			ret = 2;
		} else {
			ret = 1;
		}

		return ret;
	}

	protected sortCompFun(a: any, b: any): number {
		let ret: number = 0;
		let compareField = (aval: any, bval: any): number => {
			let an = Number(aval) ;
			let bn = Number(bval) ;
			if (!Number.isNaN(an) && !Number.isNaN(bn)) {
				if (an < bn) {
					return -1 ;
				}
				if (an > bn) {
					return 1 ;
				}
				return 0 ;
			}

			let as = `${aval ?? ''}` ;
			let bs = `${bval ?? ''}` ;
			return as.localeCompare(bs) ;
		} ;

		let atype = this.mapMatchType(a.comp_level);
		let btype = this.mapMatchType(b.comp_level);

		if (atype < btype) {
			ret = -1;
		} else if (atype > btype) {
			ret = 1;
		} else {
			ret = compareField(a.match_number, b.match_number) ;
			if (ret === 0) {
				ret = compareField(a.set_number, b.set_number) ;
			}
		}
		return ret;
	}

	protected searchForImage(jsonname: string) : string | undefined {
		let trypath = path.join(this.content_dir_, 'fields', jsonname) + '.json' ;
		if (fs.existsSync(trypath)) {
			return trypath ;
		}

		return undefined ;
	}

	protected getImageData(name: string) {
		let datafile = this.image_mgr_.getImage(name) ;
		if (!datafile) {
			return '' ;
		}
		
		let data: string  = fs.readFileSync(datafile).toString('base64');
		return data ;
	}

	protected getImageResponse(name: string, requestedName?: string) : IPCImageResponse {
		const info = this.image_mgr_.getImageInfo(name) ;
		return {
			newname: requestedName && requestedName !== name ? name : undefined,
			name: requestedName ?? name,
			data: info ? fs.readFileSync(info.path).toString('base64') : '',
			mimeType: info?.mimeType ?? 'image/png',
			extension: info?.extension ?? 'png',
		} ;
	}

	public splitterChanged(value: number) {
		let name = this.typestr_ + '_splitter' ;
		this.setSetting(name, value) ;
	}

	protected appInit() {
		let value = 20.0 ;
		let name = this.typestr_ + '_splitter' ;

		if (this.hasSetting(name)) {
			value = this.getSetting(name) ;
		}
		else {
			this.setSetting(name, value) ;
		}

		let initData : IPCAppInit = {
			type: this.typestr_,
			splitter: value,
		} ;

		this.sendToRenderer('xero-app-init', initData) ;
	}

	protected getIconData(iconname: string) {
		let datafile = path.join(this.content_dir_, 'images', 'icons', iconname) ;
		let data: string  = fs.readFileSync(datafile).toString('base64');
		return data ;
	}	
}
