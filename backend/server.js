import 'dotenv/config';
import express from 'express';
import sql from 'mssql';
import { randomUUID } from 'node:crypto';

const app = express();
const port = Number(process.env.API_PORT || 3001);
const memoryRuns = [];
let poolPromise;
app.use(express.json({ limit: '64kb' }));

function sqlConfigured(){return Boolean(process.env.DB_SERVER&&process.env.DB_NAME&&process.env.DB_USER&&process.env.DB_PASSWORD)}
function getPool(){
  if(!sqlConfigured()) return null;
  if(!poolPromise){
    const portNumber=process.env.DB_PORT?Number(process.env.DB_PORT):undefined;
    poolPromise=new sql.ConnectionPool({
      server:process.env.DB_SERVER, ...(portNumber?{port:portNumber}:{}), database:process.env.DB_NAME,
      user:process.env.DB_USER,password:process.env.DB_PASSWORD,
      options:{encrypt:process.env.DB_ENCRYPT!=='false',trustServerCertificate:process.env.DB_TRUST_SERVER_CERTIFICATE==='true'},
      pool:{max:5,min:0,idleTimeoutMillis:30000},connectionTimeout:5000,requestTimeout:10000
    }).connect().catch(error=>{poolPromise=null;throw error});
  }
  return poolPromise;
}

app.get('/api/health',async(_req,res)=>{
  if(!sqlConfigured()) return res.json({ok:true,storage:'memory',sqlServer:'not-configured'});
  try{await getPool();return res.json({ok:true,storage:'sql',sqlServer:'connected'})}
  catch{return res.json({ok:true,storage:'memory',sqlServer:'connection-failed'})}
});

app.post('/api/runs',async(req,res)=>{
  const body=req.body??{};
  if(!/^C[1-5]$/.test(body.challenge)||typeof body.pip!=='boolean'||!body.metrics||typeof body.metrics!=='object'){
    return res.status(400).json({error:'Expected challenge C1–C5, a boolean pip value and calculated metrics.'});
  }
  const run={id:randomUUID(),challenge:body.challenge,pip:body.pip,completed:Boolean(body.completed),eventsRecorded:Number(body.eventsRecorded)||0,totalEvents:Number(body.totalEvents)||0,metrics:body.metrics,createdAt:new Date().toISOString()};
  if(!sqlConfigured()){
    memoryRuns.unshift(run);if(memoryRuns.length>1000)memoryRuns.length=1000;
    return res.status(201).json({id:run.id,storage:'memory',run});
  }
  try{
    const pool=await getPool();
    await pool.request().input('id',sql.NVarChar(36),run.id).input('challenge',sql.VarChar(2),run.challenge)
      .input('pip',sql.Bit,run.pip).input('completed',sql.Bit,run.completed)
      .input('eventsRecorded',sql.Int,run.eventsRecorded).input('totalEvents',sql.Int,run.totalEvents)
      .input('metricsJson',sql.NVarChar(sql.MAX),JSON.stringify(run.metrics))
      .query('INSERT INTO dbo.SimulationRuns (Id, Challenge, PipEnabled, Completed, EventsRecorded, TotalEvents, MetricsJson) VALUES (@id, @challenge, @pip, @completed, @eventsRecorded, @totalEvents, @metricsJson)');
    return res.status(201).json({id:run.id,storage:'sql',run});
  }catch(error){return res.status(503).json({error:'SQL Server persistence failed. Check DB settings and run database/setup.sql.',detail:error.code||'SQL_CONNECTION_ERROR'})}
});

app.get('/api/runs',async(_req,res)=>{
  if(!sqlConfigured()) return res.json({storage:'memory',runs:memoryRuns});
  try{
    const pool=await getPool();const result=await pool.request().query('SELECT TOP (100) Id, Challenge, PipEnabled, Completed, EventsRecorded, TotalEvents, MetricsJson, CreatedAt FROM dbo.SimulationRuns ORDER BY CreatedAt DESC');
    return res.json({storage:'sql',runs:result.recordset.map(r=>({id:r.Id,challenge:r.Challenge,pip:r.PipEnabled,completed:r.Completed,eventsRecorded:r.EventsRecorded,totalEvents:r.TotalEvents,metrics:JSON.parse(r.MetricsJson),createdAt:r.CreatedAt}))});
  }catch(error){return res.status(503).json({error:'SQL Server history unavailable.',detail:error.code||'SQL_CONNECTION_ERROR'})}
});

app.get('/api/runs/:id',async(req,res)=>{
  if(!sqlConfigured()){
    const run=memoryRuns.find(r=>r.id===req.params.id);return run?res.json({storage:'memory',run}):res.status(404).json({error:'Run not found in this server session.'});
  }
  try{const pool=await getPool();const result=await pool.request().input('id',sql.NVarChar(36),req.params.id).query('SELECT Id, Challenge, PipEnabled, Completed, EventsRecorded, TotalEvents, MetricsJson, CreatedAt FROM dbo.SimulationRuns WHERE Id=@id');const r=result.recordset[0];return r?res.json({storage:'sql',run:{id:r.Id,challenge:r.Challenge,pip:r.PipEnabled,completed:r.Completed,eventsRecorded:r.EventsRecorded,totalEvents:r.TotalEvents,metrics:JSON.parse(r.MetricsJson),createdAt:r.CreatedAt}}):res.status(404).json({error:'Run not found.'})}
  catch(error){return res.status(503).json({error:'SQL Server history unavailable.',detail:error.code||'SQL_CONNECTION_ERROR'})}
});

app.listen(port,'127.0.0.1',()=>console.log(`Priority Rescue API listening on http://127.0.0.1:${port} (${sqlConfigured()?'SQL Server configured':'memory storage'})`));
process.on('SIGINT',async()=>{try{if(poolPromise)await(await poolPromise).close()}catch{}process.exit(0)});
