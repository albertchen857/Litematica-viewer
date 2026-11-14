// 投影分步拆分算法，原样取自「投影分步查看器.html」（第 246–768 行，一行没改）。
// 和桌面上 litematic_steps.py 是同一套规则。加载后挂在 window.Splitter 上：
//   Splitter.analyze({size, palette:[{n, p}], blocks:[[x,y,z,调色板下标]]}, params)
// 输入的整理见 js/tools/steps.js 的 toSplitterData()。

/* 投影分步拆分算法：层为骨架，纹理为单元 */
(function (root) {
'use strict';

// ---------- 方块知识库 ----------
const COLORS = {
  iron_block:'#DCDCDC', sea_lantern:'#ACC8BE', scaffolding:'#AA844A', mycelium:'#6F6369', dirt:'#866043',
  cyan_terracotta:'#565B5B', gray_concrete:'#36393D', white_concrete:'#CFD5D6', white_terracotta:'#D1B2A1',
  white_wool:'#E9ECEC', glowstone:'#D4B26E', redstone_block:'#AF1805', birch_wall_sign:'#C0AF79',
  iron_trapdoor:'#CBCACA', redstone_wire:'#C81E0A', stone_button:'#7E7E7E', black_wall_banner:'#1D1D21',
  blue_wool:'#35399D', lantern:'#E0A040', light_blue_wall_banner:'#3AB3DA', light_blue_concrete:'#2489C7',
  dark_oak_wall_sign:'#42291A', light_blue_concrete_powder:'#4AB4D5', black_wool:'#141519',
  polished_deepslate:'#484849', polished_deepslate_wall:'#484849', polished_deepslate_stairs:'#484849',
  polished_deepslate_slab:'#484849', warped_trapdoor:'#2B6963', warped_slab:'#2B6963', warped_stairs:'#2B6963',
  stripped_warped_hyphae:'#3A9A94', gray_wall_banner:'#474F52', stone:'#7D7D7D', oak_planks:'#A2834F',
  spruce_planks:'#735531', red_concrete:'#8E2121', polished_diorite:'#C0C1C2', deepslate_tile_wall:'#36363A', black_stained_glass:'#2A2A2E',
  dark_oak_trapdoor:'#4B3219', black_stained_glass_pane:'#2A2A2E', white_carpet:'#E9ECEC', red_carpet:'#A12722', quartz_slab:'#EBE5DE',
  birch_stairs:'#C0AF79', red_wall_banner:'#A12722', anvil:'#444444', jungle_leaves:'#4E8A2A', polished_diorite_stairs:'#C0C1C2',
  moss_block:'#596D2D', deepslate_tile_stairs:'#36363A', cake:'#F2E7D8', birch_fence:'#C0AF79', birch_fence_gate:'#C0AF79',
  chiseled_bookshelf:'#B0905A', spruce_fence_gate:'#735531', tripwire:'#DDDDDD', bookshelf:'#75603A', red_wool:'#A12722',
  tripwire_hook:'#8A8A8A', sea_pickle:'#6A7037', chest:'#A2742F', potted_poppy:'#8A4A2E', potted_cactus:'#8A4A2E', end_rod:'#E6E0D8',
  loom:'#8E7451', barrel:'#86643A', water_cauldron:'#3F76E4', smoker:'#5A5450', smithing_table:'#39333A', furnace:'#6E6E6E',
  brewing_stand:'#7A6A50', slime_block:'#6FC05B', honey_block:'#FBB931', flower_pot:'#8A4A2E', beacon:'#75E1D8', ender_chest:'#2A3A3A',
  string:'#DDDDDD', cauldron:'#3F76E4', stone_bricks:'#7A797A', smooth_stone_slab:'#A0A0A0', stripped_spruce_log:'#74593A', oak_stairs:'#A2834F', deepslate_brick_slab:'#46464A', spruce_trapdoor:'#6B5032', oak_trapdoor:'#7D6339', deepslate_bricks:'#46464A', andesite_wall:'#888889', spruce_fence:'#735531', andesite_stairs:'#888889', spruce_fence_gate:'#735531', deepslate_brick_wall:'#46464A', deepslate_brick_stairs:'#46464A', oak_planks:'#A2834F', spruce_wall_sign:'#735531', spruce_stairs:'#735531', oak_slab:'#A2834F', hopper:'#4A4A4E', lightning_rod:'#C46B4D', glass:'#C0DCE0', torch:'#F0C040', wall_torch:'#F0C040'
};
const ZH = {
  iron_block:'铁块', iron:'铁', stone_bricks:'石砖', smooth_stone_slab:'平滑石台阶', smooth_stone:'平滑石', stripped_spruce_log:'去皮云杉原木',
  oak_stairs:'橡木楼梯', deepslate_brick_slab:'深板岩砖台阶', spruce_trapdoor:'云杉木活板门', oak_trapdoor:'橡木活板门', deepslate_bricks:'深板岩砖',
  deepslate_brick:'深板岩砖', andesite_wall:'安山岩墙', andesite:'安山岩', spruce_fence:'云杉木栅栏', andesite_stairs:'安山岩楼梯', spruce_fence_gate:'云杉木栅栏门',
  deepslate_brick_wall:'深板岩砖墙', deepslate_brick_stairs:'深板岩砖楼梯', oak_planks:'橡木木板', spruce_wall_sign:'云杉木告示牌', spruce_sign:'云杉木告示牌',
  spruce_stairs:'云杉木楼梯', spruce_planks:'云杉木板', oak_slab:'橡木台阶', hopper:'漏斗', lightning_rod:'避雷针', spruce:'云杉木', oak:'橡木',
  red_concrete:'红色混凝土', polished_diorite:'磨制闪长岩', deepslate_tile_wall:'深板岩瓦墙', deepslate_tile:'深板岩瓦', black_stained_glass:'黑色染色玻璃',
  dark_oak_trapdoor:'深色橡木活板门', dark_oak:'深色橡木', black_stained_glass_pane:'黑色染色玻璃板', white_carpet:'白色地毯', red_carpet:'红色地毯',
  quartz_slab:'石英台阶', quartz:'石英', birch_stairs:'白桦木楼梯', birch:'白桦木', red_wall_banner:'红色旗帜', red_banner:'红色旗帜', anvil:'铁砧',
  jungle_leaves:'丛林树叶', polished_diorite_stairs:'磨制闪长岩楼梯', moss_block:'苔藓块', deepslate_tile_stairs:'深板岩瓦楼梯', cake:'蛋糕',
  birch_fence:'白桦木栅栏', birch_fence_gate:'白桦木栅栏门', chiseled_bookshelf:'雕纹书架', spruce_fence_gate:'云杉木栅栏门', tripwire:'绊线（线）',
  string:'线', bookshelf:'书架', red_wool:'红色羊毛', tripwire_hook:'绊线钩', sea_pickle:'海泡菜', chest:'箱子', potted_poppy:'盆栽虞美人',
  potted_cactus:'盆栽仙人掌', end_rod:'末地烛', loom:'织布机', barrel:'木桶', water_cauldron:'装水的炼药锅', cauldron:'炼药锅', smoker:'烟熏炉',
  smithing_table:'锻造台', furnace:'熔炉', brewing_stand:'酿造台', slime_block:'黏液块', honey_block:'蜂蜜块', flower_pot:'花盆', beacon:'信标',
  ender_chest:'末影箱', sea_lantern:'海晶灯', scaffolding:'脚手架', mycelium:'菌丝体', dirt:'泥土',
  cyan_terracotta:'青色陶瓦', gray_concrete:'灰色混凝土', white_concrete:'白色混凝土', white_terracotta:'白色陶瓦',
  white_wool:'白色羊毛', glowstone:'荧石', redstone_block:'红石块', birch_wall_sign:'白桦木告示牌',
  birch_sign:'白桦木告示牌', iron_trapdoor:'铁活板门', redstone_wire:'红石粉', redstone:'红石粉', stone_button:'石头按钮',
  black_wall_banner:'黑色旗帜', black_banner:'黑色旗帜', blue_wool:'蓝色羊毛', lantern:'灯笼',
  light_blue_wall_banner:'淡蓝色旗帜', light_blue_banner:'淡蓝色旗帜', light_blue_concrete:'淡蓝色混凝土',
  dark_oak_wall_sign:'深色橡木告示牌', dark_oak_sign:'深色橡木告示牌', light_blue_concrete_powder:'淡蓝色混凝土粉末',
  black_wool:'黑色羊毛', polished_deepslate:'磨制深板岩', polished_deepslate_wall:'磨制深板岩墙',
  polished_deepslate_stairs:'磨制深板岩楼梯', polished_deepslate_slab:'磨制深板岩台阶', warped_trapdoor:'诡异木活板门',
  warped_slab:'诡异木台阶', warped_stairs:'诡异木楼梯', stripped_warped_hyphae:'去皮诡异菌核',
  gray_wall_banner:'灰色旗帜', gray_banner:'灰色旗帜', warped:'诡异木', light_blue_concrete_fam:'淡蓝色混凝土'
};
const ROLE_ZH = {skeleton:'骨架', fill:'填充', opening:'开口', detail:'外形细节', furnish:'室内陈设', attach:'附着物', redstone:'红石/功能'};
const ROLE_PRI = {skeleton:0, fill:1, opening:2, detail:3, furnish:3.5, attach:4, redstone:5};
const NOTE_KINDS = ['cross','warn','info','mix','cont','merge'];

function zh(n){ return ZH[n] || n.replace(/_/g,' '); }

function family(n){
  let f = n.replace(/^stripped_/, '');
  f = f.replace(/_(stairs|slab|wall|fence_gate|fence|trapdoor|door|button|pressure_plate|wall_sign|sign|hanging_sign|wall_banner|banner|carpet|pane|powder)$/, '');
  f = f.replace(/_(planks|log|wood|hyphae|stem)$/, '');
  return f;
}
function matClass(f){
  if (/terracotta$/.test(f)) return 'terracotta';
  if (/concrete$/.test(f)) return 'concrete';
  if (/wool$/.test(f)) return 'wool';
  if (/^(sea_lantern|glowstone|shroomlight|.*froglight|redstone_lamp)$/.test(f)) return 'light';
  if (/^(dirt|coarse_dirt|grass_block|mycelium|podzol|rooted_dirt|mud|moss_block)$/.test(f)) return 'soil';
  if (/(oak|spruce|birch|jungle|acacia|mangrove|cherry|bamboo|crimson|warped)/.test(f)) return 'wood';
  if (/(stone|deepslate|andesite|diorite|granite|tuff|cobble|brick|blackstone|basalt|calcite)/.test(f)) return 'stone';
  if (/_block$/.test(f)) return 'metal';
  return f;
}
function familyName(f, members){
  if (ZH[f] && members.length===1) return ZH[members[0]] || ZH[f];
  if (f==='warped') return '诡异木';
  if (ZH[f]) return ZH[f];
  return members.map(zh).join('/');
}

const ATTACH_RE = /(_wall_banner|_banner|_wall_sign|_sign|_button|^lantern$|soul_lantern|torch|^redstone_wire$|_carpet$|^ladder$|^vine$|^lever$|_pressure_plate$|rail$|candle|flower_pot|^potted_|^lightning_rod$|^sea_pickle$|^end_rod$|^tripwire)/;
const FURNISH_RE = /^(chest|trapped_chest|ender_chest|barrel|furnace|smoker|blast_furnace|loom|smithing_table|crafting_table|cartography_table|fletching_table|brewing_stand|cauldron|water_cauldron|lava_cauldron|beacon|anvil|chipped_anvil|damaged_anvil|enchanting_table|lectern|grindstone|stonecutter|composter|cake|bell|jukebox|note_block)$/;
const REDSTONE_RE = /^(redstone_block|repeater|comparator|observer|piston|sticky_piston|dispenser|dropper|hopper|target|daylight_detector)$/;
const DETAIL_RE = /(_stairs|_slab|_wall$|_fence|_fence_gate|_trapdoor|_pane$|^iron_bars$|^chain$|^scaffolding$)/;
const OPEN_RE = /(glass$|_door$|glass_pane$)/;
const GRAVITY_RE = /(^sand$|^red_sand$|^gravel$|_concrete_powder$|anvil$)/;

function roleOf(st){
  const n = st.n;
  if (REDSTONE_RE.test(n)) return 'redstone';
  if (FURNISH_RE.test(n)) return 'furnish';
  if (ATTACH_RE.test(n)) return 'attach';
  if (OPEN_RE.test(n)) return 'opening';
  if (DETAIL_RE.test(n)) return 'detail';
  if (st.p && st.p.axis && /(_log|_wood|_hyphae|_stem|pillar|basalt)$/.test(n)) return 'skeleton';
  return 'fill';
}
const DIRS = {north:[0,0,-1], south:[0,0,1], east:[1,0,0], west:[-1,0,0]};
// 附着物的依附位置（相对偏移），null 表示不需要依附
function supportOffset(st){
  const n = st.n, p = st.p || {};
  if (n==='end_rod'){ if (p.facing==='up') return [0,-1,0]; if (p.facing==='down') return [0,1,0]; const d = DIRS[p.facing]; return d ? [-d[0],0,-d[2]] : null; }
  if (n==='tripwire') return null;
  if (/_wall_banner$|_wall_sign$|wall_torch$|^ladder$|^tripwire_hook$/.test(n) && p.facing){ const d = DIRS[p.facing]; return [-d[0],0,-d[2]]; }
  if (/_button$|^lever$/.test(n)){
    if (p.face==='floor') return [0,-1,0];
    if (p.face==='ceiling') return [0,1,0];
    const d = DIRS[p.facing]; return [-d[0],0,-d[2]];
  }
  if (/lantern$/.test(n)) return p.hanging==='true' ? [0,1,0] : [0,-1,0];
  if (/(^redstone_wire$|_carpet$|_banner$|_sign$|^torch$|_pressure_plate$|rail$|candle|flower_pot|^potted_|^sea_pickle$|^cake$)/.test(n)) return [0,-1,0];
  if (GRAVITY_RE.test(n)) return [0,-1,0];
  return null;
}
const ITEM = n => n.replace(/_wall_(banner|sign|torch)$/, '_$1').replace(/^redstone_wire$/, 'redstone').replace(/^tripwire$/, 'string').replace(/^water_cauldron$/, 'cauldron');
const STACK = n => /(banner|sign)$/.test(n) ? 16 : /^(cake|.*_bed)$/.test(n) ? 1 : 64;

// ---------- 颜色 ----------
function hex2rgb(h){ const v = parseInt(h.slice(1),16); return [v>>16&255, v>>8&255, v&255]; }
function hashColor(s){ let h=0; for (const c of s) h = (h*31 + c.charCodeAt(0))|0; const hue = Math.abs(h)%360; return hsl2hex(hue, 45, 55); }
function hsl2hex(h,s,l){ s/=100; l/=100; const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l), f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1));
  return '#'+[f(0),f(8),f(4)].map(x=>Math.round(x*255).toString(16).padStart(2,'0')).join(''); }
