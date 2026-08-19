import { useState, useEffect, useCallback, useRef } from "react";

// ════════════════════════════════════════════════════════════════════════════
// BUILD CONFIG — swap "lite" → "pro" to generate the Pro build
// ════════════════════════════════════════════════════════════════════════════
const BUILD_TYPE   = "lite";   // "lite" | "pro"
const SELAR_URL    = "https://selar.com/m/bitkon-vrimda-adamu-tubi1";
// ── AdMob credentials (Lite only) — replace before publishing ───────────────
const ADMOB_APP_ID  = "ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX"; // TODO
const ADMOB_UNIT_ID = "ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX"; // TODO
// ────────────────────────────────────────────────────────────────────────────
const IS_PRO = BUILD_TYPE === "pro";

// ── Difficulty config ────────────────────────────────────────────────────────
const DIFF = {
  beginner: { depth:1, random:0.40, label:"Beginner 🌱", proOnly:false },
  moderate: { depth:2, random:0.10, label:"Moderate ⚡", proOnly:false },
  expert:   { depth:3, random:0.00, label:"Expert 🔥",   proOnly:true  },
};

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════
const ROWS=5, COLS=6, MAX_P=12, WIN_TARGET=12;
const K="king", S="servant";
const op = p => p===K?S:K;

// ════════════════════════════════════════════════════════════════════════════
// BOARD UTILS
// ════════════════════════════════════════════════════════════════════════════
const newBoard = () => Array.from({length:ROWS},()=>Array(COLS).fill(null));
const copyBoard = b => b.map(r=>[...r]);
const ck = (r,c) => `${r},${c}`;
const countP = (b,p) => b.flat().filter(v=>v===p).length;
const adjMoves = (b,r,c) =>
  [[-1,0],[1,0],[0,-1],[0,1]].map(([dr,dc])=>[r+dr,c+dc])
    .filter(([nr,nc])=>nr>=0&&nr<ROWS&&nc>=0&&nc<COLS&&!b[nr][nc]);
const canAnyMove = (b,p) =>
  b.some((row,r)=>row.some((v,c)=>v===p&&adjMoves(b,r,c).length>0));

// All 3-in-a-row lines
const MILLS = (()=>{
  const m=[];
  for(let r=0;r<ROWS;r++) for(let c=0;c<=COLS-3;c++) m.push([[r,c],[r,c+1],[r,c+2]]);
  for(let c=0;c<COLS;c++) for(let r=0;r<=ROWS-3;r++) m.push([[r,c],[r+1,c],[r+2,c]]);
  return m;
})();

// Extended lines for Traditional (4,5,6 in a row)
const EXT_LINES = (()=>{
  const m=[];
  for(let r=0;r<ROWS;r++){
    for(let len=4;len<=COLS;len++)
      for(let c=0;c<=COLS-len;c++) m.push(Array.from({length:len},(_,i)=>[r,c+i]));
  }
  for(let c=0;c<COLS;c++){
    for(let len=4;len<=ROWS;len++)
      for(let r=0;r<=ROWS-len;r++) m.push(Array.from({length:len},(_,i)=>[r+i,c]));
  }
  return m;
})();

const millKey = m => m.map(([r,c])=>`${r}${c}`).sort().join('');
const getMills = (b,p) => MILLS.filter(m=>m.every(([r,c])=>b[r][c]===p));
const getExt   = (b,p) => EXT_LINES.filter(m=>m.every(([r,c])=>b[r][c]===p));

const hasNewMill = (b,prev,p) => {
  const old=new Set(getMills(prev,p).map(millKey));
  return getMills(b,p).some(m=>!old.has(millKey(m)));
};
const hasNewExt = (b,prev,p) => {
  const old=new Set(getExt(prev,p).map(millKey));
  return getExt(b,p).some(m=>!old.has(millKey(m)));
};
const hasNewScore = (b,prev,p,ver) =>
  hasNewMill(b,prev,p) || (ver==='traditional'&&hasNewExt(b,prev,p));

const wouldFormMill = (b,r,c,p) => {
  const t=copyBoard(b); t[r][c]=p; return getMills(t,p).length>0;
};

// RULE: All opponent pieces capturable (no mill protection)
// In Traditional: if opponent has extended mills, those entire groups are removed at once
const getCapturables = (b,p,ver) => {
  if(ver==='traditional'){
    const ext=getExt(b,p);
    if(ext.length>0){
      // Return all cells of all extended groups (auto-remove)
      const cells=[...new Set(ext.flat().map(([r,c])=>ck(r,c)))]
        .map(k=>k.split(',').map(Number));
      return { cells, isExtended:true };
    }
  }
  const all=[];
  b.forEach((row,r)=>row.forEach((v,c)=>{ if(v===p) all.push([r,c]); }));
  return { cells:all, isExtended:false };
};

// ════════════════════════════════════════════════════════════════════════════
// GAME STATE FACTORY
// ════════════════════════════════════════════════════════════════════════════
const mkGame = (ver,sh) => ({
  board:newBoard(), phase:'placement', turn:sh,
  placed:{king:0,servant:0}, sel:null, hi:[], version:ver, stickHolder:sh,
  winner:null, winVal:0, scoredBy:{king:0,servant:0},
  pmov:{king:[],servant:[]}, openMouth:null,
  msg:`${sh===K?'👑 King':'🪨 Servant'} places first. Tap any square.`,
});

