import { IContainer, Mode } from '../common/types';
import { Kernel } from '../bootstrap/kernel';
import * as fs from 'fs';
import * as path from 'path';
import { Listener } from './listener';
import Environment from '../environment';

export class Bot {
  private _kernel: Kernel;
  private _listener: any;
  public container: IContainer;

  constructor() {
    this._kernel = new Kernel();
    this.container = this._kernel.getContainer();
    this._listener = new Listener(this.container);
    this._load();
  }

  private _load(): void {
    this._registerPlugins();
  }

  private _registerPlugins(): void {
    fs.readdir(path.join(__dirname, './plugins'), (err, plugins) => {
      if (err) {
        return console.error(err);
      }
      plugins.forEach((plugin) => {
        let pluginName = plugin.replace('.plugin.ts', '');
        if (Environment.Playground === Mode.Production) {
          pluginName = plugin.replace('.plugin.js', '');
        }
        this.container.pluginService.register(pluginName, this.container);
      });
    });
  }

  public run(): void {
    //
  }
}
