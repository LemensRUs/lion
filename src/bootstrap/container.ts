import Bottle from 'bottlejs';
import { ClientService } from '../services/discord.service';
import { HttpService } from '../services/http.service';
import { PluginService } from '../services/plugin.service';

export class Container {
  constructor(private _bottle: Bottle) {
    this._bottle.service('clientService', ClientService);
    this._bottle.service('httpService', HttpService);
    this._bottle.service('pluginService', PluginService);
  }
}