// ════════════════════════════════════════════════════════════════════════════
// PURE GAME LOGIC
// ════════════════════════════════════════════════════════════════════════════
function doPlacement(g,r,c){
  const b=copyBoard(g.board);
  if(b[r][c]) return {...g,msg:'That square is occupied.'};
  if(wouldFormMill(b,r,c,g.turn)) return {...g,msg:'⛔ Cannot form 3-in-a-row during placement!'};
  b[r][c]=g.turn;
  const placed={...g.placed,[g.turn]:g.placed[g.turn]+1};
  if(placed.king===MAX_P&&placed.servant===MAX_P)
    return {...g,board:b,placed,phase:'movement',turn:g.stickHolder,
      msg:`All pieces placed! 👑 King moves first.`};
  const next=op(g.turn);
  return {...g,board:b,placed,turn:next,
    msg:`${next===K?'👑 King':'🪨 Servant'}: place piece ${placed[next]+1}/${MAX_P}`};
}

function doMovement(g,r,c){
  const {board,turn,sel,hi,version,openMouth}=g;
  // Modified: MUST score — forced close
  if(version==='modified'&&openMouth&&openMouth.player===turn){
    const [er,ec]=openMouth.emptyCell;
    if(board[r][c]===turn){
      if(adjMoves(board,r,c).some(([nr,nc])=>nr===er&&nc===ec))
        return {...g,sel:[r,c],hi:[[er,ec]],msg:`⚠️ MUST score! Tap green square.`};
      return {...g,msg:`⚠️ Must close open mouth! Pick a piece adjacent to (${er+1},${String.fromCharCode(65+ec)}).`};
    }
    if(sel&&hi.some(([hr,hc])=>hr===r&&hc===c)) return executeMove(g,sel[0],sel[1],r,c);
    return {...g,msg:`⚠️ You MUST close your open mouth and score first!`};
  }
  if(board[r][c]===turn){
    const vm=adjMoves(board,r,c);
    if(!vm.length) return {...g,sel:null,hi:[],msg:`That piece can't move. Choose another.`};
    return {...g,sel:[r,c],hi:vm,msg:`${turn===K?'👑 King':'🪨 Servant'}: tap a green square to move.`};
  }
  if(sel&&hi.some(([hr,hc])=>hr===r&&hc===c)) return executeMove(g,sel[0],sel[1],r,c);
  if(board[r][c]===op(turn)) return {...g,sel:null,hi:[],msg:`That is your opponent's piece!`};
  return {...g,sel:null,hi:[],msg:`Select one of your own pieces.`};
}

function executeMove(g,fr,fc,tr,tc){
  const prev=copyBoard(g.board);
  const board=copyBoard(g.board);
  board[fr][fc]=null; board[tr][tc]=g.turn;

  // Kings Seizure
  const mv4=[...g.pmov[g.turn],{fr,fc,tr,tc}].slice(-4);
  const pmov={...g.pmov,[g.turn]:mv4};
  if(mv4.length>=3){
    const [m1,m2,m3]=mv4.slice(-3);
    if(m1.fr===m3.fr&&m1.fc===m3.fc&&m1.tr===m3.tr&&m1.tc===m3.tc
      &&m2.fr===m1.tr&&m2.fc===m1.tc&&m2.tr===m1.fr&&m2.tc===m1.fc){
      board[tr][tc]=null;
      let seized=false;
      for(let r=0;r<ROWS&&!seized;r++) for(let c=0;c<COLS&&!seized;c++)
        if(board[r][c]===op(g.turn)){board[r][c]=null;seized=true;}
      return checkWin({...g,board,pmov:{king:[],servant:[]},turn:g.stickHolder,
        sel:null,hi:[],openMouth:null,msg:`⚔️ Kings Seizure! Pieces removed. 👑 King moves.`},g.turn);
    }
  }

  // New score?
  if(hasNewScore(board,prev,g.turn,g.version)){
    const cap=getCapturables(board,op(g.turn),g.version);
    const sb={...g.scoredBy,[g.turn]:g.scoredBy[g.turn]+1};
    if(cap.isExtended){
      const b2=copyBoard(board);
      cap.cells.forEach(([r,c])=>{b2[r][c]=null;});
      const ng={...g,board:b2,pmov,scoredBy:sb,phase:'movement',sel:null,hi:[],
        openMouth:null,turn:op(g.turn),
        msg:`🎯 Extended score! Captured ${cap.cells.length} opponent pieces!`};
      return checkWin(ng,g.turn);
    }
    return {...g,board,pmov,scoredBy:sb,phase:'capture',sel:null,hi:cap.cells,
      openMouth:null,msg:`🎯 SCORED! Tap any opponent piece to remove it.`};
  }

  // Open mouth detection
  const prevMK=new Set(getMills(prev,g.turn).map(millKey));
  const broken=getMills(prev,g.turn).filter(m=>!new Set(getMills(board,g.turn).map(millKey)).has(millKey(m)));
  let openMouth=null, mouthMsg='';
  if(broken.length>0){
    const emptyCell=broken[0].find(([mr,mc])=>board[mr][mc]===null);
    if(emptyCell){
      if(g.version==='modified'){
        openMouth={player:g.turn,emptyCell};
        mouthMsg=`👄 Mouth opened! You MUST close it to score next move.`;
      } else {
        mouthMsg=`👄 Mouth opened — close anytime to score again!`;
      }
    }
  }

  const next=op(g.turn);
  return checkWin({...g,board,pmov,openMouth,sel:null,hi:[],turn:next,
    msg:mouthMsg||`${next===K?'👑 King':'🪨 Servant'}: select and move a piece.`},g.turn);
}

