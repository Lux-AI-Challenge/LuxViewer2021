import { LuxMatchState } from '@lux-ai/2020-challenge/lib/es6/types';
import { LuxDesignLogic } from '@lux-ai/2020-challenge/lib/es6/logic';
import { Game } from '@lux-ai/2020-challenge/lib/es6/Game';
import { Resource } from '@lux-ai/2020-challenge/lib/es6/Resource';
import { Unit as LUnit } from '@lux-ai/2020-challenge/lib/es6/Unit/index';

import {
  getDepthByPos,
  getRoadType,
  hashMapCoords,
  mapCoordsToIsometricPixels,
  mapIsometricPixelsToPosition,
  mapPosToIsometricPixels,
} from './utils';
import { Position } from '@lux-ai/2020-challenge/lib/es6/GameMap/position';
import { GameObjects } from 'phaser';
import seedrandom from 'seedrandom';
import { TEAM_A_COLOR, TEAM_B_COLOR } from './types';
import { Cell } from '@lux-ai/2020-challenge/lib/es6/GameMap/cell';

type CommandsArray = Array<{
  command: string;
  agentID: number;
}>;

export interface Frame {
  // map from hashed position to resource data
  resourceData: Map<
    number,
    {
      type: Resource.Types;
      amt: number;
      pos: Position;
    }
  >;
  teamStates: FrameTeamStateData;
  unitData: FrameUnitData;
  cityData: FrameCityData;
  cityTileData: FrameCityTileData;
  annotations: CommandsArray;
  errors: string[];
  cellsWithRoads: Map<number, Cell>;
}

export type FrameTeamStateData = {
  [x in LUnit.TEAM]: {
    workers: number;
    carts: number;
    /** array of city ids this team owns */
    citiesOwned: Array<string>;
    researchPoints: number;
    statistics: {
      fuelGenerated: number;
      resourcesCollected: {
        [x in Resource.Types]: number;
      };
    };
  };
};
type FrameUnitData = Map<string, FrameSingleUnitData>;
export interface FrameSingleUnitData {
  pos: Position;
  team: LUnit.TEAM;
  cargo: LUnit.Cargo;
  type: LUnit.Type;
  cooldown: number;
  id: string;
}

type FrameCityTileData = Array<FrameSingleCityTileData>;

type FrameSingleCityTileData = {
  pos: Position;
  team: LUnit.TEAM;
  cityid: string;
  tileid: string;
  cooldown: number;
};

export type FrameCityData = Map<
  string,
  {
    cityTilePositions: Array<Position>;
    fuel: number;
    team: LUnit.TEAM;
  }
>;

export type GameCreationConfigs = {
  replayData: object;
  handleUnitClicked: HandleUnitClicked;
  handleTileClicked: HandleTileClicked;
};

type HandleUnitClicked = (unit: FrameSingleUnitData) => void;
export type FrameTileData = {
  pos: Position;
  units: Map<string, FrameSingleUnitData>;
  cityTile: FrameCityTileData;
  resources: {
    type: Resource.Types;
    amt: number;
  };
};
type HandleTileClicked = (data: FrameTileData) => void;

export interface StaticGlobalStats {
  totalResources: {
    wood: number;
    coal: number;
    uranium: number;
  };
}

class MainScene extends Phaser.Scene {
  player: Phaser.GameObjects.Sprite;
  cursors: any;

  globalStats: StaticGlobalStats = {
    totalResources: {
      wood: 0,
      coal: 0,
      uranium: 0,
    },
  };
  workers: Array<Phaser.GameObjects.Sprite> = [];
  luxgame: Game;

  graphics: Phaser.GameObjects.Graphics;

  // All unit sprites rendered throughout match
  unitSprites: Map<
    string,
    { sprite: Phaser.GameObjects.Sprite; originalPosition: Position }
  > = new Map();

  cityTilemapTiles: Map<string, Phaser.Tilemaps.Tile> = new Map();

  currentTurn = 0;

  dynamicLayer: Phaser.Tilemaps.DynamicTilemapLayer;

  frames: Array<Frame> = [];

  /** To allow dimensions to run a match */
  pseudomatch: any = {
    state: {},
    configs: {
      storeReplay: false,
      runProfiler: false,
      debug: false,
      seed: undefined,
    },
    throw: (id: number, err: any) => {
      this.currentTurnErrors.push(`Team ${id} - ${err}`);
    },
    sendAll: () => {},
    send: () => {},
    log: {
      detail: () => {},
      warn: (m: string) => {
        this.currentTurnErrors.push(m);
      },
    },
    agents: [],
  };

  currentTurnErrors: Array<string> = [];

  map: Phaser.Tilemaps.Tilemap;
  floorImageTiles: Map<number, GameObjects.Image> = new Map();

  activeImageTile: GameObjects.Image = null;
  originalTileY = 0;

  hoverImageTile: GameObjects.Image = null;
  originalHoverImageTileY = 0;

  /** Overall zoom of replayer */
  overallScale = 1;

