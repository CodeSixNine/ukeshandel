/* Ukeshandel – logikk
   Dokumentet lists/main i Firestore:
   items:   {id:{n,c,q,x,o,note?,h?,home?,exp?,hb?,pr?,fast?,ab?,at?}}   h = avdeling, c = huket av
   dinners: {id:{name,ing:[id],qty:{id:n},o,url?,portions?,notes?}}
   week:    {Mandag: middagsId | "@rest" | ""}      wp: {Mandag: personer}
   stores:  {id:{name,so:[avdelingsId],o}}           hist: {id:{at,st,picks:[id],by,sum?,est?}}
   cooked:  {id:{did,at}}   left: {id:{n,did,at,exp}}   waste: {id:{n,at}}
   codes:   {strekkode: varens id}                   cfg: {ign:{"vare_forgjenger":1}}
   Endringer lagres feltvis, så flere kan bruke appen samtidig. */

/* ===== Hjelpere ===== */
function key(s){return String(s).trim().toLowerCase()}
function clone(x){return JSON.parse(JSON.stringify(x))}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function isObj(x){return !!x&&typeof x==="object"&&!Array.isArray(x)}
function splitQ(s){const m=String(s).match(/^(.*?)\s+x\s*(\d+)?\s*$/i);return m&&m[1].trim()?{n:m[1].trim(),q:m[2]?Math.max(1,+m[2]):1}:{n:String(s).trim(),q:1}}
function pad(n){return String(n).padStart(2,"0")}
function ymd(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
function addDays(n){const d=new Date();d.setDate(d.getDate()+n);return ymd(d)}
function daysTo(s){if(!s)return null;const t=new Date();t.setHours(0,0,0,0);const d=new Date(s+"T00:00:00");if(isNaN(d))return null;return Math.round((d-t)/864e5)}
function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);const y=new Date(Date.UTC(t.getUTCFullYear(),0,1));return Math.ceil(((t-y)/864e5+1)/7)}
function weekKey(ms){const d=new Date(ms);const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const day=t.getUTCDay()||7;t.setUTCDate(t.getUTCDate()+4-day);return t.getUTCFullYear()+"-"+pad(isoWeek(d))}
function todayName(){return DAYS[(new Date().getDay()+6)%7]}
function kr(n){return Math.round(n).toLocaleString("nb-NO")+" kr"}
function safeUrl(u){u=String(u||"").trim();if(!u)return"";if(!/^https?:\/\//i.test(u))u="https://"+u;return u}
function num(v){const n=parseFloat(String(v).replace(",",".").replace(/[^\d.]/g,""));return isFinite(n)?n:NaN}

/* ===== Overgang fra eldre lagringsformater ===== */
function migrateV2(st){
  if(st.v>=2)return st;
  const out=[],idx={};
  for(const it of st.items||[]){const s=splitQ(it.n),k=key(s.n);
    if(k in idx){const o=out[idx[k]];o.q=Math.max(o.q,s.q);o.c=o.c&&it.c}
    else{idx[k]=out.length;out.push({n:s.n,c:!!it.c,q:s.q})}}
  st.items=out;
  for(const d of st.dinners||[]){const seen=new Set(),ing=[];for(const i of d.ing){const s=splitQ(i),k=key(s.n);if(!seen.has(k)){seen.add(k);ing.push(s.n)}}d.ing=ing;d.qty={}}
  st.v=2;return st;
}
const HDR={"pinjekjerner":"Frukt og grønt","hvit monster":"Drikke","focaccia":"Brød","aiolo":"Kjøl","kjøttdeig":"Kjøtt og pålegg","fetaost":"Ost","pepper":"Krydder og sauser","makrell i tomat":"Hermetikk og baking","ovnsbakte grønnsaker":"Frys","tomatpure":"Tørrvarer","creme fraiche":"Meieri","tacolefse":"Taco","pesto":"Middag og pasta","nachos":"Snacks og godteri","cleanex":"Husholdning","tannbørste hode":"Hygiene og apotek"};
function toV3(src){
  const d=clone(src);
  if(d.v>=3)return d;
  migrateV2(d);
  const items={},idBy={};let o=0;
  for(const it of d.items||[]){
    const k=key(it.n);
    if(HDR[k])items[uid("h")]={n:HDR[k],h:true,o:o+=1000};
    if(idBy[k])continue;
    const id=uid("i");idBy[k]=id;
    items[id]={n:it.n,c:!!it.c,q:it.q||1,x:it.x||0,o:o+=1000};
  }
  const dinners={},dmap={};let i=0;
  for(const dn of d.dinners||[]){
    const ing=[],qty={};
    for(const nm of dn.ing||[]){
      let id=idBy[key(nm)];
      if(!id){id=uid("i");idBy[key(nm)]=id;items[id]={n:nm,c:true,q:1,x:0,o:o+=1000}}
      if(!ing.includes(id))ing.push(id);
      const qv=dn.qty&&dn.qty[key(nm)];if(qv>1)qty[id]=qv;
    }
    const nid=uid("d");dmap[dn.id]=nid;
    dinners[nid]={name:dn.name,ing,qty,o:i++};
  }
  const week={};for(const day of DAYS)week[day]=dmap[(d.week||{})[day]]||"";
  return {v:3,items,dinners,week};
}

/* ===== Tilstand ===== */
const MAPS=["items","dinners","week","wp","stores","hist","cooked","left","waste","codes","cfg","rmap"];
let S=toV3(SEED),B=null,PL={p:{},by:{}},ME={name:""};
function ensure(){for(const k of MAPS)if(!isObj(S[k]))S[k]={};if(!isObj(S.cfg.ign))S.cfg.ign={}}
ensure();
function ls(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
let tab=ls("tab","liste"),hideDone=ls("hide2",false),shop=ls("shop",false),trip=ls("trip",[]),col=ls("col",[]),lastPos=ls("pos","end"),storeSel=ls("store","");
let prevSeen=ls("seen",0)||Date.now();
let ref=null,fdb=null,saveTimer=null,confirmReset=false,firstServer=true;
let addQ="",homeQ="",mvQ="",editMode=false,selId=null,delArm=false,usedArm=null,bannerOff=false;
let OV=null; /* åpent vindu: {type:"day"|"ing"|"recipe"|"cook"|"rev"|"more"|"scan"|"done"|"store", …} */
let undoState=null,scanCtx="list";

const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function status(m){$("#status").textContent=m}

/* ===== Melding nederst, med angre ===== */
function snapUndo(){undoState=clone(S)}
function toast(m,undo){
  const t=$("#toast");
  if(!undo)undoState=null;
  t.innerHTML=`<span>${esc(m)}</span>${undo&&undoState?'<button id="undo" type="button">Angre</button>':""}`;
  t.classList.toggle("act",!!(undo&&undoState));t.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>{t.classList.remove("show","act");if(undo)undoState=null},undo?6000:2200);
}
function doUndo(){if(!undoState)return;const u=undoState;undoState=null;S=u;ensure();changed();if(OV)renderOverlay();toast("Angret")}

/* ===== Varer, rekkefølge og avdelinger ===== */
const I=id=>S.items[id];
function ids(){return Object.keys(S.items).sort((a,b)=>(S.items[a].o-S.items[b].o)||(a<b?-1:a>b?1:0))}
function itemIds(){return ids().filter(id=>!S.items[id].h)}
function headerIds(){return ids().filter(id=>S.items[id].h)}
function findByName(n){const k=key(n);return Object.keys(S.items).find(id=>!S.items[id].h&&key(S.items[id].n)===k)}
function dinnerIds(){return Object.keys(S.dinners).sort((a,b)=>(S.dinners[a].o||0)-(S.dinners[b].o||0))}
function secOf(){const m={};let cur=null;for(const id of ids()){if(I(id).h)cur=id;else m[id]=cur}return m}
function curStore(){return storeSel&&S.stores[storeSel]?S.stores[storeSel]:null}
function storeIds(){return Object.keys(S.stores).sort((a,b)=>(S.stores[a].o||0)-(S.stores[b].o||0))}
function secOrder(st){const hs=headerIds();if(!st||!Array.isArray(st.so))return hs;const r=st.so.filter(h=>S.items[h]&&I(h).h);return [...r,...hs.filter(h=>!r.includes(h))]}
function groups(useStore){
  const g=[{h:null,items:[]}],by={};
  for(const id of ids()){if(I(id).h){const x={h:id,items:[]};g.push(x);by[id]=x}else g[g.length-1].items.push(id)}
  const first=g[0].items.length?[g[0]]:[];
  if(useStore&&curStore())return [...first,...secOrder(curStore()).map(h=>by[h]).filter(Boolean)];
  return [...first,...g.slice(1)];
}
function renorm(){ids().forEach((id,i)=>S.items[id].o=(i+1)*1000)}
function placeAt(id,pos){
  const arr=ids().filter(x=>x!==id),last=arr.length?I(arr[arr.length-1]).o:0;
  if(pos&&pos.sec){const hi=arr.indexOf(pos.sec);if(hi<0)pos="end";else{let j=hi;while(j+1<arr.length&&!I(arr[j+1]).h)j++;pos={after:arr[j]}}}
  if(pos==="top"){I(id).o=(arr.length?I(arr[0]).o:0)-1000;return}
  if(!pos||pos==="end"||!pos.after){I(id).o=last+1000;return}
  const i=arr.indexOf(pos.after);if(i<0){I(id).o=last+1000;return}
  const a=I(arr[i]).o,b=i+1<arr.length?I(arr[i+1]).o:a+2000;
  if(b-a<1e-6){renorm();return placeAt(id,pos)}
  I(id).o=(a+b)/2;
}
function parsePos(v){if(v==="top"||v==="end")return v;if(v&&v.startsWith("s:"))return {sec:v.slice(2)};return "end"}
function posOptions(sel){
  let o=`<option value="end"${sel==="end"?" selected":""}>Nederst i listen</option><option value="top"${sel==="top"?" selected":""}>Øverst i listen</option>`;
  for(const id of headerIds())o+=`<option value="s:${id}"${sel==="s:"+id?" selected":""}>Avdeling: ${esc(I(id).n)}</option>`;
  return o;
}
function newItem(name,q,pos,extra){const id=uid("i");S.items[id]=Object.assign({n:name,c:true,q:q||1,x:0,o:0},extra||{});placeAt(id,parsePos(pos));return id}
/* need = legg på handlelisten. manual = noen la den til selv (vises for den andre) */
function need(id,manual){const it=I(id);if(!it||it.h)return;if(it.c!==false){it.c=false;if(manual&&ME.name){it.ab=ME.name;it.at=Date.now()}else{delete it.ab;delete it.at}}}
function gotIt(id){const it=I(id);if(!it)return;it.c=true;delete it.ab;delete it.at}
function putHome(id){const it=I(id);if(!it)return;it.home=true;if(it.hb>0)it.exp=addDays(it.hb);else delete it.exp}

/* ===== Ukeplan, porsjoner og antall ===== */
const REST="@rest";
function dq(din,id){return (din.qty&&din.qty[id])||1}
function dayFactor(day,din){const w=S.wp[day];return (w>0&&din.portions>0)?w/din.portions:1}
function planned(){const p={},by={};for(const d of DAYS){const din=S.dinners[S.week[d]];if(!din)continue;const f=dayFactor(d,din);
  for(const id of din.ing||[]){if(!S.items[id])continue;p[id]=(p[id]||0)+Math.max(1,Math.ceil(dq(din,id)*f-1e-9));by[id]=by[id]||[];if(!by[id].includes(din.name))by[id].push(din.name)}}return {p,by}}
function applyFor(did){const d=S.dinners[did];if(!d)return;for(const id of d.ing||[])if(S.items[id]&&!I(id).home)need(id,false)}
function qtyOf(id){const it=I(id);return PL.p[id]?Math.max(1,PL.p[id]+(it.x||0)):(it.q||1)}
function bump(id,d){const it=I(id),pp=planned().p[id];
  if(pp){const nx=(it.x||0)+d;if(pp+nx<1)return;it.x=nx}else{const nq=(it.q||1)+d;if(nq<1)return;it.q=nq}
  changed()}
function estimate(list){let sum=0,miss=0;for(const id of list){const it=I(id);if(it.pr>0)sum+=it.pr*qtyOf(id);else miss++}return {sum,miss}}
function dinnerCost(d){let sum=0,miss=0;for(const id of d.ing||[]){if(!S.items[id])continue;const it=I(id);if(it.pr>0)sum+=it.pr*dq(d,id);else miss++}return {sum,miss}}

/* ===== Lagring: bare feltene som er endret ===== */
function changed(noRender){clearTimeout(saveTimer);saveTimer=setTimeout(save,400);if(!noRender)render()}
function diffArgs(){
  const FP=firebase.firestore.FieldPath,DEL=firebase.firestore.FieldValue.delete(),a=[];
  const eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
  (function walk(path,s,b,depth){
    if(depth>0&&isObj(s)&&isObj(b)){
      for(const k of new Set([...Object.keys(s),...Object.keys(b)])){
        const hs=k in s&&s[k]!==undefined,hb=k in b&&b[k]!==undefined;
        if(!hs){if(hb)a.push(new FP(...path,k),DEL);continue}
        if(!hb){a.push(new FP(...path,k),clone(s[k]));continue}
        walk([...path,k],s[k],b[k],depth-1);
      }
    }else if(!eq(s,b))a.push(new FP(...path),s===undefined?DEL:clone(s));
  })([],S,B,3);
  return a;
}
function save(){
  saveTimer=null;if(!ref||!B)return;
  const a=diffArgs();if(!a.length)return;
  B=clone(S);
  ref.update(...a).then(()=>status("Lagret")).catch(e=>status(e&&e.code==="permission-denied"?"Du har ikke tilgang til å endre listen":"Kunne ikke lagre ("+(e&&e.code||"ukjent feil")+")"));
}
function prune(map,max){const ks=Object.keys(map).sort((a,b)=>(map[a].at||0)-(map[b].at||0));while(ks.length>max)delete map[ks.shift()]}

/* ===== Nytt siden sist ===== */
function newOnes(){return itemIds().filter(id=>{const it=I(id);return it.c===false&&it.ab&&it.ab!==ME.name&&it.at>prevSeen})}
function newBanner(){
  if(editMode)return"";
  const n=newOnes();if(!n.length)return"";
  const by={};for(const id of n)(by[I(id).ab]=by[I(id).ab]||[]).push(I(id).n);
  const txt=Object.keys(by).map(w=>`<b>${esc(w)}</b> la til ${esc(by[w].slice(0,6).join(", "))}${by[w].length>6?" og "+(by[w].length-6)+" til":""}`).join(". ");
  return `<div class="banner"><span>${txt}</span><button class="btn small" id="seenok">OK</button></div>`;
}

/* ===== Lær rekkefølgen fra handleturene ===== */
function orderSuggestions(){
  const trips=Object.values(S.hist).filter(t=>Array.isArray(t.picks)).sort((a,b)=>b.at-a.at).slice(0,15);
  if(trips.length<2)return [];
  const sec=secOf(),pos={};ids().forEach((id,i)=>pos[id]=i);
  const pre={},suc={};
  for(const t of trips){const pk=t.picks.filter(id=>S.items[id]&&!I(id).h);
    for(let i=0;i<pk.length;i++){const x=pk[i];
      if(i>0){const p=pk[i-1];(pre[x]=pre[x]||{n:0,c:{}}).n++;pre[x].c[p]=(pre[x].c[p]||0)+1}
      if(i<pk.length-1){const nx=pk[i+1];(suc[x]=suc[x]||{n:0,c:{}}).n++;suc[x].c[nx]=(suc[x].c[nx]||0)+1}}}
  const top=o=>{let b=null,bc=0;for(const k in o.c)if(o.c[k]>bc){bc=o.c[k];b=k}return [b,bc]};
  const out=[];
  for(const x in pre){const [p,c]=top(pre[x]);if(!p||c<2||c/pre[x].n<.6||S.cfg.ign[x+"_"+p])continue;
    if(sec[x]===sec[p]){if(pos[x]<pos[p])out.push({x,p,c,kind:"order"});continue}
    if(suc[x]){const [nx,c2]=top(suc[x]);if(nx&&c2>=2&&sec[nx]===sec[p])out.push({x,p,c,kind:"sec"})}
  }
  return out.slice(0,12);
}
function tripCount(){return Object.values(S.hist).filter(t=>Array.isArray(t.picks)).length}

/* ===== Foreslå middager ===== */
function lastCooked(){const m={};for(const k in S.cooked){const c=S.cooked[k];if(!m[c.did]||c.at>m[c.did])m[c.did]=c.at}return m}
function dinnerScore(did,lc){
  const d=S.dinners[did],ing=(d.ing||[]).filter(id=>S.items[id]);
  const days=lc[did]?Math.floor((Date.now()-lc[did])/864e5):null;
  let s=days==null?30:Math.min(days,60);const soon=[];let home=0;
  for(const id of ing){if(I(id).home){home++;const n=daysTo(I(id).exp);if(n!=null&&n<=3)soon.push(I(id).n)}}
  s+=soon.length*20+home*3;if(!ing.length)s-=25;
  return {s,days,soon,home};
}
function scoreHint(sc){const p=[];if(sc.soon.length)p.push("Bruker "+sc.soon.join(", ")+" som snart går ut");
  p.push(sc.days==null?"Ikke laget i appen ennå":sc.days===0?"Laget i dag":"Laget for "+sc.days+(sc.days===1?" dag":" dager")+" siden");return p.join(" · ")}
function suggestWeek(){
  const lc=lastCooked(),used=new Set(DAYS.map(d=>S.week[d]).filter(Boolean));
  const empty=DAYS.filter(d=>!S.week[d]);if(!empty.length){toast("Alle dager har allerede middag");return}
  const cand=dinnerIds().filter(id=>!used.has(id)).map(id=>({id,sc:dinnerScore(id,lc).s+Math.random()})).sort((a,b)=>b.sc-a.sc);
  if(!cand.length){toast("Ingen flere middager å foreslå. Legg til flere under Middager.");return}
  snapUndo();let n=0;
  for(const d of empty){const c=cand.shift();if(!c)break;S.week[d]=c.id;delete S.wp[d];applyFor(c.id);n++}
  changed();toast("La inn middag på "+n+(n===1?" dag":" dager"),true);
}

/* ===== Flere varer på én gang ===== */
function itemByKey(){const m={};for(const id of itemIds())m[key(I(id).n)]=id;return m}
function smartSplit(text){
  const whole=String(text||"").trim();if(!whole)return [];
  const km=itemByKey();
  if(km[key(splitQ(whole).n)])return [whole];
  const parts=whole.split(/\s*(?:,|;|\n|\s+og\s+|\s+&\s+|\s+\+\s+)\s*/i).map(s=>s.trim()).filter(Boolean);
  const out=[];
  for(const p of parts){
    if(km[key(splitQ(p).n)]){out.push(p);continue}
    const w=p.split(/\s+/);if(w.length<2){out.push(p);continue}
    const got=[];let i=0,ok=true;
    while(i<w.length){let f=0;for(let j=w.length;j>i;j--){if(km[key(w.slice(i,j).join(" "))]){f=j;break}}if(!f){ok=false;break}got.push(w.slice(i,f).join(" "));i=f}
    if(ok&&got.length>1)out.push(...got);else out.push(p);
  }
  return out;
}

/* ===== Handleliste ===== */
function subLine(id){
  const it=I(id),by=PL.by[id],parts=[];
  if(it.note)parts.push(`<small class="note">${esc(it.note)}</small>`);
  if(by&&!it.c)parts.push(`<small class="by">${esc(by.join(" · "))}</small>`);
  return parts.join("");
}
function whoBadge(id){const it=I(id);return (it.c===false&&it.ab&&it.ab!==ME.name&&it.at>prevSeen)?`<span class="who" title="Lagt til av ${esc(it.ab)}">${esc(it.ab.charAt(0).toUpperCase())}</span>`:""}
function itemRow(id){
  const it=I(id);
  if(editMode){
    if(it.h)return `<li class="item edit hdr${id===selId?" sel":""}" data-id="${id}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="nm"><b>${esc(it.n)}</b><small class="by">Avdeling</small></span></li>`;
    const tags=[it.fast?"fast":"",it.hb?it.hb+" d holdbar":"",it.pr?kr(it.pr):""].filter(Boolean).join(" · ");
    return `<li class="item edit${id===selId?" sel":""}" data-id="${id}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="nm">${esc(it.n)}${it.note?`<small class="note">${esc(it.note)}</small>`:""}${tags?`<small class="by">${esc(tags)}</small>`:""}</span></li>`;
  }
  const qn=qtyOf(id);
  const step=it.c?"":`<span class="step"><button class="qb" data-qd="-1" data-qi="${id}" aria-label="Færre ${esc(it.n)}">−</button><b class="qv${qn>1?" many":""}">${qn}</b><button class="qb" data-qd="1" data-qi="${id}" aria-label="Flere ${esc(it.n)}">+</button></span>`;
  return `<li class="item${it.c?" on":""}" data-id="${id}"><input type="checkbox" ${it.c?"checked":""} tabindex="-1" aria-label="${esc(it.n)}"><span class="nm"><span class="nmt">${esc(it.n)}${whoBadge(id)}</span>${subLine(id)}</span>${step}</li>`;
}
function addMatches(q){q=key(q);if(!q)return [];return itemIds().filter(id=>key(I(id).n).includes(q)||key(I(id).note||"").includes(q))}
function addResHtml(){
  const q=addQ.trim();if(!q)return"";
  const parts=smartSplit(q);
  if(parts.length>1){
    let anyNew=false;
    const rows=parts.map(p=>{const s=splitQ(p),id=findByName(s.n);if(!id)anyNew=true;
      return `<li><span>${esc(id?I(id).n:s.n)}${s.q>1?" ×"+s.q:""}</span><small>${id?(I(id).c?"legges på listen":"står allerede på listen"):"ny vare"}</small></li>`}).join("");
    return `<div class="pknew"><b>${parts.length} varer</b><ul class="mlist">${rows}</ul>${anyNew?`<select id="newpos" aria-label="Plassering for nye varer">${posOptions(lastPos)}</select>`:""}<div class="row"><button class="btn small primary" id="addmulti">Legg til alle</button><button class="btn small" id="addone">Legg til som én vare</button></div></div>`;
  }
  const m=addMatches(q);let h="";
  if(m.length)h+=`<ul class="reslist">${m.map(id=>`<li class="res${I(id).c?"":" active"}" data-ak="${id}"><span>${esc(I(id).n)}${I(id).note?` <small class="note">${esc(I(id).note)}</small>`:""}</span><small class="state">${I(id).c?"Legg på listen":"På listen ✓"}</small></li>`).join("")}</ul>`;
  else h+=`<p class="sub" style="margin:0">Ingen treff i sortimentet.</p>`;
  if(!findByName(splitQ(q).n))h+=`<div class="pknew"><div>Ny vare: <b>${esc(splitQ(q).n)}</b></div><select id="newpos" aria-label="Plassering i listen">${posOptions(lastPos)}</select><button class="btn small primary" id="additem">Legg til ny vare</button></div>`;
  return h;
}
function refreshAdd(){const el=$("#addres");if(el)el.innerHTML=addResHtml()}
function pickExisting(id){const it=I(id);snapUndo();
  if(it.c){need(id,true);toast(it.n+" lagt på listen",true);addQ="";changed();const i=$("#newitem");if(i)i.focus()}
  else{gotIt(id);toast(it.n+" huket av",true);changed()}}
function addItem(){
  const v=addQ.trim();if(!v)return;
  const parts=smartSplit(v);if(parts.length>1){addMulti(parts);return}
  const sq=splitQ(v),m=addMatches(v);
  if(!$("#newpos")){const ex=findByName(sq.n)||(m.length===1?m[0]:null);if(ex){if(I(ex).c)pickExisting(ex);else toast(I(ex).n+" står allerede på listen")}return}
  addNew(sq.n,sq.q);
}
function addNew(name,q){
  const pos=$("#newpos")?$("#newpos").value:lastPos;lastPos=pos;lsSet("pos",pos);
  snapUndo();const id=newItem(name,q,pos);need(id,true);addQ="";changed();toast(name+" lagt til",true);
  setTimeout(()=>{const i=$("#newitem");if(i)i.focus()},0);
}
function addMulti(parts){
  const pos=$("#newpos")?$("#newpos").value:lastPos;lastPos=pos;lsSet("pos",pos);
  snapUndo();let n=0;
  for(const p of parts){const s=splitQ(p);let id=findByName(s.n);
    if(id){if(I(id).c!==false){need(id,true);n++}if(s.q>1&&!planned().p[id])I(id).q=s.q}
    else{id=newItem(s.n,s.q,pos);need(id,true);n++}}
  addQ="";changed();toast(n+(n===1?" vare":" varer")+" lagt på listen",true);
}
function mvResHtml(){const q=key(mvQ);if(!q||!selId)return"";
  const m=ids().filter(id=>id!==selId&&key(I(id).n).includes(q));
  if(!m.length)return `<p class="sub" style="margin:0">Ingen treff på «${esc(mvQ)}»</p>`;
  return `<ul class="reslist mvlist">${m.slice(0,40).map(id=>`<li class="res mvr" data-mk="${id}"><span>Etter <b>${esc(I(id).n)}</b>${I(id).h?' <small class="by">(avdeling)</small>':""}</span></li>`).join("")}</ul>`}
function panelHtml(){
  const it=I(selId);if(!it)return"";
  const isH=!!it.h;
  let secOpts='<option value="">Flytt til avdeling…</option>';for(const id of headerIds())secOpts+=`<option value="${id}">${esc(I(id).n)}</option>`;
  return `<div class="panel"><div class="ptitle">${isH?"Avdeling: ":""}${esc(it.n)}</div>
    <div class="row"><button class="btn small" id="mv-up">↑ Opp</button><button class="btn small" id="mv-down">↓ Ned</button><button class="btn small" id="mv-top">Øverst</button><button class="btn small" id="mv-bot">Nederst</button></div>
    <div id="mv-res">${mvResHtml()}</div>
    <div class="row"><input type="search" id="mv-q" placeholder="Flytt etter: søk vare eller avdeling" value="${esc(mvQ)}" autocomplete="off"></div>
    ${isH?"":`<div class="row"><select id="mv-sec" aria-label="Flytt til avdeling">${secOpts}</select></div>`}
    <div class="row"><input type="text" id="mv-name" value="${esc(it.n)}" placeholder="Navn" aria-label="Navn"></div>
    ${isH?"":`<div class="row"><input type="text" id="mv-note" value="${esc(it.note||"")}" placeholder="Notat, f.eks. lilla eller om tilbud" aria-label="Notat"></div>
    <div class="row two"><label class="mini">Pris per stk (kr)<input type="text" inputmode="decimal" id="mv-pr" value="${it.pr?esc(String(it.pr).replace(".",",")):""}" placeholder="f.eks. 39,90"></label><label class="mini">Holdbar (dager)<input type="text" inputmode="numeric" id="mv-hb" value="${it.hb||""}" placeholder="f.eks. 4"></label></div>
    <label class="tog"><input type="checkbox" id="mv-fast" ${it.fast?"checked":""}> Fast vare: legges på listen hver nye uke</label>`}
    <div class="row"><button class="btn small primary" id="mv-save">Lagre</button><button class="btn small" id="mv-del">${delArm===selId?"Trykk igjen for å slette":isH?"Slett avdeling":"Slett vare"}</button><button class="btn small" id="mv-done" style="margin-left:auto">Lukk</button></div></div>`;
}
function suggestBanner(){
  if(editMode||bannerOff)return"";
  const n=orderSuggestions().length;if(!n)return"";
  return `<div class="banner"><span>Handleturene tyder på at ${n} ${n===1?"vare står":"varer står"} på feil sted i listen.</span><button class="btn small" id="seeorder">Se forslag</button></div>`;
}
function renderListe(){
  if(shop&&!editMode)return renderShop();
  let h=`<div class="stick"><div class="toolbar">`;
  if(!editMode)h+=`<button class="btn small primary" id="shopmode">Handlemodus</button><label class="tog"><input type="checkbox" id="hide" ${hideDone?"checked":""}> Skjul avhuket</label>`;
  else h+=`<button class="btn small" id="newsec">+ Ny avdeling</button>`;
  h+=`<button class="btn small${editMode?" primary":""}" id="editmode" style="margin-left:auto">${editMode?"Ferdig":"Endre liste"}</button></div>`;
  if(!editMode)h+=`<div class="addbox"><div class="srow"><input type="search" id="newitem" placeholder="Legg til: søk, eller skriv flere med komma" value="${esc(addQ)}" autocomplete="off" enterkeyhint="done"><button class="btn" id="scanlist" aria-label="Skann strekkode">Skann</button></div><div id="addres">${addResHtml()}</div></div>`;
  h+=`</div>`;
  if(editMode)h+=`<p class="sub" style="margin-top:8px">Trykk på en vare eller avdeling for å flytte, endre navn, notat, pris, holdbarhet eller slette.${curStore()?" Listen vises i standard rekkefølge mens du redigerer.":""}</p>`;
  h+=newBanner()+suggestBanner();
  h+=`<div class="group rest" style="margin-top:12px"><ul>`;
  let any=false;
  for(const g of groups(!editMode)){
    if(g.h){
      if(editMode)h+=itemRow(g.h);
      else{const left=g.items.filter(id=>!I(id).c).length,closed=col.includes(g.h);
        h+=`<li class="sec"><button class="secbtn" data-col="${g.h}" aria-expanded="${!closed}"><span class="chev">${closed?"▸":"▾"}</span>${esc(I(g.h).n)}</button><small class="${left?"left":""}">${left?left+" igjen":"alt huket av"}</small></li>`;
        if(closed)continue;}
    }
    for(const id of g.items){if(!editMode&&hideDone&&I(id).c)continue;h+=itemRow(id);any=true}
  }
  if(!any&&!editMode)h+=`<li class="empty">Alt er avhuket</li>`;
  h+=`</ul></div>`;
  if(editMode&&selId)h+=panelHtml();
  return h;
}
function renderShop(){
  const left=itemIds().filter(id=>!I(id).c),est=estimate(left);
  let h=`<div class="shopbar"><div><b class="big">${left.length}</b> igjen${est.sum?` · ca. ${kr(est.sum)}`:""}</div><button class="btn primary" id="shopdone">Ferdig handlet</button></div>`;
  h+=`<div class="row shopopts">${storeIds().length?`<select id="storesel" aria-label="Butikk"><option value="">Standard rekkefølge</option>${storeIds().map(s=>`<option value="${s}"${s===storeSel?" selected":""}>${esc(S.stores[s].name)}</option>`).join("")}</select>`:""}<button class="btn small" id="share">Del listen</button></div>`;
  for(const g of groups(true)){
    const rows=g.items.filter(id=>!I(id).c);if(!rows.length)continue;
    if(g.h)h+=`<div class="shsec">${esc(I(g.h).n)}</div>`;
    h+=`<ul class="shop">${rows.map(id=>{const q=qtyOf(id);return `<li class="sh" data-sh="${id}"><span class="box" aria-hidden="true"></span><span class="nm"><span class="nmt">${esc(I(id).n)}${whoBadge(id)}</span>${subLine(id)}</span>${q>1?`<b class="shq">×${q}</b>`:""}</li>`}).join("")}</ul>`;
  }
  if(!left.length)h+=`<p class="empty" style="text-align:center">Alt er i kurven.</p>`;
  const inb=trip.filter(id=>S.items[id]&&I(id).c);
  if(inb.length)h+=`<details class="basket"${ls("bopen",false)?" open":""}><summary>I kurven (${inb.length})</summary><ul class="shop">${inb.map(id=>`<li class="sh done" data-unsh="${id}"><span class="box on" aria-hidden="true">✓</span><span class="nm">${esc(I(id).n)}</span>${qtyOf(id)>1?`<b class="shq">×${qtyOf(id)}</b>`:""}</li>`).join("")}</ul></details>`;
  return h;
}

/* ===== Ukeplan ===== */
function renderUke(){
  const tn=todayName();
  let h=`<h2>Uke ${isoWeek(new Date())}: hva skal dere spise?</h2><div class="group">`;
  for(const d of DAYS){const v=S.week[d],din=S.dinners[v],rest=v===REST;
    let pers="";
    if(din){if(din.portions>0){const w=S.wp[d]||din.portions;pers=`<div class="pers"><button class="qb" data-wp="${d}" data-wd="-1" aria-label="Færre personer">−</button><span class="${S.wp[d]&&S.wp[d]!==din.portions?"chg":""}">${w} pers.</span><button class="qb" data-wp="${d}" data-wd="1" aria-label="Flere personer">+</button></div>`}
}
    h+=`<div class="day${d===tn?" istoday":""}"><b>${d}${d===tn?'<small class="by">i dag</small>':""}</b><button class="btn daybtn${din||rest?"":" none"}" data-dayp="${d}">${din?esc(din.name):rest?"Rester":"Velg middag"}</button>${din||rest?`<button class="btn small" data-cook="${d}">Laget</button>`:"<span></span>"}${pers?`<div class="dayx">${pers}</div>`:""}</div>`}
  const noPor=DAYS.some(d=>S.dinners[S.week[d]])&&!DAYS.some(d=>(S.dinners[S.week[d]]||{}).portions>0);
  h+=`</div><p class="sub" style="margin-top:10px">Ingrediensene legges på handlelisten når du velger en middag, bortsett fra det dere har hjemme. «Laget» tar ingrediensene ut av Hjemme.${noPor?" Sett antall porsjoner i oppskriften til en middag (under Middager), så kan du endre antall personer per dag her.":""}</p>`;
  h+=`<div class="toolbar">${DAYS.some(d=>!S.week[d])?'<button class="btn" id="suggest">Foreslå middager til tomme dager</button>':""}<button class="btn primary" id="newweek">Ny uke</button></div>`;
  if(confirmReset)h+=`<div class="confirm">Alt som ikke hører til ukens middager blir avhuket. Faste varer legges på listen, og personantall nullstilles. <button class="btn small primary" id="yesreset">Ja, start ny uke</button><button class="btn small" id="noreset">Avbryt</button></div>`;
  return h;
}
/* ===== Middager ===== */
function recipeLink(d,label){return d&&d.url?`<a class="rlink" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener">${label||"Oppskrift"} ↗</a>`:""}
function renderMiddager(){
  let h=`<div class="toolbar"><input type="text" id="newdin" placeholder="Ny middag, f.eks. Lasagne"><button class="btn primary" id="adddin">Lag middag</button></div><h2>Dine middager</h2><div class="groups">`;
  for(const did of dinnerIds()){const d=S.dinners[did];
    const chips=(d.ing||[]).filter(id=>S.items[id]).map(id=>`<span class="chip">${esc(I(id).n)}${dq(d,id)>1?` <b class="cq">×${dq(d,id)}</b>`:""}<button data-din="${did}" data-dii="${id}" aria-label="Fjern ${esc(I(id).n)}">×</button></span>`).join("");
    const cost=dinnerCost(d);
    const meta=[d.portions?`<span class="pchip">${d.portions} porsjoner</span>`:"",cost.sum?`<span class="pchip">ca. ${kr(cost.sum)}${cost.miss?` <small>(${cost.miss} uten pris)</small>`:""}</span>`:"",recipeLink(d),d.notes?`<small class="rnote">${esc(String(d.notes).split("\n")[0].slice(0,90))}</small>`:""].join("");
    h+=`<div class="group dish"><div class="ghead"><b>${esc(d.name)}</b><button class="btn small" data-deldin="${did}">${delArm===did?"Trykk igjen":"Slett"}</button></div>
    <div class="chips">${chips||'<span class="sub">Ingen ingredienser ennå</span>'}</div>
    ${meta?`<div class="rmeta">${meta}</div>`:""}
    <div class="addline"><button class="btn small primary" data-pick="${did}">Velg ingredienser</button><button class="btn small" data-rec="${did}">Oppskrift</button></div></div>`;
  }
  return h+`</div>`;
}

/* ===== Hjemme ===== */
function homeIds(){return itemIds().filter(id=>I(id).home)}
function expText(exp){const n=daysTo(exp);if(n==null)return"";const cls=n<0?"bad":n<=2?"warn":"ok";const txt=n<0?(n===-1?"Gikk ut i går":"Gikk ut for "+(-n)+" dager siden"):n===0?"Går ut i dag":n===1?"Går ut i morgen":"Går ut om "+n+" dager";return `<small class="exp ${cls}">${txt}</small>`}
function soonCount(){let n=0;for(const id of homeIds()){const d=daysTo(I(id).exp);if(d!=null&&d<=2)n++}for(const k in S.left){const d=daysTo(S.left[k].exp);if(d!=null&&d<=1)n++}return n}
function usedButtons(kind,id){return `<span class="usedq"><button class="btn small" data-usedok="${kind}:${id}">Brukt opp</button><button class="btn small" data-waste="${kind}:${id}">Kastet</button><button class="qb" data-usedno="1" aria-label="Avbryt">↩</button></span>`}
function homeRow(id){const it=I(id),by=PL.by[id],arm=usedArm==="i:"+id;
  return `<li class="hrow" data-hid="${id}"><span class="nm">${esc(it.n)}${it.note?`<small class="note">${esc(it.note)}</small>`:""}${expText(it.exp)}${by?`<small class="by">Til ${esc(by.join(" · "))}</small>`:""}</span>${arm?usedButtons("i",id):`<input type="date" class="hdate" data-hd="${id}" value="${esc(it.exp||"")}" aria-label="Best før for ${esc(it.n)}"><button class="qb" data-used="i:${id}" aria-label="${esc(it.n)} er brukt opp eller kastet" title="Brukt opp eller kastet">✕</button>`}</li>`}
function leftRow(k){const l=S.left[k],arm=usedArm==="l:"+k;
  return `<li class="hrow"><span class="nm">${esc(l.n)}${expText(l.exp)}</span>${arm?usedButtons("l",k):`<input type="date" class="hdate" data-ld="${k}" value="${esc(l.exp||"")}" aria-label="Best før for ${esc(l.n)}"><button class="qb" data-used="l:${k}" aria-label="${esc(l.n)} er spist eller kastet" title="Spist eller kastet">✕</button>`}</li>`}
function homeMatches(){const q=key(homeQ);if(!q)return [];return itemIds().filter(id=>key(I(id).n).includes(q))}
function homeResHtml(){
  const q=homeQ.trim();if(!q)return"";
  const m=homeMatches();let h="";
  if(m.length)h+=`<ul class="reslist">${m.map(id=>`<li class="res${I(id).home?" active":""}" data-hk="${id}"><span>${esc(I(id).n)}</span><small class="state">${I(id).home?"Hjemme ✓":"Legg til"}</small></li>`).join("")}</ul>`;
  else h+=`<p class="sub" style="margin:0">Ingen treff i sortimentet.</p>`;
  const sq=splitQ(q);if(!findByName(sq.n))h+=`<div class="pknew"><div>Ny vare: <b>${esc(sq.n)}</b></div><select id="hpos" aria-label="Plassering i handlelisten">${posOptions(lastPos)}</select><button class="btn small primary" id="homeadd">Legg til i sortimentet og hjemme</button></div>`;
  return h;
}
function toggleHome(id){const it=I(id);snapUndo();if(it.home){delete it.home;delete it.exp;toast(it.n+" fjernet fra Hjemme",true)}else{putHome(id);toast(it.n+" lagt i Hjemme",true)}homeQ="";changed();const i=$("#homeq");if(i)i.focus()}
function homeAdd(){const sq=splitQ(homeQ.trim());if(!sq.n)return;const pos=$("#hpos").value;lastPos=pos;lsSet("pos",pos);
  snapUndo();const id=newItem(sq.n,sq.q,pos);putHome(id);homeQ="";changed();toast(sq.n+" lagt i Hjemme",true);setTimeout(()=>{const i=$("#homeq");if(i)i.focus()},0)}
function renderHjemme(){
  let h=`<div class="stick"><div class="addbox" style="margin-top:10px"><div class="srow"><input type="search" id="homeq" placeholder="Legg til hjemme: søk eller skriv ny" value="${esc(homeQ)}" autocomplete="off"><button class="btn" id="scanhome" aria-label="Skann strekkode">Skann</button><button class="btn" id="rcptbtn">Kvittering</button></div><div id="homeres">${homeResHtml()}</div></div></div>`;
  const hs=homeIds(),lk=Object.keys(S.left).sort((a,b)=>(S.left[a].exp||"").localeCompare(S.left[b].exp||""));
  if(!hs.length&&!lk.length)h+=`<p class="empty">Ingenting er registrert hjemme ennå. Søk etter varer over, skann en strekkode, eller trykk «Ferdig handlet» i handlemodus, så havner det dere kjøpte her.</p>`;
  if(lk.length)h+=`<h2>Rester</h2><ul class="hlist">${lk.map(leftRow).join("")}</ul>`;
  const soon=hs.filter(id=>{const n=daysTo(I(id).exp);return n!=null&&n<=2}).sort((a,b)=>daysTo(I(a).exp)-daysTo(I(b).exp));
  if(soon.length)h+=`<h2>Går snart ut</h2><ul class="hlist">${soon.map(homeRow).join("")}</ul>`;
  if(hs.length>soon.length){
    h+=`<h2>Hjemme <span class="cnt2">${hs.length}</span></h2>`;
    for(const g of groups(false)){const rows=g.items.filter(id=>I(id).home&&!soon.includes(id));if(!rows.length)continue;
      if(g.h)h+=`<div class="shsec">${esc(I(g.h).n)}</div>`;
      h+=`<ul class="hlist">${rows.map(homeRow).join("")}</ul>`}
  }
  const sug=dinnerIds().map(did=>{const d=S.dinners[did],ing=(d.ing||[]).filter(id=>S.items[id]),miss=ing.filter(id=>!I(id).home);return {d,ing,miss}})
    .filter(x=>x.ing.length&&x.miss.length<x.ing.length).sort((a,b)=>a.miss.length-b.miss.length||b.ing.length-a.ing.length).slice(0,5);
  if(sug.length)h+=`<h2>Hva kan vi lage?</h2><div class="group">${sug.map(x=>`<div class="sug"><b>${esc(x.d.name)}</b><small>${x.miss.length?"Mangler "+x.miss.map(id=>esc(I(id).n)).join(", "):"Dere har alt"}</small></div>`).join("")}</div>`;
  return h;
}
function finishUsed(spec,wasted){
  const [kind,id]=spec.split(":");snapUndo();let name="";
  if(kind==="i"&&S.items[id]){name=I(id).n;delete I(id).home;delete I(id).exp}
  else if(kind==="l"&&S.left[id]){name=S.left[id].n;delete S.left[id]}
  if(!name)return;
  if(wasted){S.waste[uid("w")]={n:name,at:Date.now()};prune(S.waste,150)}
  usedArm=null;changed();toast(name+(wasted?" registrert som kastet":kind==="l"?" spist":" brukt opp"),true);
}

/* ===== Dato og dagens middag øverst ===== */
function renderToday(){
  const tn=todayName(),v=S.week[tn],d=S.dinners[v];
  let h=`<span class="wk">Uke ${isoWeek(new Date())}</span>`;
  if(d)h+=` · I dag: <b>${esc(d.name)}</b>${d.url?" · "+recipeLink(d):(d.notes?` · <button class="linkbtn tl" data-rec="${v}">Oppskrift</button>`:"")} · <button class="linkbtn tl" data-cook="${tn}">Laget</button>`;
  else if(v===REST)h+=` · I dag: <b>Rester</b> · <button class="linkbtn tl" data-cook="${tn}">Spist</button>`;
  else h+=` · Ingen middag planlagt i dag`;
  $("#today").innerHTML=h;
}

/* ===== Del som tekst ===== */
function listText(){
  const lines=["Handleliste uke "+isoWeek(new Date())];
  for(const g of groups(true)){const rows=g.items.filter(id=>!I(id).c);if(!rows.length)continue;
    if(g.h)lines.push("",I(g.h).n.toUpperCase());
    for(const id of rows){const q=qtyOf(id);lines.push("- "+I(id).n+(q>1?" ×"+q:"")+(I(id).note?" ("+I(id).note+")":""))}}
  if(lines.length===1)lines.push("","Alt er handlet.");
  return lines.join("\n");
}
async function shareList(){
  const text=listText();
  if(navigator.share){try{await navigator.share({title:"Handleliste",text});return}catch(e){if(e&&e.name==="AbortError")return}}
  try{await navigator.clipboard.writeText(text);toast("Listen er kopiert. Lim den inn der du vil sende den.")}catch(e){OV={type:"text",text};renderOverlay()}
}

/* ===== Strekkoder ===== */
const ZXING_URL="https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
function loadScript(src,glob){glob=glob||"ZXing";return new Promise((res,rej)=>{if(window[glob])return res();const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load"));document.head.appendChild(s)})}
async function shrink(file,max){const bmp=await createImageBitmap(file);const sc=Math.min(1,max/Math.max(bmp.width,bmp.height));const c=document.createElement("canvas");c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);c.getContext("2d").drawImage(bmp,0,0,c.width,c.height);return c.toDataURL("image/jpeg",.92)}
async function decodeBarcode(file){
  try{if("BarcodeDetector" in window){const fm=await BarcodeDetector.getSupportedFormats();if(fm&&fm.length){const det=new BarcodeDetector({formats:fm});const r=await det.detect(await createImageBitmap(file));if(r&&r.length)return String(r[0].rawValue)}}}catch(e){}
  try{await loadScript(ZXING_URL)}catch(e){toast("Kunne ikke laste strekkodeleseren. Sjekk nettforbindelsen.");return null}
  const hints=new Map();hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
  for(const size of [1600,1000,2400]){try{const r=await new ZXing.BrowserMultiFormatReader(hints).decodeFromImageUrl(await shrink(file,size));if(r)return String(r.getText())}catch(e){}}
  return null;
}
function startScan(ctx){scanCtx=ctx;const f=$("#scanfile");f.value="";f.click()}
function actOnCode(id){snapUndo();const it=I(id);
  if(scanCtx==="home"){putHome(id);toast(it.n+" lagt i Hjemme",true)}
  else{need(id,true);toast(it.n+" lagt på listen",true)}
  changed()}
function handleCode(code){const id=S.codes[code];if(id&&S.items[id]&&!I(id).h){actOnCode(id);return}OV={type:"scan",code,q:""};renderOverlay()}

/* ===== Sikkerhetskopier ===== */
function bkRef(name){return fdb.collection("lists").doc(name)}
async function dailyBackup(){
  const t=ymd(new Date());if(ls("bk","")===t)return;
  try{await bkRef("backup-"+t).set(clone(S));lsSet("bk",t);
    for(let i=8;i<=21;i++){const d=new Date();d.setDate(d.getDate()-i);bkRef("backup-"+ymd(d)).delete().catch(()=>{})}}catch(e){}
}
async function loadBackups(){
  const names=[];for(let i=0;i<8;i++){const d=new Date();d.setDate(d.getDate()-i);names.push("backup-"+ymd(d))}
  names.push("backup-prev","backup-v2");
  const out=[];
  await Promise.all(names.map(async n=>{try{const s=await bkRef(n).get();if(s.exists){const d=s.data();const cnt=Array.isArray(d.items)?d.items.length:Object.values(d.items||{}).filter(x=>!x.h).length;out.push({n,cnt})}}catch(e){}}));
  out.sort((a,b)=>names.indexOf(a.n)-names.indexOf(b.n));
  if(OV&&OV.type==="more"){OV.bk=out;renderOverlay()}
}
function bkLabel(n){if(n==="backup-prev")return "Før siste gjenoppretting";if(n==="backup-v2")return "Før oppgraderingen i oktober";const s=n.slice(7),d=daysTo(s);return d===0?"I dag ("+s+")":d===-1?"I går ("+s+")":s}
async function restore(name){
  try{const s=await bkRef(name).get();if(!s.exists){toast("Fant ikke kopien");return}
    await bkRef("backup-prev").set(clone(S));
    S=toV3(s.data());ensure();B=clone(S);await ref.set(clone(S));OV=null;renderOverlay();render();toast("Listen er gjenopprettet")}
  catch(e){toast("Gjenoppretting feilet ("+(e&&e.code||"ukjent feil")+")")}
}
function downloadCopy(){
  const blob=new Blob([JSON.stringify(S,null,1)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="ukeshandel-"+ymd(new Date())+".json";document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500);
}


/* ===== Kvittering: les skjermbilde, finn varer og priser ===== */
const TESS_URL="https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
function normName(s){return key(s).replace(/\d+([.,]\d+)?\s*(%|kg|g|gr|l|ltr|cl|dl|ml|stk|pk)?/g," ").replace(/[^a-zæøåäöé ]/g," ").replace(/\b(stk|kg|gr|ltr|pk|pakke|pr|x)\b/g," ").replace(/\s+/g," ").trim()}
function tokHit(t,words){return words.some(w=>w===t||(t.length>=4&&(w.startsWith(t)||w.endsWith(t)))||(t.length>=6&&w.includes(t)))}
function matchItem(txt){
  const k=normName(txt);if(!k)return null;
  if(S.rmap[k]&&S.items[S.rmap[k]]&&!I(S.rmap[k]).h)return S.rmap[k];
  const words=k.split(" ");let best=null,bs=0;
  for(const id of itemIds()){const toks=normName(I(id).n).split(" ").filter(t=>t.length>=3);if(!toks.length)continue;
    if(toks.every(t=>tokHit(t,words))){const s=toks.join("").length*10+toks.length;if(s>bs){bs=s;best=id}}}
  return best;
}
function prettyName(s){const n=normName(s);return n?n.charAt(0).toUpperCase()+n.slice(1):String(s).trim()}
const RC_SKIP=/^(sum|total|totalt|å ?betale|a ?betale|betalt|bank|bankaxept|kort|visa|mastercard|mva|grunnlag|netto|veksel|kontant|tilgode|subtotal|kasse|kvittering|org|foretak|tlf|telefon|dato|tid\b|ref|aid|bax|trans|termin|kunde|medlem|trumf|bonus|du (har )?spar|herav|avrunding|antall|vipps|gavekort|refusjon|endring)/i;
function parseReceipt(text){
  const raw=String(text).split(/\n/).map(l=>l.replace(/[|]/g," ").replace(/\s+/g," ").trim()).filter(Boolean);
  let store="",date=null,total=null,lastText=null;const lines=[];
  const chain=/(rema\s*1000|kiwi|coop\s*(extra|prix|mega|obs|marked)|coop|extra|meny|spar|joker|bunnpris|obs|europris|oda)/i;
  raw.forEach((l,i)=>{
    if(!store&&i<10){const m=l.match(chain);if(m)store=m[0].replace(/\s+/g," ").toUpperCase()}
    if(!date){const m=l.match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/);if(m){let y=+m[3];if(y<100)y+=2000;const d=new Date(y,+m[2]-1,+m[1],12);if(!isNaN(d)&&y>2010&&y<2100)date=d.getTime()}}
    const pm=l.match(/(-?\s?\d{1,5}[.,]\d{2})\s*(kr|nok)?\s*[a-z*]?$/i);
    if(!pm){if(/[a-zæøå]{3}/i.test(l)&&!RC_SKIP.test(l)&&!/\d{2}[:.]\d{2}/.test(l))lastText=l;return}
    const price=parseFloat(pm[1].replace(/\s/g,"").replace(",","."));
    let name=l.slice(0,pm.index).trim();
    if(/^(sum|total|totalt|å ?betale|a ?betale)\b/i.test(name)){if(price>0)total=price;return}
    if(RC_SKIP.test(name)||/pant/i.test(name))return;
    if(price<0||/^(rabatt|kampanje|tilbud|nedslag|kupong|medlemsrabatt)/i.test(name)){if(lines.length)lines[lines.length-1].p=Math.max(0,Math.round((lines[lines.length-1].p+(price<0?price:-price))*100)/100);return}
    const qm=name.match(/^(\d+)\s*(stk|st)?\s*[x×*]\s*(\d+[.,]\d{2})?$/i);
    if(qm||!/[a-zæøå]{2}/i.test(name.replace(/\b(stk|st|kg|x)\b/gi,""))){
      const q=qm?+qm[1]:1;
      const prev=lines[lines.length-1];
      if(lastText&&(!prev||prev.txt!==lastText)){lines.push({txt:lastText,p:price,q});lastText=null}
      else if(prev){prev.q=q;prev.p=price}
      return;
    }
    let q=1;const im=name.match(/^(\d+)\s*[x×*]\s+(.*)$/i);if(im){q=+im[1];name=im[2]}
    const tm=name.match(/^(.*?)\s+(\d+)\s*[x×*]\s*\d+[.,]\d{2}$/i);if(tm){name=tm[1];q=+tm[2]}
    name=name.replace(/^\d{3,}\s+/,"").replace(/\s+\d{1,2}\s*%$/,"").trim();
    if(!/[a-zæøå]{2}/i.test(name))return;
    lines.push({txt:name,p:price,q});lastText=null;
  });
  for(const ln of lines){ln.id=matchItem(ln.txt);ln.nm=ln.id?I(ln.id).n:prettyName(ln.txt);ln.on=true;ln.auto=!!ln.id}
  return {store,date,total,lines};
}
async function prepImage(file){
  const bmp=await createImageBitmap(file);
  const sc=bmp.width<900?2:bmp.width<1300?1.5:1;
  const c=document.createElement("canvas");c.width=Math.round(bmp.width*sc);c.height=Math.round(bmp.height*sc);
  const g=c.getContext("2d");g.filter="grayscale(1) contrast(1.15)";g.drawImage(bmp,0,0,c.width,c.height);return c;
}
async function readReceipt(file){
  OV={type:"rcpt",stage:"read",pct:0};renderOverlay();
  try{await loadScript(TESS_URL,"Tesseract")}catch(e){OV=null;renderOverlay();toast("Kunne ikke laste tekstgjenkjenningen. Sjekk nettforbindelsen.");return}
  let text="";
  try{const img=await prepImage(file);
    const r=await Tesseract.recognize(img,"nor",{logger:m=>{if(OV&&OV.type==="rcpt"&&OV.stage==="read"){if(m.status==="recognizing text")OV.pct=Math.round(m.progress*100);OV.msg=m.status;const b=$("#rc-pct");if(b)b.textContent=rcStatus(OV)}}});
    text=r.data.text||""}
  catch(e){OV=null;renderOverlay();toast("Klarte ikke å lese bildet.");return}
  const pr=parseReceipt(text);
  if(!pr.lines.length){OV={type:"rcpt",stage:"none",raw:text};renderOverlay();return}
  OV=Object.assign({type:"rcpt",stage:"review",raw:text,pick:null,q:""},pr);renderOverlay();
}
function rcStatus(o){return /recogniz/.test(o.msg||"")?"Leser tekst … "+o.pct+" %":/load|initializ/.test(o.msg||"")?"Laster tekstgjenkjenning (første gang tar det litt tid) …":"Forbereder …"}
function rcptHtml(o){
  if(o.stage==="read")return `<div class="phead"><b class="ptl">Kvittering</b><button class="btn small" id="ov-close">Avbryt</button></div><div class="pkbody"><p class="sub" id="rc-pct">${esc(rcStatus(o))}</p></div>`;
  if(o.stage==="none")return `<div class="phead"><b class="ptl">Kvittering</b><button class="btn small" id="ov-close">Lukk</button></div><div class="pkbody"><p class="sub" style="margin:0">Fant ingen varelinjer med pris. Prøv et skarpere skjermbilde der hele kvitteringen er med, gjerne fra butikkens app.</p>${o.raw?`<details><summary class="sub">Teksten appen leste</summary><textarea class="sharetxt" readonly>${esc(o.raw)}</textarea></details>`:""}</div>`;
  if(o.pick!=null){const ln=o.lines[o.pick],q=key(o.q);
    const rows=itemIds().filter(id=>!q||key(I(id).n).includes(q)).slice(0,q?60:25);
    return `<div class="phead"><input type="search" id="rcp-q" placeholder="Hvilken vare er «${esc(ln.txt)}»? Søk" value="${esc(o.q)}" autocomplete="off"><button class="btn small" id="rcp-back">Tilbake</button></div>
      <div class="pkbody"><ul class="pklist">${rows.map(id=>`<li class="item" data-rcpk="${id}"><span class="nm">${esc(I(id).n)}</span></li>`).join("")}</ul>
      <div class="pknew"><div>Ny vare: <b>${esc(o.q.trim()||ln.nm)}</b></div><button class="btn small primary" id="rcp-new">Bruk som ny vare</button></div>
      <button class="btn small" id="rcp-skip">Ikke ta med denne linjen</button></div>`}
  const sumL=o.lines.filter(l=>l.on).reduce((a,l)=>a+(l.p||0),0);
  const nNew=o.lines.filter(l=>l.on&&!l.id&&!findByName(l.nm)).length;
  return `<div class="phead"><b class="ptl">Kvittering${o.store?": "+esc(o.store):""}</b><button class="btn small primary" id="rc-save">Lagre</button><button class="btn small" id="ov-close">Avbryt</button></div>
    <div class="pkbody"><p class="sub" style="margin:0">${o.date?new Date(o.date).toLocaleDateString("nb-NO")+" · ":""}${o.total?"Sum på kvitteringen: <b>"+kr(o.total)+"</b> · ":""}Valgte linjer: <b>${kr(sumL)}</b>${o.total&&Math.abs(o.total-sumL)>1?' <span class="warnt">(avviker, sjekk linjene)</span>':""}</p>
    <p class="sub" style="margin:0">Trykk på et navn for å koble linjen til riktig vare. Det appen lærer, husker den neste gang.</p>
    <ul class="pklist">${o.lines.map((l,i)=>`<li class="item rcl${l.on?"":" off"}"><input type="checkbox" data-rcon="${i}" ${l.on?"checked":""} aria-label="Ta med ${esc(l.txt)}"><button class="rcname" data-rcpick="${i}"><span>${l.id?esc(I(l.id).n):"Ny vare: "+esc(l.nm)}${l.q>1?" ×"+l.q:""}</span><small class="by">${esc(l.txt)}${l.id&&!l.auto?" · koblet av deg":""}</small></button><input type="text" inputmode="decimal" class="rcp" data-rcp="${i}" value="${esc(String(l.p.toFixed(2)).replace(".",","))}" aria-label="Pris for ${esc(l.txt)}"></li>`).join("")}</ul>
    ${nNew?`<label class="fl">${nNew} ${nNew===1?"ny vare legges":"nye varer legges"} i<select id="rc-pos">${posOptions(lastPos)}</select></label>`:""}
    <p class="sub" style="margin:0">Lagre setter pris på varene, legger dem i Hjemme, huker av det som sto på handlelisten og fører beløpet i budsjettet.</p></div>`;
}
function saveReceipt(o){
  const pos=$("#rc-pos")?$("#rc-pos").value:lastPos;lastPos=pos;lsSet("pos",pos);
  snapUndo();const got=[];let sum=0;
  for(const l of o.lines){if(!l.on)continue;
    let id=l.id&&S.items[l.id]?l.id:findByName(l.nm);
    if(!id)id=newItem(l.nm,1,pos);
    const it=I(id);if(l.p>0)it.pr=Math.round(l.p/(l.q||1)*100)/100;
    putHome(id);if(it.c===false)gotIt(id);
    if(!l.auto||!l.id)S.rmap[normName(l.txt)]=id;
    got.push({n:it.n,p:l.p});sum+=l.p||0;
  }
  const total=o.total||Math.round(sum*100)/100,at=o.date&&Math.abs(o.date-Date.now())<3*864e5?Date.now():(o.date||Date.now());
  const near=Object.keys(S.hist).find(k=>{const t=S.hist[k];return !t.rc&&Math.abs(t.at-at)<12*3600e3});
  const rec=near?S.hist[near]:(S.hist[uid("t")]={at,st:storeSel||"",by:ME.name||""});
  rec.sum=total;rec.rc=1;rec.sn=o.store||"";rec.lines=got.slice(0,80);prune(S.hist,30);
  OV=null;renderOverlay();changed();toast(got.length+(got.length===1?" vare":" varer")+" fra kvitteringen lagt i Hjemme",true);
}
function receiptsHtml(){
  const rs=Object.values(S.hist).filter(t=>t.rc).sort((a,b)=>b.at-a.at).slice(0,8);
  let h=`<div class="row" style="margin-top:10px"><button class="btn small primary" id="rcptbtn2">Les kvittering</button></div>`;
  if(rs.length)h+=`<ul class="mlist" style="margin-top:8px">${rs.map(t=>`<li><details class="rcd"><summary><span>${new Date(t.at).toLocaleDateString("nb-NO")}${t.sn?" · "+esc(t.sn):""}</span><b>${kr(t.sum||0)}</b></summary><ul class="mlist">${(t.lines||[]).map(l=>`<li><span>${esc(l.n)}</span><small>${kr(l.p||0)}</small></li>`).join("")}</ul></details></li>`).join("")}</ul>`;
  return h;
}

/* ===== Vinduer (velgere, oppskrift, laget, mer …) ===== */
function dayListHtml(o){
  const q=key(o.q),cur=S.week[o.day]||"",lc=lastCooked();
  let rows=dinnerIds().filter(id=>!q||key(S.dinners[id].name).includes(q)).map(id=>({id,sc:dinnerScore(id,lc)}));
  if(!q)rows.sort((a,b)=>b.sc.s-a.sc.s);
  const nl=Object.keys(S.left).length;
  let h=q?"":`<li class="item${cur===""?" picked":""}" data-did=""><span>Ingen middag</span></li><li class="item${cur===REST?" picked":""}" data-did="${REST}"><span class="nm">Rester<small class="by">${nl?nl+" porsjon"+(nl===1?"":"er")+" registrert i Hjemme":"Ingen rester registrert"}</small></span></li>`;
  h+=rows.map(r=>`<li class="item${r.id===cur?" picked":""}" data-did="${r.id}"><span class="nm">${esc(S.dinners[r.id].name)}<small class="by">${esc(scoreHint(r.sc))}</small></span><small class="cnt">${(S.dinners[r.id].ing||[]).length} ingr.</small></li>`).join("");
  if(q&&!rows.length)h+=`<li class="empty">Ingen middag heter «${esc(o.q)}»</li>`;
  return h;
}
function dayNewHtml(o){const q=o.q.trim();if(!q||dinnerIds().some(id=>key(S.dinners[id].name)===key(q)))return"";
  return `<div class="pknew"><div>Ny middag: <b>${esc(q)}</b></div><button class="btn small primary" id="dp-add">Lag middagen og velg ingredienser</button></div>`}
function pickListHtml(o){
  const d=S.dinners[o.did];if(!d)return"";
  const q=key(o.q),inDin=new Set(d.ing||[]);let h="";
  for(const id of ids()){const it=I(id);
    if(it.h){if(!q)h+=`<li class="pkh">${esc(it.n)}</li>`;continue}
    if(q&&!key(it.n).includes(q))continue;
    const on=inDin.has(id);
    h+=`<li class="item${on?" picked":""}" data-pk="${id}"><input type="checkbox" tabindex="-1" ${on?"checked":""} aria-label="${esc(it.n)}"><span class="nm">${esc(it.n)}</span>${on?`<span class="step"><button class="qb" data-dq="-1" data-dk="${id}" aria-label="Færre">−</button><b class="qv${dq(d,id)>1?" many":""}">${dq(d,id)}</b><button class="qb" data-dq="1" data-dk="${id}" aria-label="Flere">+</button></span>`:""}</li>`;
  }
  if(q&&!h)h=`<li class="empty">Ingen varer i listen matcher «${esc(o.q)}»</li>`;
  return h;
}
function pickNewHtml(o){const s=splitQ(o.q.trim());if(!s.n||findByName(s.n))return"";
  return `<div class="pknew"><div>Ny vare: <b>${esc(s.n)}</b></div><div class="row"><select id="pk-pos" aria-label="Plassering i listen">${posOptions(lastPos)}</select><button class="btn small primary" id="pk-add">Legg til i listen og middagen</button></div></div>`}
function scanListHtml(o){
  const q=key(o.q);const rows=itemIds().filter(id=>!q||key(I(id).n).includes(q)).slice(0,q?60:25);
  let h=`<ul class="pklist">${rows.map(id=>`<li class="item" data-sk="${id}"><span class="nm">${esc(I(id).n)}</span></li>`).join("")}</ul>`;
  const s=splitQ(o.q.trim());
  if(s.n&&!findByName(s.n))h+=`<div class="pknew"><div>Ny vare: <b>${esc(s.n)}</b></div><select id="sc-pos" aria-label="Plassering i listen">${posOptions(lastPos)}</select><button class="btn small primary" id="sc-add">Opprett og koble til strekkoden</button></div>`;
  return h;
}
function budgetHtml(){
  const hs=Object.values(S.hist).filter(t=>t.sum>0||t.est>0);
  if(!hs.length)return `<p class="sub">Ingen handleturer med beløp ennå. Fyll inn hva handelen kostet når du trykker «Ferdig handlet», eller legg inn priser på varene under «Endre liste», så regner appen ut et anslag.</p>`;
  const wk={};for(const t of hs){const k=weekKey(t.at);wk[k]=wk[k]||{s:0,est:false};wk[k].s+=t.sum>0?t.sum:t.est;if(!(t.sum>0))wk[k].est=true}
  const weeks=[];for(let i=5;i>=0;i--){const d=new Date();d.setDate(d.getDate()-7*i);const k=weekKey(d.getTime());weeks.push({k,w:isoWeek(d),v:wk[k]})}
  const mx=Math.max(1,...weeks.map(w=>w.v?w.v.s:0));
  const now=new Date(),mStart=new Date(now.getFullYear(),now.getMonth(),1).getTime();
  let month=0,mEst=false;for(const t of hs)if(t.at>=mStart){month+=t.sum>0?t.sum:t.est;if(!(t.sum>0))mEst=true}
  return `<p class="sub" style="margin:0 0 8px">Denne måneden: <b>${mEst?"ca. ":""}${kr(month)}</b></p><div class="bars">${weeks.map(w=>`<div class="bar"><span class="bl">Uke ${w.w}</span><span class="bt"><span style="width:${w.v?Math.max(2,Math.round(w.v.s/mx*100)):0}%"></span></span><span class="bv">${w.v?(w.v.est?"ca. ":"")+kr(w.v.s):"–"}</span></div>`).join("")}</div>`;
}
function wasteHtml(){
  const since=Date.now()-30*864e5,m={};let tot=0;
  for(const k in S.waste){const w=S.waste[k];if(w.at>=since){m[w.n]=(m[w.n]||0)+1;tot++}}
  if(!tot)return `<p class="sub">Ingenting registrert som kastet de siste 30 dagene. Trykk ✕ på en vare i Hjemme og velg «Kastet» når noe må kastes.</p>`;
  const top=Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return `<p class="sub" style="margin:0 0 8px">${tot} ${tot===1?"ting":"ting"} kastet de siste 30 dagene.</p><ul class="mlist">${top.map(([n,c])=>`<li><span>${esc(n)}</span><small>${c}×</small></li>`).join("")}</ul>`;
}
function moreHtml(o){
  const sug=orderSuggestions(),tc=tripCount();
  let h=`<div class="phead"><b class="ptl">Mer</b><button class="btn small" id="ov-close">Lukk</button></div><div class="pkbody">`;
  h+=`<section class="msec"><h3>Del handlelisten</h3><p class="sub">Sender det som mangler som vanlig tekst, f.eks. på SMS.</p><button class="btn small primary" id="share">Del listen</button></section>`;
  h+=`<section class="msec" id="m-order"><h3>Rekkefølge fra handleturene</h3>`;
  if(sug.length)h+=`<ul class="mlist sugl">${sug.map(s=>`<li><span>Flytt <b>${esc(I(s.x).n)}</b> etter <b>${esc(I(s.p).n)}</b>${s.kind==="sec"?' <small class="by">(annen avdeling)</small>':""}<small class="by">Plukket slik ${s.c} ganger</small></span><span class="row nowrap"><button class="btn small primary" data-sgo="${s.x}|${s.p}">Flytt</button><button class="btn small" data-sno="${s.x}|${s.p}">Ignorer</button></span></li>`).join("")}</ul>`;
  else h+=`<p class="sub">${tc<2?"Appen lærer av rekkefølgen dere plukker varer i handlemodus. Forslag dukker opp etter et par handleturer"+(tc?" (1 registrert så langt).":"."):"Ingen forslag nå. Listen stemmer med hvordan dere går i butikken ("+tc+" handleturer registrert)."}</p>`;
  h+=`</section>`;
  h+=`<section class="msec"><h3>Butikker</h3><p class="sub">Hver butikk kan ha sin egen rekkefølge på avdelingene. Velg butikk når du starter handlemodus.</p>`;
  if(storeIds().length)h+=`<ul class="mlist">${storeIds().map(s=>`<li><span>${esc(S.stores[s].name)}${s===storeSel?' <small class="by">i bruk på denne telefonen</small>':""}</span><span class="row nowrap">${s===storeSel?"":`<button class="btn small" data-stuse="${s}">Bruk</button>`}<button class="btn small" data-stedit="${s}">Endre</button></span></li>`).join("")}</ul>`;
  if(storeSel)h+=`<p class="sub" style="margin:6px 0 0"><button class="linkbtn" data-stuse="">Bruk standard rekkefølge</button></p>`;
  h+=`<div class="row" style="margin-top:8px"><input type="text" id="newstore" placeholder="Ny butikk, f.eks. Rema Moholt"><button class="btn small primary" id="addstore">Legg til</button></div></section>`;
  h+=`<section class="msec"><h3>Budsjett og kvitteringer</h3>${budgetHtml()}${receiptsHtml()}</section>`;
  h+=`<section class="msec"><h3>Matsvinn</h3>${wasteHtml()}</section>`;
  h+=`<section class="msec"><h3>Sikkerhetskopier</h3><p class="sub">Appen tar en kopi av hele listen én gang om dagen og beholder kopiene en uke.</p>`;
  if(!o.bk)h+=`<p class="sub">Henter kopier …</p>`;
  else if(!o.bk.length)h+=`<p class="sub">Ingen kopier ennå. Den første lages i dag.</p>`;
  else h+=`<ul class="mlist">${o.bk.map(b=>`<li><span>${esc(bkLabel(b.n))}<small class="by">${b.cnt} varer</small></span><button class="btn small" data-restore="${b.n}">${o.arm===b.n?"Trykk igjen for å gjenopprette":"Gjenopprett"}</button></li>`).join("")}</ul>`;
  h+=`<div class="row" style="margin-top:8px"><button class="btn small" id="download">Last ned kopi som fil</button></div></section>`;
  h+=`<section class="msec"><h3>Snarveier</h3><p class="sub">Trykk og hold på app-ikonet på hjemskjermen for å gå rett til «Legg til vare», handlemodus eller Hjemme. Det kan ta et par dager før telefonen henter snarveiene etter en oppdatering.</p></section>`;
  return h+`</div>`;
}
function storeHtml(o){
  const st=S.stores[o.sid];if(!st)return"";
  const order=secOrder(st);
  return `<div class="phead"><b class="ptl">${esc(st.name)}</b><button class="btn small primary" id="ov-back">Ferdig</button></div><div class="pkbody">
    <label class="fl">Navn<input type="text" id="st-name" value="${esc(st.name)}"></label>
    <p class="sub" style="margin:0">Rekkefølgen på avdelingene i denne butikken. Varene inni hver avdeling følger listen.</p>
    <ul class="pklist">${order.map((h,i)=>`<li class="item"><span class="nm">${esc(I(h).n)}</span><span class="step"><button class="qb" data-so="${i}" data-sd="-1" aria-label="Flytt opp" ${i===0?"disabled":""}>↑</button><button class="qb" data-so="${i}" data-sd="1" aria-label="Flytt ned" ${i===order.length-1?"disabled":""}>↓</button></span></li>`).join("")||'<li class="empty">Ingen avdelinger ennå. Lag avdelinger under «Endre liste».</li>'}</ul>
    <button class="btn small" id="st-del">${o.arm?"Trykk igjen for å slette butikken":"Slett butikken"}</button></div>`;
}
function renderOverlay(){
  const el=$("#picker");
  if(!OV){el.hidden=true;el.innerHTML="";document.body.style.overflow="";return}
  const ae=document.activeElement,aid=ae&&el.contains(ae)&&ae.id,ss=aid&&ae.selectionStart;
  const pb=el.querySelector(".pkbody"),st=pb?pb.scrollTop:0;
  let h="";const o=OV;
  if(o.type==="day")h=`<div class="phead"><input type="search" id="dp-q" placeholder="Middag til ${esc(o.day.toLowerCase())}: søk" value="${esc(o.q)}" autocomplete="off"><button class="btn small" id="ov-close">Lukk</button></div>
      <div class="pkbody"><ul id="dp-list" class="pklist">${dayListHtml(o)}</ul><div id="dp-new">${dayNewHtml(o)}</div></div>`;
  else if(o.type==="ing"){const d=S.dinners[o.did];if(!d){OV=null;return renderOverlay()}
    h=`<div class="phead"><input type="search" id="pk-q" placeholder="Ingredienser til ${esc(d.name)}: søk" value="${esc(o.q)}" autocomplete="off"><button class="btn small primary" id="ov-close">Ferdig</button></div>
    <div class="pkbody"><ul id="pk-list" class="pklist">${pickListHtml(o)}</ul><div id="pk-new">${pickNewHtml(o)}</div></div>`}
  else if(o.type==="recipe"){const d=S.dinners[o.did];if(!d){OV=null;return renderOverlay()}
    h=`<div class="phead"><b class="ptl">${esc(d.name)}</b><button class="btn small primary" id="rc-save">Lagre</button><button class="btn small" id="ov-close">Lukk</button></div>
      <div class="pkbody"><label class="fl">Lenke til oppskrift<input type="url" id="rc-url" value="${esc(d.url||"")}" placeholder="https://…" inputmode="url" autocomplete="off"></label>${d.url?recipeLink(d,"Åpne oppskriften"):""}
      <label class="fl">Porsjoner<input type="number" id="rc-por" min="1" max="50" inputmode="numeric" value="${esc(d.portions||"")}" placeholder="f.eks. 4"></label>
      <label class="fl">Oppskrift og notater<textarea id="rc-notes" rows="12" placeholder="Fremgangsmåte, tips, hva som må forberedes …">${esc(d.notes||"")}</textarea></label></div>`}
  else if(o.type==="cook"){
    if(o.rest){const lk=Object.keys(S.left);
      h=`<div class="phead"><b class="ptl">Rester spist</b><button class="btn small primary" id="ck-ok">Ferdig</button><button class="btn small" id="ov-close">Avbryt</button></div>
      <div class="pkbody"><p class="sub" style="margin:0">Huk av restene som er spist.</p><ul class="pklist">${lk.length?lk.map(k=>`<li class="item${o.sel.includes(k)?" picked":""}" data-ck="${k}"><input type="checkbox" tabindex="-1" ${o.sel.includes(k)?"checked":""} aria-label="${esc(S.left[k].n)}"><span class="nm">${esc(S.left[k].n)}${expText(S.left[k].exp)}</span></li>`).join(""):'<li class="empty">Ingen rester registrert i Hjemme.</li>'}</ul></div>`}
    else{const d=S.dinners[S.week[o.day]];if(!d){OV=null;return renderOverlay()}
      const ing=(d.ing||[]).filter(id=>S.items[id]&&I(id).home);
      h=`<div class="phead"><b class="ptl">Laget: ${esc(d.name)}</b><button class="btn small primary" id="ck-ok">Ferdig</button><button class="btn small" id="ov-close">Avbryt</button></div>
      <div class="pkbody"><p class="sub" style="margin:0">Huk av det som er brukt opp. Det tas ut av Hjemme.</p>
      <ul class="pklist">${ing.length?ing.map(id=>`<li class="item${o.sel.includes(id)?" picked":""}" data-ck="${id}"><input type="checkbox" tabindex="-1" ${o.sel.includes(id)?"checked":""} aria-label="${esc(I(id).n)}"><span class="nm">${esc(I(id).n)}</span></li>`).join(""):`<li class="empty">Ingen av ingrediensene er registrert hjemme.</li>`}</ul>
      <ul class="pklist"><li class="item${o.left?" picked":""}" id="ck-left"><input type="checkbox" tabindex="-1" ${o.left?"checked":""} aria-label="Det ble rester"><span class="nm">Det ble rester<small class="by">Legges i Hjemme med 3 dagers holdbarhet</small></span></li></ul></div>`}}
  else if(o.type==="rev"){const d=S.dinners[o.did];if(!d){OV=null;return renderOverlay()}
    const ing=(d.ing||[]).filter(id=>S.items[id]);
    h=`<div class="phead"><b class="ptl">${esc(d.name)}: se over</b><button class="btn small primary" id="ov-close">Ferdig</button></div>
      <div class="pkbody"><p class="sub" style="margin:0">Det som er huket av legges på handlelisten. Fjern krysset på det dere allerede har, så registreres det som «har hjemme».</p>
      <ul class="pklist">${ing.map(id=>{const it=I(id),on=it.c===false;return `<li class="item${on?" picked":""}" data-rv="${id}"><input type="checkbox" tabindex="-1" ${on?"checked":""} aria-label="${esc(it.n)}"><span class="nm">${esc(it.n)}<small class="by">${on?"Kjøpes":it.home?"Har hjemme":"Trengs ikke"}</small></span></li>`}).join("")}</ul></div>`}
  else if(o.type==="scan")h=`<div class="phead"><input type="search" id="sc-q" placeholder="Hvilken vare er dette? Søk" value="${esc(o.q)}" autocomplete="off"><button class="btn small" id="ov-close">Avbryt</button></div>
      <div class="pkbody"><p class="sub" style="margin:0">Ny strekkode (${esc(o.code)}). Velg varen én gang, så kjenner appen den igjen neste gang.</p><div id="sc-wrap" class="stack">${scanListHtml(o)}</div></div>`;
  else if(o.type==="done"){const inb=trip.filter(id=>S.items[id]&&I(id).c),est=estimate(inb);
    h=`<div class="phead"><b class="ptl">Ferdig handlet</b><button class="btn small primary" id="dn-ok">Lagre</button><button class="btn small" id="ov-close">Avbryt</button></div>
      <div class="pkbody"><p class="sub" style="margin:0">${inb.length} ${inb.length===1?"vare":"varer"} i kurven legges i Hjemme${inb.some(id=>I(id).hb)?", med best før-dato der holdbarhet er satt":""}.</p>
      <label class="fl">Hva kostet handelen? (valgfritt)<input type="text" inputmode="decimal" id="dn-sum" placeholder="${est.sum?"Anslag: "+Math.round(est.sum):"f.eks. 845"}" value="${esc(o.sum||"")}"></label>
      ${storeIds().length?`<label class="fl">Butikk<select id="dn-store"><option value="">Ikke valgt</option>${storeIds().map(s=>`<option value="${s}"${s===storeSel?" selected":""}>${esc(S.stores[s].name)}</option>`).join("")}</select></label>`:""}</div>`}
  else if(o.type==="more")h=moreHtml(o);
  else if(o.type==="rcpt")h=rcptHtml(o);
  else if(o.type==="store")h=storeHtml(o);
  else if(o.type==="text")h=`<div class="phead"><b class="ptl">Del listen</b><button class="btn small" id="ov-close">Lukk</button></div><div class="pkbody"><p class="sub" style="margin:0">Marker teksten og kopier den.</p><textarea class="sharetxt" readonly>${esc(o.text)}</textarea></div>`;
  el.innerHTML=h;el.hidden=false;document.body.style.overflow="hidden";
  const npb=el.querySelector(".pkbody");if(npb&&pb)npb.scrollTop=st;
  if(aid){const n=document.getElementById(aid);if(n){n.focus();try{if(ss!=null)n.setSelectionRange(ss,ss)}catch(e){}}}
}
function closeOv(){OV=null;renderOverlay();render()}
function openCook(day){const v=S.week[day];
  if(v===REST){OV={type:"cook",day,rest:true,sel:Object.keys(S.left)};renderOverlay();return}
  const d=S.dinners[v];if(!d)return;OV={type:"cook",day,sel:(d.ing||[]).filter(id=>S.items[id]&&I(id).home),left:false};renderOverlay()}
function newDinner(name){const id=uid("d");S.dinners[id]={name,ing:[],qty:{},o:Date.now()};return id}
function setDay(day,id){
  snapUndo();S.week[day]=id;delete S.wp[day];
  const d=S.dinners[id];if(d)applyFor(id);changed(true);
  if(d&&(d.ing||[]).some(x=>S.items[x]))OV={type:"rev",did:id};else OV=null;
  renderOverlay();render();
}

/* ===== Tegning ===== */
function setNavH(){const n=document.querySelector("nav");if(n)document.documentElement.style.setProperty("--navh",(n.getBoundingClientRect().height-1)+"px")}
addEventListener("resize",setNavH);
function render(keep){
  const kept={};
  if(keep)for(const el of document.querySelectorAll("#view .panel input, #newdin")){if(el.id)kept[el.id]=el.type==="checkbox"?el.checked:el.value}
  setNavH();
  PL=planned();
  if(selId&&!S.items[selId])selId=null;
  const ae=document.activeElement,aid=ae&&$("#view").contains(ae)&&ae.id,ss=aid&&ae.selectionStart;
  document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===tab));
  const sc=soonCount(),dot=$("#homedot");dot.textContent=sc;dot.hidden=!sc;
  document.body.classList.toggle("editing",!!(editMode&&selId));
  $("#view").innerHTML=tab==="uke"?renderUke():tab==="middager"?renderMiddager():tab==="hjemme"?renderHjemme():renderListe();
  $("#sub").textContent=itemIds().filter(id=>!I(id).c).length+" varer igjen å handle";
  renderToday();
  for(const k in kept){const el=document.getElementById(k);if(el){if(el.type==="checkbox")el.checked=kept[k];else el.value=kept[k]}}
  if(aid){const n=document.getElementById(aid);if(n){n.focus();try{if(ss!=null)n.setSelectionRange(ss,ss)}catch(e){}}}
}
function scrollSel(){const el=document.querySelector(`li.item[data-id="${selId}"]`);if(el)el.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}
function moved(){mvQ="";changed();scrollSel();toast("Flyttet",true)}
function setTab(t){tab=t;confirmReset=false;editMode=false;selId=null;delArm=false;usedArm=null;lsSet("tab",tab);render();window.scrollTo(0,0)}

/* ===== Hendelser: hovedvisningen ===== */
document.querySelector("nav").addEventListener("click",e=>{const b=e.target.closest("button");if(b)setTab(b.dataset.tab)});
$("#more").addEventListener("click",()=>{OV={type:"more",bk:null};renderOverlay();if(fdb)loadBackups()});
$("#toast").addEventListener("click",e=>{if(e.target.id==="undo")doUndo()});
$("#rcptfile").addEventListener("change",e=>{const f=e.target.files&&e.target.files[0];if(f)readReceipt(f)});
function pickReceipt(){const f=$("#rcptfile");f.value="";f.click()}
$("#scanfile").addEventListener("change",async e=>{const file=e.target.files&&e.target.files[0];if(!file)return;toast("Leter etter strekkode …");
  const code=await decodeBarcode(file);if(!code){toast("Fant ingen strekkode. Ta bildet nærmere, rett forfra og med godt lys.");return}handleCode(code)});
document.addEventListener("click",e=>{const t=e.target.closest("[data-cook],[data-rec]");if(!t||!t.closest("#today"))return;if(t.dataset.cook)openCook(t.dataset.cook);else{OV={type:"recipe",did:t.dataset.rec};renderOverlay()}});
$("#view").addEventListener("click",e=>{
  const t=e.target;
  const qb=t.closest("button.qb");
  if(qb&&qb.dataset.qi){bump(qb.dataset.qi,+qb.dataset.qd);return}
  if(qb&&qb.dataset.wp){const d=qb.dataset.wp,din=S.dinners[S.week[d]];if(!din)return;const w=Math.max(1,Math.min(40,(S.wp[d]||din.portions)+ +qb.dataset.wd));if(w===din.portions)delete S.wp[d];else S.wp[d]=w;changed();return}
  if(qb&&qb.dataset.used){usedArm=qb.dataset.used;render();return}
  if(qb&&qb.dataset.usedno){usedArm=null;render();return}
  if(t.dataset.usedok){finishUsed(t.dataset.usedok,false);return}
  if(t.dataset.waste){finishUsed(t.dataset.waste,true);return}
  const sb=t.closest("button.secbtn");if(sb){const id=sb.dataset.col;col=col.includes(id)?col.filter(x=>x!==id):[...col,id];lsSet("col",col);render();return}
  const sh=t.closest("li[data-sh]");if(sh){const id=sh.dataset.sh;snapUndo();gotIt(id);trip=trip.filter(x=>x!==id);trip.push(id);lsSet("trip",trip);changed();toast(I(id).n+" i kurven",true);return}
  const us=t.closest("li[data-unsh]");if(us){const id=us.dataset.unsh;need(id,false);trip=trip.filter(x=>x!==id);lsSet("trip",trip);changed();return}
  const mv=t.closest("li.mvr");if(mv){snapUndo();placeAt(selId,{after:mv.dataset.mk});moved();return}
  const rs=t.closest("li.res");if(rs&&rs.dataset.ak){if(S.items[rs.dataset.ak])pickExisting(rs.dataset.ak);return}
  const hk=t.closest("li[data-hk]");if(hk){toggleHome(hk.dataset.hk);return}
  const li=t.closest("li.item");
  if(li&&li.dataset.id){const id=li.dataset.id;
    if(editMode){selId=selId===id?null:id;delArm=false;mvQ="";render();return}
    snapUndo();if(I(id).c){need(id,true);toast(I(id).n+" lagt på listen",true)}else{gotIt(id);toast(I(id).n+" huket av",true)}changed();return}
  if(t.id==="seenok"){prevSeen=Date.now();lsSet("seen",prevSeen);render();return}
  if(t.id==="seeorder"){OV={type:"more",bk:null};renderOverlay();if(fdb)loadBackups();setTimeout(()=>{const m=$("#m-order");if(m)m.scrollIntoView()},50);return}
  if(t.id==="scanlist"){startScan("list");return}
  if(t.id==="scanhome"){startScan("home");return}
  if(t.id==="rcptbtn"){pickReceipt();return}
  if(t.id==="shopmode"){shop=true;lsSet("shop",true);render();window.scrollTo(0,0);return}
  if(t.id==="shopdone"){OV={type:"done",sum:""};renderOverlay();return}
  if(t.id==="share"){shareList();return}
  if(t.id==="editmode"){editMode=!editMode;selId=null;delArm=false;mvQ="";render();return}
  if(t.id==="newsec"){snapUndo();const id=uid("h");S.items[id]={n:"Ny avdeling",h:true,o:0};placeAt(id,"end");selId=id;changed();setTimeout(()=>{scrollSel();const n=$("#mv-name");if(n){n.focus();n.select()}},50);return}
  if(selId&&S.items[selId]){
    const arr=ids(),i=arr.indexOf(selId);
    if(t.id==="mv-up"){if(i>0){placeAt(selId,i>1?{after:arr[i-2]}:"top");changed();scrollSel()}return}
    if(t.id==="mv-down"){if(i<arr.length-1){placeAt(selId,{after:arr[i+1]});changed();scrollSel()}return}
    if(t.id==="mv-top"||t.id==="mv-bot"){snapUndo();placeAt(selId,t.id==="mv-top"?"top":"end");moved();return}
    if(t.id==="mv-save"){saveSel();return}
    if(t.id==="mv-done"){selId=null;delArm=false;mvQ="";render();return}
    if(t.id==="mv-del"){if(delArm!==selId){delArm=selId;render();return}
      snapUndo();const it=I(selId);delete S.items[selId];
      if(!it.h){for(const did in S.dinners){const d=S.dinners[did];if((d.ing||[]).includes(selId)){d.ing=d.ing.filter(x=>x!==selId);if(d.qty&&d.qty[selId]!=null){const q=clone(d.qty);delete q[selId];d.qty=q}}}
        for(const c in S.codes)if(S.codes[c]===selId)delete S.codes[c]}
      else for(const s in S.stores){const so=S.stores[s].so;if(Array.isArray(so)&&so.includes(selId))S.stores[s].so=so.filter(x=>x!==selId)}
      toast(it.n+" slettet",true);selId=null;delArm=false;changed();return}
  }
  if(t.id==="additem"){addNew(splitQ(addQ.trim()).n,splitQ(addQ.trim()).q);return}
  if(t.id==="addmulti"){addMulti(smartSplit(addQ));return}
  if(t.id==="addone"){const s=splitQ(addQ.trim());const ex=findByName(s.n);if(ex){pickExisting(ex);return}addNew(s.n,s.q);return}
  if(t.id==="homeadd"){homeAdd();return}
  if(t.dataset.cook){openCook(t.dataset.cook);return}
  if(t.dataset.rec){OV={type:"recipe",did:t.dataset.rec};renderOverlay();return}
  if(t.dataset.dayp){OV={type:"day",day:t.dataset.dayp,q:""};renderOverlay();return}
  if(t.id==="suggest"){suggestWeek();return}
  if(t.id==="newweek"){confirmReset=true;render();return}
  if(t.id==="noreset"){confirmReset=false;render();return}
  if(t.id==="yesreset"){snapUndo();const p=planned().p;
    for(const id of itemIds()){const it=I(id);if((p[id]||it.fast)&&!it.home)need(id,false);else gotIt(id);if(it.x)it.x=0}
    for(const d of Object.keys(S.wp))delete S.wp[d];
    confirmReset=false;changed();toast("Ny uke er klar",true);return}
  if(t.dataset.dii){snapUndo();const d=S.dinners[t.dataset.din];d.ing=d.ing.filter(x=>x!==t.dataset.dii);if(d.qty&&d.qty[t.dataset.dii]!=null){const q=clone(d.qty);delete q[t.dataset.dii];d.qty=q}changed();toast(I(t.dataset.dii).n+" fjernet fra "+d.name,true);return}
  if(t.dataset.pick){OV={type:"ing",did:t.dataset.pick,q:""};renderOverlay();return}
  if(t.dataset.deldin){const id=t.dataset.deldin;if(delArm!==id){delArm=id;render();return}
    snapUndo();const nm=S.dinners[id].name;delete S.dinners[id];for(const d of DAYS)if(S.week[d]===id){S.week[d]="";delete S.wp[d]}delArm=false;changed();toast(nm+" slettet",true);return}
  if(t.id==="adddin"){const v=$("#newdin").value.trim();if(!v)return;const id=newDinner(v);changed();OV={type:"ing",did:id,q:""};renderOverlay()}
});
$("#view").addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.hd){const it=I(t.dataset.hd);if(t.value)it.exp=t.value;else delete it.exp;changed();return}
  if(t.dataset.ld){const l=S.left[t.dataset.ld];if(!l)return;if(t.value)l.exp=t.value;else delete l.exp;changed();return}
  if(t.id==="hpos"||t.id==="newpos"){lastPos=t.value;lsSet("pos",lastPos);return}
  if(t.id==="hide"){hideDone=t.checked;lsSet("hide2",hideDone);render();return}
  if(t.id==="storesel"){storeSel=t.value;lsSet("store",storeSel);render();return}
  if(t.id==="mv-sec"&&t.value){snapUndo();placeAt(selId,{sec:t.value});moved();return}
});
$("#view").addEventListener("toggle",e=>{if(e.target.classList&&e.target.classList.contains("basket"))lsSet("bopen",e.target.open)},true);
function saveSel(){
  const it=I(selId);if(!it)return;
  const v=$("#mv-name").value.trim();
  if(v&&v!==it.n){if(!it.h){const o=findByName(v);if(o&&o!==selId){toast(v+" finnes allerede i listen");return}}it.n=v}
  if(!it.h){
    const nv=$("#mv-note").value.trim();if(nv)it.note=nv;else delete it.note;
    const pr=num($("#mv-pr").value);if(pr>0)it.pr=Math.round(pr*100)/100;else delete it.pr;
    const hb=parseInt($("#mv-hb").value,10);if(hb>0)it.hb=Math.min(hb,3650);else delete it.hb;
    if($("#mv-fast").checked)it.fast=true;else delete it.fast;
  }
  changed();toast("Lagret");
}
$("#view").addEventListener("keydown",e=>{if(e.key!=="Enter")return;const t=e.target;
  if(t.id==="homeq"){e.preventDefault();if($("#homeadd")){homeAdd();return}const m=homeMatches(),ex=findByName(splitQ(homeQ).n)||(m.length===1?m[0]:null);if(ex&&!I(ex).home)toggleHome(ex);return}
  if(t.id==="mv-name"||t.id==="mv-note"||t.id==="mv-pr"||t.id==="mv-hb"){saveSel();return}
  if(t.id==="newitem"){e.preventDefault();addItem()}else if(t.id==="newdin")$("#adddin").click()});
