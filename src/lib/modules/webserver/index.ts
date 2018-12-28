const fs = require("../../core/fs.js");
const {canonicalHost} = require("../../utils/host.js");
const utils = require("../../utils/utils.js");
const Server = require("./server.js").default;
const opn = require("opn");

require("ejs");
const Templates = {
  embark_building_placeholder: require("./templates/embark-building-placeholder.html.ejs"),
};

class WebServer {
  private embark: any;
  private logger: any;
  private events: any;
  private buildDir: any;
  private plugins: any;
  private webServerConfig: any;
  private host: any;
  private protocol: any;
  private port: any;
  private enableCatchAll: any;
  private server: any;

  constructor(embark: any, options: any) {
    this.embark = embark;
    this.logger = embark.logger;
    this.events = embark.events;
    this.buildDir = embark.config.buildDir;
    this.plugins = options.plugins;
    this.webServerConfig = embark.config.webServerConfig;
    if (!this.webServerConfig.enabled) {
      return;
    }

    this.host = this.webServerConfig.host;
    this.protocol = this.webServerConfig.protocol;
    this.port = parseInt(this.webServerConfig.port, 10);
    this.enableCatchAll = this.webServerConfig.enableCatchAll === true;
    this.enableCatchAll = false; // FIXME when true, some Requests end up failing (eg: process-logs)

    this.events.request("processes:register", "webserver", {
      launchFn: (cb: any) => { this.server.start(cb); },
      stopFn: (cb: any) => { this.server.stop(cb); },
    });

    this.events.emit("status", __("Starting Server"));

    this.server = new Server({
      buildDir: this.buildDir,
      certOptions : this.webServerConfig.certOptions,
      events: this.events,
      host: this.host,
      logger: this.logger,
      openBrowser: this.webServerConfig.openBrowser,
      plugins: this.plugins,
      port: this.port,
      protocol: this.webServerConfig.protocol,
    });

    this.listenToCommands();
    this.registerConsoleCommands();

    this.events.on("webserver:config:change", () => {
      this.embark.config.webServerConfig = null;
      this.embark.config.loadWebServerConfigFile();
      this.webServerConfig = this.embark.config.webServerConfig;
      this.protocol = this.webServerConfig.protocol;
      this.host = this.webServerConfig.host;
      this.port = this.webServerConfig.port;
      this.server.host = this.host;
      this.server.port = this.port;
      this.server.protocol = this.webServerConfig.protocol;
      this.server.certOptions =  this.webServerConfig.certOptions;

      this.testPort(() => {
        this.events.request("processes:stop", "webserver", (_err: any) => {
          this.events.request("processes:launch", "webserver", (__err: any, message: any, port: any) => {
            this.logger.info(message);
            this.port = port;
            this.events.request("open-browser", () => {});
          });
        });
      });
    });

    this.testPort(() => {
      this.events.request("processes:launch", "webserver", (_err: any, message: any, port: any) => {
        this.logger.info(message);
        this.port = port;
        this.setServiceCheck();
      });
    });
  }

  private testPort(done: any) {
    if (this.port === 0) {
      this.logger.warn(__("Assigning an available port"));
      this.server.port = 0;
      return done();
    }
    utils.pingEndpoint(this.host, this.port, this.protocol, this.protocol, "", (err?: any) => {
      if (err) { // Port is ok
        return done();
      }
      this.logger.warn(__("Webserver already running on port %s. Assigning an available port", this.port));
      this.port = 0;
      this.server.port = 0;
      done();
    });
  }

  private setServiceCheck() {
    this.events.request("services:register", "Webserver", (cb: any) => {
      const url = this.protocol + "://" + canonicalHost(this.host) + ":" + this.port;
      utils.checkIsAvailable(url, (available: any) => {
        const devServer = __("Webserver") + " (" + url + ")";
        const serverStatus = (available ? "on" : "off");
        return cb({name: devServer, status: serverStatus});
      });
    });

    this.events.on("check:wentOffline:Webserver", () => {
      this.logger.info(__("Webserver is offline"));
    });
  }

  private listenToCommands() {
    this.events.setCommandHandler("build-placeholder", (cb: any) => this.buildPlaceholderPage(cb));
    this.events.setCommandHandler("open-browser", (cb: any) => this.openBrowser(cb));
    this.events.setCommandHandler("start-webserver", (cb: any) => this.events.request("processes:launch", "webserver", cb));
    this.events.setCommandHandler("stop-webserver",  (cb: any) => this.events.request("processes:stop", "webserver", cb));
    this.events.setCommandHandler("logs:webserver:turnOn",  (cb: any) => this.server.enableLogging(cb));
    this.events.setCommandHandler("logs:webserver:turnOff",  (cb: any) => this.server.disableLogging(cb));
  }

  private registerConsoleCommands() {
    this.embark.registerConsoleCommand({
      description: __("Start or stop the websever"),
      matches: ["webserver start"],
      process: (cmd: any, callback: any) => {
        this.events.request("start-webserver", callback);
      },
      usage: "webserver start/stop",
    });

    this.embark.registerConsoleCommand({
      matches: ["webserver stop"],
      process: (cmd: any, callback: any) => {
        this.events.request("stop-webserver", callback);
      },
    });

    this.embark.registerConsoleCommand({
      description: __("Open a browser window at the Dapp's url"),
      matches: ["browser open"],
      process: (cmd: any, callback: any) => {
        this.events.request("open-browser", callback);
      },
    });

    this.embark.registerConsoleCommand({
      matches: ["log webserver on"],
      process: (cmd: any, callback: any) => {
        this.events.request("logs:webserver:turnOn", callback);
      },
    });

    this.embark.registerConsoleCommand({
      matches: ["log webserver off"],
      process: (cmd: any, callback: any) => {
        this.events.request("logs:webserver:turnOff", callback);
      },
    });
  }

  private buildPlaceholderPage(cb: any) {
    const html = Templates.embark_building_placeholder({buildingMsg: __("Embark is building, please wait...")});
    fs.mkdirpSync(this.buildDir); // create buildDir if it does not exist
    fs.writeFile(utils.joinPath(this.buildDir, "index.html"), html, cb);
  }

  private openBrowser(cb: any) {
    const _cb = () => { cb(); };
    return opn(
      `${this.protocol}://${canonicalHost(this.server.hostname)}:${this.server.port}`,
      {wait: false},
    ).then(_cb, _cb); // fail silently, e.g. in a docker container
  }
}

export default WebServer;