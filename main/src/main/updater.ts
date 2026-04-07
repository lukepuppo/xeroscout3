import { app, autoUpdater, BrowserWindow, dialog } from "electron";
import type * as winston from "winston";

export type AppUpdaterState =
    | "idle"
    | "not-configured"
    | "checking"
    | "available"
    | "not-available"
    | "downloaded"
    | "error";

export interface AppUpdaterStatus {
    state: AppUpdaterState;
    message: string;
    configured: boolean;
    feedUrl: string;
}

const DEFAULT_UPDATE_FEED_URL = "";

export class AppUpdater {
    private win_?: BrowserWindow;
    private logger_?: winston.Logger;
    private initialized_ = false;
    private status_: AppUpdaterStatus = {
        state: "not-configured",
        message: "Auto-update feed URL is not configured.",
        configured: false,
        feedUrl: "",
    };

    public initialize(win: BrowserWindow, logger: winston.Logger) {
        this.win_ = win;
        this.logger_ = logger;

        if (this.initialized_) {
            this.pushStatus();
            return;
        }

        this.initialized_ = true;
        this.refreshStatusFromConfiguration();

        autoUpdater.on("checking-for-update", () => {
            this.setStatus("checking", "Checking for updates...");
        });

        autoUpdater.on("update-available", () => {
            this.setStatus("available", "Update available. Downloading...");
        });

        autoUpdater.on("update-not-available", () => {
            this.setStatus("not-available", "No updates are currently available.");
            this.dialogInfo("No Updates", "No updates are currently available.");
        });

        autoUpdater.on("error", (err) => {
            const message = `Update check failed: ${err.message}`;
            this.setStatus("error", message);
            this.dialogError("Update Error", message);
        });

        autoUpdater.on("update-downloaded", () => {
            this.setStatus("downloaded", "Update downloaded. It will be installed the next time XeroScout restarts.");

            const answer = dialog.showMessageBoxSync(this.win_!, {
                type: "info",
                title: "Update Ready",
                message: "Update downloaded. It will be installed the next time XeroScout restarts.",
                buttons: ["Restart Now", "Later"],
                defaultId: 0,
                cancelId: 1,
            });

            if (answer === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    }

    public checkForUpdates() {
        this.refreshStatusFromConfiguration();

        if (process.platform !== "win32") {
            this.setStatus("error", "Auto-update is currently only configured for Windows builds.");
            this.dialogInfo("Auto Update", this.status_.message);
            return;
        }

        if (!app.isPackaged) {
            this.setStatus("error", "Auto-update checks are only available in packaged builds.");
            this.dialogInfo("Auto Update", this.status_.message);
            return;
        }

        if (!this.status_.configured) {
            this.dialogInfo("Auto Update", "Auto-update feed URL is not configured yet.");
            return;
        }

        try {
            autoUpdater.setFeedURL({ url: this.status_.feedUrl });
            autoUpdater.checkForUpdates();
        }
        catch (err) {
            const errobj = err as Error;
            this.setStatus("error", `Unable to start update check: ${errobj.message}`);
            this.dialogError("Update Error", this.status_.message);
        }
    }

    public getStatus() : AppUpdaterStatus {
        return { ...this.status_ };
    }

    public quitAndInstall() {
        autoUpdater.quitAndInstall();
    }

    private refreshStatusFromConfiguration() {
        const feedUrl = this.getFeedUrl();
        if (feedUrl.length === 0) {
            this.setStatus("not-configured", "Auto-update feed URL is not configured.");
        }
        else if (this.status_.state === "not-configured") {
            this.setStatus("idle", "Auto-update is configured and ready.");
        }
        else {
            this.status_ = {
                ...this.status_,
                configured: true,
                feedUrl: feedUrl,
            };
            this.pushStatus();
        }
    }

    private getFeedUrl() : string {
        const envUrl = process.env.XEROSCOUT_UPDATE_URL?.trim();
        const url = envUrl && envUrl.length > 0 ? envUrl : DEFAULT_UPDATE_FEED_URL;
        return url.trim();
    }

    private setStatus(state: AppUpdaterState, message: string) {
        const feedUrl = this.getFeedUrl();
        this.status_ = {
            state,
            message,
            configured: feedUrl.length > 0,
            feedUrl,
        };

        if (this.logger_) {
            this.logger_.info("UpdaterStatus", {
                state: this.status_.state,
                message: this.status_.message,
                configured: this.status_.configured,
            });
        }

        this.pushStatus();
    }

    private pushStatus() {
        if (this.win_) {
            this.win_.webContents.send("updater-status", [this.getStatus()]);
        }
    }

    private dialogInfo(title: string, message: string) {
        if (this.win_) {
            dialog.showMessageBoxSync(this.win_, {
                type: "info",
                title,
                message,
            });
        }
    }

    private dialogError(title: string, message: string) {
        if (this.win_) {
            dialog.showMessageBoxSync(this.win_, {
                type: "error",
                title,
                message,
            });
        }
    }
}

export const appUpdater = new AppUpdater();
