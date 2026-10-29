import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError, badRequest } from '../lib/errors.ts';
import { parseBody } from '../lib/validate.ts';
import { isAdminRequest, requestEmail, requireOrg, selectedOrgId } from '../services/orgContext.ts';
import { canManage, createOrg, joinOrg, leaveOrg, listOrgs, members, orgDetails, removeMember, reviewMember, setMemberRole } from '../services/orgService.ts';
const createSchema=z.object({name:z.string().trim().min(1).max(80)});
const joinSchema=z.object({code:z.string().trim().min(1).max(32)});
const roleSchema=z.object({role:z.enum(['owner','member'])});
export const orgRoutes: FastifyPluginAsync=async(app)=>{
  app.get('/',async(request)=>({data:orgDetails(requireOrg(request),requestEmail(request))}));
  /** 我的组织列表 + 当前生效组织 + 是否有创建权限（管理员可创建多个组织） */
  app.get('/mine',async(request)=>{
    const email=requestEmail(request);
    const orgs=listOrgs(email);
    return {data:{orgs,activeOrgId:orgs.length>0?requireOrg(request):null,canCreate:isAdminRequest(request)}};
  });
  app.post('/',async(request,reply)=>{
    const email=requestEmail(request);
    if(!isAdminRequest(request))throw badRequest('只有管理员可以创建组织');
    const input=parseBody(createSchema,request.body);
    const data=createOrg(input.name,email);
    reply.header('Set-Cookie','freeshift_org='+data.org.id+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000');
    reply.status(201);
    return {data};
  });
  /** 切换当前组织：写入 Cookie，之后所有接口都作用于该组织 */
  app.post('/switch',async(request,reply)=>{
    const email=requestEmail(request);
    const input=parseBody(z.object({orgId:z.number().int().positive()}),request.body);
    const allowed=listOrgs(email).some(item=>item.org.id===input.orgId);
    if(!allowed)throw badRequest('你不在该组织中');
    reply.header('Set-Cookie','freeshift_org='+input.orgId+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000');
    return {data:orgDetails(input.orgId,email)};
  });
  app.post('/join',async(request)=>{const input=parseBody(joinSchema,request.body);return {data:joinOrg(input.code,requestEmail(request))};});
  app.get('/requests',async(request)=>{const id=requireOrg(request);if(!canManage(id,requestEmail(request)))throw new AppError(403,'FORBIDDEN','仅组织负责人可操作');return {data:{requests:members(id,'pending')}};});
  app.post('/requests/:email/approve',async(request)=>{const id=requireOrg(request);reviewMember(id,requestEmail(request),(request.params as {email:string}).email.toLowerCase(),true);return {data:{requests:members(id,'pending'),members:members(id)}};});
  app.post('/requests/:email/reject',async(request)=>{const id=requireOrg(request);reviewMember(id,requestEmail(request),(request.params as {email:string}).email.toLowerCase(),false);return {data:{requests:members(id,'pending')}};});
  app.get('/members',async(request)=>({data:{members:members(requireOrg(request))}}));
  app.delete('/members/:email',async(request,reply)=>{removeMember(requireOrg(request),requestEmail(request),(request.params as {email:string}).email.toLowerCase());return reply.status(204).send();});
  /** 授予/收回成员的组织管理员权限（仅组织创建者） */
  app.patch('/members/:email',async(request)=>{
    const id=requireOrg(request);
    const input=parseBody(roleSchema,request.body);
    setMemberRole(id,requestEmail(request),(request.params as {email:string}).email.toLowerCase(),input.role);
    return {data:{members:members(id)}};
  });
  app.post('/leave',async(request)=>{leaveOrg(requireOrg(request),requestEmail(request));return {data:{left:true}};});
  app.get('/selected',async(request)=>({data:{orgId:selectedOrgId(request)}}));
};
