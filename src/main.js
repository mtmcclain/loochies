// Loochies - tiny playable slice (walk + Blocker + one level)
// Uses provided sprite sheet (assets/loochies-art.png)

const VIRTUAL_W = 320;
const VIRTUAL_H = 180;
const TILE = 16;

const canvas = document.getElementById('screen');
const stage = document.getElementById('stage');
const hudStatus = document.getElementById('status');
const blockerBtn = document.getElementById('blockerBtn');
const builderBtn = document.getElementById('builderBtn');
const diggerBtn = document.getElementById('diggerBtn');
const basherBtn = document.getElementById('basherBtn');
const floaterBtn = document.getElementById('floaterBtn');
const blockerCountEl = document.getElementById('blockerCount');
const builderCountEl = document.getElementById('builderCount');
const diggerCountEl = document.getElementById('diggerCount');
const basherCountEl = document.getElementById('basherCount');
const floaterCountEl = document.getElementById('floaterCount');
const restartBtn = document.getElementById('restartBtn');
const nextBtn = document.getElementById('nextBtn');
const selectBtn = document.getElementById('selectBtn');

const state = {
  selectedTool: 'none', // 'blocker' | 'builder' | 'digger' | 'basher' | 'floater'
  timeLeft: 60, // seconds
  goal: 5,
  total: 10,
  saved: 0,
  lost: 0,
  over: false,
  jobCounts: { blocker: 0, builder: 0, digger: 0, basher: 0, floater: 0 },
  currentLevel: 0,
};

blockerBtn.addEventListener('click', () => {
  if (state.jobCounts.blocker <= 0) return selectNone();
  toggleTool('blocker', blockerBtn);
});
builderBtn.addEventListener('click', () => {
  if (state.jobCounts.builder <= 0) return selectNone();
  toggleTool('builder', builderBtn);
});
diggerBtn.addEventListener('click', () => {
  if (state.jobCounts.digger <= 0) return selectNone();
  toggleTool('digger', diggerBtn);
});
basherBtn.addEventListener('click', () => {
  if (state.jobCounts.basher <= 0) return selectNone();
  toggleTool('basher', basherBtn);
});
floaterBtn.addEventListener('click', () => {
  if (state.jobCounts.floater <= 0) return selectNone();
  toggleTool('floater', floaterBtn);
});
restartBtn.addEventListener('click', () => setupLevel());
nextBtn.addEventListener('click', () => { state.currentLevel = (state.currentLevel + 1) % levels.length; setupLevel(); });
selectBtn.addEventListener('click', () => { state.currentLevel = (state.currentLevel + 1) % levels.length; setupLevel(); });

function selectNone() {
  state.selectedTool = 'none';
  for (const b of [blockerBtn,builderBtn,diggerBtn,basherBtn,floaterBtn]) b.setAttribute('aria-pressed','false'), b.classList.remove('selected');
}
function toggleTool(tool, btn) {
  const pressed = btn.getAttribute('aria-pressed') === 'true';
  selectNone();
  const next = !pressed;
  if (next) {
    btn.setAttribute('aria-pressed','true'); btn.classList.add('selected');
    state.selectedTool = tool;
  }
}

// Integer scaling to fill screen while staying crisp
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const vv = window.visualViewport;
  const vw = Math.floor((vv ? vv.width : window.innerWidth));
  const vh = Math.floor((vv ? vv.height : window.innerHeight));
  const hud = document.getElementById('hud');
  const hudH = Math.ceil(hud.getBoundingClientRect().height);
  const availW = vw;
  const availH = vh - hudH;
  stage.style.width = `${availW}px`;
  stage.style.height = `${availH}px`;
  let scale = Math.floor(Math.min(availW / VIRTUAL_W, availH / VIRTUAL_H));
  if (scale < 1) scale = Math.min(availW / VIRTUAL_W, availH / VIRTUAL_H);
  const cssW = VIRTUAL_W * scale;
  const cssH = VIRTUAL_H * scale;
  canvas.width = Math.round(VIRTUAL_W * scale * dpr);
  canvas.height = Math.round(VIRTUAL_H * scale * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
let ctx = fitCanvas();
window.addEventListener('resize', () => (ctx = fitCanvas()));
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => (ctx = fitCanvas()));
}