  /** relative scales for each of these svgs */
  defaultScales = {
    city: 0.34,
    tree: 0.6,
    worker: 0.16,
    cart: 0.6,
    block: 0.44,
    tree0: 0.3,
    tree1: 0.33,
    uranium: 0.43,
    clouds: 0.7,
    road: 0.44,
  };

  /** playback speed */
  speed = 1;

  /** debug mode on or off */
  debug = true;

  constructor() {
    super({
      key: 'MainScene',
    });
  }

  preload() {
    this.load.image('worker0', 'assets/sprites/worker0w.svg');
    this.load.image('worker1', 'assets/sprites/worker1w.svg');
    this.load.image('cart0', 'assets/sprites/carts/cart0e.svg');
    this.load.image('cart1', 'assets/sprites/carts/cart1e.svg');

    this.load.svg('block1', 'assets/ground.svg');

    // generate 15 binary values 0001 to 1111 and load the path tiles
    for (let i = 1; i <= 15; i++) {
      let str = i.toString(2);
      // pad if necessary
      if (str.length < 4) {
        let a = str.length;
        for (let j = 0; j < 4 - a; j++) {
          str = '0' + str;
        }
      }
      this.load.svg(`path${str}`, `assets/sprites/paths/path${str}.svg`);
    }
    this.load.svg(`path0000`, `assets/sprites/paths/path1111.svg`);

    this.load.svg('tree1', 'assets/sprites/tree1.svg');
    this.load.svg('tree0', 'assets/sprites/tree0.svg');
    // city naming scheme
    // city<team><variant><transparent? t : ''>
    this.load.svg('city00', 'assets/sprites/city00.svg');
    this.load.svg('city01', 'assets/sprites/city01.svg');
    this.load.svg('city02', 'assets/sprites/city02.svg');
    this.load.svg('city02t', 'assets/sprites/city02t.svg');
    this.load.svg('city03', 'assets/sprites/city03.svg');
    this.load.svg('city03t', 'assets/sprites/city03t.svg');

    this.load.svg('city10', 'assets/sprites/city10.svg');
    this.load.svg('city11', 'assets/sprites/city11.svg');
    this.load.svg('city12', 'assets/sprites/city12.svg');
    this.load.svg('city12t', 'assets/sprites/city12t.svg');
    this.load.svg('city13', 'assets/sprites/city13.svg');
    this.load.svg('city13t', 'assets/sprites/city13t.svg');

    this.load.image('coal', 'assets/sprites/coal.png');
    this.load.svg('uranium', 'assets/sprites/uranium.svg');

    this.load.svg('cloud0', 'assets/sprites/cloud0.svg');
    this.load.svg('cloud1', 'assets/sprites/cloud1.svg');
    this.load.svg('cloud2', 'assets/sprites/cloud2.svg');
  }

  /**
   * Handle when a tile is clicked
   */
  private onTileClicked(v: Position) {
    const f = this.frames[this.turn];
    const unitDataAtXY: FrameUnitData = new Map();
    const cityTile: FrameCityTileData = [];

    // TODO: can be slow if we iterate entire unit list
    f.unitData.forEach((unit) => {
      if (unit.pos.x === v.x && unit.pos.y === v.y) {
        unitDataAtXY.set(unit.id, unit);
      }
    });
    f.cityTileData.forEach((ct) => {
      if (ct.pos.x === v.x && ct.pos.y === v.y) {
        cityTile.push(ct);
      }
    });
    const resourceAtXY = f.resourceData.get(hashMapCoords(v));
    const clickedPos = new Position(v.x, v.y);
    this.handleTileClicked({
      pos: clickedPos,
      units: unitDataAtXY,
      cityTile: cityTile,
      resources: resourceAtXY,
    });
    this.currentSelectedTilePos = clickedPos;
  }

  mapWidth: number = -1;
  mapHeight: number = -1;

