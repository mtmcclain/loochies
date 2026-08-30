// Loochies - tiny playable slice (walk + Blocker + one level)
// Uses provided sprite sheet (assets/loochies-art.png)

const VIRTUAL_W = 320;
const VIRTUAL_H = 180;
const TILE = 16;

const canvas = document.getElementById('screen');
const stage = document.getElementById('stage');
const hudStatus = document.getElementById('status');
const blockerBtn = document.getElementById('blockerBtn');
const blockerCountEl = document.getElementById('blockerCount');
const restartBtn = document.getElementById('restartBtn');

const state = {
  selectedTool: 'none', // 'blocker'
  blockersRemaining: 5,
  timeLeft: 60, // seconds
  goal: 5,
  total: 10,
  saved: 0,
  lost: 0,
  over: false,
};

blockerBtn.addEventListener('click', () => {
  if (state.blockersRemaining <= 0) return;
  const pressed = blockerBtn.getAttribute('aria-pressed') === 'true';
  const next = !pressed;
  blockerBtn.setAttribute('aria-pressed', String(next));
  state.selectedTool = next ? 'blocker' : 'none';
});
restartBtn.addEventListener('click', () => setupLevel());

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

// Simple tile map for ground/platforms. 0 = empty, 1 = ground, 2 = wall
function createEmptyMap(w, h) {
  return new Array(h).fill(0).map(() => new Array(w).fill(0));
}

// Level 1: A platform with a pit; place a blocker before the pit to turn them to exit.
const level1 = {
  width: Math.floor(VIRTUAL_W / TILE),
  height: Math.floor(VIRTUAL_H / TILE),
  map: null,
  spawn: { x: 3 * TILE + 8, y: 7 * TILE - 1 }, // slightly above ground, more runway
  // Exit bottom should sit on the ground (top of ground is row height-2)
  exit: { x: 1 * TILE, y: 0, w: TILE, h: 2 * TILE },
  pitX: 14, // tiles (further right to give time before the fall)
};
level1.map = createEmptyMap(level1.width, level1.height);
for (let x = 0; x < level1.width; x++) {
  // ground floor
  level1.map[level1.height - 2][x] = 1;
  level1.map[level1.height - 1][x] = 1;
}
// place exit now that we know height
level1.exit.y = (level1.height - 2) * TILE - level1.exit.h;
// walls at edges
for (let y = 0; y < level1.height; y++) {
  level1.map[y][0] = 2;
  level1.map[y][level1.width - 1] = 2;
}
// pit where ground is removed
for (let x = level1.pitX; x < level1.pitX + 2; x++) {
  level1.map[level1.height - 2][x] = 0;
  level1.map[level1.height - 1][x] = 0;
}

// Entity system
class Loochie {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = 0.6; // pixels per frame
    this.vy = 0;
    this.dir = 1; // 1 right, -1 left
    this.state = 'walk'; // 'walk' | 'fall' | 'block'
    this.width = 10;
    this.height = 14;
    this.frame = 0; // legacy counter
    this.frameTick = 0;
    this.animT = 0;
    this.animFrame = 0;
    this.markedForRemoval = false;
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
  if (tx < 0 || tx >= level1.width) return 2;
  if (ty < 0) return 0;
  if (ty >= level1.height) return 0;
  return level1.map[ty][tx];
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
    l.vy = Math.min(l.vy + 0.5, 6);
    l.y += l.vy;
  } else {
    // align to ground grid to reduce sinking
    while (solidAt(l.x, l.y)) l.y -= 0.5;
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
  }

  // reached exit
  const exitRect = { x: level1.exit.x, y: level1.exit.y, w: level1.exit.w, h: level1.exit.h };
  if (intersects(l.rect, exitRect)) {
    l.markedForRemoval = true;
    state.saved++;
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
  for (let y = 0; y < level1.height; y++) {
    for (let x = 0; x < level1.width; x++) {
      const t = level1.map[y][x];
      if (t === 1) {
        drawDirtTile(x * TILE, y * TILE);
      } else if (t === 2) {
        drawBrickTile(x * TILE, y * TILE);
      }
    }
  }
  // exit
  drawExit(level1.exit.x, level1.exit.y, level1.exit.w, level1.exit.h);
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
  blockerCountEl.textContent = String(state.blockersRemaining);
  blockerBtn.disabled = state.blockersRemaining <= 0 || state.over;
}

// Input handling: select loochie under pointer to assign blocker
function screenToGame(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const gx = ((clientX - rect.left) / rect.width) * VIRTUAL_W;
  const gy = ((clientY - rect.top) / rect.height) * VIRTUAL_H;
  return { x: gx, y: gy };
}
function onPointer(e) {
  if (state.selectedTool !== 'blocker' || state.blockersRemaining <= 0 || state.over) return;
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
    target.state = 'block';
    world.blockers.push(target);
    state.blockersRemaining--;
    state.selectedTool = 'none';
    blockerBtn.setAttribute('aria-pressed', 'false');
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
      const l = new Loochie(level1.spawn.x, level1.spawn.y);
      l.dir = 1; // walk right initially
      world.loochies.push(l);
    }
  }
  // Update loochies
  for (const l of world.loochies) updateLoochie(l, dt);
  // Cull removed
  world.loochies = world.loochies.filter((l) => !l.markedForRemoval);
  world.blockers = world.blockers.filter((b) => !b.markedForRemoval);
  // Win condition
  if (!state.over && state.saved >= state.goal) state.over = true;
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
  ctx.fillText('EXIT', level1.exit.x + level1.exit.w + 4, level1.exit.y + 12);
}

function setupLevel() {
  world.loochies = [];
  world.blockers = [];
  world.spawnClock = 0;
  world.spawned = 0;
  state.saved = 0;
  state.lost = 0;
  state.over = false;
  state.timeLeft = 60;
  state.blockersRemaining = 5;
  blockerBtn.setAttribute('aria-pressed', 'false');
  state.selectedTool = 'none';
  drawUI();
}

setupLevel();
requestAnimationFrame(loop);

