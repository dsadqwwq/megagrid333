// Pure MetaMask (injected) frontend
const C = window.MEGA_GRID_CONFIG;
const HEX_CHAIN_ID = "0x" + C.CHAIN_ID.toString(16);
const S = C.SELECTORS;

const els = {
  grid: document.getElementById("grid"),
  pxSize: document.getElementById("pxSize"),
  resetView: document.getElementById("resetView"),
  clearSelection: document.getElementById("clearSelection"),
  selCount: document.getElementById("selCount"),
  batchList: document.getElementById("batchList"),
  batchCount: document.getElementById("batchCount"),
  runBatch: document.getElementById("runBatch"),
  clearBatch: document.getElementById("clearBatch"),
  connect: document.getElementById("connect"),
  status: document.getElementById("status"),
  tileTitle: document.getElementById("tileTitle"),
  tid: document.getElementById("tid"),
  coords: document.getElementById("coords"),
  owner: document.getElementById("owner"),
  statusTile: document.getElementById("statusTile"),
  price: document.getElementById("price"),
  claimBtn: document.getElementById("claimBtn"),
  buyBtn: document.getElementById("buyBtn"),
  cancelBtn: document.getElementById("cancelBtn"),
  listBtn: document.getElementById("listBtn"),
  listPrice: document.getElementById("listPrice"),
};

