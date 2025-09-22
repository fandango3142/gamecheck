const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// --- Responsive canvas -------------------------------------------------------
let DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
function resize() {
  const Wcss = window.innerWidth;
  const Hcss = window.innerHeight;
  canvas.width = Math.floor(Wcss * DPR);
  canvas.height = Math.floor(Hcss * DPR);
  canvas.style.width = Wcss + "px";
  canvas.style.height = Hcss + "px";
  W = canvas.width;
  H = canvas.height;
  // Recompute layout-dependent values
  R = Math.max(12 * DPR, Math.min(22 * DPR, Math.floor(Math.min(W, H) / 32)));
  HEX_H = Math.sqrt(3) * R;   // vertical spacing between hex centers
  LEFT_PAD = R + BOARD_MARGIN;
  TOP_PAD = R + BOARD_MARGIN + ceilingOffsetPx;
  computeCols();
}
let W = 0, H = 0;
let R = 18;                 // bubble radius (device px)
let HEX_H = Math.sqrt(3) * R;
const BOARD_MARGIN = 4 * DPR;
let LEFT_PAD = 0;
let TOP_PAD = 0;
let ceilingOffsetPx = 0;

// --- Board config ------------------------------------------------------------
let COLS = 0;
let ROWS_VISIBLE = 14; // logical rows visible (more can exist above)
const MAX_ROWS = 40;
function computeCols() {
  // For odd-r staggered grid, usable width ~ LEFT_PAD + COLS*2R + R
  COLS = Math.max(8, Math.floor((W - 2 * BOARD_MARGIN - R) / (2 * R)));
}

// Odd-r offset neighbors (row parity matters)
const NEI_OFFS = {
  even: [[-1,0],[-1,-1],[0,-1],[0,1],[1,0],[ -1,1]],
  odd:  [[-1,0],[0,-1],[1,-1],[0,1],[1,0],[ 1,1]]
};

// Colors
const COLORS = ["#e74c3c","#3498db","#2ecc71","#f1c40f","#9b59b6","#1abc9c","#e67e22"];

// --- Game state --------------------------------------------------------------
let grid = [];       // 2D array rows x cols (null or {color})
let shotsFired = 0;
const SHOTS_BEFORE_DROP = 5;
let gameOver = false;
let paused = false;

const shooter = {
  x: () => W * 0.5,
  y: () => H - 60 * DPR,
  angle: -Math.PI/2,
  cooldown: false,
  current: null,
  next: null
};

function rndColorFromBoard() {
  // Prefer colors present on board to avoid orphan colors
  const set = new Set();
  for (let r=0;r<grid.length;r++) for (let c=0;c<COLS;c++) {
    const cell = grid[r][c];
    if (cell) set.add(cell.color);
  }
  const pool = set.size ? Array.from(set) : COLORS;
  return pool[(Math.random()*pool.length)|0];
}

function newBubble(color = rndColorFromBoard()) {
  return {
    x: shooter.x(),
    y: shooter.y(),
    vx: 0,
    vy: 0,
    color,
    moving: false
  };
}

// --- Grid helpers ------------------------------------------------------------
function rowParity(r){ return (r & 1) ? "odd" : "even"; }

function toPixel(r, c) {
  const x = LEFT_PAD + c * (2 * R) + (r & 1 ? R : 0);
  const y = TOP_PAD + r * (HEX_H * 0.5); // odd-r vertical step is HEX_H/2
  return {x, y};
}

function toCell(x, y) {
  // Approximate row and column, then search local candidates to nearest slot
  const rApprox = Math.max(0, Math.round((y - TOP_PAD) / (HEX_H * 0.5)));
  const parity = rowParity(rApprox);
  const cApprox = Math.round((x - LEFT_PAD - (parity === "odd" ? R : 0)) / (2 * R));
  let best = {r: -1, c: -1, d2: Infinity};
  for (let dr = -2; dr <= 2; dr++) {
    const r = rApprox + dr;
    if (r < 0 || r >= MAX_ROWS) continue;
    const par = rowParity(r);
    for (let dc = -2; dc <= 2; dc++) {
      const c = cApprox + dc;
      if (c < 0 || c >= COLS) continue;
      const {x: cx, y: cy} = toPixel(r, c);
      const dx = x - cx, dy = y - cy, d2 = dx*dx + dy*dy;
      if (d2 < best.d2) best = {r, c, d2};
    }
  }
  return {r: best.r, c: best.c};
}