function doCapture(g,r,c){
  if(!g.hi.some(([hr,hc])=>hr===r&&hc===c))
    return {...g,msg:`Tap a highlighted opponent piece to remove it.`};
  const board=copyBoard(g.board); board[r][c]=null;
  return checkWin({...g,board,phase:'movement',hi:[],turn:op(g.turn)},g.turn);
}

function checkWin(g,mover,extra){
  const curr=g.turn;
  if(countP(g.board,curr)<=2||!canAnyMove(g.board,curr))
    return endGame(g,mover,!canAnyMove(g.board,curr)&&countP(g.board,curr)>2);
  return {...g,msg:extra||`${curr===K?'👑 King':'🪨 Servant'}: select and move a piece.`};
}

function endGame(g,winner,isBlocking){
  const loserClean=g.scoredBy[op(winner)]===0&&g.scoredBy[winner]>0;
  const isDouble=isBlocking||(g.version==='modified'&&loserClean);
  const winVal=isDouble?2:1;
  const badge=isBlocking?'🐐 Goat Payment — Double!':isDouble?'🔥 Double Win!':'';
  return {...g,winner,winVal,phase:'over',hi:[],sel:null,
    msg:`${winner===K?'👑 King':'🪨 Servant'} WINS! ${badge} +${winVal}pt`};
}

// ════════════════════════════════════════════════════════════════════════════
// AI ENGINE
// ════════════════════════════════════════════════════════════════════════════
function evalBoard(board,ai){
  const en=op(ai); let sc=0;
  sc+=(countP(board,ai)-countP(board,en))*10;
  sc+=(getMills(board,ai).length-getMills(board,en).length)*8;
  let myMob=0,enMob=0,myNear=0,enNear=0;
  board.forEach((row,r)=>row.forEach((v,c)=>{
    if(v===ai) myMob+=adjMoves(board,r,c).length;
    if(v===en) enMob+=adjMoves(board,r,c).length;
  }));
  sc+=(myMob-enMob)*2;
  MILLS.forEach(m=>{
    const mine=m.filter(([r,c])=>board[r][c]===ai).length;
    const ene=m.filter(([r,c])=>board[r][c]===en).length;
    const emp=m.filter(([r,c])=>!board[r][c]).length;
    if(mine===2&&emp===1) myNear+=5;
    if(ene===2&&emp===1) enNear+=5;
  });
  sc+=myNear-enNear;
  if(!canAnyMove(board,en)) sc+=1000;
  if(!canAnyMove(board,ai)) sc-=1000;
  return sc;
}

function allMoves(board,p){
  const m=[];
  board.forEach((row,r)=>row.forEach((v,c)=>{
    if(v===p) adjMoves(board,r,c).forEach(([nr,nc])=>m.push([r,c,nr,nc]));
  }));
  return m;
}

function minimax(board,depth,alpha,beta,max,ai,ver){
  const curr=max?ai:op(ai);
  if(countP(board,ai)<=2) return -9999;
  if(countP(board,op(ai))<=2) return 9999;
  if(!canAnyMove(board,op(ai))) return 9999;
  if(!canAnyMove(board,ai)) return -9999;
  if(depth===0) return evalBoard(board,ai);
  const moves=allMoves(board,curr);
  if(!moves.length) return max?-9999:9999;
  let best=max?-Infinity:Infinity;
  for(const [fr,fc,tr,tc] of moves){
    const nb=copyBoard(board); nb[fr][fc]=null; nb[tr][tc]=curr;
    let v;
    if(hasNewScore(nb,board,curr,ver)){
      const opp_=op(curr);
      const caps=[];
      nb.forEach((row,r)=>row.forEach((cell,c)=>{if(cell===opp_)caps.push([r,c]);}));
      const sample=caps.slice(0,3);
      if(!sample.length){ v=minimax(nb,depth-1,alpha,beta,!max,ai,ver); }
      else {
        v=max?-Infinity:Infinity;
        for(const [cr,cc] of sample){
          const nb2=copyBoard(nb); nb2[cr][cc]=null;
          const sv=minimax(nb2,depth-1,alpha,beta,!max,ai,ver);
          v=max?Math.max(v,sv):Math.min(v,sv);
        }
      }
    } else {
      v=minimax(nb,depth-1,alpha,beta,!max,ai,ver);
    }
    best=max?Math.max(best,v):Math.min(best,v);
    if(max) alpha=Math.max(alpha,best); else beta=Math.min(beta,best);
    if(beta<=alpha) break;
  }
  return best;
}

function aiMove(g,diff,aiPlayer){
  const cfg=DIFF[diff];
  if(Math.random()<cfg.random){
    const mv=allMoves(g.board,aiPlayer);
    if(mv.length) return mv[Math.floor(Math.random()*mv.length)];
  }
  const moves=allMoves(g.board,aiPlayer);
  if(!moves.length) return null;
  let best=null,bestSc=-Infinity;
  for(const m of moves){
    const [fr,fc,tr,tc]=m;
    const nb=copyBoard(g.board); nb[fr][fc]=null; nb[tr][tc]=aiPlayer;
    let sc;
    if(hasNewScore(nb,g.board,aiPlayer,g.version)){
      sc=500+minimax(nb,cfg.depth-1,-Infinity,Infinity,false,aiPlayer,g.version);
    } else {
      sc=minimax(nb,cfg.depth-1,-Infinity,Infinity,false,aiPlayer,g.version);
    }
    if(sc>bestSc){bestSc=sc;best=m;}
  }
  return best;
}