function toast(msg, ms=1500){ const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"), ms); }
function short(a){ return a ? a.slice(0,6)+"…"+a.slice(-4) : "—"; }
function encUint(n){ const bn=BigInt(n); return "0x"+bn.toString(16).padStart(64,"0"); }
function hexConcat(...parts){ return "0x"+parts.map(p=>p.replace(/^0x/,"")).join(""); }
function toWei(str){ const v=parseFloat(str||"0"); const wei=BigInt(Math.round(v*1e6))*10n**12n; return wei; } // 6dp -> wei

let provider=null, account=null;
let GRID_SIZE=128; // fallback
let PIXEL=2;
let ctx;
const selected=new Set();
const batch=[];

function updateSelCount(){ els.selCount.textContent = selected.size ? `Selected: ${selected.size}` : ""; }
function pushBatch(items){ (Array.isArray(items)?items:[items]).forEach(it=>{ if(batch.length<10){ batch.push(it); const li=document.createElement("li"); li.textContent=`${it.type.toUpperCase()} #${it.tokenId}`+(it.priceWei?` @ ${Number(it.priceWei)/1e18} ETH`:""); els.batchList.appendChild(li);} }); els.batchCount.textContent=`(${batch.length}/10)`; }
function clearBatch(){ batch.length=0; els.batchList.innerHTML=""; els.batchCount.textContent="(0/10)"; }

async function ensureProvider(){
  if(!window.ethereum){ alert("No MetaMask found"); throw new Error("no provider"); }
  provider=window.ethereum;
  let chain=await provider.request({method:"eth_chainId"}).catch(()=>null);
  if(chain!==HEX_CHAIN_ID){
    try{ await provider.request({method:"wallet_switchEthereumChain", params:[{chainId:HEX_CHAIN_ID}]}); }
    catch{ await provider.request({method:"wallet_addEthereumChain", params:[{ chainId:HEX_CHAIN_ID, chainName:"MegaETH Testnet", nativeCurrency:{name:"MEGA",symbol:"MEGA",decimals:18}, rpcUrls:[C.RPC_URL], blockExplorerUrls:[] }]}); }
  }
  const accs=await provider.request({method:"eth_requestAccounts"}); account=accs[0]; els.status.textContent="connected "+short(account);
  provider.on?.("accountsChanged",(a)=>{ account=a[0]||null; els.status.textContent=account?("connected "+short(account)):"—"; });
  provider.on?.("chainChanged",()=>location.reload());
}

async function ethCall(selector, args="0x"){
  const data=hexConcat(selector,args);
  return await provider.request({ method:"eth_call", params:[{ to:C.TILES_ADDRESS, data }, "latest"] });
}
async function ethSend(selector, args="0x", value="0x0"){
  const data=hexConcat(selector,args);
  const tx={ from:account, to:C.TILES_ADDRESS, value, data };
  const hash=await provider.request({ method:"eth_sendTransaction", params:[tx] });
  toast("tx "+hash.slice(0,10)+"…"); return hash;
}

function parseAddressWord(word){
  const w=word.replace(/^0x/,""); const hex=w.slice(24*2,32*2);
  if(/^0+$/.test(hex)) return null;
  return "0x"+hex;
}

async function loadGridSize(){
  try{ const res=await ethCall(S["GRID_SIZE()"]); GRID_SIZE=Number(BigInt(res)); }catch{}
}

function setupCanvas(){
  const W=GRID_SIZE*PIXEL;
  els.grid.width=W; els.grid.height=W; els.grid.style.width=W+"px"; els.grid.style.height=W+"px";
  ctx=els.grid.getContext("2d");
  for(let y=0;y<GRID_SIZE;y++){ for(let x=0;x<GRID_SIZE;x++){ ctx.fillStyle=((x+y)%2===0)?"#141414":"#101010"; ctx.fillRect(x*PIXEL,y*PIXEL,PIXEL,PIXEL); } }
  selected.forEach(id=>{ const y=Math.floor(id/GRID_SIZE),x=id%GRID_SIZE; drawSelect(x,y); });
}
function baseFill(x,y){ ctx.fillStyle=((x+y)%2===0)?"#141414":"#101010"; ctx.fillRect(x*PIXEL,y*PIXEL,PIXEL,PIXEL); }
function drawHover(x,y){ ctx.strokeStyle="#ffffff"; ctx.lineWidth=1; ctx.strokeRect(x*PIXEL+0.5,y*PIXEL+0.5,PIXEL-1,PIXEL-1); }
function drawSelect(x,y){ ctx.strokeStyle="#8b5cf6"; ctx.lineWidth=1; ctx.strokeRect(x*PIXEL+0.5,y*PIXEL+0.5,PIXEL-1,PIXEL-1); }
function redrawTile(x,y){ baseFill(x,y); const id=y*GRID_SIZE+x; if(selected.has(id)) drawSelect(x,y); }

let hover={x:-1,y:-1,id:-1}, retainTimers=new Map(), hoverDebounce=0;
els.grid.addEventListener("mousemove",(e)=>{
  const r=els.grid.getBoundingClientRect(); const x=Math.floor((e.clientX-r.left)/PIXEL); const y=Math.floor((e.clientY-r.top)/PIXEL);
  if(x===hover.x && y===hover.y) return;
  if(hover.x>=0){ const prev={x:hover.x,y:hover.y,id:hover.id}; if(retainTimers.has(prev.id)) clearTimeout(retainTimers.get(prev.id)); retainTimers.set(prev.id,setTimeout(()=>{ if(!selected.has(prev.id) && prev.id!==(y*GRID_SIZE+x)) redrawTile(prev.x,prev.y); retainTimers.delete(prev.id); },1000)); }
  hover={x,y,id:y*GRID_SIZE+x}; drawHover(x,y);
  clearTimeout(hoverDebounce); hoverDebounce=setTimeout(()=>loadTileMeta(hover.id,x,y),120);
});
els.grid.addEventListener("mouseleave",()=>{
  if(hover.x>=0){ const prev={x:hover.x,y:hover.y,id:hover.id}; if(retainTimers.has(prev.id)) clearTimeout(retainTimers.get(prev.id)); retainTimers.set(prev.id,setTimeout(()=>{ if(!selected.has(prev.id)) redrawTile(prev.x,prev.y); retainTimers.delete(prev.id); },1000)); }
  hover={x:-1,y:-1,id:-1}; els.tileTitle.textContent="Hover a tile"; els.tid.textContent="—"; els.coords.textContent="—"; els.owner.textContent="—"; els.statusTile.textContent="—"; els.price.textContent="—";
});
els.grid.addEventListener("click",(e)=>{ const r=els.grid.getBoundingClientRect(); const x=Math.floor((e.clientX-r.left)/PIXEL); const y=Math.floor((e.clientY-r.top)/PIXEL); if(x<0||y<0||x>=GRID_SIZE||y>=GRID_SIZE)return; const id=y*GRID_SIZE+x; if(selected.has(id)){ selected.delete(id); redrawTile(x,y);} else { if(selected.size>=10){ toast("Max 10 selected"); return;} selected.add(id); drawSelect(x,y);} updateSelCount(); });

async function loadTileMeta(tokenId,x,y){
  els.tileTitle.textContent=`Tile #${tokenId}`; els.tid.textContent=tokenId; els.coords.textContent=`(${x}, ${y})`;
  try{
    const idHex=encUint(tokenId);
    const [ownerHex, listingHex]=await Promise.all([ ethCall(S["ownerOfIfMinted(uint256)"], idHex), ethCall(S["listings(uint256)"], idHex) ]);
    const owner=parseAddressWord(ownerHex);
    const packed=listingHex.replace(/^0x/,"").padEnd(64*2,"0");
    const seller=parseAddressWord("0x"+packed.slice(0,64));
    const priceWeiHex="0x"+packed.slice(64,128); const priceWei=BigInt(priceWeiHex);
    els.owner.textContent=owner?short(owner):"—";
    if(!owner){ els.statusTile.textContent="Unclaimed"; els.price.textContent="—"; showPanel("claim", null, tokenId); }
    else if(seller){ els.statusTile.textContent="Listed"; els.price.textContent=String(Number(priceWei)/1e18)+" ETH"; showPanel("buy", {priceWei}, tokenId); }
    else { els.statusTile.textContent="Owned"; els.price.textContent="—"; showPanel("list", null, tokenId); }
  }catch(e){ console.warn("meta load", e); }
}

function showPanel(which, data, tokenId){
  document.getElementById("claimBox").style.display=(which==="claim")?"block":"none";
  document.getElementById("listBox").style.display=(which==="list")?"block":"none";
  document.getElementById("buyBox").style.display =(which==="buy") ?"block":"none";
  const targets = selected.size?Array.from(selected):(tokenId!=null?[tokenId]:[]);
  const slice=(arr)=>arr.slice(0, 10-batch.length);
  if(which==="claim"){ els.claimBtn.onclick=()=>{ const ids=slice(targets); if(!ids.length) return toast("No tiles"); pushBatch(ids.map(id=>({type:"claim", tokenId:id}))); }; }
  if(which==="list"){ els.listBtn.onclick=()=>{ const v=(els.listPrice.value||"0").trim(); if(!/^[0-9]+(\.[0-9]+)?$/.test(v)) return toast("Bad price"); const wei=toWei(v); const ids=slice(targets); if(!ids.length) return toast("No tiles"); pushBatch(ids.map(id=>({type:"list", tokenId:id, priceWei:wei}))); }; }
  if(which==="buy"){ els.buyBtn.onclick=()=>{ const ids=slice(targets); if(!ids.length) return toast("No tiles"); pushBatch(ids.map(id=>({type:"buy", tokenId:id, priceWei:data.priceWei}))); }; els.cancelBtn.onclick=()=>{ const ids=slice(targets); if(!ids.length) return toast("No tiles"); pushBatch(ids.map(id=>({type:"cancel", tokenId:id}))); }; }
}

async function processBatch(){
  if(!provider || !account) return toast("Connect wallet first");
  if(!batch.length) return toast("Batch empty");
  els.runBatch.disabled=true;
  try{
    let i=0;
    while(batch.length && i<10){
      const it=batch.shift();
      if(it.type==="claim"){ await ethSend(S["claim(uint256)"], encUint(it.tokenId)); }
      else if(it.type==="list"){ const args=hexConcat(encUint(it.tokenId), encUint(it.priceWei)); await ethSend(S["listForSale(uint256,uint256)"], args); }
      else if(it.type==="buy"){ await ethSend(S["buy(uint256)"], encUint(it.tokenId), "0x"+BigInt(it.priceWei).toString(16)); }
      else if(it.type==="cancel"){ await ethSend(S["cancelListing(uint256)"], encUint(it.tokenId)); }
      if(els.batchList.firstChild) els.batchList.removeChild(els.batchList.firstChild);
      els.batchCount.textContent=`(${batch.length}/10)`; i++;
    }
  }catch(e){ console.error("process error", e); toast("Tx failed (console)"); }
  els.runBatch.disabled=false;
}

async function init(){
  PIXEL=Math.max(1,Math.min(12,Number(els.pxSize.value)||2));
  setupCanvas();
  els.pxSize.addEventListener("change",()=>{ PIXEL=Math.max(1,Math.min(12,Number(els.pxSize.value)||2)); setupCanvas(); });
  els.resetView.addEventListener("click", setupCanvas);
  els.clearSelection.addEventListener("click", ()=>{ selected.clear(); setupCanvas(); updateSelCount(); });
  els.clearBatch.addEventListener("click", clearBatch);
  els.runBatch.addEventListener("click", processBatch);
  els.connect.addEventListener("click", async ()=>{ try{ await ensureProvider(); await loadGridSize(); setupCanvas(); }catch(e){ console.error(e); toast("Connect failed"); } });
}

window.addEventListener("load", init);