// ---- Audio (Web Audio API) ----
class SoundManager {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.buffers = {}; // name -> AudioBuffer
    this.lastPlay = {}; // name -> ms
    this.cooldowns = { spawn: 250 }; // ms
    this.unlocked = false;
    this.winPlayed = false;
  }
  async unlock() {
    if (this.unlocked) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // no audio support
    this.ctx = new AC();
    try { await this.ctx.resume(); } catch {}
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.9;
    this.gain.connect(this.ctx.destination);
    this.unlocked = true;
    // Lazy-load all known slots; missing files are fine
    this.loadAll().catch(()=>{});
  }
  async loadAll() {
    const slots = ['spawn','blocker','saved','fall','win'];
    await Promise.all(slots.map((s) => this.loadSlot(s).catch(()=>{})));
  }
  async loadSlot(name) {
    if (!this.ctx) return;
    const exts = ['m4a','mp3','ogg','wav'];
    for (const ext of exts) {
      const url = `assets/sounds/${name}.${ext}`;
      try {
        const resp = await fetch(url, { cache: 'force-cache' });
        if (!resp.ok) continue;
        const data = await resp.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(data.slice(0));
        this.buffers[name] = buf;
        return;
      } catch {
        // try next extension
      }
    }
    // none found; leave undefined (silent)
  }
  play(name) {
    if (!this.unlocked || !this.ctx) return;
    const buf = this.buffers[name];
    if (!buf) return; // silent-missing
    const now = performance.now();
    const cd = this.cooldowns[name] || 0;
    const last = this.lastPlay[name] || 0;
    if (now - last < cd) return;
    this.lastPlay[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.gain);
    try { src.start(); } catch {}
  }
}
const audio = new SoundManager();
// Unlock on first interaction (iPhone Safari)
['click','touchstart','pointerdown'].forEach((ev) => {
  document.addEventListener(ev, () => audio.unlock(), { once: true, passive: true });
  canvas.addEventListener(ev, () => audio.unlock(), { once: true, passive: true });
  blockerBtn.addEventListener(ev, () => audio.unlock(), { once: true, passive: true });
  restartBtn.addEventListener(ev, () => audio.unlock(), { once: true, passive: true });
});

