// Loochies - tiny playable slice (walk + Blocker + one level)
// Pixel-art is rendered procedurally to avoid binary sprite assets.

const VIRTUAL_W = 320;
const VIRTUAL_H = 180;
const TILE = 16;

const canvas = document.getElementById('screen');
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
  const scaleX = Math.floor(window.innerWidth / VIRTUAL_W) || 1;
  const scaleY = Math.floor((window.innerHeight - 56) / VIRTUAL_H) || 1; // leave HUD
  const scale = Math.max(1, Math.min(scaleX, scaleY));
  canvas.width = VIRTUAL_W * scale * dpr;
  canvas.height = VIRTUAL_H * scale * dpr;
  canvas.style.width = `${VIRTUAL_W * scale}px`;
  canvas.style.height = `${VIRTUAL_H * scale}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
let ctx = fitCanvas();
window.addEventListener('resize', () => (ctx = fitCanvas()));

// Simple tile map for ground/platforms. 0 = empty, 1 = ground, 2 = wall
function createEmptyMap(w, h) {
  return new Array(h).fill(0).map(() => new Array(w).fill(0));
}

// Level 1: A platform with a pit; place a blocker before the pit to turn them to exit.
const level1 = {
  width: Math.floor(VIRTUAL_W / TILE),
  height: Math.floor(VIRTUAL_H / TILE),
  map: null,
  spawn: { x: 2 * TILE + 8, y: 7 * TILE - 1 }, // slightly above ground
  exit: { x: 1 * TILE, y: 6 * TILE, w: TILE, h: 2 * TILE },
  pitX: 10, // tiles
};
level1.map = createEmptyMap(level1.width, level1.height);
for (let x = 0; x < level1.width; x++) {
  // ground floor
  level1.map[level1.height - 2][x] = 1;
  level1.map[level1.height - 1][x] = 1;
}
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
    this.frame = 0;
    this.frameTick = 0;
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
  if (tx < 0 || ty < 0 || tx >= level1.width || ty >= level1.height) return 2; // treat out-of-range as wall
  return level1.map[ty][tx];
}
function solidAt(px, py) {
  const t = tileAt(px, py);
  return t === 1 || t === 2;
}

function intersects(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

function updateLoochie(l) {
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

  // animate
  l.frameTick = (l.frameTick + 1) % 10;
  if (l.frameTick === 0) l.frame = (l.frame + 1) % 4;
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
  // entrance flag
  drawEntrance(level1.spawn.x - 8, level1.spawn.y - 20);
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
  ctx.fillStyle = '#1b2c50';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#3d5aa6';
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  // arrow
  ctx.fillStyle = '#98f5ff';
  ctx.fillRect(x + w / 2 - 2, y + h - 8, 4, 4);
  ctx.fillRect(x + w / 2 - 4, y + h - 12, 8, 4);
  ctx.fillRect(x + w / 2 - 6, y + h - 16, 12, 4);
}
function drawEntrance(x, y) {
  ctx.fillStyle = '#222';
  ctx.fillRect(x, y, 16, 20);
  ctx.fillStyle = '#4ee2a6';
  ctx.fillRect(x + 3, y + 3, 10, 3);
}

function drawLoochie(l) {
  const px = Math.round(l.x);
  const py = Math.round(l.y);
  const facing = l.dir;
  const f = l.frame % 4;
  const sx = px - 8;
  const sy = py - 16;
  // base shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px - 5, py - 2, 10, 2);

  if (l.state === 'block') {
    drawGirlPoseBlocker(sx, sy, facing);
  } else {
    drawGirlPoseWalk(sx, sy, facing, f);
  }
}

// Procedural pixel art for the brunette girl in a green dress
const COLORS = {
  hair: '#6b3b2a',
  hairDark: '#4a261a',
  skin: '#f1c6a8',
  dress: '#2cbf6b',
  dressDark: '#199453',
  shoe: '#4a2e1f',
  eye: '#2b1a12'
};
function p(x, y, c) {
  ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1);
}
function mirror(left, rightOriginX) {
  return rightOriginX - (left - rightOriginX) - 1;
}
function drawGirlHead(x, y, flip) {
  // simple 12x8 head + hair
  for (let i = 0; i < 12; i++) {
    p(x + (flip ? 11 - i : i), y, COLORS.hairDark);
  }
  // hair volume
  for (let yy = 1; yy <= 4; yy++) {
    for (let xx = 0; xx < 12; xx++) {
      p(x + (flip ? 11 - xx : xx), y + yy, COLORS.hair);
    }
  }
  // face
  for (let yy = 3; yy <= 6; yy++) {
    for (let xx = 2; xx <= 9; xx++) {
      p(x + (flip ? 11 - xx : xx), y + yy, COLORS.skin);
    }
  }
  // eyes
  p(x + (flip ? 11 - 4 : 4), y + 5, COLORS.eye);
  // tiny smile
  p(x + (flip ? 11 - 6 : 6), y + 6, COLORS.hairDark);
}
function drawGirlBody(x, y, flip) {
  // dress
  for (let yy = 0; yy < 6; yy++) {
    for (let xx = 2; xx < 10; xx++) {
      p(x + (flip ? 11 - xx : xx), y + yy, yy < 2 ? COLORS.dress : COLORS.dressDark);
    }
  }
  // legs
  for (let xx = 3; xx <= 4; xx++) p(x + (flip ? 11 - xx : xx), y + 6, COLORS.skin);
  for (let xx = 7; xx <= 8; xx++) p(x + (flip ? 11 - xx : xx), y + 6, COLORS.skin);
}
function drawGirlFeet(x, y, flip, stepLeft, stepRight) {
  // shoes, stepLeft / stepRight is -1..1 offset
  p(x + (flip ? 11 - 3 : 3), y + 8 + stepLeft, COLORS.shoe);
  p(x + (flip ? 11 - 8 : 8), y + 8 + stepRight, COLORS.shoe);
}
function drawGirlPoseWalk(x, y, facing, frame) {
  const flip = facing < 0;
  drawGirlHead(x + 2, y, flip);
  drawGirlBody(x + 2, y + 8, flip);
  const steps = [
    [0, 1],
    [1, 0],
    [0, -1],
    [1, 0],
  ];
  const [sl, sr] = steps[frame];
  drawGirlFeet(x + 2, y + 8, flip, sl, sr);
  // little arm swish
  p(x + (flip ? 11 - 2 : 2), y + 11, COLORS.skin);
  p(x + (flip ? 11 - 9 : 9), y + 11, COLORS.skin);
}
function drawGirlPoseBlocker(x, y, facing) {
  const flip = facing < 0;
  drawGirlHead(x + 2, y, flip);
  drawGirlBody(x + 2, y + 8, flip);
  // feet planted
  drawGirlFeet(x + 2, y + 8, flip, 0, 0);
  // arms out
  for (let i = 0; i < 3; i++) {
    p(x + (flip ? 11 - (1 + i) : 1 + i), y + 10, COLORS.skin);
    p(x + (flip ? 11 - (10 - i) : 10 - i), y + 10, COLORS.skin);
  }
}

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
  const r = 10;
  for (let i = world.loochies.length - 1; i >= 0; i--) {
    const l = world.loochies[i];
    if (l.state === 'block') continue;
    const dx = Math.abs(l.x - x);
    const dy = Math.abs(l.y - y);
    if (dx <= r && dy <= r) {
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
      world.spawnClock = 0.8;
      world.spawned++;
      const l = new Loochie(level1.spawn.x, level1.spawn.y);
      l.dir = 1; // walk right initially
      world.loochies.push(l);
    }
  }
  // Update loochies
  for (const l of world.loochies) updateLoochie(l);
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
  ctx.fillText('EXIT', level1.exit.x - 2, level1.exit.y - 2);
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

