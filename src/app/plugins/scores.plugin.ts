import { RichEmbed } from 'discord.js';
import { Plugin } from '../../common/plugin';
import Constants from '../../common/constants';
import { IContainer, IMessage, ChannelType } from '../../common/types';

export class ScoresPlugin extends Plugin {
  public name: string = 'NCAA Scores Plugin';
  public description: string = 'Gets score of a sport game.';
  public usage: string = 'scores <sport> <team origin>; ex scores NCAA UCF';
  public permission: ChannelType = ChannelType.Public;
  public pluginChannelName: string = Constants.Channels.Public.Sports;

  private _ENDPOINTS = new Map([
    ['ncaa', 'http://www.espn.com/college-football/bottomline/scores'],
    ['nfl', 'http://www.espn.com/nfl/bottomline/scores'],
    ['mlb', 'http://www.espn.com/mlb/bottomline/scores'],
    ['nba', 'http://www.espn.com/nba/bottomline/scores'],
  ]);

  private _WINNING_LABELS = ['losing', 'tied', 'winning'];
  private _FINAL_LABELS = ['lost to', 'tied with', 'won against'];
  private _MAX_NUM_DISPLAY: number = 3;

  private _UPCOMING_REGEX: RegExp = /=(\([0-9]*\)%20)?([a-zA-Z]+%20)+at%20(\([0-9]*\)%20)?([a-zA-Z]+%20)+/;
  private _UPCOMING_TIME_REGEX: RegExp = /\([A-Z0-9%:,]{5,}\)/;

  private _HOME_ACTIVE_DATA_REGEX: RegExp = /(?<=%20%20)\^?(\(\d+\))?[a-zA-Z%20]+%20[0-9]+/; //Isolates home team's data
  private _VISITOR_ACTIVE_DATA_REGEX: RegExp = /=\^?((\([0-9]+\))%20)?([a-zA-Z]*%20)+[0-9]+/; //Isolates visiting team's data

  constructor(public container: IContainer) {
    super();
  }

  public async execute(message: IMessage, args?: string[]) {
    const parsedArgs = (args || []).map((str) => str.toLowerCase()).join(' ');
    let teamArg;
    let sportArg;

    if (parsedArgs.toLowerCase() === 'help') {
      this._sendHelp(message);
      return;
    }

    //If no args, team is UCF by default
    if (parsedArgs === '') {
      sportArg = 'NCAA';
      teamArg = 'UCF';
    } else {
      let argArray = parsedArgs.split(' ');
      if (argArray.length < 2) {
        //Make sure there are 2 arguments given
        message.reply('Incorrect Amount of Arguments');
        return;
      }
      sportArg = argArray[0];

      argArray = argArray.slice(1);
      teamArg = argArray.join(' ');
    }

    const endpoint = this._ENDPOINTS.get(sportArg.toLowerCase());
    if (!endpoint) {
      message.reply('Error locating sport');
      return;
    }

    try {
      const response = await this.container.httpService.get(endpoint);
      const games = response.data.split('?'); //Each game ends with a ?

      if (teamArg.toLowerCase().includes('list')) {
        this._sendListTeams(message, games, teamArg);
        return;
      }

      const embedBuffer = [];
      let teamFound = false;

      for (const game of games) {
        //Stop if the max amount of messages have been queued
        if (embedBuffer.length >= this._MAX_NUM_DISPLAY) {
          break;
        }
        if (game.includes('DELAYED')) {
          continue;
        }

        let visitorData = game.match(this._VISITOR_ACTIVE_DATA_REGEX);
        let homeData = game.match(this._HOME_ACTIVE_DATA_REGEX);

        //Makes sure regex found data
        if (!visitorData || !homeData) {
          //If this didn't work, it may be an upcoming game

          //Call function and make sure teamFound is true if this is true atleast once
          if (this._tryUpcomingGame(embedBuffer, game, teamArg)) {
            teamFound = true;
          }
          continue;
        }

        visitorData = visitorData[0].split('%20');
        homeData = homeData[0].split('%20');

        visitorData[0] = visitorData[0].slice(1); //Remove the prefix that starts the visitors name

        const visitorName = this._getTeamNameFromTeamData(visitorData);
        const homeName = this._getTeamNameFromTeamData(homeData);

        //Check if neither team contains all search terms
        if (
          !(
            this._strictlyContainsAllTokens(visitorName, teamArg) ||
            this._strictlyContainsAllTokens(homeName, teamArg)
          )
        ) {
          continue;
        }

        teamFound = true; //Designates as true if any game was found with matching search term

        const visitorScore = parseInt(visitorData[visitorData.length - 1]);
        const homeScore = parseInt(homeData[homeData.length - 1]);

        //If searched team is the visitor, else
        const teamIsVisitor = this._strictlyContainsAllTokens(visitorName, teamArg);
        const scoreEval = this._evaluateScores(visitorScore, homeScore);

        const winning = teamIsVisitor ? scoreEval : scoreEval * -1; //Flip sign if team is home; will stay same if tied
        const winningString = game.toLowerCase().includes('final')
          ? this._FINAL_LABELS[winning + 1]
          : this._WINNING_LABELS[winning + 1];

        const opponentName = teamIsVisitor ? homeName : visitorName;
        const teamName = teamIsVisitor ? visitorName : homeName;

        const embed = new RichEmbed();
        embed.setTitle(visitorName + ' at ' + homeName);
        embed.setColor('#7289da');
        if (!game.toLowerCase().includes('final')) {
          embed.setDescription(`${teamName} is currently ${winningString} against ${opponentName}`);
        } else {
          embed.setDescription(`${teamName} ${winningString} ${opponentName}`);
        }
        embed.setFooter(visitorScore + ' - ' + homeScore);
        embedBuffer.push(embed);
      }

      //Send embeds in buffer
      embedBuffer.forEach((e) => {
        message.channel.send(e);
      });

      if (!teamFound) {
        message.reply('Team not found or Team is not playing this week!');
      }
    } catch (error) {
      this.container.loggerService.error(error);
    }
  }
  private _sendListTeams(message: IMessage, games: string[], teamArg: string) {
    const matchups = [];
    const embedBuffer: RichEmbed[] = [];
    for (const game of games) {
      if (game.includes('DELAYED')) {
        continue;
      }

      let visitorData = game.match(this._VISITOR_ACTIVE_DATA_REGEX);
      let homeData = game.match(this._HOME_ACTIVE_DATA_REGEX);

      //If null, it may be an upcoming game
      if (!visitorData || !homeData) {
        const gameData = game.match(this._UPCOMING_REGEX);
        if (!gameData) {
          continue;
        }

        const matchupData = gameData[0].replace(/=/, '').split('%20'); //Format
        matchups.push(matchupData.join(' ').replace(' at ', '@')); //Remove the at
        continue;
      }

      visitorData = visitorData[0].split('%20');
      homeData = homeData[0].split('%20');

      const visitorName = this._getTeamNameFromTeamData(visitorData);
      const homeName = this._getTeamNameFromTeamData(homeData);

      matchups.push(`${visitorName}@${homeName}`);
    }

    let numFields = 0;
    let embed = this._getNewEmbed();

    //If use types 'list phone' then show the phone version
    //This will technically work if the user types anything after 'list'
    if (teamArg.split(' ').length == 1) {
      matchups.forEach((matchup) => {
        if (numFields == 25) {
          numFields = 0;
          embedBuffer.push(embed);
          embed = this._getNewEmbed();
        }

        const [visitor, home] = matchup.split('@');
        embed.addField(visitor, home, true);
        numFields++;
      });

      //Push last embed
      embedBuffer.push(embed);
    } else {
      embed.setDescription(matchups.join('\n').replace(/@/g, ' at '));
      message.reply(embed);
    }
    embedBuffer.forEach((e) => {
      message.channel.send(e);
    });
  }
  private _getNewEmbed() {
    const embed = new RichEmbed();
    embed.setTitle('Current games available');
    embed.setColor('#7289da');
    return embed;
  }