// ---- Sprites: 3 columns x 2 rows sheet (top: walker, blocker, builder; bottom: digger, basher, floater)
const sprites = {
  img: new Image(),
  loaded: false,
  cellW: 0,
  cellH: 0,
  crops: {}, // by key: 'walker','blocker'
  canvases: {} // processed transparent canvases per sprite
};
sprites.img.onload = () => {
  sprites.cellW = Math.floor(sprites.img.width / 3);
  sprites.cellH = Math.floor(sprites.img.height / 2);
  // compute tight crops for top row cells (exclude bottom icons)
  const computeCrop = (col, row) => {
    const cellW = sprites.cellW;
    const cellH = sprites.cellH;
    const sx = col * cellW;
    const sy = row * cellH;
    const topH = Math.floor(cellH * 0.75); // ignore bottom icon strip
    const off = document.createElement('canvas');
    off.width = cellW;
    off.height = topH;
    const octx = off.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(sprites.img, sx, sy, cellW, topH, 0, 0, cellW, topH);
    const img = octx.getImageData(0, 0, cellW, topH).data;
    let minX = cellW, minY = topH, maxX = 0, maxY = 0;
    for (let y = 0; y < topH; y++) {
      for (let x = 0; x < cellW; x++) {
        const i = (y * cellW + x) * 4;
        const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
        const isBlack = r < 8 && g < 8 && b < 8;
        if (a > 8 && !isBlack) { // count as content (not black)
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    // if scan failed for any reason, fall back to centered area
    if (maxX <= minX || maxY <= minY) {
      const padW = 180, padH = 220;
      return { sx: sx + (cellW - padW) / 2, sy: sy + 20, sw: padW, sh: padH };
    }
    // add padding
    const pad = 6;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(cellW - 1, maxX + pad);
    maxY = Math.min(topH - 1, maxY + pad);
    return { sx: sx + minX, sy: sy + minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
  };
sprites.crops.walker = computeCrop(0, 0);
sprites.crops.blocker = computeCrop(1, 0);
sprites.crops.builder = computeCrop(2, 0);
sprites.crops.digger  = computeCrop(0, 1);
sprites.crops.basher  = computeCrop(1, 1);
sprites.crops.floater = computeCrop(2, 1);
  // Preprocess to punch out black background (alpha=0)
  const makeTransparent = (crop) => {
    const c = document.createElement('canvas');
    c.width = crop.sw;
    c.height = crop.sh;
    const cctx = c.getContext('2d');
    cctx.imageSmoothingEnabled = false;
    cctx.drawImage(sprites.img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.sw, crop.sh);
    const img = cctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 8 && g < 8 && b < 8) {
        d[i + 3] = 0; // transparent
      }
    }
    cctx.putImageData(img, 0, 0);
    return c;
  };
sprites.canvases.walker = makeTransparent(sprites.crops.walker);
sprites.canvases.blocker = makeTransparent(sprites.crops.blocker);
sprites.canvases.builder = makeTransparent(sprites.crops.builder);
sprites.canvases.digger  = makeTransparent(sprites.crops.digger);
sprites.canvases.basher  = makeTransparent(sprites.crops.basher);
sprites.canvases.floater = makeTransparent(sprites.crops.floater);
  // Derive 4-frame walk cycle by nudging leg halves and slight lean
  const base = sprites.canvases.walker;
  const W = base.width, H = base.height;
  const midX = Math.floor(W / 2);
  const legY = Math.floor(H * 0.6);
  const makeStep = (leftDown) => {
    const oc = document.createElement('canvas');
    oc.width = W + 2; oc.height = H + 2;
    const o = oc.getContext('2d');
    o.imageSmoothingEnabled = false;
    // slight lean
    const lean = leftDown ? -0.02 : 0.02; // radians
    o.translate((W + 2) / 2, H);
    o.rotate(lean);
    o.translate(-(W + 2) / 2, -H);
    // torso
    o.drawImage(base, 0, 0, W, legY, 1, 0, W, legY);
    // legs split
    const up = -1, down = 1;
    // left leg
    o.drawImage(base, 0, legY, midX, H - legY, 1, legY + (leftDown ? down : up), midX, H - legY);
    // right leg
    o.drawImage(base, midX, legY, W - midX, H - legY, 1 + midX, legY + (leftDown ? up : down), W - midX, H - legY);
    return oc;
  };
  sprites.frames = {
    walker: [
      makeStep(true),
      makeStep(false),
      makeStep(true),
      makeStep(false),
    ]
  };
  sprites.loaded = true;
};
sprites.img.src = 'assets/loochies-art.png';

// Simple tile map for ground/platforms. 0 = empty, 1 = ground (dirt), 2 = wall (brick)
function createEmptyMap(w, h) {
  return new Array(h).fill(0).map(() => new Array(w).fill(0));
}

function makeBase(widthTiles=Math.floor(VIRTUAL_W/TILE), heightTiles=Math.floor(VIRTUAL_H/TILE)) {
  return { width: widthTiles, height: heightTiles, map: createEmptyMap(widthTiles, heightTiles) };
}

function addFloor(lv) {
  for (let x=0;x<lv.width;x++) { lv.map[lv.height-2][x]=1; lv.map[lv.height-1][x]=1; }
}
function addWalls(lv) {
  for (let y=0;y<lv.height;y++) { lv.map[y][0]=2; lv.map[y][lv.width-1]=2; }
}

function level_Blocker() {
  const lv = makeBase();
  addFloor(lv); addWalls(lv);
  const pitX = 14;
  for (let x=pitX;x<pitX+2;x++){ lv.map[lv.height-2][x]=0; lv.map[lv.height-1][x]=0; }
  const exit = { x: 1*TILE, y: (lv.height-2)*TILE - 2*TILE, w: TILE, h: 2*TILE };
  return {
    name:'Level 1 – Blocker', ...lv,
    spawn:{ x:3*TILE+8, y:(lv.height-2)*TILE-1 },
    exit,
    total:10, goal:5, time:60,
    jobs:{ blocker:5, builder:0, digger:0, basher:0, floater:0 }
  };
}

function level_Floater() {
  const lv = makeBase();
  addFloor(lv); addWalls(lv);
  // High ledge on left
  for (let x=2;x<8;x++){ lv.map[lv.height-6][x]=1; lv.map[lv.height-7][x]=1; }
  const exit = { x: (lv.width-2)*TILE, y:(lv.height-2)*TILE - 2*TILE, w:TILE,h:2*TILE };
  return {
    name:'Level 2 – Floater', ...lv,
    spawn:{ x:3*TILE+8, y:(lv.height-7)*TILE-1 },
    exit,
    total:8, goal:5, time:60,
    jobs:{ blocker:0, builder:0, digger:0, basher:0, floater:5 }
  };
}

function level_Builder() {
  const lv = makeBase();
  addFloor(lv); addWalls(lv);
  // Wide gap
  for (let x=10;x<15;x++){ lv.map[lv.height-2][x]=0; lv.map[lv.height-1][x]=0; }
  const exit = { x: 18*TILE, y:(lv.height-2)*TILE - 2*TILE, w:TILE,h:2*TILE };
  return {
    name:'Level 3 – Builder', ...lv,
    spawn:{ x:3*TILE+8, y:(lv.height-2)*TILE-1 },
    exit,
    total:10, goal:6, time:90,
    jobs:{ blocker:0, builder:8, digger:0, basher:0, floater:0 }
  };
}

function level_Basher() {
  const lv = makeBase();
  addFloor(lv); addWalls(lv);
  // Brick wall
  const wx = 14;
  for (let y=lv.height-6;y<lv.height-2;y++){ lv.map[y][wx]=2; lv.map[y][wx+1]=2; }
  const exit = { x: (lv.width-2)*TILE, y:(lv.height-2)*TILE - 2*TILE, w:TILE,h:2*TILE };
  return {
    name:'Level 4 – Basher', ...lv,
    spawn:{ x:3*TILE+8, y:(lv.height-2)*TILE-1 },
    exit,
    total:10, goal:6, time:90,
    jobs:{ blocker:0, builder:0, digger:0, basher:6, floater:0 }
  };
}

function level_Digger() {
  const lv = makeBase();
  addFloor(lv); addWalls(lv);
  // Elevated dirt platform above exit
  for (let x=6;x<20;x++){ lv.map[lv.height-6][x]=1; }
  const exit = { x: 12*TILE, y:(lv.height-2)*TILE - 2*TILE, w:TILE,h:2*TILE };
  return {
    name:'Level 5 – Digger', ...lv,
    spawn:{ x:8*TILE+8, y:(lv.height-7)*TILE-1 },
    exit,
    total:10, goal:6, time:90,
    jobs:{ blocker:0, builder:0, digger:8, basher:0, floater:0 }
  };
}

const levels = [level_Blocker(), level_Floater(), level_Builder(), level_Basher(), level_Digger()];
let level = levels[0];

// Entity system
class Loochie {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0.6; // pixels per frame
    this.vy = 0;
    this.dir = 1; // 1 right, -1 left
    this.state = 'walk'; // 'walk' | 'fall' | 'block' | 'build' | 'dig' | 'bash' | 'float'
    this.width = 10;
    this.height = 14;
    this.frame = 0; // legacy counter
    this.frameTick = 0;
    this.animT = 0;
    this.animFrame = 0;
    this.markedForRemoval = false;
    this.fallStartY = this.y;
    this.hasFloater = false;
    this.buildData = null; // {startTx,startTy,steps,progress}
    this.bashData = null; // {tiles}
  }
  get rect() {
    return { x: this.x - this.width / 2, y: this.y - this.height, w: this.width, h: this.height };
  }
}

const world = {
  loochies: [],
  blockers: [], // subset for quick checks
  spawnClock: 0,
  spawned: 0,
};

function tileAt(px, py) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  // Treat sides as walls, air above/below as empty so pits are falls
  if (tx < 0 || tx >= level.width) return 2;
  if (ty < 0) return 0;
  if (ty >= level.height) return 0;
  return level.map[ty][tx];
}
function solidAt(px, py) {
  const t = tileAt(px, py);
  return t === 1 || t === 2;
}