  /**
   * Load replay data into game
   * and generate all relevant frames
   */
  async loadReplayData(replayData: any): Promise<void> {
    this.pseudomatch.configs.seed = replayData.seed;
    this.pseudomatch.configs.mapType = replayData.mapType;
    this.pseudomatch.configs.width = replayData.width;
    this.pseudomatch.configs.height = replayData.height;

    // use design to initialize "fake game"
    await LuxDesignLogic.initialize(this.pseudomatch);

    this.luxgame = this.pseudomatch.state.game;
    let width = this.luxgame.map.width;
    let height = this.luxgame.map.height;
    this.graphics = this.add.graphics({ x: 0, y: 0 });
    this.mapWidth = width;
    this.mapHeight = height;

    for (let y = 0; y < height; y++) {
      let row = this.luxgame.map.getRow(y);
      row.forEach((cell) => {
        const img = this.addNormalFloorTile(cell.pos);
        this.floorImageTiles.set(
          hashMapCoords(new Position(cell.pos.x, cell.pos.y)),
          img
        );
        if (cell.hasResource()) {
          this.globalStats.totalResources[cell.resource.type] +=
            cell.resource.amount;
        }
      });
    }

    // add handler for clicking tiles
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (d: { worldX: number; worldY: number }) => {
        const pos = mapIsometricPixelsToPosition(d.worldX, d.worldY, {
          scale: this.overallScale,
          width: this.mapWidth,
          height: this.mapHeight,
        });
        const imageTile = this.floorImageTiles.get(hashMapCoords(pos));
        if (imageTile) {
          if (this.activeImageTile == null) {
            this.originalTileY = imageTile.y;
            this.activeImageTile = imageTile;
            this.activeImageTile.setTint(0x86bfda);
            this.activeImageTile.setY(this.originalTileY - 5);
          } else if (this.activeImageTile !== imageTile) {
            this.activeImageTile.setY(this.originalTileY);
            this.activeImageTile.clearTint();
            this.originalTileY = imageTile.y;
            this.activeImageTile = imageTile;
            this.activeImageTile.setTint(0x86bfda);
            this.activeImageTile.setY(this.originalTileY - 5);
          }
        } else {
          if (this.activeImageTile) {
            this.activeImageTile.setY(this.originalTileY);
            this.activeImageTile.clearTint();
          }
          this.activeImageTile = null;
        }
        this.onTileClicked(pos);
      }
    );

