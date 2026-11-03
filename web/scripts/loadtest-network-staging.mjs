import { performance } from "node:perf_hooks";
const args=process.argv.slice(2);
const value=name=>{const x=args.find(a=>a.startsWith(`--${name}=`));return x?x.split("=").slice(1).join("="):""};
const origin=value("origin"),users=Math.min(500,Math.max(1,Number(value("users")||100)));
const appKey=process.env.YF_STAGING_APP_KEY||"";
if(!/^https:\/\//.test(origin)||/production|yokefellow\.io/.test(origin)||!appKey.startsWith("yfk_"))
  throw new Error("Staging HTTPS origin and YF_STAGING_APP_KEY required; production is blocked");
const started=performance.now();
const results=await Promise.all(Array.from({length:users},async (_,i)=>{
  const wallet="0x"+(i+1).toString(16).padStart(40,"0");
  const begin=performance.now();
  try {
    const response=await fetch(`${origin.replace(/\/$/,"")}/v1/workshop/state?wallet=${wallet}`,{
      headers:{Authorization:`Bearer ${appKey}`},signal:AbortSignal.timeout(10000)});
    await response.arrayBuffer();
    return {status:response.status,ms:performance.now()-begin};
  } catch(error) {
    return {status:"transport_error",ms:performance.now()-begin};
  }
}));
const latencies=results.map(r=>r.ms).sort((a,b)=>a-b);
const histogram={};
for(const r of results)histogram[r.status]=(histogram[r.status]||0)+1;
const percentile=p=>Number(latencies[Math.floor((latencies.length-1)*p)].toFixed(2));
console.log(JSON.stringify({origin,users,elapsedMs:Number((performance.now()-started).toFixed(2)),
 statuses:histogram,p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99)},null,2));