function intersects(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function updateLoochie(l, dt) {
  // Blocker has no movement
  if (l.state === 'block') return;

  // Gravity
  const feetY = l.y + 1;
  const onGround = solidAt(l.x, feetY);
  if (!onGround) {
    // start falling
    if (l.vy === 0) l.fallStartY = l.y;
    // floater slows fall
    const grav = l.hasFloater && (l.y - l.fallStartY > 10) ? 0.2 : 0.5;
    const vmax = l.hasFloater ? 1.5 : 6;
    l.vy = Math.min(l.vy + grav, vmax);
    l.y += l.vy;
  } else {
    // align to ground grid to reduce sinking
    while (solidAt(l.x, l.y)) l.y -= 0.5;
    // check fall damage only after they've landed once before
    const justLanded = l.vy > 0;
    if (justLanded) {
      if (l.landedOnce && !l.hasFloater && l.y - l.fallStartY > 26) {
        l.markedForRemoval = true;
        state.lost++;
        audio.play('fall');
        return;
      }
      l.landedOnce = true; // first safe landing sets this
    }
    l.vy = 0;
    // move horizontally
    const aheadX = l.x + l.dir * 6;
    const headY = l.y - l.height + 4;
    const blocked = solidAt(aheadX, l.y) || solidAt(aheadX, headY);
    // turn at blockers
    for (const b of world.blockers) {
      if (b === l) continue;
      if (intersects(l.rect, b.rect)) {
        l.dir *= -1;
        break;
      }
    }
    if (blocked) {
      l.dir *= -1;
    } else {
      // special jobs handling when on ground
      if (l.state === 'build' && l.buildData) {
        l.buildData.progress += dt;
        if (l.buildData.progress >= 0.12) {
          l.buildData.progress = 0;
          const i = l.buildData.stepsMade || 0;
          const tx = l.buildData.startTx + i * (l.dir>0?1:-1);
          const floorTop = level.height - 2;
          const floorBot = level.height - 1;
          if (tx > 0 && tx < level.width - 1) {
            level.map[floorTop][tx] = 1;
            level.map[floorBot][tx] = 1;
          }
          l.buildData.stepsMade = i + 1;
          if (l.buildData.stepsMade >= l.buildData.total) {
            l.state = 'walk'; l.buildData = null;
          }
        }
      } else if (l.state === 'dig') {
        const tx = Math.floor(l.x / TILE);
        const ty = Math.floor(l.y / TILE);
        if (ty+1 < level.height && level.map[ty+1][tx] === 1) {
          level.map[ty+1][tx] = 0;
        } else {
          l.state = 'walk';
        }
      } else if (l.state === 'bash' && l.bashData) {
        const tx = Math.floor((l.x + l.dir*8) / TILE);
        const ty = Math.floor((l.y - 8) / TILE);
        let removed = 0;
        for (let y=ty-1;y<=ty+1;y++) {
          const xx = tx;
          if (y>=0 && y<level.height && xx>0 && xx<level.width-1 && level.map[y][xx]===2) { level.map[y][xx]=0; removed++; }
        }
        l.bashData.tiles--;
        if (l.bashData.tiles<=0 || removed===0) { l.state='walk'; l.bashData=null; }
      }

      // step off ledge check
      const footAhead = solidAt(aheadX, feetY + 1);
      if (!footAhead) {
        // start falling
        l.y += 1; // step down
      }
      l.x += l.dir * l.vx;
    }
  }

  // fell into abyss
  if (l.y > VIRTUAL_H + 50) {
    l.markedForRemoval = true;
    state.lost++;
    audio.play('fall');
  }

  // reached exit
  const exitRect = { x: level.exit.x, y: level.exit.y, w: level.exit.w, h: level.exit.h };
  if (intersects(l.rect, exitRect)) {
    l.markedForRemoval = true;
    state.saved++;
    audio.play('saved');
  }

  // animate when moving on ground
  const moving = onGround && Math.abs(l.vx) > 0 && l.state !== 'block';
  if (moving) {
    l.animT += dt;
    if (l.animT >= 0.1) { // ~10 fps
      l.animT -= 0.1;
      l.animFrame = (l.animFrame + 1) % 4;
    }
  } else {
    l.animT = 0;
    l.animFrame = 0;
  }
}

// Drawing utilities
function clear() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);
}
function drawLevel() {
  // sky
  const sky = ctx.createLinearGradient(0, 0, 0, VIRTUAL_H);
  sky.addColorStop(0, '#0b1525');
  sky.addColorStop(1, '#091015');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIRTUAL_W, VIRTUAL_H);

  // dirt ground
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const t = level.map[y][x];
      if (t === 1) {
        drawDirtTile(x * TILE, y * TILE);
      } else if (t === 2) {
        drawBrickTile(x * TILE, y * TILE);
      }
    }
  }
  // exit
  drawExit(level.exit.x, level.exit.y, level.exit.w, level.exit.h);
  // no entrance marker
}

