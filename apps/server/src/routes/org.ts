import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../lib/validate.ts';
import { requestEmail, requireOrg } from '../services/orgContext.ts';
import { createOrg, joinOrg, leaveOrg, members, orgDetails, ownerOnly, removeMember, reviewMember } from '../services/orgService.ts';
const createSchema=z.object({name:z.string().trim().min(1).max(80)});
const joinSchema=z.object({code:z.string().trim().min(1).max(32)});
export const orgRoutes: FastifyPluginAsync=async(app)=>{
  app.get('/',async(request)=>({data:orgDetails(requireOrg(request),requestEmail(request))}));
  app.post('/',async(request,reply)=>{const input=parseBody(createSchema,request.body);const data=createOrg(input.name,requestEmail(request));reply.status(201);return {data};});
  app.post('/join',async(request)=>{const input=parseBody(joinSchema,request.body);return {data:joinOrg(input.code,requestEmail(request))};});
  app.get('/requests',async(request)=>{const id=requireOrg(request);ownerOnly(id,requestEmail(request));return {data:{requests:members(id,'pending')}};});
  app.post('/requests/:email/approve',async(request)=>{const id=requireOrg(request);reviewMember(id,requestEmail(request),(request.params as {email:string}).email.toLowerCase(),true);return {data:{requests:members(id,'pending'),members:members(id)}};});
  app.post('/requests/:email/reject',async(request)=>{const id=requireOrg(request);reviewMember(id,requestEmail(request),(request.params as {email:string}).email.toLowerCase(),false);return {data:{requests:members(id,'pending')}};});
  app.get('/members',async(request)=>({data:{members:members(requireOrg(request))}}));
  app.delete('/members/:email',async(request,reply)=>{removeMember(requireOrg(request),requestEmail(request),(request.params as {email:string}).email.toLowerCase());return reply.status(204).send();});
  app.post('/leave',async(request)=>{leaveOrg(requireOrg(request),requestEmail(request));return {data:{left:true}};});
};
