import http from "node:http";
import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {z} from "zod"; import {getTraining,queryPlan} from "./xunji.js";
const mcp=new McpServer({name:"xunji-health-mcp",version:"0.1.0"});
mcp.tool("xunji_get_training","Read Xunji training data for one date. full_data=true returns detailed sets, RPE, notes, rests, metrics and heart-rate data.",{date:z.string().describe("YYYY-MM-DD"),full_data:z.boolean().default(false)},async({date,full_data})=>({content:[{type:"text",text:JSON.stringify(await getTraining(date,full_data))}]}));
mcp.tool("xunji_query_plan","Query Xunji official training plans.",{payload:z.record(z.any())},async({payload})=>({content:[{type:"text",text:JSON.stringify(await queryPlan(payload))}]}));
// v0.1 deliberately has no write-back tool; writes require preview + explicit confirmation.
const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined}); await mcp.connect(transport);
const port=Number(process.env.PORT||3000);
http.createServer(async(req,res)=>{if(req.url==="/health"){res.writeHead(200,{"content-type":"application/json"});return res.end(JSON.stringify({ok:true,service:"xunji-health-mcp"}));}if(req.url==="/mcp"){try{return await transport.handleRequest(req,res)}catch(e){res.writeHead(500,{"content-type":"application/json"});return res.end(JSON.stringify({error:String(e?.message||e)}));}}res.writeHead(404);res.end("Not found");}).listen(port,"0.0.0.0",()=>console.log(`Xunji MCP listening on ${port}`));