function inBounds(r, c) { return r >= 0 && r < MAX_ROWS && c >= 0 && c < COLS; }

// --- Init --------------------------------------------------------------------
function initGrid() {
  grid = Array.from({length: MAX_ROWS}, ()=>Array(COLS).fill(null));
  // Seed top rows
  const seedRows = Math.min(ROWS_VISIBLE-4, 8);
  for (let r=0;r<seedRows;r++){
    for (let c=0;c<COLS;c++){
      if (Math.random() < 0.85){
        grid[r][c] = { color: COLORS[(Math.random()*COLORS.length)|0] };
      }
    }
  }
}

function loadShooter() {
  shooter.current = newBubble();
  shooter.next = newBubble();
}

// --- Physics & placement -----------------------------------------------------
const MAX_SPEED = 900;      // px/s
const SUBSTEPS = 3;
const EPS = 0.0001;

function clampAngle(a){
  const minA = (-165 * Math.PI) / 180;
  const maxA = (-15 * Math.PI) / 180;
  return Math.max(minA, Math.min(maxA, a));
}

function shoot(){
  if (gameOver || paused || shooter.cooldown) return;
  const b = shooter.current;
  b.moving = true;
  shooter.cooldown = true;
  b.vx = Math.cos(shooter.angle) * MAX_SPEED;
  b.vy = Math.sin(shooter.angle) * MAX_SPEED;
}

function reflectWalls(b){
  if (b.x <= LEFT_PAD + R) { b.x = LEFT_PAD + R + (LEFT_PAD + R - b.x); b.vx = Math.abs(b.vx); }
  else if (b.x >= W - LEFT_PAD - R) { b.x = W - LEFT_PAD - R - (b.x - (W - LEFT_PAD - R)); b.vx = -Math.abs(b.vx); }
}

function localCellsNear(x, y){
  const {r, c} = toCell(x,y);
  const out = [];
  for (let dr = -2; dr <= 2; dr++){
    for (let dc = -2; dc <= 2; dc++){
      const rr = r+dr, cc = c+dc;
      if (inBounds(rr,cc)) out.push([rr,cc]);
    }
  }
  return out;
}

function collideAndPlace(b){
  // If touch ceiling
  if (b.y - R <= TOP_PAD) {
    const target = toCell(b.x, TOP_PAD + EPS);
    snapIntoCell(target.r, target.c, b.color);
    return true;
  }
  // Check against nearby occupied cells
  const near = localCellsNear(b.x, b.y);
  for (const [r,c] of near){
    const cell = grid[r][c];
    if (!cell) continue;
    const {x: cx, y: cy} = toPixel(r,c);
    const dx = b.x - cx, dy = b.y - cy;
    const dist2 = dx*dx + dy*dy;
    const minDist = 2*R - 0.5*DPR;
    if (dist2 <= minDist*minDist) {
      // Snap to nearest available neighbor slot around [r,c]
      const target = nearestEmptyNeighbor(b.x, b.y, r, c);
      if (!target) return false; // no space (shouldn't happen often)
      snapIntoCell(target.r, target.c, b.color);
      return true;
    }
  }
  return false;
}

function nearestEmptyNeighbor(px, py, r, c){
  const parity = rowParity(r);
  const neigh = NEI_OFFS[parity];
  let best = null, bestD2 = Infinity;
  // Candidate slots include the neighbor cells + current coarse cell
  const candidates = [];
  for (const [dr,dc] of neigh) candidates.push([r+dr,c+dc]);
  candidates.push([r,c]);
  for (const [rr,cc] of candidates){
    if (!inBounds(rr,cc) || grid[rr][cc]) continue;
    const {x: cx, y: cy} = toPixel(rr,cc);
    const d2 = (px-cx)**2 + (py-cy)**2;
    if (d2 < bestD2){ bestD2 = d2; best = {r: rr, c: cc}; }
  }
  return best;
}

function snapIntoCell(r, c, color){
  if (!inBounds(r,c)) return;
  // If occupied, find nearest empty around that slot
  if (grid[r][c]) {
    const alt = nearestEmptyNeighbor(...Object.values(toPixel(r,c)), r, c);
    if (!alt) return;
    r = alt.r; c = alt.c;
  }
  grid[r][c] = { color };
  postPlacement(r, c);
}