function aiPlacement(g,aiPlayer){
  let best=null,bestSc=-Infinity;
  g.board.forEach((row,r)=>row.forEach((v,c)=>{
    if(!v&&!wouldFormMill(g.board,r,c,aiPlayer)){
      let sc=0;
      MILLS.forEach(m=>{
        if(m.some(([mr,mc])=>mr===r&&mc===c)){
          const own=m.filter(([mr,mc])=>g.board[mr][mc]===aiPlayer).length;
          const en=m.filter(([mr,mc])=>g.board[mr][mc]===op(aiPlayer)).length;
          const emp=m.filter(([mr,mc])=>!g.board[mr][mc]).length;
          sc+=own*4; if(own===2)sc+=20; if(en===2&&emp>0)sc+=10;
        }
      });
      sc-=(Math.abs(r-2)+Math.abs(c-2.5))*0.5;
      if(sc>bestSc){bestSc=sc;best=[r,c];}
    }
  }));
  return best;
}

function aiBestCapture(board,aiPlayer){
  let best=null,bestSc=-Infinity;
  const en=op(aiPlayer);
  board.forEach((row,r)=>row.forEach((v,c)=>{
    if(v===en){
      const b2=copyBoard(board); b2[r][c]=null;
      const sc=evalBoard(b2,aiPlayer);
      if(sc>bestSc){bestSc=sc;best=[r,c];}
    }
  }));
  return best;
}

// ════════════════════════════════════════════════════════════════════════════
// ADMOB MOCK — Lite only; replace with real react-native-google-mobile-ads
// ════════════════════════════════════════════════════════════════════════════
function AdMobInterstitial({onClose}){
  // Replace this component body with:
  //   import { InterstitialAd, AdEventType } from 'react-native-google-mobile-ads';
  //   const ad = InterstitialAd.createForAdRequest(ADMOB_UNIT_ID);
  //   ad.addAdEventListener(AdEventType.CLOSED, onClose);
  //   ad.load(); ad.show();
  const [timer,setTimer]=useState(5);
  useEffect(()=>{
    const t=setInterval(()=>setTimer(p=>p>0?p-1:0),1000);
    return()=>clearInterval(t);
  },[]);
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.94)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:990,padding:16}}>
      <div style={{background:'#141414',border:'1px solid #333',borderRadius:12,
        padding:24,maxWidth:300,width:'100%',textAlign:'center'}}>
        <div style={{color:'#555',fontSize:10,marginBottom:8,letterSpacing:2}}>ADVERTISEMENT</div>
        <div style={{width:'100%',height:160,background:'#1c1c1c',borderRadius:8,
          display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
          border:'1px dashed #2a2a2a',marginBottom:16,gap:6}}>
          <div style={{fontSize:28}}>📢</div>
          <div style={{color:'#444',fontSize:11}}>AdMob Ad Unit</div>
          <div style={{color:'#2a2a2a',fontSize:9,maxWidth:200}}>
            {ADMOB_UNIT_ID.slice(0,30)}...
          </div>
        </div>
        <button disabled={timer>0} onClick={onClose} style={{
          background:timer>0?'#2a2a2a':'linear-gradient(135deg,#8B6914,#C4A35A)',
          color:timer>0?'#555':'#000',border:'none',borderRadius:8,
          padding:'11px 24px',cursor:timer>0?'not-allowed':'pointer',
          fontSize:13,fontWeight:'bold',transition:'all 0.3s',
        }}>
          {timer>0?`Skip in ${timer}s...`:'✕ Continue'}
        </button>
        <div style={{color:'#333',fontSize:9,marginTop:8}}>
          Replace this with real AdMob ID: {ADMOB_APP_ID.slice(0,20)}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════════════════════════════════
