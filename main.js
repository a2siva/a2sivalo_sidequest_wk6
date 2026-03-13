import { LevelLoader } from "./src/LevelLoader.js";
import { Game } from "./src/Game.js";
import { ParallaxBackground } from "./src/ParallaxBackground.js";
import { loadAssets } from "./src/AssetLoader.js";
import {
  applyIntegerScale,
  installResizeHandler,
} from "./src/utils/IntegerScale.js";

import { CameraController } from "./src/CameraController.js";
import { InputManager } from "./src/InputManager.js";
import { SoundManager } from "./src/SoundManager.js";
import { DebugOverlay } from "./src/DebugOverlay.js";

import { WinScreen } from "./src/ui/WinScreen.js";
import { LoseScreen } from "./src/ui/LoseScreen.js";

function loadJSONAsync(url) {
  return new Promise((resolve, reject) => {
    loadJSON(url, resolve, reject);
  });
}

let audioUnlocked = false;
function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (typeof userStartAudio === "function") userStartAudio();
}

function preventKeysThatScroll(evt) {
  const k = (evt?.key ?? "").toLowerCase();
  const scrollKeys = [" ", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  if (scrollKeys.includes(k)) {
    evt.preventDefault?.();
    return false;
  }
  return true;
}

let game;
let parallax;
let hudGfx;

let tuningDoc;
let levelPkg;
let assets;

let cameraController;
let inputManager;
let soundManager;
let debugOverlay;

let winScreen;
let loseScreen;
let parallaxLayers = [];

const LEVELS_URL = new URL("./data/levels.json", window.location.href).href;
const TUNING_URL = new URL("./data/tuning.json", window.location.href).href;
const START_LEVEL_ID = "ex5_level1";

let bootStarted = false;
let bootDone = false;

function getPlayerEnergyInfo() {
  const candidates = [
    game?.level?.player,
    game?.level?.playerCtrl,
    game?.level?.playerCtrl?.sprite,
    game?.player,
    game?.playerCtrl,
    game?.playerCtrl?.sprite,
  ];

  for (const obj of candidates) {
    if (!obj) continue;

    const current =
      obj.energy ??
      obj.currentEnergy ??
      obj.energyNow ??
      obj.hp ??
      obj.health ??
      obj.stamina;

    const max =
      obj.maxEnergy ??
      obj.energyMax ??
      obj.maxHp ??
      obj.maxHealth ??
      obj.maxStamina;

    if (typeof current === "number" && typeof max === "number" && max > 0) {
      return {
        current,
        max,
        ratio: constrain(current / max, 0, 1),
      };
    }
  }

  return null;
}

function drawLowEnergyPulse(viewW, viewH) {
  const info = getPlayerEnergyInfo();
  if (!info) return;

  if (info.ratio > 0.35) return;

  const intensity = map(info.ratio, 0.35, 0, 0.35, 1, true);
  const pulse = (sin(frameCount * 0.18) + 1) * 0.5;
  const alpha = 40 + pulse * 90 * intensity;
  const edge = 30 + pulse * 35 * intensity;

  camera.off();
  push();

  noStroke();

  for (let i = 0; i < edge; i++) {
    const a = alpha * (1 - i / edge);

    fill(180, 0, 0, a);
    rect(0, i, viewW, 1);

    fill(180, 0, 0, a);
    rect(0, viewH - i, viewW, 1);

    fill(180, 0, 0, a);
    rect(i, 0, 1, viewH);

    fill(180, 0, 0, a);
    rect(viewW - i, 0, 1, viewH);
  }

  const textAlpha = 120 + pulse * 100 * intensity;
  fill(255, 80, 80, textAlpha);
  textAlign(CENTER, TOP);
  textSize(14);
  textStyle(BOLD);
  text("LOW ENERGY", viewW / 2, 12);

  pop();
  camera.on();
}

async function boot() {
  console.log("BOOT: start");

  tuningDoc = await loadJSONAsync(TUNING_URL);

  const loader = new LevelLoader(tuningDoc);
  levelPkg = await loader.load(LEVELS_URL, START_LEVEL_ID);

  assets = await loadAssets(levelPkg, tuningDoc);

  soundManager = new SoundManager();

  const defs = levelPkg.level?.view?.parallax ?? [];
  parallaxLayers = defs
    .map((d) => ({
      img: loadImage(d.img),
      factor: Number(d.speed ?? 0),
    }))
    .filter((l) => l.img);

  initRuntime();

  bootDone = true;
  console.log("BOOT: done");
}

function initRuntime() {
  const { viewW, viewH } = levelPkg.view;

  resizeCanvas(viewW, viewH);

  pixelDensity(1);
  noSmooth();
  drawingContext.imageSmoothingEnabled = false;

  frameRate(60);

  applyIntegerScale(viewW, viewH);
  installResizeHandler(viewW, viewH);

  allSprites.pixelPerfect = true;

  world.autoStep = false;

  hudGfx = createGraphics(viewW, viewH);
  hudGfx.noSmooth();
  hudGfx.pixelDensity(1);

  inputManager = new InputManager();
  debugOverlay = new DebugOverlay();

  game = new Game(levelPkg, assets, {
    hudGfx,
    inputManager,
    soundManager,
    debugOverlay,
  });
  game.build();

  winScreen = new WinScreen(levelPkg, assets);
  loseScreen = new LoseScreen(levelPkg, assets);

  cameraController = new CameraController(levelPkg);
  cameraController.setTarget(game.level.playerCtrl.sprite);
  cameraController.reset();

  game.events.on("level:restarted", () => {
    cameraController?.reset();
  });

  parallax = new ParallaxBackground(parallaxLayers);

  loop();
}

function setup() {
  new Canvas(10, 10, "pixelated");
  pixelDensity(1);
  noLoop();

  if (bootStarted) return;
  bootStarted = true;

  boot().catch((err) => {
    console.error("BOOT FAILED:", err);
  });
}

function draw() {
  if (!bootDone || !levelPkg || !game) return;

  const viewW = levelPkg.view.viewW;
  const viewH = levelPkg.view.viewH;

  const bg = levelPkg.level?.view?.background ?? [69, 61, 79];
  background(bg[0], bg[1], bg[2]);

  parallax?.draw({
    cameraX: camera.x || 0,
    viewW,
    viewH,
  });

  game.update();

  cameraController?.update({
    viewW,
    viewH,
    levelW: game.level.bounds.levelW,
    levelH: game.level.bounds.levelH,
  });
  cameraController?.applyToP5Camera();

  game.draw({
    drawHudFn: () => {
      camera.off();
      try {
        drawingContext.imageSmoothingEnabled = false;
        imageMode(CORNER);
        image(hudGfx, 0, 0);
      } finally {
        camera.on();
        noTint();
      }
    },
  });

  drawLowEnergyPulse(viewW, viewH);

  const won = game?.won === true || game?.level?.won === true;
  const dead = game?.lost === true || game?.level?.player?.dead === true;

  const elapsedMs = Number(game?.elapsedMs ?? game?.level?.elapsedMs ?? 0);

  if (won) winScreen?.draw({ elapsedMs, game });
  if (dead) loseScreen?.draw({ elapsedMs, game });
}

function mousePressed() {
  unlockAudioOnce();
}

function keyPressed(evt) {
  unlockAudioOnce();
  return preventKeysThatScroll(evt);
}

window.addEventListener(
  "keydown",
  (e) => {
    const k = (e.key ?? "").toLowerCase();
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
      e.preventDefault();
    }
  },
  { passive: false },
);

window.setup = setup;
window.draw = draw;
window.mousePressed = mousePressed;
window.keyPressed = keyPressed;