$("#view").addEventListener("input",e=>{
  if(e.target.id==="homeq"){homeQ=e.target.value;const r=$("#homeres");if(r)r.innerHTML=homeResHtml()}
  if(e.target.id==="newitem"){addQ=e.target.value;refreshAdd()}
  if(e.target.id==="mv-q"){mvQ=e.target.value;$("#mv-res").innerHTML=mvResHtml()}});

/* ===== Hendelser: vinduene ===== */
$("#picker").addEventListener("click",e=>{
  const t=e.target,o=OV;if(!o)return;
  if(t.id==="ov-close"){closeOv();return}
  if(t.id==="share"){shareList();return}
  if(o.type==="day"){
    if(t.id==="dp-add"){const id=newDinner(o.q.trim());S.week[o.day]=id;delete S.wp[o.day];changed(true);OV={type:"ing",did:id,q:""};renderOverlay();return}
    const li=t.closest("li[data-did]");if(li)setDay(o.day,li.dataset.did);return}
  if(o.type==="ing"){const d=S.dinners[o.did];if(!d)return;
    if(t.id==="pk-add"){const sq=splitQ(o.q.trim());if(!sq.n)return;const pos=$("#pk-pos").value;lastPos=pos;lsSet("pos",pos);
      const id=newItem(sq.n,1,pos);d.ing=[...(d.ing||[]),id];if(sq.q>1)d.qty=Object.assign({},d.qty,{[id]:sq.q});
      afterIng(d,id);o.q="";renderOverlay();toast(sq.n+" lagt til");return}
    const qb=t.closest("button.qb");
    if(qb&&qb.dataset.dk){const id=qb.dataset.dk,n=Math.max(1,dq(d,id)+ +qb.dataset.dq),q=Object.assign({},d.qty);if(n===1)delete q[id];else q[id]=n;d.qty=q;afterIng(d,id);renderOverlay();return}
    const li=t.closest("li[data-pk]");if(!li)return;
    const id=li.dataset.pk,has=(d.ing||[]).includes(id);
    if(has){d.ing=d.ing.filter(x=>x!==id);if(d.qty&&d.qty[id]!=null){const q=clone(d.qty);delete q[id];d.qty=q}}else d.ing=[...(d.ing||[]),id];
    afterIng(d,has?null:id);renderOverlay();return}
  if(o.type==="recipe"&&t.id==="rc-save"){const d=S.dinners[o.did];if(!d)return;
    const u=$("#rc-url").value.trim(),po=parseInt($("#rc-por").value,10),no=$("#rc-notes").value.replace(/\s+$/,"");
    if(u)d.url=safeUrl(u);else delete d.url;if(po>0)d.portions=Math.min(po,50);else delete d.portions;if(no)d.notes=no;else delete d.notes;
    changed(true);closeOv();toast("Oppskrift lagret");return}
  if(o.type==="cook"){
    if(t.id==="ck-ok"){snapUndo();let n=0;
      if(o.rest){for(const k of o.sel)if(S.left[k]){delete S.left[k];n++}OV=null;changed(true);closeOv();toast(n?n+(n===1?" rest":" rester")+" spist":"Ingenting endret",true);return}
      const d=S.dinners[S.week[o.day]];
      for(const id of o.sel)if(S.items[id]){delete I(id).home;delete I(id).exp;n++}
      if(d){S.cooked[uid("k")]={did:S.week[o.day],at:Date.now()};prune(S.cooked,200);
        if(o.left){S.left[uid("r")]={n:"Rester: "+d.name,did:S.week[o.day],at:Date.now(),exp:addDays(3)};prune(S.left,20)}}
      closeOv();changed();toast((d?d.name+" laget":"Laget")+(n?", "+n+(n===1?" vare":" varer")+" tatt ut av Hjemme":"")+(o.left?", rester lagt i Hjemme":""),true);return}
    if(t.closest("#ck-left")){o.left=!o.left;renderOverlay();return}
    const li=t.closest("li[data-ck]");if(li){const id=li.dataset.ck;o.sel=o.sel.includes(id)?o.sel.filter(x=>x!==id):[...o.sel,id];renderOverlay()}
    return}
  if(o.type==="rev"){const li=t.closest("li[data-rv]");if(!li)return;const id=li.dataset.rv,it=I(id);
    o.orig=o.orig||{};if(!(id in o.orig))o.orig[id]={home:!!it.home,exp:it.exp||null};
    if(it.c===false){gotIt(id);it.home=true}
    else{need(id,false);const g=o.orig[id];if(g.home)it.home=true;else{delete it.home;if(!g.exp)delete it.exp}if(g.exp)it.exp=g.exp}
    changed(true);renderOverlay();return}
  if(o.type==="scan"){
    if(t.id==="sc-add"){const s=splitQ(o.q.trim());if(!s.n)return;const pos=$("#sc-pos").value;lastPos=pos;lsSet("pos",pos);const id=newItem(s.n,s.q,pos);S.codes[o.code]=id;OV=null;renderOverlay();actOnCode(id);return}
    const li=t.closest("li[data-sk]");if(li){S.codes[o.code]=li.dataset.sk;OV=null;renderOverlay();actOnCode(li.dataset.sk)}return}
  if(o.type==="done"&&t.id==="dn-ok"){
    const inb=trip.filter(id=>S.items[id]&&I(id).c),est=estimate(inb).sum,sum=num($("#dn-sum").value),stv=$("#dn-store")?$("#dn-store").value:storeSel;
    snapUndo();
    for(const id of inb)putHome(id);
    if(inb.length||sum>0){const rec={at:Date.now(),st:stv||"",picks:trip.filter(id=>S.items[id]).slice(0,120),by:ME.name||""};if(sum>0)rec.sum=Math.round(sum*100)/100;if(est>0)rec.est=Math.round(est);S.hist[uid("t")]=rec;prune(S.hist,30)}
    shop=false;trip=[];lsSet("shop",false);lsSet("trip",[]);OV=null;renderOverlay();changed();
    toast(inb.length?inb.length+(inb.length===1?" vare":" varer")+" lagt i Hjemme":"Handlet ferdig",true);return}
  if(o.type==="rcpt"){
    if(t.id==="rc-save"){saveReceipt(o);return}
    if(t.dataset.rcon!==undefined){const l=o.lines[+t.dataset.rcon];l.on=t.checked;renderOverlay();return}
    const nb=t.closest("[data-rcpick]");if(nb){o.pick=+nb.dataset.rcpick;o.q="";renderOverlay();setTimeout(()=>{const q=$("#rcp-q");if(q)q.focus()},50);return}
    if(o.pick!=null){const ln=o.lines[o.pick];
      if(t.id==="rcp-back"){o.pick=null;renderOverlay();return}
      if(t.id==="rcp-skip"){ln.on=false;o.pick=null;renderOverlay();return}
      if(t.id==="rcp-new"){ln.id=null;ln.nm=o.q.trim()?splitQ(o.q.trim()).n:ln.nm;ln.on=true;ln.auto=false;o.pick=null;renderOverlay();return}
      const li=t.closest("[data-rcpk]");if(li){ln.id=li.dataset.rcpk;ln.nm=I(ln.id).n;ln.on=true;ln.auto=false;o.pick=null;renderOverlay();return}}
    return}
  if(o.type==="more"){
    if(t.id==="rcptbtn2"){pickReceipt();return}
    const sg=t.dataset.sgo||t.dataset.sno;
    if(t.dataset.sgo){const [x,p]=sg.split("|");if(S.items[x]&&S.items[p]){snapUndo();placeAt(x,{after:p});changed();renderOverlay();toast(I(x).n+" flyttet",true)}return}
    if(t.dataset.sno){S.cfg.ign[sg.replace("|","_")]=1;changed(true);renderOverlay();return}
    if(t.dataset.stuse!==undefined){storeSel=t.dataset.stuse;lsSet("store",storeSel);renderOverlay();render();return}
    if(t.dataset.stedit){OV={type:"store",sid:t.dataset.stedit};renderOverlay();return}
    if(t.id==="addstore"){const v=$("#newstore").value.trim();if(!v)return;const id=uid("s");S.stores[id]={name:v,so:headerIds(),o:Date.now()};changed(true);OV={type:"store",sid:id};renderOverlay();return}
    if(t.dataset.restore){if(o.arm!==t.dataset.restore){o.arm=t.dataset.restore;renderOverlay();return}restore(t.dataset.restore);return}
    if(t.id==="download"){downloadCopy();return}
    return}
  if(o.type==="store"){const st=S.stores[o.sid];if(!st)return;
    if(t.id==="ov-back"){const nv=$("#st-name").value.trim();if(nv&&nv!==st.name)st.name=nv;changed(true);OV={type:"more",bk:null};renderOverlay();loadBackups();return}
    if(t.dataset.so!==undefined){const order=secOrder(st),i=+t.dataset.so,j=i+ +t.dataset.sd;if(j<0||j>=order.length)return;[order[i],order[j]]=[order[j],order[i]];st.so=order;changed(true);renderOverlay();return}
    if(t.id==="st-del"){if(!o.arm){o.arm=true;renderOverlay();return}snapUndo();delete S.stores[o.sid];if(storeSel===o.sid){storeSel="";lsSet("store","")}changed(true);OV={type:"more",bk:null};renderOverlay();loadBackups();toast("Butikken er slettet",true);return}
  }
});
$("#picker").addEventListener("input",e=>{const o=OV;if(!o)return;const id=e.target.id;
  if(id==="dp-q"){o.q=e.target.value;$("#dp-list").innerHTML=dayListHtml(o);$("#dp-new").innerHTML=dayNewHtml(o);return}
  if(id==="pk-q"){o.q=e.target.value;$("#pk-list").innerHTML=pickListHtml(o);$("#pk-new").innerHTML=pickNewHtml(o);return}
  if(id==="sc-q"){o.q=e.target.value;$("#sc-wrap").innerHTML=scanListHtml(o);return}
  if(id==="dn-sum"){o.sum=e.target.value}
  if(id==="rcp-q"){o.q=e.target.value;const ae=e.target,ss=ae.selectionStart;renderOverlay();const n=$("#rcp-q");if(n){n.focus();try{n.setSelectionRange(ss,ss)}catch(_){}}return}
  if(e.target.dataset.rcp!==undefined){const v=num(e.target.value);o.lines[+e.target.dataset.rcp].p=isNaN(v)?0:v}});
