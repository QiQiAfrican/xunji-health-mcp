const TRAIN_BASE="https://trains.xunjiapp.cn"; const PLAN_BASE="https://api.xunjiapp.cn";
function headers(){const key=process.env.XUNJI_API_KEY;if(!key)throw new Error("XUNJI_API_KEY is not configured");return {"content-type":"application/json","authorization":key.startsWith("Bearer ")?key:`Bearer ${key}`};}
async function post(base,path,body){const r=await fetch(base+path,{method:"POST",headers:headers(),body:JSON.stringify(body)});const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data={raw}}if(!r.ok)throw new Error(`Xunji HTTP ${r.status}: ${raw.slice(0,500)}`);return data;}
export const getTraining=(date,fullData=false)=>post(TRAIN_BASE,"/api_trains_for_llm_v2",{datestr:date,include_full_data:fullData});
export const queryPlan=payload=>post(PLAN_BASE,"/open/plan/query_gzip",payload);