function colorOf(n){ return COLORS[n] || hashColor(n); }
function rgb2lab([r,g,b]){
  [r,g,b] = [r,g,b].map(v=>{ v/=255; return v>0.04045 ? Math.pow((v+0.055)/1.055,2.4) : v/12.92; });
  let x=(r*0.4124+g*0.3576+b*0.1805)/0.95047, y=(r*0.2126+g*0.7152+b*0.0722), z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const f=t=>t>0.008856?Math.cbrt(t):7.787*t+16/116; x=f(x); y=f(y); z=f(z);
  return [116*y-16, 500*(x-y), 200*(y-z)];
}
function deltaE(a,b){ const A=rgb2lab(hex2rgb(a)), B=rgb2lab(hex2rgb(b)); return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]); }

// ---------- 主算法 ----------
function analyze(data, params){
  const P = Object.assign({simThreshold:8, minBlocks:4, mergeShapes:false, maxMaterials:9, bandMerge:true, crossLayer:true, crossPerLayer:8, crossMaxSpan:8}, params||{});
  const pal = data.palette.map(st => {
    const role = roleOf(st);
    return {n:st.n, p:st.p||{}, role, fam:family(st.n), color:colorOf(st.n), sup:supportOffset(st), gravity:GRAVITY_RE.test(st.n), item:ITEM(st.n)};
  });
  const B = data.blocks.map((b,i)=>({i, x:b[0], y:b[1], z:b[2], s:b[3]}));
  const at = new Map(); const K=(x,y,z)=>x+','+y+','+z;
  B.forEach(b=>at.set(K(b.x,b.y,b.z), b));
  const [SX,SY,SZ] = data.size;

  // 1. 材质族 → 相似材质聚类（并查集，按族平均色的 ΔE）
  const fams = {}; pal.forEach(p=>{ (fams[p.fam] = fams[p.fam] || {members:new Set(), colors:[]}); fams[p.fam].members.add(p.n); });
  const famList = Object.keys(fams);
  famList.forEach(f=>{ fams[f].color = colorOf([...fams[f].members].find(n=>COLORS[n]) || [...fams[f].members][0]); });
  // 同一“材质类”内才允许合并；完全链接（簇内任意两族 ΔE 都要小于阈值），避免链式串色
  let groups = famList.map(f=>[f]);
  const dE = {}; const de=(a,b)=> dE[a+'|'+b] ?? (dE[a+'|'+b] = (matClass(a)===matClass(b) ? deltaE(fams[a].color, fams[b].color) : Infinity));
  for(;;){
    let best=null, bv=P.simThreshold;
    for (let i=0;i<groups.length;i++) for (let j=i+1;j<groups.length;j++){
      let m=0; for (const a of groups[i]) for (const b of groups[j]) m=Math.max(m, de(a,b));
      if (m<bv){ bv=m; best=[i,j]; }
    }
    if (!best) break;
    groups[best[0]] = groups[best[0]].concat(groups[best[1]]); groups.splice(best[1],1);
  }
  const clusterOf = {}; groups.forEach(g=>g.forEach(f=>clusterOf[f]=g.slice().sort()[0]));
  const find = f => clusterOf[f];
  pal.forEach(p=>p.cluster = find(p.fam));

  // 2. 依赖 & 倒挂：确定每块的“建造层”
  B.forEach(b=>{
    const p = pal[b.s]; b.buildY = b.y; b.deferred=false; b.supportMissing=false; b.supBlock=null;
    if (p.sup){
      const sb = at.get(K(b.x+p.sup[0], b.y+p.sup[1], b.z+p.sup[2]));
      if (!sb && !(b.y===0 && p.sup[1]===-1)) b.supportMissing = true;
      b.supBlock = sb || null;
      if (p.sup[1]===1 && sb){ b.buildY = b.y+1; b.deferred = true; }
    }
  });

  // 3. 层带合并：连续完全相同的层折叠
  const sig = y => B.filter(b=>b.y===y).map(b=>b.x+','+b.z+','+b.s).sort().join('|');
  const bands = []; // {y0, n}
  for (let y=0;y<SY;y++){
    const last = bands[bands.length-1];
    if (P.bandMerge && last && sig(y)!=='' && sig(y)===sig(last.y0) && !B.some(b=>b.deferred && (b.buildY===y || b.buildY===last.y0))) last.n++;
    else bands.push({y0:y, n:1});
  }
  const bandOf = {}; bands.forEach((bd,i)=>{ for (let k=0;k<bd.n;k++) bandOf[bd.y0+k]=i; });

  // 4. 层内区域生长 + 纹理体纵向追踪
  const bodies = []; const bodyCountByName = {};
  let prevRegions = []; // 上一已处理层的 {cluster, role, cells:Set('x,z'), body}
  const layers = [];
  for (const bd of bands){
    const y = bd.y0;
    const layerBlocks = B.filter(b=>b.buildY===y);
    const regions = [];
    const seen = new Set();
    const byXZ = new Map(); layerBlocks.forEach(b=>{ if(!b.deferred) byXZ.set(b.x+','+b.z, b); });
    for (const b of layerBlocks){
      if (seen.has(b.i)) continue;
      const p = pal[b.s];
      if (b.deferred || p.role==='attach' || p.role==='redstone' || p.role==='furnish'){
        seen.add(b.i);
        regions.push({role:p.role, cluster:'_'+p.role+(b.deferred?'_d':''), blocks:[b], loose:true, deferred:b.deferred});
        continue;
      }
      const reg = {role:p.role, cluster:p.cluster, blocks:[]};
      const q=[b]; seen.add(b.i);
      while (q.length){
        const c=q.pop(); reg.blocks.push(c);
        for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
          const nb = byXZ.get((c.x+dx)+','+(c.z+dz));
          if (nb && !seen.has(nb.i) && pal[nb.s].role===p.role && pal[nb.s].cluster===p.cluster){ seen.add(nb.i); q.push(nb); }
        }
      }
      regions.push(reg);
    }
    // 松散的附着物/红石：按 (角色, 是否倒挂) 合成一组
    const loose = {}; const solid = [];
    for (const r of regions){
      if (!r.loose){ solid.push(r); continue; }
      const k = r.cluster; if (!loose[k]) loose[k] = {role:r.role, cluster:k, blocks:[], deferred:r.deferred, loose:true}; loose[k].blocks.push(...r.blocks);
    }
    // 纹理体追踪：与上一层同簇区域按（8邻域膨胀后）重叠匹配
    for (const r of solid){
      r.cells = new Set(r.blocks.map(b=>b.x+','+b.z));
      let best=null, bestScore=0;
      for (const pr of prevRegions){
        if (pr.cluster!==r.cluster || pr.role!==r.role) continue;
        let score=0;
        for (const b of r.blocks){
          let hit = pr.cells.has(b.x+','+b.z) ? 2 : 0;
          if (!hit) for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) if (pr.cells.has((b.x+dx)+','+(b.z+dz))){ hit=1; break; }
          score += hit;
        }
        if (score>bestScore){ bestScore=score; best=pr; }
      }
      if (best){ r.body = best.body; r.continued = true; best.body.layers.add(y); }
      else {
        const counts = {}; r.blocks.forEach(b=>counts[pal[b.s].n]=(counts[pal[b.s].n]||0)+1);
        const dom = Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
        const famMembers = [...new Set(pal.filter(p=>p.cluster===r.cluster).map(p=>p.n))];
        const base = famMembers.length>1 ? (ZH[pal[r.blocks[0].s].fam] || zh(dom)) : zh(dom); bodyCountByName[base]=(bodyCountByName[base]||0)+1;
        const body = {id:bodies.length, name: base+' #'+bodyCountByName[base], color: colorOf(dom), cluster:r.cluster, layers:new Set([y]), startY:y};
        bodies.push(body); r.body = body; r.continued=false;
      }
    }
    prevRegions = solid.map(r=>({cluster:r.cluster, role:r.role, cells:r.cells, body:r.body}));
    layers.push({y, band:bd.n, ys:Array.from({length:bd.n},(_,k)=>y+k), solid, loose:Object.values(loose)});
  }

  // 5. 区域 → 步骤（拆大、合小、快捷栏约束）
  const steps = [];
  const NB6 = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const schedPlaced = new Set();
  // 从已放置方块/地面出发，在给定方块集合内逐块延伸，返回够不着的方块
  function unreachable(blocks, placedSet){
    const ok = new Set(); let pr=true;
    while (pr){ pr=false;
      for (const b of blocks){ if (ok.has(b.i)) continue;
        if (b.y===0 || NB6.some(([dx,dy,dz])=>{ const n=at.get(K(b.x+dx,b.y+dy,b.z+dz)); return n && (placedSet.has(n.i) || ok.has(n.i)); })){ ok.add(b.i); pr=true; } } }
    return blocks.filter(b=>!ok.has(b.i));
  }
  layers.forEach((L, li)=>{
    // 同一层里同种类型（同材质簇 + 同角色）的方块，不论多少、不论分散在哪，先归成一组
    const groups = new Map();
    for (const r of L.solid){
      const k = r.cluster+'|'+(P.mergeShapes && (r.role==='fill'||r.role==='detail') ? 'shape' : r.role);
      if (!groups.has(k)) groups.set(k, {role:r.role, cluster:r.cluster, blocks:[], bodies:[], continued:false, spots:0});
      const g = groups.get(k); g.blocks.push(...r.blocks); if (!g.bodies.includes(r.body)) g.bodies.push(r.body);
      g.continued = g.continued || r.continued; g.spots++;
    }
    let units = [...groups.values()];
    // 本层只有寥寥几块的独特材质，顺带并进紧挨着的那一步
    const adj = (a,b)=>a.blocks.some(p=>b.blocks.some(q=>Math.abs(p.x-q.x)<=1 && Math.abs(p.z-q.z)<=1));
    const dist = (a,b)=>{ let m=1e9; for(const p of a.blocks) for(const q of b.blocks) m=Math.min(m, Math.max(Math.abs(p.x-q.x),Math.abs(p.z-q.z))); return m; };
    for (let changed=true; changed;){
      changed=false;
      units.sort((a,b)=>a.blocks.length-b.blocks.length);
      for (const u of units){
        if (u.blocks.length >= P.minBlocks) continue;
        const others = units.filter(o=>o!==u);
        const big = (a,b)=>b.blocks.length-a.blocks.length;
        const host = others.filter(o=>o.role===u.role && adj(o,u)).sort(big)[0]
          || others.filter(o=>o.cluster===u.cluster && adj(o,u)).sort(big)[0]
          || others.filter(o=>o.role===u.role && dist(o,u)<=2).sort((a,b)=>dist(a,u)-dist(b,u))[0]
          || others.filter(o=>adj(o,u) && ROLE_PRI[o.role] >= ROLE_PRI[u.role]).sort(big)[0];
        if (!host) continue;
        host.blocks.push(...u.blocks);
        host.merged = (host.merged||[]).concat(u.blocks.map(b=>zh(pal[b.s].n)));
        host.bodies = host.bodies.concat(u.bodies.filter(b=>!host.bodies.includes(b)));
        units.splice(units.indexOf(u),1); changed=true; break;
      }
    }
    for (const r of L.loose) units.push({role:r.role, cluster:r.cluster, blocks:r.blocks, bodies:[], deferred:r.deferred, loose:true});
    // 快捷栏约束
    const out=[];
    for (const u of units){
      const items = [...new Set(u.blocks.map(b=>pal[b.s].item))];
      if (items.length <= P.maxMaterials){ out.push(u); continue; }
      for (let i=0;i<items.length;i+=P.maxMaterials){
        const grp = new Set(items.slice(i,i+P.maxMaterials));
        out.push(Object.assign({}, u, {blocks:u.blocks.filter(b=>grp.has(pal[b.s].item)), hotbarSplit:true}));
      }
    }
    // 排序：角色优先级 → 最近邻走位。支撑感知：
    //  ① 选中的组有方块够不着依附面，而另一组能立刻整组放且正好挨着它们 → 先放那组；
    //  ② 否则把这一组拆成“现在就能放的部分”和“被挡住/够不着、要等后面的部分”。
    let pos = [0,0]; const ordered=[]; const rest = out.slice();
    const pri = u => u.deferred ? 99 : ROLE_PRI[u.role];
    const near = u => Math.min(...u.blocks.map(b=>Math.hypot(b.x-pos[0], b.z-pos[1])));
    let guard = 0;
    while (rest.length && guard++ < 100000){
      rest.sort((a,b)=>pri(a)-pri(b) || near(a)-near(b));
      let u = rest[0];
      if (!u.loose){
        const un = unreachable(u.blocks, schedPlaced);
        if (un.length){
          // 先判断是“顺序问题”（本层别的组放了以后就够得着）还是“真悬空”（怎么排都够不着，只能垫块）
          const others = rest.filter(o=>o!==u && !o.loose);
          const supAll = new Set(schedPlaced); others.forEach(o=>o.blocks.forEach(b=>supAll.add(b.i)));
          const orderIssue = unreachable(u.blocks, supAll).length < un.length;
          if (orderIssue){
            const ready = o => unreachable(o.blocks, schedPlaced).length===0;
            const helper = others.find(o=>ready(o) && o.blocks.some(p=>un.some(q=>Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+Math.abs(p.z-q.z)===1)))
                        || others.find(ready);
            if (helper){ helper.enables = u; u = helper; }
            else {
              // 互相卡住（两种方块交替撑着往外伸，比如檐口）：不拆同种方块，而是把互相依赖的几组并成一步交错放
              for (let k=0;k<6;k++){
                const un2 = unreachable(u.blocks, schedPlaced); if (!un2.length) break;
                const dep = rest.filter(o=>o!==u && !o.loose && o.blocks.some(p=>un2.some(q=>Math.abs(p.x-q.x)+Math.abs(p.y-q.y)+Math.abs(p.z-q.z)===1)));
                if (!dep.length) break;
                for (const o of dep){
                  u.blocks.push(...o.blocks); u.interleave = true; u.spots=(u.spots||1)+(o.spots||1);
                  o.bodies.forEach(x=>{ if(!u.bodies.includes(x)) u.bodies.push(x); });
                  u.merged=(u.merged||[]).concat(o.merged||[]);
                  rest.splice(rest.indexOf(o),1);
                }
              }
            }
          }
        }
      }
      rest.splice(rest.indexOf(u),1);
      u.blocks.sort((a,b)=>Math.hypot(a.x-pos[0],a.z-pos[1])-Math.hypot(b.x-pos[0],b.z-pos[1]));
      const last = u.blocks[u.blocks.length-1]; pos=[last.x,last.z];
      u.blocks.forEach(b=>schedPlaced.add(b.i));
      ordered.push(u);
    }
    L.units = ordered;
  });

  // 5b. 跨层步骤：细小的竖向构件（立柱、望柱、宝顶、贴柱装饰、斜脊）一口气往上做完
  //   条件：起始层这一份 ≤ crossPerLayer；上一层候选也 ≤ crossPerLayer；
  //   且候选要么“正好叠在链条顶上”（任意材质），要么“同材质同角色、与链条顶斜向相邻”；
  //   并且只靠链条本身 + 起始时已放好的方块就能放得上去（不需要上层其他步骤先做）。
  if (P.crossLayer){
    for (let li=0; li<layers.length; li++){
      const L0 = layers[li]; if (L0.band>1) continue;
      for (const A of L0.units){
        if (A.loose || A.deferred) continue;
        const soleA = L0.units.length===1;
        if (A.blocks.length > P.crossPerLayer && !soleA) continue;
        const idxA = L0.units.indexOf(A);
        const base = new Set();
        B.forEach(b=>{ if (b.buildY < L0.y) base.add(b.i); });
        L0.units.slice(0, idxA).forEach(u=>u.blocks.forEach(b=>base.add(b.i)));
        let top = A.blocks.slice(); const layersIn=[{y:L0.y, n:A.blocks.length}];
        for (let lj=li+1; lj<layers.length; lj++){
          const Ly = layers[lj]; if (Ly.band>1 || Ly.y - L0.y >= P.crossMaxSpan || Ly.y !== top[0].y+1) break;
          const chain = new Set(A.blocks.map(b=>b.i)); const topXZ = top.map(b=>[b.x,b.z]);
          const added = [];
          for (const Bu of Ly.units.slice()){
            const sole = Ly.units.length===1 && !Bu.loose && Bu.cluster===A.cluster && Bu.role===A.role;  // 这一层只剩这个构件（招牌、塔尖…）
            if (Bu.deferred || (Bu.blocks.length > P.crossPerLayer && !sole)) continue;
            const stacked = Bu.blocks.every(b=>{ const d = at.get(K(b.x,b.y-1,b.z)); return d && chain.has(d.i); });
            const slanted = !Bu.loose && Bu.cluster===A.cluster && Bu.role===A.role && Bu.blocks.every(b=>topXZ.some(([x,z])=>Math.abs(x-b.x)<=1 && Math.abs(z-b.z)<=1));
            if (!stacked && !slanted && !sole) continue;
            const sup = new Set([...base, ...A.blocks.map(b=>b.i)]);
            const unB = unreachable(Bu.blocks, sup).length;
            if (unB && !(sole && unB < Bu.blocks.length)) continue;   // 独立构件里个别真悬空的块照样标红点，不阻断
            A.blocks.push(...Bu.blocks); added.push(...Bu.blocks);
            Bu.bodies.forEach(x=>{ if (!A.bodies.includes(x)) A.bodies.push(x); });
            A.merged = (A.merged||[]).concat(Bu.merged||[]);
            Ly.units.splice(Ly.units.indexOf(Bu),1);
          }
          if (!added.length) break;
          layersIn.push({y:Ly.y, n:added.length}); top = added;
        }
        if (layersIn.length>1) A.cross = layersIn;
      }
    }
  }

  // 5c. 同层同类合并：普通组按“材质簇+角色”，跨层组按“材质组成+跨度”（例如前后/左右对称的两组构件）
  const usig = u => u.cross ? 'X|'+u.cross.map(c=>c.y).join(',')+'|'+[...new Set(u.blocks.map(b=>pal[b.s].fam))].sort().join(',')
                           : u.cluster+'|'+u.role+(u.interleave?'|mix':'');
  for (const L of layers){
    for (let again=true; again;){ again=false;
      outer2: for (const a of L.units) for (const b of L.units){
        if (a===b || a.loose || b.loose || L.units.indexOf(a) > L.units.indexOf(b) || usig(a)!==usig(b)) continue;
        a.blocks.push(...b.blocks); a.merged=(a.merged||[]).concat(b.merged||[]); a.spots=(a.spots||1)+(b.spots||1);
        b.bodies.forEach(x=>{ if(!a.bodies.includes(x)) a.bodies.push(x); });
        if (a.cross) a.cross = a.cross.map((c,k)=>({y:c.y, n:c.n + b.cross[k].n}));
        if (b.enables && !a.enables) a.enables=b.enables;
        L.units.splice(L.units.indexOf(b),1); again=true; break outer2;
      }
    }
  }

  layers.forEach((L, li)=>{
    L.units.forEach((u,k)=>{
      const st = {id:steps.length, layer:li, y:L.y, band:L.band, idxInLayer:k, role:u.role, blocks:u.blocks, deferred:!!u.deferred,
        bodies:u.bodies, enables:u.enables, part:u.part, continued:u.continued, merged:u.merged||[], hotbarSplit:u.hotbarSplit, notes:[], deps:new Set(),
        cross:u.cross||null, spots:u.spots||1, interleave:!!u.interleave};
      st.title = u.loose ? (u.deferred ? '倒挂附着物（从下方放置）' : ROLE_ZH[u.role]) :
        u.bodies[0].name + (u.part ? `（第${u.part[0]}/${u.part[1]}段）` : '');
      steps.push(st); u.step = st;
      u.blocks.forEach(b=>b.step=st.id);
    });
    L.steps = L.units.map(u=>u.step.id);
  });

  // 6. 依赖、悬空检测、材料、混搭纹理
  const placed = new Set(); const ground = b=>b.y===0;
  for (const L of layers){
    for (const sid of L.steps){
      const st = steps[sid];
      // 依赖
      st.blocks.forEach(b=>{ if (b.supBlock && b.supBlock.step!==undefined && b.supBlock.step!==st.id) st.deps.add(b.supBlock.step); });
      // 悬空：以“下方各层 + 本层先前步骤”为已放置；本步内逐块向外延伸。
      // 若延伸不到，再看能否借助本层后续步骤连通（=顺序问题），都不行才算真悬空
      const pending = new Set(st.blocks.map(b=>b.i)); let progress=true;
      while (progress){
        progress=false;
        for (const b of st.blocks){
          if (!pending.has(b.i)) continue;
          if (ground(b) || NB6.some(([dx,dy,dz])=>{ const n=at.get(K(b.x+dx,b.y+dy,b.z+dz)); return n && placed.has(n.i); })){
            placed.add(b.i); pending.delete(b.i); progress=true;
          }
        }
      }
      st.laterSupported = [];
      if (pending.size){
        // 用整层（含后续步骤）做连通性检查
        const layerSet = new Set(B.filter(b=>b.buildY===st.y).map(b=>b.i));
        const ok = new Set(); let pr=true;
        while (pr){ pr=false;
          for (const i of layerSet){ if (ok.has(i)) continue; const b=B[i];
            if (ground(b) || NB6.some(([dx,dy,dz])=>{ const n=at.get(K(b.x+dx,b.y+dy,b.z+dz)); return n && ((placed.has(n.i) && !pending.has(n.i)) || ok.has(n.i)); })){ ok.add(i); pr=true; } } }
        for (const i of [...pending]) if (ok.has(i)){ st.laterSupported.push(i); pending.delete(i); }
      }
      st.floating = st.blocks.filter(b=>pending.has(b.i)).map(b=>b.i);
      st.blocks.forEach(b=>placed.add(b.i));
      // 层带内重复层：把同位置的方块也视为本步骤
      st.allBlocks = st.blocks.slice();
      for (let k=1;k<st.band;k++) st.blocks.forEach(b=>{ const o=at.get(K(b.x,b.y+k,b.z)); if(o){ o.step=st.id; st.allBlocks.push(o); placed.add(o.i);} });
      // 材料清单
      const m = {}; st.allBlocks.forEach(b=>{ const it=pal[b.s].item; m[it]=(m[it]||0)+1; });
      st.materials = Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([item,count])=>({item, name:zh(item), count, color:colorOf(item in COLORS?item:pal.find(p=>p.item===item).n), stack:STACK(item)}));
      // 混搭纹理
      if (!['attach','redstone','furnish'].includes(st.role) && st.materials.length>1){
        const tot = st.blocks.length; const ps = st.materials.map(x=>x.count/st.allBlocks.length);
        const H = -ps.reduce((s,p)=>s+p*Math.log2(p),0);
        const sameCluster = new Set(st.blocks.map(b=>pal[b.s].cluster)).size===1;
        const nFam = new Set(st.blocks.map(b=>pal[b.s].fam)).size;
        if (sameCluster && nFam>1 && H>0.6 && Math.min(...ps)>=0.15) st.mixed = st.materials.map(x=>({name:x.name, pct:Math.round(x.count/st.allBlocks.length*100)}));
      }
      // 备注
      if (st.enables && st.enables.step) st.notes.push({t:'info', s:`提前放：给步骤 ${st.enables.step.id+1}（${st.enables.step.title}）提供依附面`});
      if (st.continued) st.notes.push({t:'cont', s:'延续下层同一纹理体'});
      if (st.merged.length){ const c={}; const own = st.bodies[0] ? st.bodies[0].name.replace(/ #\d+$/,'') : ''; st.merged.filter(n=>n!==own).forEach(n=>c[n]=(c[n]||0)+1); if (Object.keys(c).length) st.notes.push({t:'merge', s:'顺带放入相邻零碎块：'+Object.entries(c).map(([n,k])=>n+'×'+k).join('、')}); }
      if (st.deferred) st.notes.push({t:'warn', s:'挂在本层方块下方，需站在下层仰着放'});
      if (st.laterSupported.length) st.notes.push({t:'info', s:`${st.laterSupported.length} 块要等本层相邻步骤放完后才有依附面`});
      if (st.floating.length) st.notes.push({t:'warn', s:`${st.floating.length} 块悬空（下方和侧面都没有方块），需临时垫方块再拆`});
      const miss = st.blocks.filter(b=>b.supportMissing);
      if (miss.length) st.notes.push({t:'warn', s:`${miss.length} 块缺少依附方块（原投影即如此）`});
      const grav = st.blocks.filter(b=>pal[b.s].gravity);
      if (grav.length) st.notes.push({t:'info', s:`含 ${grav.length} 块重力方块，确认正下方已放置`});
      if (st.mixed) st.notes.push({t:'mix', s:'混搭纹理：'+st.mixed.map(x=>x.name+' '+x.pct+'%').join(' / ')});
      if (st.band>1) st.notes.push({t:'info', s:`本层与上方 ${st.band-1} 层完全相同，重复 ${st.band} 次`});
      st.deps = [...st.deps].sort((a,b)=>a-b);
    }
  }
  // 纹理体按首次出现的步骤顺序重新编号
  const renum = {}; const seenB = new Set();
  steps.forEach(st=>st.bodies.slice(0,1).forEach(b=>{ if (seenB.has(b)) return; seenB.add(b); const base=b.name.replace(/ #\d+$/,''); renum[base]=(renum[base]||0)+1; b.name = base+' #'+renum[base]; }));
  steps.forEach(st=>{ if (st.bodies.length && !st.deferred && st.role!=='attach' && st.role!=='redstone') st.title = (st.spots>1 ? st.bodies[0].name.replace(/ #\d+$/,'') + ` · 本层 ${st.spots} 处` : st.bodies[0].name); });
  steps.forEach(st=>{ if (!st.interleave || st.cross) return; const names=[...new Set(st.bodies.map(x=>x.name.replace(/ #\d+$/,'')))]; st.title = names.join(' + ') + '（交错放置）';
    st.notes.unshift({t:'info', s:'这几种方块互相撑着往外伸，单独哪一种都放不完，所以合成一步、边走边交替放'}); });
  steps.forEach(st=>{ if (!st.cross) return; const a=st.cross[0].y, b=st.cross[st.cross.length-1].y;
    const names=[...new Set(st.bodies.map(x=>x.name.replace(/ #\d+$/,'')))];
    st.title = (names.length>1 ? names.slice(0,2).join(' → ') + (names.length>2?' …':'') : names[0]) + (st.spots>1?` ×${st.spots} 处`:'') + `（Y${a}–Y${b}）`;
    st.notes.unshift({t:'cross', s:`跨层步骤：竖向一口气做 ${st.cross.length} 层（${st.cross.map(c=>'Y'+c.y+'×'+c.n).join('、')}），上层轮到时这些位置已完成`}); });
  steps.forEach(st=>st.notes.forEach(n=>{ if (st.enables && n.s.startsWith('提前放')) n.s = `提前放：给步骤 ${st.enables.step.id+1}（${st.enables.step.title}）提供依附面`; }));
  const json = steps.map(s=>Object.assign({}, s, {enables:undefined, ySpan: s.cross ? [s.cross[0].y, s.cross[s.cross.length-1].y] : [s.y, s.y+s.band-1], blocks:s.blocks.map(b=>b.i), allBlocks:s.allBlocks.map(b=>b.i)}));
  return {params:P, pal, blocks:B.map(b=>({i:b.i,x:b.x,y:b.y,z:b.z,s:b.s,step:b.step,deferred:b.deferred,buildY:b.buildY})),
    layers:layers.map(L=>({y:L.y, band:L.band, ys:L.ys, steps:L.steps})), steps:json,
    bodies:bodies.map(b=>({id:b.id,name:b.name,color:b.color,layers:[...b.layers]})), size:data.size,
    clusters:famList.map(f=>({fam:f, cluster:find(f), members:[...fams[f].members]}))};
}

// 大区域切段：绕区域中心按角度（从西北方向顺时针）排序，在目标切点附近找最大角度间隙（自然断口）
function splitRegion(blocks, maxN){
  const k = Math.ceil(blocks.length / maxN);
  const cx = blocks.reduce((s,b)=>s+b.x,0)/blocks.length, cz = blocks.reduce((s,b)=>s+b.z,0)/blocks.length;
  const ang = b => { let a = Math.atan2(b.z-cz, b.x-cx) - Math.atan2(-1,-1); while (a<0) a+=2*Math.PI; return a; };
  const arr = blocks.slice().sort((a,b)=>ang(a)-ang(b) || (Math.hypot(b.x-cx,b.z-cz)-Math.hypot(a.x-cx,a.z-cz)));
  const cuts=[0]; const target = arr.length/k;
  for (let i=1;i<k;i++){
    const t = Math.round(i*target), w = Math.max(1, Math.round(target*0.25));
    let best=t, gap=-1;
    for (let j=Math.max(cuts[cuts.length-1]+1,t-w); j<=Math.min(arr.length-1,t+w); j++){
      const g = ang(arr[j])-ang(arr[j-1]); if (g>gap){ gap=g; best=j; }
    }
    cuts.push(best);
  }
  cuts.push(arr.length);
  const parts=[]; for (let i=0;i<k;i++) parts.push(arr.slice(cuts[i],cuts[i+1]));
  return parts.filter(p=>p.length);
}

const api = {analyze, ROLE_ZH, ROLE_PRI, zh, colorOf};
if (typeof module!=='undefined') module.exports = api; else root.Splitter = api;
})(this);