$("#picker").addEventListener("keydown",e=>{if(e.key!=="Enter")return;const id=e.target.id;
  if(id==="pk-q"&&$("#pk-add"))$("#pk-add").click();
  if(id==="sc-q"&&$("#sc-add"))$("#sc-add").click();
  if(id==="newstore")$("#addstore").click();
  if(id==="dn-sum")$("#dn-ok").click()});
$("#picker").addEventListener("change",e=>{if(e.target.dataset.rcp!==undefined&&OV&&OV.type==="rcpt"){renderOverlay();return}if(e.target.id==="rc-pos"){lastPos=e.target.value;lsSet("pos",lastPos)}if(e.target.id==="sc-pos"||e.target.id==="pk-pos"){lastPos=e.target.value;lsSet("pos",lastPos)}});
function afterIng(d,addedId){if(addedId&&DAYS.some(day=>S.dinners[S.week[day]]===d)&&!I(addedId).home)need(addedId,false);changed(true)}

/* ===== Nytt siden sist: husk når appen sist var åpen ===== */
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")lsSet("seen",Date.now());else{prevSeen=ls("seen",prevSeen);render()}});

/* ===== Snarveier fra app-ikonet ===== */
(function(){const go=new URLSearchParams(location.search).get("go");if(!go)return;
  if(go==="add"){tab="liste";shop=false;setTimeout(()=>{const i=$("#newitem");if(i)i.focus()},600)}
  else if(go==="shop"){tab="liste";shop=true}
  else if(go==="home")tab="hjemme";
  else if(go==="week")tab="uke";
  lsSet("tab",tab);lsSet("shop",shop);
  try{history.replaceState(null,"",location.pathname)}catch(e){}})();