    // add handler for moving cursor around isometric map
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer) => {
      let px = pointer.worldX;
      let py = pointer.worldY;
      const pos = mapIsometricPixelsToPosition(px, py, {
        scale: this.overallScale,
        width: this.mapWidth,
        height: this.mapHeight,
      });
      const imageTile = this.floorImageTiles.get(hashMapCoords(pos));
      if (imageTile) {
        if (this.hoverImageTile == null) {
          this.originalHoverImageTileY = imageTile.y;
          this.hoverImageTile = imageTile;
          this.hoverImageTile.setTint(0x86bfda);
        } else if (this.hoverImageTile !== imageTile) {
          if (this.activeImageTile != this.hoverImageTile) {
            this.hoverImageTile.clearTint();
          }
          this.originalHoverImageTileY = imageTile.y;
          this.hoverImageTile = imageTile;
          this.hoverImageTile.setTint(0x86bfda);
        }
      } else {
        if (this.hoverImageTile) {
          this.hoverImageTile.setY(this.originalHoverImageTileY);
          this.hoverImageTile.clearTint();
        }
        this.hoverImageTile = null;
      }
    });

    // spawn in clouds
    const map_edge_cloud_tolerance = -2;
    for (let x = -100; x < 100; x += 9) {
      for (let y = -100; y < 100; y += 9) {
        if (
          x < this.mapWidth - map_edge_cloud_tolerance &&
          x > map_edge_cloud_tolerance &&
          y < this.mapHeight - map_edge_cloud_tolerance &&
          y > map_edge_cloud_tolerance
        ) {
          continue;
        }
        const s = seedrandom('' + x * 10e5 + y);
        let cloudtype = 'cloud';
        const p = s();
        if (p < 0.33) {
          cloudtype += '0';
        } else if (p < 0.66) {
          cloudtype += '1';
        } else {
          cloudtype += '2';
        }
        const pos = new Position(x + s() * 5 - 2.5, y + s() * 5 - 2.5);
        const isopos = mapPosToIsometricPixels(pos, {
          scale: this.overallScale,
          width: this.mapWidth,
          height: this.mapHeight,
        });
        const cloud = this.add
          .sprite(isopos[0], isopos[1], cloudtype)
          .setDepth(10e5)
          .setScale(this.overallScale * this.defaultScales.clouds);
        this.cloudSprites.push({ cloud, pos });
      }
    }

    // load the initial state from replay
    // this.pseudomatch.configs.preLoadedGame = this.luxgame;

    this.cameras.main.centerOnX(0);
    this.cameras.main.centerOnY(0);
    this.generateGameFrames(replayData).then(() => {
      this.renderFrame(0);
      this.game.events.emit('setup');
    });
    // setTimeout(() => {
    //   LuxDesignLogic.initialize(this.pseudomatch).then(() => {
    //     this.generateGameFrames(replayData).then(() => {
    //       this.renderFrame(0);
    //       this.game.events.emit('setup');
    //     });
    //   });
    // }, 1);
  }

  /**
   * Creates a snapshot of the game state
   * @param game
   */
  createFrame(game: Game, annotations: CommandsArray): Frame {
    const teamStates: FrameTeamStateData = {
      [LUnit.TEAM.A]: {
        workers: 0,
        carts: 0,
        citiesOwned: [],
        researchPoints: game.state.teamStates[0].researchPoints,
        statistics: {
          fuelGenerated: 0,
          resourcesCollected: {
            wood: 0,
            coal: 0,
            uranium: 0,
          },
        },
      },
      [LUnit.TEAM.B]: {
        workers: 0,
        carts: 0,
        citiesOwned: [],
        researchPoints: game.state.teamStates[1].researchPoints,
        statistics: {
          fuelGenerated: 0,
          resourcesCollected: {
            wood: 0,
            coal: 0,
            uranium: 0,
          },
        },
      },
    };
    const teams = [LUnit.TEAM.A, LUnit.TEAM.B];
    for (const team of teams) {
      teamStates[team].statistics.fuelGenerated +=
        game.stats.teamStats[team].fuelGenerated;
      teamStates[team].statistics.resourcesCollected.wood =
        game.stats.teamStats[team].resourcesCollected.wood;
      teamStates[team].statistics.resourcesCollected.coal =
        game.stats.teamStats[team].resourcesCollected.coal;
      teamStates[team].statistics.resourcesCollected.uranium =
        game.stats.teamStats[team].resourcesCollected.uranium;

      game.getTeamsUnits(team).forEach((unit) => {
        if (unit.type === LUnit.Type.WORKER) {
          teamStates[team].workers++;
        } else {
          teamStates[team].carts++;
        }
      });
    }

    const unitData: FrameUnitData = new Map();
    [
      ...Array.from(game.getTeamsUnits(LUnit.TEAM.A).values()),
      ...Array.from(game.getTeamsUnits(LUnit.TEAM.B).values()),
    ].forEach((unit) => {
      unitData.set(unit.id, {
        team: unit.team,
        type: unit.type,
        cooldown: unit.cooldown,
        cargo: { ...unit.cargo },
        id: unit.id,
        pos: unit.pos,
      });
    });

    const cityData: FrameCityData = new Map();
    const cityTileData: FrameCityTileData = [];
    game.cities.forEach((city) => {
      teamStates[city.team].citiesOwned.push(city.id);
      cityData.set(city.id, {
        cityTilePositions: city.citycells.map((cell) => cell.pos),
        fuel: city.fuel,
        team: city.team,
      });
      city.citycells.forEach((cell) => {
        const ct = cell.citytile;
        cityTileData.push({
          pos: ct.pos,
          team: ct.team,
          cityid: ct.cityid,
          tileid: ct.getTileID(),
          cooldown: ct.cooldown,
        });
      });
    });
    const resourceData: Map<number, any> = new Map();

    game.map.resources.forEach((cell) => {
      // resourceMap
      resourceData.set(hashMapCoords(cell.pos), {
        type: cell.resource.type,
        amt: cell.resource.amount,
        pos: cell.pos,
      });
    });

    let cellsWithRoads: Map<number, Cell> = new Map();
    for (let y = 0; y < game.map.height; y++) {
      let row = game.map.getRow(y);
      row.forEach((cell) => {
        if (cell.cooldown !== 1) {
          cellsWithRoads.set(hashMapCoords(cell.pos), cell);
        }
      });
    }

    return {
      resourceData,
      unitData,
      cityData,
      cityTileData,
      teamStates,
      annotations,
      errors: this.currentTurnErrors,
      cellsWithRoads,
    };
  }

  public turn = 0;

  public handleUnitClicked: HandleUnitClicked;
  public handleTileClicked: HandleTileClicked;

  public currentSelectedTilePos: Position = null;

  create(configs: GameCreationConfigs) {
    this.loadReplayData(configs.replayData);
    this.handleUnitClicked = configs.handleUnitClicked;
    this.handleTileClicked = configs.handleTileClicked;
    this.events.emit('created');
  }

  /**
   * Paint in a resource tile to the current rendered frame
   */
  addResourceTile(type: Resource.Types, x: number, y: number) {
    const p = mapCoordsToIsometricPixels(x, y, {
      scale: this.overallScale,
      width: this.mapWidth,
      height: this.mapHeight,
    });
    switch (type) {
      case Resource.Types.WOOD: {
        let treeType = 0;
        let tscale = this.defaultScales.tree0;
        const s = seedrandom('' + x * 10e5 + y);
        let scaleFactor = 140;
        if (s() < 0.5) {
          treeType = 1;
          tscale = this.defaultScales.tree1;
          scaleFactor = 120;
        }
        const img = this.add
          .image(
            p[0] + 20 * tscale * this.overallScale,
            p[1] - scaleFactor * tscale * this.overallScale,
            'tree' + treeType
          )
          .setDepth(getDepthByPos(new Position(x, y)))
          .setScale(tscale * this.overallScale);
        return img;
      }
      case Resource.Types.COAL: {
        const img = this.add
          .image(p[0], p[1], 'coal')
          .setDepth(getDepthByPos(new Position(x, y)))
          .setScale(1.5);
        img.setY(img.y - 18);
        return img;
      }
      case Resource.Types.URANIUM: {
        const img = this.add
          .image(
            p[0] - 22 * this.defaultScales.uranium * this.overallScale,
            p[1] - 62 * this.defaultScales.uranium * this.overallScale,
            'uranium'
          )
          .setDepth(getDepthByPos(new Position(x, y)))
          .setScale(this.defaultScales.uranium * this.overallScale);
        return img;
      }
    }
  }

  addCityTile(data: FrameSingleCityTileData, tilesWithUnits: Set<number>) {
    const p = mapPosToIsometricPixels(data.pos, {
      scale: this.overallScale,
      width: this.mapWidth,
      height: this.mapHeight,
    });
    let cityTileType = 'city' + data.team;

    const s = seedrandom('' + data.pos.x * 10e3 + data.pos.y);
    let variant = '0';
    const rngp = s();
    if (rngp < 0.25) {
      variant = '2';
    } else if (rngp < 0.5) {
      variant = '1';
    } else if (rngp < 0.75) {
      variant = '3';
    }
    cityTileType += variant;
    // make tile transparent if there's a unit behind it and its a tall building (type 2 or 3)
    if (
      (variant === '2' || variant === '3') &&
      tilesWithUnits.has(
        hashMapCoords(new Position(data.pos.x - 1, data.pos.y - 1))
      )
    ) {
      cityTileType += 't';
    }
    const img = this.add
      .image(p[0], p[1], cityTileType)
      .setDepth(getDepthByPos(data.pos))
      .setScale(this.defaultScales.city * this.overallScale);

    switch (data.team + variant) {
      case '00':
      case '01':
        img.setY(img.y - 80 * this.defaultScales.city * this.overallScale);
        img.setX(img.x + 10 * this.defaultScales.city * this.overallScale);
        break;
      case '02':
      case '03':
        img.setY(img.y - 140 * this.defaultScales.city * this.overallScale);
        img.setX(img.x + 10 * this.defaultScales.city * this.overallScale);
        break;
      case '10':
      case '11':
        img.setY(img.y - 110 * this.defaultScales.city * this.overallScale);
        break;
      case '12':
      case '13':
        img.setY(img.y - 160 * this.defaultScales.city * this.overallScale);
        break;
    }

    return img;
  }

  addNormalFloorTile(pos: Position) {
    const ps = mapCoordsToIsometricPixels(pos.x, pos.y, {
      scale: this.overallScale,
      width: this.mapWidth,
      height: this.mapHeight,
    });

    const img = this.add
      .image(ps[0], ps[1], 'block1')
      .setScale(this.defaultScales.block * this.overallScale);
    img.setDepth(getDepthByPos(pos) / 100);
    return img;
  }

  /**
   * Add worker sprite for use by any frame
   */
  addWorkerSprite(x: number, y: number, team: LUnit.TEAM, id: string) {
    const p = mapCoordsToIsometricPixels(x, y, {
      scale: this.overallScale,
      width: this.mapWidth,
      height: this.mapHeight,
    });
    const sprite = this.add
      .sprite(p[0], p[1], 'worker' + team)
      .setScale(this.defaultScales.worker * this.overallScale);
    sprite.setDepth(getDepthByPos(new Position(x, y)));
    this.unitSprites.set(id, { sprite, originalPosition: new Position(x, y) });
    return sprite;
  }

  /**
   * Add cart sprite for use by any frame
   */
  addCartSprite(x: number, y: number, team: LUnit.TEAM, id: string) {
    const p = mapCoordsToIsometricPixels(x, y, {
      scale: this.overallScale,
      width: this.mapWidth,
      height: this.mapHeight,
    });
    const sprite = this.add
      .sprite(p[0], p[1], 'cart' + team)
      .setScale(this.defaultScales.cart * this.overallScale);
    sprite.setDepth(getDepthByPos(new Position(x, y)));
    this.unitSprites.set(id, { sprite, originalPosition: new Position(x, y) });
    return sprite;
  }

  currentRenderedFramesImgs: Array<GameObjects.Image> = [];
  currentRenderedFramesRoads: Array<{
    img: GameObjects.Image;
    pos: Position;
  }> = [];
  currentRenderedFramesText: Array<GameObjects.Text> = [];
  cloudSprites: Array<{ cloud: GameObjects.Sprite; pos: Position }> = [];

  renderFrame(turn: number) {
    this.turn = turn;
    const f = this.frames[turn];
    if (!f) {
      return;
    }
    // destroy any old rendered images
    this.currentRenderedFramesImgs.forEach((img) => {
      img.destroy();
    });
    this.currentRenderedFramesText.forEach((txt) => {
      txt.destroy();
    });
    this.currentRenderedFramesRoads.forEach(({ img, pos }) => {
      img.destroy();
      let hash = hashMapCoords(pos);
      // let oldimg = this.floorImageTiles.get(hash);
      let img2 = this.addNormalFloorTile(pos);
      let old = this.floorImageTiles.get(hash);
      old.destroy();
      this.floorImageTiles.set(hash, img2);
    });

    // render roads
    f.cellsWithRoads.forEach((cell) => {
      let hash = hashMapCoords(cell.pos);
      let oldimg = this.floorImageTiles.get(hash);
      oldimg.destroy();
      const p = mapPosToIsometricPixels(cell.pos, {
        scale: this.overallScale,
        width: this.mapWidth,
        height: this.mapHeight,
      });

      // determine road to render by adjacency
      let adjacency = [false, false, false, false];

      let dirs = [
        Game.DIRECTIONS.NORTH,
        Game.DIRECTIONS.EAST,
        Game.DIRECTIONS.SOUTH,
        Game.DIRECTIONS.WEST,
      ];
      dirs.forEach((dir, i) => {
        let newpos = cell.pos.translate(dir, 1);
        let hash = hashMapCoords(newpos);
        if (f.cellsWithRoads.has(hash)) {
          adjacency[i] = true;
        }
      });

      const img = this.add
        .image(p[0], p[1], getRoadType(adjacency))
        .setDepth(getDepthByPos(cell.pos) / 100 + 1 / 1e7)
        .setScale(this.defaultScales.road * this.overallScale);
      this.currentRenderedFramesRoads.push({ img, pos: cell.pos });
      this.floorImageTiles.set(hash, img);
    });

    // render clouds to the appropriate size
    this.cloudSprites.forEach(({ cloud, pos }) => {
      cloud.setScale(this.overallScale * this.defaultScales.clouds);
      const p = mapPosToIsometricPixels(pos, {
        scale: this.overallScale,
        width: this.mapWidth,
        height: this.mapHeight,
      });
      cloud.setX(p[0]);
      cloud.setY(p[1]);
    });

    let visibleUnits: Set<string> = new Set();
    let unitPosToCount: Map<number, number> = new Map();
    let visibleCityTiles: Set<number> = new Set();
    let tilesWithUnits: Set<number> = new Set();

    // find tiles with units and count units per tile
    f.unitData.forEach((data) => {
      visibleUnits.add(data.id);
      const hash = hashMapCoords(data.pos);
      if (tilesWithUnits.has(hash)) {
        if (unitPosToCount.has(hash)) {
          unitPosToCount.set(hash, unitPosToCount.get(hash) + 1);
        } else {
          unitPosToCount.set(hash, 2);
        }
      }
      tilesWithUnits.add(hash);
    });

    // find all standing cities
    f.cityTileData.forEach((data) => {
      visibleCityTiles.add(hashMapCoords(data.pos));
    });

    const tilesWithResources: Set<number> = new Set();
    // paint in all resource tiles
    f.resourceData.forEach((data) => {
      const img = this.addResourceTile(data.type, data.pos.x, data.pos.y);
      this.currentRenderedFramesImgs.push(img);
      tilesWithResources.add(hashMapCoords(data.pos));
    });

    // iterate over all units in this frame / turn
    f.unitData.forEach((data) => {
      const id = data.id;
      const { sprite } = this.unitSprites.get(id);

      sprite.setVisible(true);
      const p = mapPosToIsometricPixels(data.pos, {
        scale: this.overallScale,
        width: this.mapWidth,
        height: this.mapHeight,
      });

      // translate unit position depending on if there's a resource or city there
      let newx = p[0] - 45 * this.defaultScales.worker * this.overallScale;
      let newy = p[1] - 140 * this.defaultScales.worker * this.overallScale;
      if (visibleCityTiles.has(hashMapCoords(data.pos))) {
        newy = p[1] - 20 * this.defaultScales.worker * this.overallScale;
      } else if (tilesWithResources.has(hashMapCoords(data.pos))) {
        newy = p[1] - 60 * this.defaultScales.worker * this.overallScale;
      }

      // create smooth movement
      this.tweens.add({
        targets: sprite,
        x: newx,
        y: newy,
        ease: 'Linear',
        duration: 340 / this.speed,
        repeat: 0,
        yoyo: false,
      });

      if (data.type === LUnit.Type.WORKER) {
        // add 1/10e5 to place this in front of cities
        sprite
          .setDepth(getDepthByPos(data.pos) + 1 / 10e5)
          .setScale(this.defaultScales.worker * this.overallScale);
      } else {
        sprite
          .setDepth(getDepthByPos(data.pos) + 1 / 10e5)
          .setScale(this.defaultScales.cart * this.overallScale);
      }
    });

    // iterate over all live city tiles and draw in unit counts
    this.graphics.clear();
    this.graphics.lineStyle(3 * this.overallScale, 0x323d34, 1);
    this.graphics.fillStyle(0xe7ded1, 1);
    f.cityTileData.forEach((data) => {
      const img = this.addCityTile(data, tilesWithUnits);
      this.currentRenderedFramesImgs.push(img);
      const hash = hashMapCoords(data.pos);
      if (unitPosToCount.has(hash)) {
        let c = unitPosToCount.get(hash);
        const p = mapPosToIsometricPixels(data.pos, {
          scale: this.overallScale,
          width: this.mapWidth,
          height: this.mapHeight,
        });
        this.graphics
          .fillCircle(
            p[0] + 16 * this.overallScale,
            p[1] - 20 * this.overallScale,
            18 * this.overallScale
          )
          .setDepth(getDepthByPos(data.pos) + 1);
        this.graphics
          .strokeCircle(
            p[0] + 16 * this.overallScale,
            p[1] - 20 * this.overallScale,
            18 * this.overallScale
          )
          .setDepth(getDepthByPos(data.pos) + 1);

        const text = this.make
          .text({
            x: p[0] + 9 * this.overallScale,
            y: p[1] - 33 * this.overallScale,
            text: `${c}`,
            style: {
              fontSize: `${24 * this.overallScale}px`,
              fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
              color: '#323D34',
              fontWeight: 'bold',
            },
          })
          .setDepth(getDepthByPos(data.pos) + 1e8);
        this.currentRenderedFramesText.push(text);
      }
    });

    this.unitSprites.forEach(({ sprite, originalPosition }, key) => {
      if (!visibleUnits.has(key)) {
        sprite.setVisible(false);
        const p = mapPosToIsometricPixels(originalPosition, {
          scale: this.overallScale,
          width: this.mapWidth,
          height: this.mapHeight,
        });
        sprite.x = p[0];
        sprite.y = p[1] - 18;
      }
    });

    if (this.currentSelectedTilePos !== null) {
      this.onTileClicked(this.currentSelectedTilePos);
    }

    // add annotations
    if (this.debug) {
      f.annotations.forEach((cmd) => {
        const strs = cmd.command.split(' ');
        switch (strs[0]) {
          case Game.ACTIONS.DEBUG_ANNOTATE_CIRCLE: {
            if (strs.length === 3) {
              let x = parseInt(strs[1]);
              let y = parseInt(strs[2]);
              if (isNaN(x) || isNaN(y)) {
                return;
              }
              const p = mapCoordsToIsometricPixels(x, y, {
                scale: this.overallScale,
                width: this.mapWidth,
                height: this.mapHeight,
              });
              if (cmd.agentID === LUnit.TEAM.A) {
                this.graphics.lineStyle(7 * this.overallScale, TEAM_A_COLOR, 1);
              } else {
                this.graphics.lineStyle(7 * this.overallScale, TEAM_B_COLOR, 1);
              }
              this.graphics
                .strokeCircle(
                  p[0] + 0 * this.overallScale,
                  p[1] - 16 * this.overallScale,
                  34 * this.overallScale
                )
                .setDepth(getDepthByPos(new Position(x, y)) + 1);
            }
            break;
          }
          case Game.ACTIONS.DEBUG_ANNOTATE_X:
            if (strs.length === 3) {
              let x = parseInt(strs[1]);
              let y = parseInt(strs[2]);
              if (isNaN(x) || isNaN(y)) {
                return;
              }
              const p = mapCoordsToIsometricPixels(x, y, {
                scale: this.overallScale,
                width: this.mapWidth,
                height: this.mapHeight,
              });
              if (cmd.agentID === LUnit.TEAM.A) {
                this.graphics.lineStyle(7 * this.overallScale, TEAM_A_COLOR, 1);
              } else {
                this.graphics.lineStyle(7 * this.overallScale, TEAM_B_COLOR, 1);
              }
              this.graphics
                .lineBetween(
                  p[0] - 28 * this.overallScale,
                  p[1] - 46 * this.overallScale,
                  p[0] + 32 * this.overallScale,
                  p[1] + 14 * this.overallScale
                )
                .setDepth(getDepthByPos(new Position(x, y)) + 1);
              this.graphics
                .lineBetween(
                  p[0] + 28 * this.overallScale,
                  p[1] - 46 * this.overallScale,
                  p[0] - 32 * this.overallScale,
                  p[1] + 14 * this.overallScale
                )
                .setDepth(getDepthByPos(new Position(x, y)) + 1);
            }
            break;
          case Game.ACTIONS.DEBUG_ANNOTATION_LINE: {
            if (strs.length === 5) {
              let x1 = parseInt(strs[1]);
              let y1 = parseInt(strs[2]);
              let x2 = parseInt(strs[3]);
              let y2 = parseInt(strs[4]);
              if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) {
                return;
              }
              const p = mapCoordsToIsometricPixels(x1, y1, {
                scale: this.overallScale,
                width: this.mapWidth,
                height: this.mapHeight,
              });
              const p2 = mapCoordsToIsometricPixels(x2, y2, {
                scale: this.overallScale,
                width: this.mapWidth,
                height: this.mapHeight,
              });

              if (cmd.agentID === LUnit.TEAM.A) {
                this.graphics.lineStyle(7 * this.overallScale, TEAM_A_COLOR, 1);
              } else {
                this.graphics.lineStyle(7 * this.overallScale, TEAM_B_COLOR, 1);
              }
              this.graphics
                .lineBetween(
                  p[0] - 0 * this.overallScale,
                  p[1] - 28 * this.overallScale,
                  p2[0] + 0 * this.overallScale,
                  p2[1] - 14 * this.overallScale
                )
                .setDepth(10e5);
            }
            break;
          }
          default:
            return true;
        }
      });
    }
  }

  async generateGameFrames(replayData) {
    while (this.currentTurn <= this.luxgame.configs.parameters.MAX_DAYS) {
      const commands = replayData.allCommands[
        this.currentTurn
      ] as CommandsArray;
      const state: LuxMatchState = this.pseudomatch.state;
      const game = state.game;
      let annotations = [] as CommandsArray;
      let unannotated = commands.filter((cmd) => {
        const strs = cmd.command.split(' ');
        switch (strs[0]) {
          case Game.ACTIONS.DEBUG_ANNOTATE_CIRCLE:
          case Game.ACTIONS.DEBUG_ANNOTATE_X:
          case Game.ACTIONS.DEBUG_ANNOTATION_LINE:
            annotations.push(cmd);
            return false;
          default:
            return true;
        }
      });
      await LuxDesignLogic.update(this.pseudomatch, unannotated);

      [
        ...Array.from(game.getTeamsUnits(LUnit.TEAM.A).values()),
        ...Array.from(game.getTeamsUnits(LUnit.TEAM.B).values()),
      ].forEach((unit) => {
        if (this.unitSprites.has(unit.id)) {
          // const sprite = this.unitSprites.get(unit.id);
          // const p = mapPosToPixels(unit.pos);
          // this.tweens.add({
          //   targets: sprite,
          //   x: p[0],
          //   y: p[1],
          //   ease: 'Linear',
          //   duration: 100,
          //   repeat: 0,
          //   yoyo: false,
          // });
        } else {
          if (unit.type === LUnit.Type.WORKER) {
            this.addWorkerSprite(
              unit.pos.x,
              unit.pos.y,
              unit.team,
              unit.id
            ).setVisible(false);
          } else {
            this.addCartSprite(
              unit.pos.x,
              unit.pos.y,
              unit.team,
              unit.id
            ).setVisible(false);
          }
        }
      });

      const frame = this.createFrame(this.pseudomatch.state.game, annotations);
      // console.log(
      //   { turn: this.currentTurn },
      //   'frame size',
      //   memorySizeOf(frame)
      // );
      this.frames.push(frame);
      this.currentTurn++;
    }
  }

  lastPointerPosition = null;

  update(time: number, delta: number) {
    const panvelocity = 32 * Math.sqrt(this.overallScale);
    const wkey = this.input.keyboard.addKey('W');
    if (wkey.isDown) {
      this.moveCamera(0, -panvelocity);
    }
    const skey = this.input.keyboard.addKey('S');
    if (skey.isDown) {
      this.moveCamera(0, panvelocity);
    }
    const akey = this.input.keyboard.addKey('A');
    if (akey.isDown) {
      this.moveCamera(-panvelocity, 0);
    }
    const dkey = this.input.keyboard.addKey('D');
    if (dkey.isDown) {
      this.moveCamera(panvelocity, 0);
    }
    if (this.game.input.activePointer.isDown) {
      if (this.lastPointerPosition != null) {
        let dx = this.lastPointerPosition.x - this.game.input.activePointer.x;
        let dy = this.lastPointerPosition.y - this.game.input.activePointer.y;
        this.moveCamera(dx, dy);
      }
      this.lastPointerPosition = {
        x: this.game.input.activePointer.x,
        y: this.game.input.activePointer.y,
      };
    } else {
      this.lastPointerPosition = null;
    }
  }

  moveCamera(dx: number, dy: number) {
    let yBounds = [-640 - 640 * this.overallScale, 640 * this.overallScale];
    let xBounds = [-2560 - 640 * this.overallScale, 640 * this.overallScale];
    if (
      this.cameras.main.scrollX <= xBounds[1] &&
      this.cameras.main.scrollX >= xBounds[0]
    ) {
      this.cameras.main.scrollX += dx;
    } else if (this.cameras.main.scrollX < xBounds[0] && dx > 0) {
      this.cameras.main.scrollX += dx;
    } else if (this.cameras.main.scrollX > xBounds[1] && dx < 0) {
      this.cameras.main.scrollX += dx;
    }

    if (
      this.cameras.main.scrollY <= yBounds[1] &&
      this.cameras.main.scrollY >= yBounds[0]
    ) {
      this.cameras.main.scrollY += dy;
    } else if (this.cameras.main.scrollY < yBounds[0] && dy > 0) {
      this.cameras.main.scrollY += dy;
    } else if (this.cameras.main.scrollY > yBounds[1] && dy < 0) {
      this.cameras.main.scrollY += dy;
    }

    if (this.cameras.main.scrollX < xBounds[0]) {
      this.cameras.main.scrollX = xBounds[0];
    }
    if (this.cameras.main.scrollY < yBounds[0]) {
      this.cameras.main.scrollY = yBounds[0];
    }
    if (this.cameras.main.scrollY > yBounds[1]) {
      this.cameras.main.scrollY = yBounds[1];
    }
  }
}

export default MainScene;
