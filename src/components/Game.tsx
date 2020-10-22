import 'phaser';
import React, { useEffect, useState } from 'react';
import classnames from 'classnames';
import MainScene, { Frame, FrameTileData } from '../scenes/MainScene';
import { createGame } from '../game';
import PlayerStats from './PlayerStats';
import GameStats from './GameStats';
import {
  Button,
  CircularProgress,
  ButtonGroup,
  Card,
  CardContent,
  Slider,
  Grid,
} from '@material-ui/core';
import './styles.css';
import { LuxMatchConfigs, Unit } from '@lux-ai/2020-challenge/lib/es6';
import TileStats from './TileStats';

export const GameComponent = () => {
  const [isReady, setReady] = useState(false);
  const [selectedTileData, setTileData] = useState<FrameTileData>(null);
  const [game, setGame] = useState<Phaser.Game>(null);
  const [main, setMain] = useState<MainScene>(null);
  const [configs, setConfigs] = useState<LuxMatchConfigs>(null);
  const [sliderConfigs, setSliderConfigs] = useState({
    step: 1,
    min: 0,
    max: 1000,
  });
  useEffect(() => {
    if (game) {
      game.events.on('setup', () => {
        const main: MainScene = game.scene.scenes[0];
        setMain(main);
        const configs = main.luxgame.configs;
        setConfigs(configs as LuxMatchConfigs);

        setSliderConfigs({
          min: 0,
          max: configs.parameters.MAX_DAYS,
          step: 1,
        });
        setReady(true);
      });
    }
  }, [game]);
  useEffect(() => {
    if (isReady) {
      moveToTurn(0);
    }
  }, [isReady]);
  const [turn, setTurn] = useState(0);
  const [currentFrame, setFrame] = useState<Frame>(null);
  const [uploading, setUploading] = useState(false);
  const handleChange = (_event: any, newValue: number) => {
    moveToTurn(newValue);
  };
  const fileInput = React.createRef<HTMLInputElement>();
  const moveToTurn = (turn: number) => {
    setTurn(turn);
    main.renderFrame(turn);
    setFrame(main.frames[turn]);
  };
  const handleUpload = () => {
    setUploading(true);
    if (fileInput.current.files.length) {
      const file = fileInput.current.files[0];
      const name = file.name;
      const meta = name.split('.');

      if (meta[meta.length - 1] === 'json') {
        file
          .text()
          .then(JSON.parse)
          .then((data) => {
            if (game) {
              game.destroy(true, false);
            }
            setReady(false);
            const newgame = createGame({
              replayData: data,
              handleUnitClicked,
              handleTileClicked,
            });
            setGame(newgame);
            setUploading(false);
          });
      }
    }
  };
  const renderUploadButton = () => {
    return (
      <Button variant="contained" component="label">
        Upload Replay{' '}
        <input
          accept=".json, .luxr"
          type="file"
          style={{ display: 'none' }}
          onChange={handleUpload}
          ref={fileInput}
        />
      </Button>
    );
  };
  const noUpload = !uploading && game === null;
  const gameLoading =
    (uploading && game === null) || (!isReady && game !== null);

  const handleUnitClicked = (data) => {
    console.log(data);
  };
  const handleTileClicked = (data) => {
    setTileData(data);
  };
  return (
    <div className="Game">
      <div className="gameContainer">
        <h1>Lux AI Challenge</h1>
        <Grid container spacing={3}>
          <Grid item xs={6}>
            <Card
              className={classnames({
                'phaser-wrapper': true,
                Loading: gameLoading,
              })}
            >
              <CardContent>
                {noUpload && renderUploadButton()}
                {gameLoading && <CircularProgress />}
                <div id="content"></div>
                <Slider
                  value={turn}
                  disabled={!isReady}
                  onChange={handleChange}
                  aria-labelledby="continuous-slider"
                  min={sliderConfigs.min}
                  step={sliderConfigs.step}
                  max={sliderConfigs.max}
                />
                <ButtonGroup color="primary">
                  <Button
                    disabled={!isReady}
                    onClick={() => {
                      moveToTurn(turn - 1);
                    }}
                  >
                    {'<'}
                  </Button>
                  <Button
                    disabled={!isReady}
                    onClick={() => {
                      moveToTurn(turn + 1);
                    }}
                  >
                    {'>'}
                  </Button>
                </ButtonGroup>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6}>
            <Card className="stats">
              <CardContent>
                {selectedTileData && (
                  <TileStats
                    {...selectedTileData}
                    cities={currentFrame.cityData}
                  />
                )}
                <GameStats turn={turn} />
                {currentFrame !== null &&
                  [0, 1].map((team: Unit.TEAM) => {
                    return (
                      <PlayerStats
                        key={team}
                        workerUnits={currentFrame.teamStates[team].workers}
                        cartUnits={currentFrame.teamStates[team].carts}
                        cities={currentFrame.teamStates[team].citiesOwned.map(
                          (id) => {
                            const city = currentFrame.cityData.get(id);
                            return {
                              fuel: city.fuel,
                              cells: city.cityTilePositions.length,
                              cityid: id,
                            };
                          }
                        )}
                        team={team}
                      />
                    );
                  })}
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12}>
            {!noUpload && renderUploadButton()}
          </Grid>
        </Grid>
      </div>
    </div>
  );
};