function postPlacement(r, c){
  // Matches
  const popped = popMatches(r, c);
  // Floating removal
  const dropped = dropFloating();
  // Prepare next shot
  shooter.current = shooter.next;
  shooter.current.x = shooter.x();
  shooter.current.y = shooter.y();
  shooter.current.vx = 0; shooter.current.vy = 0; shooter.current.moving = false;
  shooter.next = newBubble();
  shooter.cooldown = false;
  shotsFired++;
  if (shotsFired % SHOTS_BEFORE_DROP === 0) dropCeiling();
  checkGameOver();
}

// --- Matching & floating -----------------------------------------------------
function neighborsOf(r,c){
  const out = [];
  const neigh = NEI_OFFS[rowParity(r)];
  for (const [dr,dc] of neigh){
    const rr = r+dr, cc = c+dc;
    if (inBounds(rr,cc) && grid[rr][cc]) out.push([rr,cc]);
  }
  return out;
}

function popMatches(sr, sc){
  const color = grid[sr][sc].color;
  const stack = [[sr,sc]];
  const seen = new Set();
  const comp = [];
  while (stack.length){
    const [r,c] = stack.pop();
    const key = r+"_"+c;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!grid[r][c] || grid[r][c].color !== color) continue;
    comp.push([r,c]);
    for (const nb of neighborsOf(r,c)) stack.push(nb);
  }
  if (comp.length >= 3){
    for (const [r,c] of comp) grid[r][c] = null;
    return comp.length;
  }
  return 0;
}

function dropFloating(){
  // BFS from all bubbles in the top connected to the ceiling rows (r==0 && occupied)
  const visited = new Set();
  const q = [];
  for (let c=0;c<COLS;c++){
    if (grid[0][c]) { visited.add("0_"+c); q.push([0,c]); }
  }
  while (q.length){
    const [r,c] = q.shift();
    for (const [rr,cc] of neighborsOf(r,c)){
      const key = rr+"_"+cc;
      if (!visited.has(key)){ visited.add(key); q.push([rr,cc]); }
    }
  }
  // Any occupied not visited -> drop
  let removed = 0;
  for (let r=0;r<MAX_ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (grid[r][c] && !visited.has(r+"_"+c)){ grid[r][c] = null; removed++; }
    }
  }
  return removed;
}

function dropCeiling(){
  // Add a new row at top and push everything down by half-row (standard mechanic)
  ceilingOffsetPx += HEX_H * 0.5;
  TOP_PAD = R + BOARD_MARGIN + ceilingOffsetPx;
  // If offset >= HEX_H, materialize a concrete row and reset offset
  if (ceilingOffsetPx >= HEX_H) {
    // Shift rows downward by 1 logical row
    for (let r = MAX_ROWS-1; r > 0; r--) {
      for (let c=0;c<COLS;c++) grid[r][c] = grid[r-1][c];
    }
    // New top row
    for (let c=0;c<COLS;c++) {
      grid[0][c] = Math.random() < 0.9 ? { color: COLORS[(Math.random()*COLORS.length)|0] } : null;
    }
    ceilingOffsetPx -= HEX_H;
    TOP_PAD = R + BOARD_MARGIN + ceilingOffsetPx;
  }
}

function checkGameOver(){
  // Lose if any bubble center is below shooter.y() - 2R
  const limit = shooter.y() - 2*R;
  for (let r=0;r<MAX_ROWS;r++){
    for (let c=0;c<COLS;c++){
      if (!grid[r][c]) continue;
      const {y} = toPixel(r,c);
      if (y + R >= limit) { gameOver = true; return; }
    }
  }
  // Win if no bubbles remain
  for (let r=0;r<MAX_ROWS;r++) for (let c=0;c<COLS;c++) if (grid[r][c]) return;
  gameOver = true;
}

// --- Update loop -------------------------------------------------------------
let lastT = 0;
function update(t){
  if (!lastT) lastT = t;
  const dt = Math.min(0.033, (t - lastT) / 1000); // cap dt
  lastT = t;

  if (!paused && !gameOver && shooter.current && shooter.current.moving){
    const b = shooter.current;
    const step = dt / SUBSTEPS;
    for (let i=0;i<SUBSTEPS;i++){
      b.x += b.vx * step;
      b.y += b.vy * step;
      reflectWalls(b);
      if (collideAndPlace(b)) break;
    }
  }

  draw();
  requestAnimationFrame(update);
}