function drawDirtTile(x, y) {
  ctx.fillStyle = '#5b3a1e';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#7a5231';
  ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
  ctx.fillStyle = '#3e2816';
  for (let i = 0; i < 4; i++) {
    ctx.fillRect(x + 2 + i * 3, y + 10 + (i % 2), 2, 2);
  }
}
function drawBrickTile(x, y) {
  ctx.fillStyle = '#6a3d20';
  ctx.fillRect(x, y, TILE, TILE);
  ctx.fillStyle = '#95562b';
  ctx.fillRect(x + 1, y + 5, TILE - 2, 4);
}
function drawExit(x, y, w, h) {
  // Door resting on the floor with simple frame
  ctx.fillStyle = '#0f2541';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#2f64c7';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = '#7aa7ff';
  ctx.fillRect(x + 2, y + h - 5, w - 4, 2);
}

function drawLoochie(l) {
  const px = Math.round(l.x);
  const py = Math.round(l.y);
  const facing = l.dir;
  // base shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px - 5, py - 2, 10, 2);

  // choose sprite
  if (sprites.loaded) {
    let c, crop;
    if (l.state === 'block') {
      c = sprites.canvases.blocker; crop = sprites.crops.blocker;
    } else if (l.state === 'build') {
      c = sprites.canvases.builder; crop = sprites.crops.builder;
    } else if (l.state === 'dig') {
      c = sprites.canvases.digger; crop = sprites.crops.digger;
    } else if (l.state === 'bash') {
      c = sprites.canvases.basher; crop = sprites.crops.basher;
    } else if (!solidAt(l.x, l.y+1) && l.hasFloater && l.y - l.fallStartY > 10) {
      c = sprites.canvases.floater; crop = sprites.crops.floater;
    } else {
      const frames = sprites.frames && sprites.frames.walker ? sprites.frames.walker : [sprites.canvases.walker];
      const idx = frames.length > 1 ? l.animFrame % frames.length : 0;
      c = frames[idx];
      crop = sprites.crops.walker;
    }
    // simple bob animation for walker
    let bob = 0;
    if (l.state !== 'block') bob = Math.sin((l.frame % 60) / 60 * Math.PI * 2) > 0 ? 0 : 1;
    // desired on-screen size around 30-32px tall
    const destH = 30 + bob;
    const aspect = crop.sw / crop.sh;
    const destW = Math.round(destH * aspect);
    const dx = Math.round(px - destW / 2);
    const dy = Math.round(py - destH);
    ctx.save();
    if (facing < 0) {
      ctx.translate(px, 0);
      ctx.scale(-1, 1);
      ctx.translate(-px, 0);
      ctx.drawImage(c, 0, 0, crop.sw, crop.sh, Math.round(px - (px - dx) - destW), dy, destW, destH);
    } else {
      ctx.drawImage(c, 0, 0, crop.sw, crop.sh, dx, dy, destW, destH);
    }
    ctx.restore();
  } else {
    // Fallback: simple rectangle if image not loaded yet
    ctx.fillStyle = '#2cbf6b';
    ctx.fillRect(px - 5, py - 14, 10, 14);
  }
}

