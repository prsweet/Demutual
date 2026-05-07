(function(){const n=document.createElement("link").relList;if(n&&n.supports&&n.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const l of s)if(l.type==="childList")for(const h of l.addedNodes)h.tagName==="LINK"&&h.rel==="modulepreload"&&o(h)}).observe(document,{childList:!0,subtree:!0});function i(s){const l={};return s.integrity&&(l.integrity=s.integrity),s.referrerPolicy&&(l.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?l.credentials="include":s.crossOrigin==="anonymous"?l.credentials="omit":l.credentials="same-origin",l}function o(s){if(s.ep)return;s.ep=!0;const l=i(s);fetch(s.href,l)}})();function N(t){if(t.length>=255)throw new TypeError("Alphabet too long");const n=new Uint8Array(256);for(let r=0;r<n.length;r++)n[r]=255;for(let r=0;r<t.length;r++){const c=t.charAt(r),g=c.charCodeAt(0);if(n[g]!==255)throw new TypeError(c+" is ambiguous");n[g]=r}const i=t.length,o=t.charAt(0),s=Math.log(i)/Math.log(256),l=Math.log(256)/Math.log(i);function h(r){if(r instanceof Uint8Array||(ArrayBuffer.isView(r)?r=new Uint8Array(r.buffer,r.byteOffset,r.byteLength):Array.isArray(r)&&(r=Uint8Array.from(r))),!(r instanceof Uint8Array))throw new TypeError("Expected Uint8Array");if(r.length===0)return"";let c=0,g=0,b=0;const f=r.length;for(;b!==f&&r[b]===0;)b++,c++;const a=(f-b)*l+1>>>0,u=new Uint8Array(a);for(;b!==f;){let k=r[b],y=0;for(let E=a-1;(k!==0||y<g)&&E!==-1;E--,y++)k+=256*u[E]>>>0,u[E]=k%i>>>0,k=k/i>>>0;if(k!==0)throw new Error("Non-zero carry");g=y,b++}let m=a-g;for(;m!==a&&u[m]===0;)m++;let L=o.repeat(c);for(;m<a;++m)L+=t.charAt(u[m]);return L}function S(r){if(typeof r!="string")throw new TypeError("Expected String");if(r.length===0)return new Uint8Array;let c=0,g=0,b=0;for(;r[c]===o;)g++,c++;const f=(r.length-c)*s+1>>>0,a=new Uint8Array(f);for(;c<r.length;){const k=r.charCodeAt(c);if(k>255)return;let y=n[k];if(y===255)return;let E=0;for(let A=f-1;(y!==0||E<b)&&A!==-1;A--,E++)y+=i*a[A]>>>0,a[A]=y%256>>>0,y=y/256>>>0;if(y!==0)throw new Error("Non-zero carry");b=E,c++}let u=f-b;for(;u!==f&&a[u]===0;)u++;const m=new Uint8Array(g+(f-u));let L=g;for(;u!==f;)m[L++]=a[u++];return m}function I(r){const c=S(r);if(c)return c;throw new Error("Non-base"+i+" character")}return{encode:h,decodeUnsafe:S,decode:I}}var T="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";const _=N(T),j="http://localhost:3000",e={tab:"marketplace",jwt:localStorage.getItem("demutual_jwt"),address:"",username:localStorage.getItem("demutual_username")??"",buckets:[],bucketDetail:null,assets:[],draftBucketId:localStorage.getItem("demutual_draft_bucket_id")??"",log:"",err:""};function p(t,n){const i=n!==void 0?` ${JSON.stringify(n,null,2)}`:"";e.log=`${new Date().toISOString().slice(11,19)} ${t}${i}
${e.log}`.slice(0,8e3)}async function w(t,n){const i=new Headers(n==null?void 0:n.headers);i.set("Content-Type","application/json"),e.jwt&&i.set("Authorization",`Bearer ${e.jwt}`);const o=await fetch(`${j}${t}`,{...n,headers:i}),s=await o.json();return s.success||p(`HTTP ${o.status}`,s),s}function P(t){e.jwt=t,t?localStorage.setItem("demutual_jwt",t):localStorage.removeItem("demutual_jwt")}async function D(){e.err="";const t=window.solana;if(!(t!=null&&t.isPhantom)){e.err="Install Phantom and allow this origin, or open in a browser with Phantom.",d();return}const{publicKey:n}=await t.connect();e.address=n.toBase58(),p("Connected",e.address),d()}async function C(){if(e.err="",!e.address){e.err="Connect wallet first.",d();return}const t=await w(`/auth/nonce?address=${encodeURIComponent(e.address)}`);if(!t.success){e.err=t.error,d();return}const{nonce:n,message:i}=t.data,o=window.solana,s=new TextEncoder().encode(i),{signature:l}=await o.signMessage(s,"utf8"),h=_.encode(l),S={address:e.address,details:{nonce:n,message:i},signature:h};e.username.trim()&&(S.username=e.username.trim(),localStorage.setItem("demutual_username",e.username.trim()));const I=await w("/auth/wallet-login",{method:"POST",body:JSON.stringify(S)});if(!I.success){e.err=I.error,d();return}P(I.data.token),p("Logged in"),await U(),await $(),d()}function R(){P(null),e.buckets=[],e.assets=[],e.bucketDetail=null,p("Logged out"),d()}function x(){if(!e.jwt)return"";try{const t=e.jwt.split(".")[1];return t?JSON.parse(atob(t.replace(/-/g,"+").replace(/_/g,"/"))).userId??"":""}catch{return""}}async function $(){let t="/buckets";if(e.tab==="creator"&&e.jwt){const i=x();i&&(t=`/buckets?creatorId=${encodeURIComponent(i)}`)}const n=await w(t);n.success&&(e.buckets=n.data,p(`Listed buckets (${t})`,n.data.length))}async function U(){const t=await w("/assets");t.success&&(e.assets=t.data,p("Assets loaded",t.data.length))}async function B(t){const n=await w(`/buckets/${encodeURIComponent(t)}`);n.success&&(e.bucketDetail=n.data,p("Bucket detail",t)),d()}async function J(t){t.preventDefault();const n=new FormData(t.target),i={id:String(n.get("id")??"").trim(),name:String(n.get("name")??"").trim(),symbol:String(n.get("symbol")??"").trim(),iconUrl:String(n.get("iconUrl")??"").trim(),decimals:Number(n.get("decimals")??9)},o=await w("/assets",{method:"POST",body:JSON.stringify(i)});o.success?(p("Asset upserted",i.id),await U()):e.err=o.error,d()}async function M(t){t.preventDefault();const n=new FormData(t.target),i={name:String(n.get("name")??"").trim(),estimatedApy:Number(n.get("apy")??0)},o=await w("/buckets",{method:"POST",body:JSON.stringify(i)});if(o.success){const s=String(o.data.id);e.draftBucketId=s,localStorage.setItem("demutual_draft_bucket_id",s),p("Draft bucket created",s),await $()}else e.err=o.error;d()}async function q(t){var l;t.preventDefault();const n=e.draftBucketId.trim();if(!n){e.err="Set draft bucket id (from create bucket).",d();return}const i=String(((l=document.getElementById("listings-json"))==null?void 0:l.value)??"");let o;try{o=JSON.parse(i)}catch{e.err='Listings must be valid JSON array: [{"assetId":"...","percentage":50}, ...]',d();return}const s=await w(`/buckets/${encodeURIComponent(n)}/creator/assets`,{method:"POST",body:JSON.stringify({assets:o})});s.success?(p("Listings saved (replaces previous)",n),await $(),await B(n)):e.err=s.error,d()}async function z(){const t=e.draftBucketId.trim();if(!t){e.err="No draft bucket id.",d();return}const n=await w(`/buckets/${encodeURIComponent(t)}/creator/publish`,{method:"POST"});n.success?(p("Published",t),await $(),await B(t)):e.err=n.error,d()}async function F(t){var s,l;t.preventDefault();const n=String(((s=document.getElementById("invest-bucket-id"))==null?void 0:s.value)??"").trim(),i=Number(((l=document.getElementById("invest-amount"))==null?void 0:l.value)??0);if(!n||!i){e.err="Bucket id and amount required.",d();return}const o=await w(`/buckets/${encodeURIComponent(n)}/invest`,{method:"POST",body:JSON.stringify({amount:i})});o.success?(p("Invest OK",o.data),await $(),await B(n)):e.err=o.error,d()}function d(){var n,i,o,s,l,h,S,I,r,c,g,b,f;const t=document.getElementById("app");t.innerHTML=`
    <header>
      <div>
        <h1>Demutual review UI</h1>
        <div class="badge">API: ${j}</div>
      </div>
      <div class="row">
        ${e.jwt?'<span class="badge">Signed in</span><button class="ghost" type="button" id="btn-logout">Log out</button>':""}
        <button class="primary" type="button" id="btn-connect">1. Connect Phantom</button>
        <input placeholder="Username (first login only)" value="${O(e.username)}" id="inp-username" style="max-width:200px;margin:0" />
        <button class="ghost" type="button" id="btn-login" ${e.address?"":"disabled"}>2. Sign & login</button>
      </div>
      ${e.address?`<div class="badge">Wallet: ${e.address}</div>`:""}
      ${e.err?`<div class="err">${v(e.err)}</div>`:""}
    </header>

    <div class="tabs">
      <button type="button" class="${e.tab==="marketplace"?"active":""}" data-tab="marketplace">Marketplace</button>
      <button type="button" class="${e.tab==="creator"?"active":""}" data-tab="creator">Creator</button>
      <button class="ghost" type="button" id="btn-refresh-buckets">Refresh buckets</button>
    </div>

    ${e.tab==="marketplace"?`
      <div class="grid2">
        <div class="panel">
          <h2>Published buckets</h2>
          <p class="badge">GET /buckets (no creatorId → PUBLISHED only)</p>
          <ul class="list" id="bucket-list">
            ${e.buckets.map(a=>`<li data-bid="${O(String(a.id))}">${v(String(a.name))} · TVL ${v(String(a.tvl))} · ${v(String(a.type))}</li>`).join("")}
          </ul>
        </div>
        <div class="panel">
          <h2>Detail & invest</h2>
          <button class="ghost" type="button" id="btn-load-detail">Load selected / draft id</button>
          <pre class="log">${v(JSON.stringify(e.bucketDetail,null,2))}</pre>
          <form id="form-invest">
            <label>Bucket id</label>
            <input id="invest-bucket-id" value="${O(e.draftBucketId)}" />
            <label>Amount (gross; fee applied server-side)</label>
            <input id="invest-amount" type="number" step="any" value="100" />
            <button class="primary" type="submit" ${e.jwt?"":"disabled"}>POST /invest</button>
          </form>
        </div>
      </div>`:`
      <div class="panel">
        <h2>Register asset (mint id)</h2>
        <p class="badge">POST /assets — id is usually SPL mint address (string).</p>
        <form id="form-asset">
          <label>id (mint)</label>
          <input name="id" required placeholder="So111..." />
          <label>Name</label>
          <input name="name" required value="Wrapped SOL" />
          <label>Symbol</label>
          <input name="symbol" required value="SOL" />
          <label>Icon URL</label>
          <input name="iconUrl" required value="https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png" />
          <label>Decimals</label>
          <input name="decimals" type="number" value="9" />
          <button class="primary" type="submit" ${e.jwt?"":"disabled"}>Upsert asset</button>
        </form>
        <p class="badge">Known assets (${e.assets.length}):</p>
        <ul class="list">
          ${e.assets.map(a=>`<li>${v(String(a.symbol))} — <code>${v(String(a.id))}</code></li>`).join("")}
        </ul>
      </div>
      <div class="panel">
        <h2>Create draft bucket</h2>
        <form id="form-bucket">
          <label>Name</label>
          <input name="name" required placeholder="My basket" />
          <label>Estimated APY</label>
          <input name="apy" type="number" step="any" value="0.12" />
          <button class="primary" type="submit" ${e.jwt?"":"disabled"}>POST /buckets</button>
        </form>
        <label>Draft bucket id (for listings / publish)</label>
        <input id="inp-draft-id" value="${O(e.draftBucketId)}" />
      </div>
      <div class="panel">
        <h2>Set listings (replace all)</h2>
        <p class="badge">POST /buckets/:id/creator/assets — percentages must sum to 100; asset ids must exist.</p>
        <textarea id="listings-json" rows="6" style="width:100%;max-width:none;font-family:monospace;font-size:12px;background:#0a0d12;color:#e8ecf4;border:1px solid #2a3344;border-radius:8px;padding:8px">${v(`[
  { "assetId": "REPLACE_WITH_MINT", "percentage": 60 },
  { "assetId": "REPLACE_WITH_MINT_2", "percentage": 40 }
]`)}</textarea>
        <button class="primary" type="button" id="btn-save-listings" ${e.jwt?"":"disabled"}>Save listings</button>
        <button class="ghost" type="button" id="btn-publish" ${e.jwt?"":"disabled"}>Publish draft</button>
      </div>`}

    <div class="panel">
      <h2>Response log</h2>
      <pre class="log">${v(e.log||"…")}</pre>
    </div>
  `,(n=document.getElementById("btn-connect"))==null||n.addEventListener("click",()=>void D()),(i=document.getElementById("btn-login"))==null||i.addEventListener("click",()=>void C()),(o=document.getElementById("btn-logout"))==null||o.addEventListener("click",R),(s=document.getElementById("inp-username"))==null||s.addEventListener("input",a=>{e.username=a.target.value}),(l=document.getElementById("btn-refresh-buckets"))==null||l.addEventListener("click",()=>void $().then(d)),document.querySelectorAll("[data-tab]").forEach(a=>{a.addEventListener("click",()=>{e.tab=a.dataset.tab,$().then(d)})}),(h=document.getElementById("bucket-list"))==null||h.addEventListener("click",a=>{const u=a.target.closest("[data-bid]");if(u){const m=u.getAttribute("data-bid");e.draftBucketId=m,localStorage.setItem("demutual_draft_bucket_id",m),B(m)}}),(S=document.getElementById("btn-load-detail"))==null||S.addEventListener("click",()=>{var u,m;const a=(m=(u=document.getElementById("invest-bucket-id"))==null?void 0:u.value)==null?void 0:m.trim();a&&B(a)}),(I=document.getElementById("inp-draft-id"))==null||I.addEventListener("input",a=>{e.draftBucketId=a.target.value,localStorage.setItem("demutual_draft_bucket_id",e.draftBucketId)}),(r=document.getElementById("form-asset"))==null||r.addEventListener("submit",a=>void J(a)),(c=document.getElementById("form-bucket"))==null||c.addEventListener("submit",a=>void M(a)),(g=document.getElementById("form-invest"))==null||g.addEventListener("submit",a=>void F(a)),(b=document.getElementById("btn-save-listings"))==null||b.addEventListener("click",a=>void q(a)),(f=document.getElementById("btn-publish"))==null||f.addEventListener("click",()=>void z())}function v(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function O(t){return v(t).replace(/'/g,"&#39;")}d();$().then(d);