// --- Input -------------------------------------------------------------------
function screenToCanvas(x, y){
  const rect = canvas.getBoundingClientRect();
  return { x: (x - rect.left) * DPR, y: (y - rect.top) * DPR };
}
function aimAt(sx, sy){
  const b = shooter.current;
  const {x, y} = screenToCanvas(sx, sy);
  shooter.angle = clampAngle(Math.atan2(y - shooter.y(), x - shooter.x()));
}

canvas.addEventListener("mousemove",(e)=> aimAt(e.clientX, e.clientY), {passive:true});
canvas.addEventListener("touchmove",(e)=>{ if (e.touches[0]) aimAt(e.touches[0].clientX, e.touches[0].clientY); }, {passive:true});
canvas.addEventListener("mousedown", ()=> shoot());
canvas.addEventListener("touchstart", ()=> shoot(), {passive:true});

document.addEventListener("keydown",(e)=>{
  if (e.key === "ArrowLeft") shooter.angle = clampAngle(shooter.angle - 0.06);
  else if (e.key === "ArrowRight") shooter.angle = clampAngle(shooter.angle + 0.06);
  else if (e.key === " " || e.key === "Enter") shoot();
  else if (e.key === "Shift"){
    if (!shooter.cooldown && !gameOver && !paused){
      const tmp = shooter.current; shooter.current = shooter.next; shooter.next = tmp;
      shooter.current.x = shooter.x(); shooter.current.y = shooter.y();
    }
  } else if (e.key.toLowerCase() === "p") paused = !paused;
});

// --- Render ------------------------------------------------------------------
function drawBubble(x, y, color){
  ctx.beginPath();
  ctx.arc(x, y, R, 0, Math.PI*2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, DPR);
  ctx.strokeStyle = "#1d1d1d";
  ctx.stroke();
}

function drawGrid(){
  for (let r=0;r<MAX_ROWS;r++){
    for (let c=0;c<COLS;c++){
      const cell = grid[r][c];
      if (!cell) continue;
      const {x,y} = toPixel(r,c);
      if (y < -R || y > H + R) continue;
      drawBubble(x, y, cell.color);
    }
  }
}

function drawHUD(){
  // Aim line
  ctx.beginPath();
  ctx.moveTo(shooter.x(), shooter.y());
  ctx.lineTo(shooter.x() + Math.cos(shooter.angle)*80*DPR, shooter.y() + Math.sin(shooter.angle)*80*DPR);
  ctx.lineWidth = 2*DPR;
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();

  // Current
  if (shooter.current && !shooter.current.moving) drawBubble(shooter.current.x, shooter.current.y, shooter.current.color);
  // Next
  if (shooter.next) drawBubble(W - (BOARD_MARGIN + 3*R), H - (BOARD_MARGIN + 3*R), shooter.next.color);

  // Text
  ctx.fillStyle = "#fff";
  ctx.font = `${14*DPR}px system-ui, -apple-system, Segoe UI, Roboto`;
  ctx.textAlign = "left";
  ctx.fillText(`Shots: ${shotsFired}`, BOARD_MARGIN + R, H - (BOARD_MARGIN + 2*R));
  ctx.fillText(`Drop in: ${SHOTS_BEFORE_DROP - (shotsFired % SHOTS_BEFORE_DROP)}`, BOARD_MARGIN + R, H - (BOARD_MARGIN + R));
  if (paused) {
    ctx.textAlign = "center";
    ctx.fillText("Paused (P)", W/2, H/2);
  }
  if (gameOver) {
    ctx.textAlign = "center";
    ctx.fillText("Game Over — Press R to Restart", W/2, H/2);
  }
}

function draw(){
  ctx.clearRect(0,0,W,H);
  drawGrid();
  // Moving bubble on top
  if (shooter.current && shooter.current.moving) drawBubble(shooter.current.x, shooter.current.y, shooter.current.color);
  drawHUD();
}

// --- Restart -----------------------------------------------------------------
document.addEventListener("keydown",(e)=>{
  if (e.key.toLowerCase() === "r"){
    if (gameOver) { shotsFired = 0; gameOver = false; }
    ceilingOffsetPx = 0;
    TOP_PAD = R + BOARD_MARGIN + ceilingOffsetPx;
    initGrid();
    loadShooter();
  }
});

// --- Boot --------------------------------------------------------------------
window.addEventListener("resize", ()=>{ resize(); });
resize();
initGrid();
loadShooter();
requestAnimationFrame(update);