/* ===== Firebase: innlogging og synk ===== */
const gate=$("#gate");
function showGate(msg,btn){gate.hidden=false;$("#gate-msg").textContent=msg;$("#login").hidden=!btn}
let unsub=null;
function adopt(d){
  S=d;ensure();B=clone(S);
  trip=trip.filter(id=>S.items[id]);
  if(storeSel&&!S.stores[storeSel])storeSel="";
  render(true);if(OV&&!["recipe","store","done","text","rcpt"].includes(OV.type))renderOverlay();
}
function startSync(user){
  ME.name=((user.displayName||"").trim().split(/\s+/)[0])||(user.email||"").split(/[@.]/)[0].replace(/^./,c=>c.toUpperCase());
  ref=fdb.collection("lists").doc("main");
  status("Kobler til…");
  unsub=ref.onSnapshot({includeMetadataChanges:true},snap=>{
    gate.hidden=true;
    if(!snap.exists){if(!snap.metadata.fromCache){B=clone(S);ref.set(clone(S)).then(()=>status("Listen er opprettet"))}return}
    const d=snap.data();
    if(!d.v||d.v<3){if(snap.metadata.fromCache)return;const n=toV3(d);bkRef("backup-v2").set(clone(d)).catch(()=>{});adopt(n);ref.set(clone(n)).then(()=>toast("Listen er oppgradert"));return}
    if(saveTimer)return;
    adopt(d);
    if(!snap.metadata.fromCache&&firstServer){firstServer=false;dailyBackup()}
    status(snap.metadata.fromCache?"Frakoblet, endringer lagres når du er på nett igjen":"Synkronisert · "+(user.email||""));
  },err=>{
    if(err&&err.code==="permission-denied")showGate("Kontoen "+(user.email||"")+" har ikke tilgang til denne listen. Be eieren legge deg til.",true);
    else status("Mistet synk, last appen på nytt");
  });
}
render();
if(typeof firebaseConfig==="undefined"||!firebaseConfig.apiKey||/LIM_INN/.test(firebaseConfig.apiKey)){
  showGate("Appen mangler Firebase-oppsett. Lim inn firebaseConfig i config.js.",false);
}else{
  firebase.initializeApp(firebaseConfig);
  fdb=firebase.firestore();
  fdb.enablePersistence({synchronizeTabs:true}).catch(()=>{});
  const auth=firebase.auth();
  auth.getRedirectResult().catch(()=>{});
  auth.onAuthStateChanged(u=>{
    if(unsub){unsub();unsub=null}
    if(u){startSync(u)}else{ref=null;showGate("Logg inn for å se og synkronisere handlelisten.",true)}
  });
  $("#login").addEventListener("click",async()=>{
    const p=new firebase.auth.GoogleAuthProvider();
    try{await auth.signInWithPopup(p)}
    catch(e){
      if(e&&(e.code==="auth/popup-blocked"||e.code==="auth/operation-not-supported-in-this-environment"))auth.signInWithRedirect(p);
      else if(e&&e.code!=="auth/popup-closed-by-user"&&e.code!=="auth/cancelled-popup-request")showGate("Innlogging feilet: "+(e.code||e.message),true);
    }
  });
  $("#logout").addEventListener("click",()=>auth.signOut());
}
if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
