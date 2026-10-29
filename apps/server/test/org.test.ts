import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { migrate } from '../src/db/index.ts';
import { seedDefaults } from '../src/db/seed-defaults.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { closeDb, getDb, run } from '../src/db/index.ts';
let app:FastifyInstance;
const admin='admin@example.com', owner='owner@example.com', member='member@example.com', other='other@example.com';
function token(email:string,role:'admin'|'member'='member'):string {const t=createHash('sha256').update(email+':'+role).digest('base64url');run("INSERT INTO auth_account(email,role,created_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET role=excluded.role",[email,role,Date.now()]);run('INSERT OR REPLACE INTO auth_session(token_hash,email,expires_at) VALUES(?,?,?)',[createHash('sha256').update(t).digest('hex'),email,Date.now()+86400000]);return t;}
interface Session {token:string; org?:string}
const sessions:Record<string,Session>={};
function sessionOf(email:string):Session {return sessions[email]??(sessions[email]={token:''});}
function cookieOf(session:Session):string {return 'freeshift_session='+session.token+(session.org?'; freeshift_org='+session.org:'');}
async function call(email:string,method:'GET'|'POST'|'PATCH'|'DELETE'|'PUT',url:string,payload?:object){
  const session=sessionOf(email);
  const res=await app.inject({method,url:'/api/v1'+url,headers:{cookie:cookieOf(session)},...(payload?{payload}:{})});
  const raw=res.headers['set-cookie'];const text=Array.isArray(raw)?raw[0]:(typeof raw==='string'?raw:undefined);
  const m=text?.match(/freeshift_org=(\d+)/);if(m) session.org=m[1];
  return res;
}
beforeEach(()=>{closeDb();vi.stubEnv('DATABASE_PATH',':memory:');vi.stubEnv('AUTH_ENABLED','true');app=buildApp();for(const key of Object.keys(sessions)) delete sessions[key];sessions[admin]={token:token(admin,'admin')};sessions[owner]={token:token(owner)};sessions[member]={token:token(member)};});
afterEach(async()=>{await app.close();closeDb();vi.unstubAllEnvs();});
describe('organization tenancy',()=>{
 it('migrates legacy tables twice without losing schedule foreign keys',()=>{
   const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
   const db=new DatabaseSync(':memory:');
   let schema=readFileSync(new URL('../src/db/schema.sql',import.meta.url),'utf8');
   schema=schema.slice(0,schema.indexOf('CREATE TABLE IF NOT EXISTS organization'))+schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS slot_template'));
   schema=schema.replaceAll('  org_id INTEGER NOT NULL REFERENCES organization(id) ON DELETE CASCADE,\n','').replaceAll(',\n  UNIQUE(org_id, name)','').replace(/name( +)TEXT( +)NOT NULL,/g,'name$1TEXT$2NOT NULL UNIQUE,');
   db.exec(schema);
   db.exec("INSERT INTO slot_template(name) VALUES('旧模板'); INSERT INTO time_slot(template_id,label,sort_order) VALUES(1,'旧时段',1); INSERT INTO semester(name,start_date,total_weeks,active_template_id,is_active) VALUES('旧学期','2026-09-01',20,1,1); INSERT INTO app_user(name) VALUES('旧用户'); INSERT INTO schedule(semester_id,user_id,weekday,slot_id,start_week,end_week) VALUES(1,1,1,1,1,2); INSERT INTO schedule_occurrence VALUES(1,1,1,1,1,1)");
   migrate(db);seedDefaults(db);migrate(db);seedDefaults(db);
   expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
   expect(db.prepare('SELECT * FROM schedule_occurrence').all()).toHaveLength(1);
   expect(db.prepare('SELECT org_id FROM app_user WHERE id=1').get()).toMatchObject({org_id:1});
   expect(db.prepare('SELECT * FROM organization').all()).toHaveLength(1);
   expect(db.prepare("SELECT * FROM slot_template WHERE name='大学课表（秋）'").all()).toHaveLength(1);
   db.close();
 });
  it('lets admins create several organizations and switch between them',async()=>{
    expect((await call(admin,'GET','/org')).json().error.code).toBe('NO_ORG');
    expect((await call(admin,'GET','/org/mine')).json().data).toMatchObject({orgs:[],activeOrgId:null,canCreate:true});
    // 普通成员不能创建组织
    expect((await call(owner,'POST','/org',{name:'成员组织'})).json().error.code).toBe('VALIDATION_ERROR');
    expect((await call(owner,'GET','/org/mine')).json().data.canCreate).toBe(false);
    const a=await call(admin,'POST','/org',{name:'组织A'});expect(a.statusCode).toBe(201);const orgA=a.json().data.org;
    expect(orgA.code).toMatch(/^[A-F0-9]{8}$/);
    expect(a.headers['set-cookie']).toContain('freeshift_org='+orgA.id);
    const b=await call(admin,'POST','/org',{name:'组织B'});expect(b.statusCode).toBe(201);const orgB=b.json().data.org;
    const mine=(await call(admin,'GET','/org/mine')).json().data;
    expect(mine.orgs.map((o:{org:{name:string};role:string})=>[o.org.name,o.role])).toEqual([['组织A','owner'],['组织B','owner']]);
    expect(mine.activeOrgId).toBe(orgB.id);
    // 切换组织后，同一账号看到的是另一个组织的数据
    const back=await call(admin,'POST','/org/switch',{orgId:orgA.id});expect(back.statusCode).toBe(200);
    expect(back.json().data.org.id).toBe(orgA.id);
    const ua=(await call(admin,'POST','/users',{name:'同名用户'})).json().data.user;
    await call(admin,'POST','/org/switch',{orgId:orgB.id});
    const ub=(await call(admin,'POST','/users',{name:'同名用户'})).json().data.user;
    await call(admin,'POST','/org/switch',{orgId:orgA.id});
    expect((await call(admin,'GET','/users')).json().data.users.map((u:{id:number})=>u.id)).toEqual([ua.id]);
    expect((await call(admin,'GET','/users/'+ub.id)).statusCode).toBe(404);
    expect((await call(admin,'POST','/org/switch',{orgId:9999})).json().error.code).toBe('VALIDATION_ERROR');
    // 其他非成员也无法切换到别人的组织
    expect((await call(owner,'POST','/org/switch',{orgId:orgA.id})).json().error.code).toBe('VALIDATION_ERROR');
  });
  it('creates organizations, approves joins and isolates users templates schedules and semesters',async()=>{
    expect((await call(owner,'GET','/org')).json().error.code).toBe('NO_ORG');
    const a=await call(admin,'POST','/org',{name:'组织A'});expect(a.statusCode).toBe(201);const orgA=a.json().data.org;
    expect(orgA.code).toMatch(/^[A-F0-9]{8}$/);
    expect((await call(member,'POST','/org/join',{code:orgA.code})).json().data.status).toBe('pending');
    expect((await call(member,'GET','/users')).json().error.code).toBe('PENDING_APPROVAL');
    expect((await call(admin,'GET','/org/requests')).json().data.requests).toHaveLength(1);
    expect((await call(admin,'POST','/org/requests/'+member+'/approve',{})).statusCode).toBe(200);
    expect((await call(member,'GET','/org')).json().data.org.id).toBe(orgA.id);
    expect((await call(member,'GET','/org/requests')).statusCode).toBe(403);
    expect((await call(member,'POST','/org/join',{code:orgA.code})).json().data.status).toBe('approved');
    // 组织管理员（非创建者）可以审批与移除成员
    expect((await call(owner,'POST','/org/join',{code:orgA.code})).json().data.status).toBe('pending');
    expect((await call(admin,'POST','/org/requests/'+owner+'/approve',{})).statusCode).toBe(200);
    await call(admin,'PATCH','/org/members/'+owner,{role:'owner'});
    expect((await call(owner,'GET','/org/requests')).statusCode).toBe(200);
    await call(member,'POST','/org/join',{code:orgA.code});await call(admin,'POST','/org/requests/'+member+'/approve',{});
    const overreach=await call(member,'PATCH','/org/members/'+owner,{role:'member'});
    expect(overreach.json().error.code).toBe('FORBIDDEN');
    expect((await call(owner,'DELETE','/org/members/'+member)).statusCode).toBe(204);
    // 已被移除的成员不再是管理员可管的对象，非创建者无法修改成员角色
    expect((await call(owner,'PATCH','/org/members/'+member,{role:'owner'})).json().error.code).toBe('FORBIDDEN');
    await call(member,'POST','/org/join',{code:orgA.code});await call(admin,'POST','/org/requests/'+member+'/approve',{});
    const other2=(await call(admin,'POST','/org',{name:'组织B'})).json().data.org;
    // 同名用户在另一个组织里可以独立存在
    await call(admin,'POST','/org/switch',{orgId:other2.id});
    const ub=(await call(admin,'POST','/users',{name:'同名用户'})).json().data.user;
    await call(admin,'POST','/org/switch',{orgId:orgA.id});
    const ua=(await call(admin,'POST','/users',{name:'同名用户'})).json().data.user;
    await call(admin,'POST','/org/switch',{orgId:orgA.id});
    expect((await call(admin,'GET','/users')).json().data.users.map((u:{id:number})=>u.id)).toEqual([ua.id]);
    expect((await call(admin,'GET','/users/'+ub.id)).statusCode).toBe(404);
    expect((await call(admin,'PATCH','/users/'+ub.id,{name:'越权'})).statusCode).toBe(404);
    const tb=(await call(admin,'POST','/templates',{name:'私有模板'})).json().data.template;
    // owner 已被授予组织 A 的管理员，因此这里换一个纯成员视角（member 在组织 A）
    const memberTemplates=(await call(member,'GET','/templates')).json().data.templates;
    const memberIds=memberTemplates.map((t:{id:number})=>t.id);
    // 同组织成员可见本组织模板
    expect(memberIds).toContain(tb.id);
    // 跨组织：另一个组织的成员看不到本组织模板
    const outsiderEmail='outsider@example.com';
    await call(admin,'POST','/org',{name:'组织C'});
    sessions[outsiderEmail]={token:token(outsiderEmail)};
    await call(admin,'POST','/org/switch',{orgId:orgA.id});
    expect((await call(outsiderEmail,'GET','/templates')).json().error.code).toBe('NO_ORG');
    // owner 已被提升为组织 A 管理员，跨组织访问改用组织外账号
    expect((await call(outsiderEmail,'GET','/templates/'+tb.id)).statusCode).toBe(404);
    expect((await call(outsiderEmail,'POST','/templates',{name:'非法克隆',cloneFrom:tb.id})).statusCode).toBe(404);
    expect((await call(outsiderEmail,'POST','/semester',{name:'非法学期',startDate:'2026-09-01',totalWeeks:20,activeTemplateId:tb.id})).statusCode).toBe(404);
    const templates=(await call(admin,'GET','/templates')).json().data.templates;
    const active=templates.find((t:{isActive:boolean})=>t.isActive);
    const slots=(await call(admin,'GET','/templates/'+active.id)).json().data.slots;
    const sb=await call(admin,'POST','/schedules',{userId:ua.id,weekday:1,slotId:slots[0].id,startWeek:1,endWeek:2});expect(sb.statusCode).toBe(201);
    const sid=sb.json().data.schedule.id;
    // 组织外账号看不到、也改不了本组织的排班
    expect((await call(outsiderEmail,'GET','/schedules')).json().error.code).toBe('NO_ORG');
    expect((await call(outsiderEmail,'GET','/schedules/'+sid)).statusCode).toBe(404);
    expect((await call(outsiderEmail,'DELETE','/schedules/'+sid)).statusCode).toBe(404);
    expect((await call(outsiderEmail,'POST','/schedules',{userId:ua.id,weekday:1,slotId:slots[0].id,startWeek:1,endWeek:2})).statusCode).toBe(404);
    expect((await call(outsiderEmail,'POST','/schedules/check',{userId:ua.id,weekday:1,slotIds:[slots[0].id],startWeek:1,endWeek:2})).statusCode).toBe(404);
    const autumn=templates.find((t:{name:string})=>t.name==='大学课表（秋）');
    const autumnSlots=(await call(admin,'GET','/templates/'+autumn.id)).json().data.slots;
    expect(autumnSlots.map((s:{startTime:string;endTime:string;durationMin:number})=>[s.startTime,s.endTime,s.durationMin])).toEqual([['08:30','10:10',100],['10:30','12:10',100],['14:00','15:40',100],['16:00','17:40',100]]);
    expect(getDb().prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