// (Old procedural pixel art kept in git history; now drawing from sheet)

function drawUI() {
  const txt = `Saved ${state.saved}/${state.total}  Goal ${state.goal}  Time ${Math.ceil(state.timeLeft)}s`;
  hudStatus.textContent = state.over ? (state.saved >= state.goal ? 'You did it! 🎉' : 'Level failed') : txt;
  blockerCountEl.textContent = String(state.jobCounts.blocker);
  builderCountEl.textContent = String(state.jobCounts.builder);
  diggerCountEl.textContent = String(state.jobCounts.digger);
  basherCountEl.textContent = String(state.jobCounts.basher);
  floaterCountEl.textContent = String(state.jobCounts.floater);
  for (const [btn, key] of [[blockerBtn,'blocker'],[builderBtn,'builder'],[diggerBtn,'digger'],[basherBtn,'basher'],[floaterBtn,'floater']]) {
    btn.disabled = state.jobCounts[key] <= 0 || state.over;
  }
}

// Input handling: select loochie under pointer to assign blocker
function screenToGame(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const gx = ((clientX - rect.left) / rect.width) * VIRTUAL_W;
  const gy = ((clientY - rect.top) / rect.height) * VIRTUAL_H;
  return { x: gx, y: gy };
}
function onPointer(e) {
  if (state.selectedTool === 'none' || state.over) return;
  const p = e.touches ? e.touches[0] : e;
  const { x, y } = screenToGame(p.clientX, p.clientY);
  // find top-most loochie within radius
  let target = null;
  for (let i = world.loochies.length - 1; i >= 0; i--) {
    const l = world.loochies[i];
    if (l.state === 'block') continue;
    // hit test against drawn sprite bounds (+ padding)
    const crop = sprites.crops && sprites.crops.walker ? sprites.crops.walker : { sw: 20, sh: 30 };
    const aspect = crop.sw / crop.sh;
    const destH = 30; // base height
    const destW = Math.round(destH * aspect);
    const pad = 6;
    const rect = { x: l.x - destW / 2 - pad, y: l.y - destH - pad, w: destW + pad * 2, h: destH + pad * 2 };
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      target = l;
      break;
    }
  }
  if (target) {
    const tool = state.selectedTool;
    const spend = (k) => { state.jobCounts[k]--; };
    if (tool === 'blocker' && state.jobCounts.blocker>0) {
      target.state = 'block';
      world.blockers.push(target);
      spend('blocker'); audio.play('blocker');
    } else if (tool === 'builder' && state.jobCounts.builder>0) {
      target.state = 'build';
      const startTx = Math.floor(target.x / TILE) + (target.dir>0?1:-1);
      const startTy = level.height - 2; // not used for placement; set to floorTop for clarity
      target.buildData = { startTx, startTy, total:7, stepsMade:0, progress:0 };
      spend('builder');
    } else if (tool === 'digger' && state.jobCounts.digger>0) {
      target.state = 'dig';
      spend('digger');
    } else if (tool === 'basher' && state.jobCounts.basher>0) {
      target.state = 'bash';
      target.bashData = { tiles: 6 };
      spend('basher');
    } else if (tool === 'floater' && state.jobCounts.floater>0) {
      target.hasFloater = true;
      spend('floater');
    }
    selectNone();
    drawUI();
  }
}
canvas.addEventListener('click', onPointer);
canvas.addEventListener('touchstart', onPointer, { passive: true });