export default function DaraGame(){
  const [screen,setScreen]   = useState('title');
  const [version,setVersion] = useState('traditional');
  const [mode,setMode]       = useState('two_player');   // two_player | vs_computer
  const [diff,setDiff]       = useState('beginner');
  const [pSide,setPSide]     = useState(K);              // human side
  const [net,setNet]         = useState(0);
  const [sh,setSH]           = useState(K);
  const [g,setG]             = useState(null);
  const [thinking,setThink]  = useState(false);
  const thinkingRef          = useRef(false);
  const [showRules,setRules] = useState(false);
  const [showAd,setAd]       = useState(false);
  const nextShRef            = useRef(K);

  const compSide = mode==='vs_computer' ? op(pSide) : null;

  // ── AI trigger ─────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!g||g.phase==='over'||mode!=='vs_computer') return;
    if(g.turn!==compSide&&g.phase!=='capture') return;
    if(g.phase==='capture'&&g.turn!==compSide) return; // capture after AI scored
    if(thinkingRef.current) return;

    const delay=diff==='expert'?850:diff==='moderate'?600:400;
    thinkingRef.current = true;
    setThink(true);
    const t=setTimeout(()=>{
      setG(prev=>{
        if(!prev||prev.phase==='over') return prev;
        // Capture phase (AI picks best piece)
        if(prev.phase==='capture'&&prev.hi.length>0){
          const best=aiBestCapture(prev.board,compSide)||prev.hi[0];
          return doCapture(prev,best[0],best[1]);
        }
        if(prev.turn!==compSide) return prev;
        // Placement
        if(prev.phase==='placement'){
          const cell=aiPlacement(prev,compSide);
          return cell?doPlacement(prev,cell[0],cell[1]):prev;
        }
        // Movement — forced open mouth (modified)
        if(prev.version==='modified'&&prev.openMouth&&prev.openMouth.player===compSide){
          const [er,ec]=prev.openMouth.emptyCell;
          for(let r=0;r<ROWS;r++) for(let c=0;c<COLS;c++){
            if(prev.board[r][c]===compSide&&adjMoves(prev.board,r,c).some(([nr,nc])=>nr===er&&nc===ec))
              return executeMove(prev,r,c,er,ec);
          }
        }
        if(prev.phase==='movement'){
          const mv=aiMove(prev,diff,compSide);
          return mv?executeMove(prev,mv[0],mv[1],mv[2],mv[3]):prev;
        }
        return prev;
      });
      thinkingRef.current = false;
      setThink(false);
    },delay);
    return()=>{ clearTimeout(t); thinkingRef.current = false; };
  },[g?.turn,g?.phase,mode,compSide,diff]);

  const launch=useCallback((ver,stickHolder)=>{
    setSH(stickHolder);
    setG(mkGame(ver,stickHolder));
    setScreen('game');
  },[]);

  const click=useCallback((r,c)=>{
    if(thinking) return;
    if(mode==='vs_computer'&&g?.turn===compSide&&g?.phase!=='over') return;
    setG(prev=>{
      if(!prev||prev.phase==='over') return prev;
      if(prev.phase==='placement') return doPlacement(prev,r,c);
      if(prev.phase==='movement')  return doMovement(prev,r,c);
      if(prev.phase==='capture')   return doCapture(prev,r,c);
      return prev;
    });
  },[g,thinking,mode,compSide]);

  const nextGame=useCallback(()=>{
    if(!g?.winner) return;
    const newNet=g.winner===K?net+g.winVal:net-g.winVal;
    setNet(newNet);
    nextShRef.current=g.winner;
    if(Math.abs(newNet)>=WIN_TARGET){setScreen('session_over');return;}
    if(!IS_PRO){setAd(true);}
    else{launch(version,g.winner);}
  },[g,net,version,launch]);

  const afterAd=useCallback(()=>{
    setAd(false);
    launch(version,nextShRef.current);
  },[version,launch]);

  // ── TITLE ──────────────────────────────────────────────────────────────────
  if(screen==='title') return(
    <div style={Sx.root}>
      {showRules&&<RulesModal onClose={()=>setRules(false)}/>}
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:54}}>♟</div>
        <div style={Sx.bigT}>DARA</div>
        <div style={{color:'#6A5020',fontSize:12,marginBottom:4}}>
          Traditional Zaar · Sayawa · Northern Nigeria
        </div>
        {!IS_PRO&&(
          <div style={{display:'inline-block',background:'rgba(196,163,90,0.1)',
            border:'1px solid #5A4010',borderRadius:20,padding:'2px 14px',
            color:'#C4A35A',fontSize:10,letterSpacing:1}}>LITE VERSION</div>
        )}
      </div>
      <button style={Sx.btn} onClick={()=>setScreen('setup')}>▶ Play DARA</button>
      <button style={{...Sx.btn,...Sx.ghost,marginTop:8}} onClick={()=>setRules(true)}>
        📜 Rules of DARA
      </button>
      {!IS_PRO&&(
        <div style={{marginTop:14,padding:'12px 16px',
          background:'rgba(196,163,90,0.06)',border:'1px solid #4A3408',
          borderRadius:12,maxWidth:280,textAlign:'center',width:'100%'}}>
          <div style={{color:'#C4A35A',fontWeight:'bold',fontSize:13}}>🔥 Expert Mode + More!</div>
          <div style={{color:'#777',fontSize:11,margin:'4px 0 8px'}}>
            Unlock Expert AI &amp; Pro features
          </div>
          <a href={SELAR_URL} target="_blank" rel="noreferrer"
            style={{display:'block',background:'linear-gradient(135deg,#8B6914,#C4A35A)',
              color:'#000',textDecoration:'none',borderRadius:6,padding:'8px',
              fontSize:12,fontWeight:'bold'}}>
            🛒 Get Pro Version on Selar
          </a>
        </div>
      )}
    </div>
  );

  // ── SETUP ──────────────────────────────────────────────────────────────────
  if(screen==='setup') return(
    <div style={Sx.root}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
        <button style={{...Sx.ghost,padding:'6px 10px',fontSize:12}} onClick={()=>setScreen('title')}>←</button>
        <span style={{color:'#C4A35A',fontSize:18,fontWeight:900,letterSpacing:4}}>DARA</span>
      </div>

      <SetupRow label="Game Version">
        {['traditional','modified'].map(v=>(
          <button key={v} style={{...Sx.tog,...(version===v?Sx.togOn:{})}}
            onClick={()=>setVersion(v)}>
            {v==='traditional'?'📜 Traditional':'⚡ Modified'}
          </button>
        ))}
      </SetupRow>

      <SetupRow label="Game Mode">
        {[['two_player','👥 Two Players'],['vs_computer','🤖 vs Computer']].map(([m,l])=>(
          <button key={m} style={{...Sx.tog,...(mode===m?Sx.togOn:{})}} onClick={()=>setMode(m)}>
            {l}
          </button>
        ))}
      </SetupRow>

      {mode==='vs_computer'&&(
        <>
          <SetupRow label="Difficulty">
            {Object.entries(DIFF).map(([k,cfg])=>{
              const locked=!IS_PRO&&cfg.proOnly;
              return(
                <div key={k} style={{position:'relative',display:'inline-block'}}>
                  <button style={{...Sx.tog,...(diff===k&&!locked?Sx.togOn:{}),
                    opacity:locked?0.5:1,cursor:locked?'not-allowed':'pointer'}}
                    onClick={()=>!locked&&setDiff(k)}>
                    {cfg.label}{locked?' 🔒':''}
                  </button>
                  {locked&&(
                    <div style={{position:'absolute',top:'100%',left:'50%',transform:'translateX(-50%)',
                      background:'#181008',border:'1px solid #5A4010',borderRadius:8,
                      padding:'8px 10px',zIndex:20,width:150,textAlign:'center',marginTop:4,
                      boxShadow:'0 4px 16px rgba(0,0,0,0.6)'}}>
                      <div style={{color:'#C4A35A',fontSize:10,fontWeight:'bold',marginBottom:4}}>Pro Only</div>
                      <a href={SELAR_URL} target="_blank" rel="noreferrer"
                        style={{display:'block',background:'linear-gradient(135deg,#8B6914,#C4A35A)',
                          color:'#000',textDecoration:'none',borderRadius:4,
                          padding:'4px',fontSize:10,fontWeight:'bold'}}>
                        🛒 Get Pro
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </SetupRow>

          <SetupRow label="You Play As">
            {[[K,'👑 King (Sticks)'],[S,'🪨 Servant (Stones)']].map(([s,l])=>(
              <button key={s} style={{...Sx.tog,...(pSide===s?Sx.togOn:{})}} onClick={()=>setPSide(s)}>
                {l}
              </button>
            ))}
          </SetupRow>
        </>
      )}

      <button style={{...Sx.btn,marginTop:20}} onClick={()=>launch(version,K)}>
        ▶ Start Game
      </button>
    </div>
  );

  // ── SESSION OVER ───────────────────────────────────────────────────────────
  if(screen==='session_over'){
    const sw=net>0?K:S;
    return(
      <div style={{...Sx.root,justifyContent:'center',textAlign:'center',gap:10}}>
        <div style={{fontSize:76}}>🏆</div>
        <div style={{color:'#C4A35A',fontSize:13,letterSpacing:4}}>SESSION CHAMPION</div>
        <div style={{color:'#fff',fontSize:34,fontWeight:900}}>
          {sw===K?'👑 THE KING':'🪨 THE SERVANT'}
        </div>
        {mode==='vs_computer'&&(
          <div style={{color:'#888',fontSize:13,marginTop:4}}>
            {sw===pSide?'🎉 You beat the computer!':'💡 The AI won this time. Try again!'}
          </div>
        )}
        <div style={{color:'#555',fontSize:12}}>Final score: {Math.abs(net)} pts</div>
        <button style={{...Sx.btn,marginTop:20}} onClick={()=>{setNet(0);setScreen('setup');}}>
          New Session
        </button>
      </div>
    );
  }

  // ── GAME ───────────────────────────────────────────────────────────────────
  if(!g) return null;
  const hiSet=new Set(g.hi.map(([r,c])=>ck(r,c)));
  const kCnt=countP(g.board,K), sCnt=countP(g.board,S);
  const isOver=g.phase==='over';
  const humanTurn=mode==='two_player'||(g.turn===pSide&&!thinking);

  return(
    <div style={Sx.root}>
      {showAd&&<AdMobInterstitial onClose={afterAd}/>}

      {/* Header */}
      <div style={Sx.header}>
        <Badge player={K} count={kCnt} active={g.turn===K&&!isOver}
          isStick={g.stickHolder===K} isHuman={mode==='vs_computer'&&pSide===K}/>
        <div style={{textAlign:'center'}}>
          <div style={{fontSize:15,fontWeight:900,color:'#C4A35A',letterSpacing:4}}>DARA</div>
          <div style={{fontSize:12,fontWeight:'bold',
            color:net===0?'#555':net>0?'#FFD700':'#C0C0C0'}}>
            {net===0?'Tied':net>0?`👑 +${net}`:`🪨 +${Math.abs(net)}`}
          </div>
          <div style={{fontSize:9,color:'#444'}}>{version} · ±{WIN_TARGET}</div>
        </div>
        <Badge player={S} count={sCnt} active={g.turn===S&&!isOver}
          isStick={g.stickHolder===S} isHuman={mode==='vs_computer'&&pSide===S}/>
      </div>

      {/* AI thinking bar */}
      {thinking&&(
        <div style={{color:'#C4A35A',fontSize:12,background:'rgba(196,163,90,0.1)',
          padding:'4px 14px',borderRadius:20,border:'1px solid #5A4010'}}>
          🤖 {DIFF[diff].label} is thinking...
        </div>
      )}

      {/* Message */}
      <div style={Sx.msg}>
        <span style={{fontSize:12,lineHeight:1.45,
          color:g.phase==='capture'?'#FF7070':isOver?'#FFD700':'#C4A35A'}}>
          {g.msg}
        </span>
      </div>

      {/* Board */}
      <div style={Sx.shell}>
        <div style={{display:'flex',paddingLeft:22,gap:4,marginBottom:3}}>
          {Array.from({length:COLS},(_,i)=>(
            <div key={i} style={{width:50,textAlign:'center',fontSize:10,color:'#8B6914',fontWeight:'bold'}}>
              {String.fromCharCode(65+i)}
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:4}}>
          <div style={{display:'flex',flexDirection:'column',justifyContent:'space-around',width:18}}>
            {Array.from({length:ROWS},(_,i)=>(
              <div key={i} style={{height:50,display:'flex',alignItems:'center',
                justifyContent:'center',fontSize:10,color:'#8B6914',fontWeight:'bold'}}>{i+1}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:`repeat(${COLS},50px)`,gap:4}}>
            {g.board.map((row,r)=>row.map((cell,c)=>{
              const id=ck(r,c),isHi=hiSet.has(id);
              const isSel=g.sel&&g.sel[0]===r&&g.sel[1]===c;
              const isCap=isHi&&g.phase==='capture';
              return(
                <div key={id} onClick={()=>!isOver&&humanTurn&&click(r,c)} style={{
                  width:50,height:50,borderRadius:7,
                  cursor:isOver||!humanTurn?'default':'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center',
                  background:isSel?'#7A5C10':isCap?'#4A0E1A':isHi?'#163016':'#221408',
                  border:isSel?'2px solid #FFD700':isCap?'2px solid #FF6B6B':isHi?'2px solid #4CAF50':'1px solid #3A2210',
                  boxShadow:isSel?'0 0 14px rgba(255,215,0,0.5)':isCap?'0 0 12px rgba(255,100,100,0.5)':isHi?'0 0 10px rgba(76,175,80,0.35)':'none',
                  transition:'all 0.12s',
                }}>
                  {cell===K&&<Piece type={K}/>}
                  {cell===S&&<Piece type={S}/>}
                  {!cell&&isHi&&!isCap&&(
                    <div style={{width:12,height:12,borderRadius:'50%',
                      background:'rgba(76,175,80,0.45)',border:'1.5px solid #4CAF50'}}/>
                  )}
                </div>
              );
            }))}
          </div>
        </div>
      </div>

      {/* Status tags */}
      <div style={{display:'flex',gap:5,flexWrap:'wrap',justifyContent:'center'}}>
        {[
          g.phase.toUpperCase(),
          g.phase==='placement'?`K:${g.placed.king}/${MAX_P} S:${g.placed.servant}/${MAX_P}`:null,
          g.openMouth?'👄 OPEN MOUTH':null,
          mode==='vs_computer'?`🤖 ${DIFF[diff].label}`:null,
          !IS_PRO?'LITE':null,
        ].filter(Boolean).map(t=>(
          <span key={t} style={{background:'rgba(255,255,255,0.04)',border:'1px solid #3A2008',
            borderRadius:4,padding:'2px 7px',fontSize:10,color:'#555'}}>{t}</span>
        ))}
      </div>

      {/* Buttons */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center',marginTop:4}}>
        {isOver&&<button style={Sx.btn} onClick={nextGame}>Next Game →</button>}
        <button style={Sx.sec} onClick={()=>{setNet(0);setScreen('setup');}}>🏠 Home</button>
        <button style={Sx.sec} onClick={()=>{setG(mkGame(version,sh));setThink(false);}}>↺</button>
        <button style={Sx.sec} onClick={()=>setRules(true)}>📜</button>
      </div>

      {/* Legend */}
      <div style={{display:'flex',gap:14,justifyContent:'center',marginTop:4}}>
        {[['#4CAF50','🟩 Move'],['#FF6B6B','🟥 Capture'],['#FFD700','🟨 Selected']].map(([c,t])=>(
          <span key={t} style={{fontSize:11,color:c}}>{t}</span>
        ))}
      </div>

      {showRules&&<RulesModal onClose={()=>setRules(false)}/>}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
function SetupRow({label,children}){
  return(
    <div style={{width:'100%',maxWidth:360,textAlign:'center',marginBottom:4}}>
      <div style={{color:'#8B6914',fontSize:11,fontWeight:'bold',letterSpacing:2,
        textTransform:'uppercase',marginBottom:8}}>{label}</div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'center'}}>
        {children}
      </div>
    </div>
  );
}

function Badge({player,count,active,isStick,isHuman}){
  return(
    <div style={{textAlign:'center',opacity:active?1:0.4,transition:'opacity 0.3s',minWidth:58}}>
      <div style={{fontSize:22}}>{player===K?'🟤':'⚪'}</div>
      <div style={{color:'#C4A35A',fontWeight:900,fontSize:22,lineHeight:1}}>{count}</div>
      <div style={{fontSize:9,color:'#555'}}>{player===K?'King':'Servant'}</div>
      {isStick&&<div style={{fontSize:8,color:'#FFD700'}}>STICKS</div>}
      {isHuman&&<div style={{fontSize:8,color:'#4CAF50'}}>YOU</div>}
      {active&&<div style={{width:5,height:5,borderRadius:'50%',background:'#C4A35A',margin:'2px auto'}}/>}
    </div>
  );
}

function Piece({type}){
  const isK=type===K;
  return(
    <div style={{width:38,height:38,borderRadius:'50%',
      background:isK?'radial-gradient(circle at 35% 28%,#E8A828,#6B2C08)'
               :'radial-gradient(circle at 35% 28%,#F2F2F2,#8A8A8A)',
      border:isK?'2px solid #D4A017':'2px solid #CCCCCC',
      boxShadow:'0 3px 8px rgba(0,0,0,0.65),inset 0 1px 0 rgba(255,255,255,0.15)',
      display:'flex',alignItems:'center',justifyContent:'center',fontSize:15}}>
      {isK?'🟤':'⚪'}
    </div>
  );
}

function RulesModal({onClose}){
  const rules=[
    ['🏗 Board','5×6 = 30 squares. King 🟤 = sticks (12). Servant ⚪ = stones (12).'],
    ['📍 Placement','Take turns placing pieces. You CANNOT form 3-in-a-row during placement.'],
    ['↕ Movement','King moves first. Move one piece one square (up/down/left/right) to empty square. Touch-and-play: tap a piece = must move it.'],
    ['🎯 Scoring','Form 3-in-a-row → remove ANY opponent piece (ALL pieces are capturable once you score — even those in scoring positions!).'],
    ['📏 Extended Score (Traditional Only)','Form 4, 5, or 6 in a row — each is a valid score. WARNING: if opponent scores while you have a 4+ line, they capture ALL those pieces at once!'],
    ['👄 Open Mouth','Break your own 3-in-a-row → move piece back to reform it and score again. Unlimited!'],
    ['⚡ Modified Rule','Open mouth = MUST SCORE immediately. No other moves allowed. Opponent can force you to score on bad captures!'],
    ['🐐 Goat Payment','Block ALL opponent moves = DOUBLE score!'],
    ['⚔ Kings Seizure','Same piece back-forth 3 times → that piece + 1 opponent piece removed. 👑 King moves next.'],
    ['🏆 Session','Net score to ±12 wins the session. Game win = +1pt (or +2 double). Loser −pts. Winner gets Sticks next game.'],
    ['🤖 AI Modes','Beginner: makes mistakes, easy to beat. Moderate: plays well. Expert: strong AI (Pro only).'],
  ];
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',
      display:'flex',alignItems:'center',justifyContent:'center',zIndex:999,padding:12}}>
      <div style={{background:'#130B04',border:'1px solid #7A5C10',borderRadius:14,
        padding:20,maxWidth:360,width:'100%',maxHeight:'88vh',overflowY:'auto',
        display:'flex',flexDirection:'column',gap:10}}>
        <div style={{color:'#C4A35A',fontSize:18,fontWeight:900,letterSpacing:4}}>DARA — Rules</div>
        {rules.map(([t,d])=>(
          <div key={t}>
            <div style={{color:'#C4A35A',fontWeight:'bold',fontSize:12,marginBottom:2}}>{t}</div>
            <div style={{color:'#bbb',fontSize:11,lineHeight:1.55}}>{d}</div>
          </div>
        ))}
        <button style={{...Sx.btn,marginTop:4}} onClick={onClose}>✓ Got it!</button>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const Sx={
  root:{minHeight:'100vh',background:'linear-gradient(160deg,#080500,#110900,#080500)',
    display:'flex',flexDirection:'column',alignItems:'center',
    padding:'14px 8px 28px',gap:8,fontFamily:"'Segoe UI',system-ui,sans-serif",color:'#fff'},
  bigT:{fontSize:56,fontWeight:900,color:'#C4A35A',letterSpacing:12,
    margin:'0 0 4px',textShadow:'0 0 40px rgba(196,163,90,0.4)'},
  header:{display:'flex',justifyContent:'space-between',alignItems:'center',
    width:'100%',maxWidth:380,background:'rgba(255,255,255,0.03)',
    borderRadius:12,padding:'10px 16px',border:'1px solid #3A2008'},
  msg:{background:'rgba(0,0,0,0.5)',borderRadius:8,padding:'9px 14px',
    maxWidth:380,width:'100%',textAlign:'center',minHeight:46,
    display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid #280E02'},
  shell:{padding:12,borderRadius:14,
    background:'linear-gradient(145deg,#3A2010,#582E14,#3A2010)',
    border:'2px solid #8B6914',
    boxShadow:'0 10px 36px rgba(0,0,0,0.8),inset 0 1px 0 rgba(255,255,255,0.06)'},
  btn:{background:'linear-gradient(135deg,#8B6914,#C4A35A)',color:'#000',
    border:'none',borderRadius:8,padding:'12px 24px',fontSize:14,
    fontWeight:'bold',cursor:'pointer',width:'100%',maxWidth:300},
  ghost:{background:'transparent',color:'#C4A35A',
    border:'1px solid #5A4010',borderRadius:8,padding:'10px 16px',
    fontSize:13,cursor:'pointer',width:'100%',maxWidth:300,textAlign:'center'},
  sec:{background:'rgba(255,255,255,0.05)',color:'#C4A35A',
    border:'1px solid #3A2008',borderRadius:8,padding:'10px 14px',fontSize:13,cursor:'pointer'},
  tog:{background:'rgba(255,255,255,0.05)',color:'#777',
    border:'1px solid #3A2008',borderRadius:8,padding:'10px 14px',
    fontSize:12,cursor:'pointer',transition:'all 0.2s'},
  togOn:{background:'linear-gradient(135deg,#6B5010,#9A7820)',
    color:'#FFD700',border:'1px solid #8B6914',fontWeight:'bold'},
};