  private _evaluateScores(a: number, b: number): number {
    if (a == b) return 0; //Tied
    return a > b ? 1 : -1;
  }

  private _sendHelp(message: IMessage) {
    message.reply({
      embed: {
        title: 'Scores Plugin Help',
        color: '7506394',
        fields: [
          { name: 'Supported Sports', value: 'NCAA NFL MLB NBA' },
          {
            name: 'Inputting Teams',
            value:
              'For NCAA: Use their most common name\nFor Professional Sports: Use their city only\n',
          },
          {
            name: 'Examples',
            value:
              '!scores NCAA UCF\n!scores NCAA Florida State\n!scores NFL Seattle\n!scores MLB Atlanta',
          },
        ],
      },
    });
  }

  private _tryUpcomingGame(embedBuffer: RichEmbed[], game: any, teamArg: string): boolean {
    let teamsData = game.match(this._UPCOMING_REGEX) || [''];
    const time = String(game.match(this._UPCOMING_TIME_REGEX) || '').split('%20'); //Convert Array to string

    //Make sure data is valid
    if (teamsData.join(' ') === '' || time.join(' ') === '') {
      return false;
    }

    teamsData = teamsData[0].replace('=', '').split('%20'); //Trim and split
    const matchup = teamsData.join(' ');

    teamsData = matchup.split(' at '); //Eliminate 'at' and combine multi-word team names
    const [visitorName, homeName] = teamsData;

    //Check if neither team contains all search terms
    if (
      !(
        this._strictlyContainsAllTokens(visitorName, teamArg) ||
        this._strictlyContainsAllTokens(homeName, teamArg)
      )
    ) {
      return false;
    }

    const embed = new RichEmbed();
    embed.setTitle(matchup);
    embed.setColor('#7289da');
    embed.setDescription(visitorName + ' will face off at ' + homeName);
    embed.setFooter(time.join(' '));
    embedBuffer.push(embed);

    return true;
  }

  private _getTeamNameFromTeamData(arr: string[]): string {
    let name = arr.slice(0, arr.length - 1).join(' '); //Last element is team score

    //Trim whitespace and special characters
    name = name.trim().replace(/=?(\^)?/, '');

    return name;
  }

  private _strictlyContainsAllTokens(teamName: string, tokens: string): boolean {
    let teamNameArr = teamName.trim().split(' ');
    //Remove rank if there is one
    if (/\([0-9]+\)/.test(teamNameArr[0])) {
      teamNameArr = teamNameArr.slice(1);
    }

    return teamNameArr.join(' ').toLowerCase() === tokens.toLowerCase();
  }
}