// Game loop
let lastTime = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000); // clamp
  lastTime = now;
  if (!state.over) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.over = true;
    }
  }
  step(dt);
  draw();
  requestAnimationFrame(loop);
}

function step(dt) {
  // Spawn schedule
  if (!state.over && world.spawned < state.total) {
    world.spawnClock -= dt;
    if (world.spawnClock <= 0) {
      world.spawnClock = 1.2; // a bit slower to allow blocker tap
      world.spawned++;
      const l = new Loochie(level.spawn.x, level.spawn.y);
      l.dir = 1; // walk right initially
      world.loochies.push(l);
      audio.play('spawn');
    }
  }
  // Update loochies
  for (const l of world.loochies) updateLoochie(l, dt);
  // Cull removed
  world.loochies = world.loochies.filter((l) => !l.markedForRemoval);
  world.blockers = world.blockers.filter((b) => !b.markedForRemoval);
  // Win condition
  if (!state.over && state.saved >= state.goal) {
    state.over = true;
    audio.play('win');
  }
  // Hard fail when none alive/spawning and not enough saved
  if (!state.over && world.spawned >= state.total && world.loochies.length === 0 && state.saved < state.goal) {
    state.over = true;
  }
  drawUI();
}

function draw() {
  clear();
  drawLevel();
  for (const l of world.loochies) drawLoochie(l);
  // HUD overlay inside canvas: exit and spawn labels
  ctx.fillStyle = '#fff';
  ctx.font = '8px monospace';
  const label = 'EXIT';
  const tw = ctx.measureText(label).width;
  let lx = level.exit.x + level.exit.w + 4;
  if (lx + tw > VIRTUAL_W - 2) lx = level.exit.x - 2 - tw; // keep on screen
  ctx.fillText(label, lx, level.exit.y + 12);
}

function setupLevel() {
  world.loochies = [];
  world.blockers = [];
  world.spawnClock = 0;
  world.spawned = 0;
  state.saved = 0;
  state.lost = 0;
  state.over = false;
  level = levels[state.currentLevel % levels.length];
  state.total = level.total;
  state.goal = level.goal;
  state.timeLeft = level.time;
  state.jobCounts = { ...level.jobs };
  // ensure fresh map references
  level.map = level.map.map(r=>r.slice());
  level.exit = { ...level.exit };
  state.selectedTool = 'none'; selectNone();
  drawUI();
}

setupLevel();
requestAnimationFrame(loop);

