import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcrypt';
import { PrismaClient, Role, AccountStatus } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(session({ store: new (pgSession(session))({ conString: process.env.DATABASE_URL, tableName: 'web_sessions', createTableIfMissing: true }), secret: process.env.SESSION_SECRET || 'development-only-change-me', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12 } }));
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });
const cleanUser = u => ({ id:u.id, username:u.username, email:u.email, role:u.role, status:u.status, studentId:u.student?.id, teacherId:u.teacher?.id, name:u.student?.fullName || u.teacher?.fullName || u.username });
const mustLogin = (req,res,next) => req.session.userId ? next() : res.status(401).json({ error:'Authentication required' });
const allow = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error:'You do not have permission for this action' });
app.use('/api', async (req,res,next) => { if (!req.session.userId) return next(); try { const user = await prisma.user.findUnique({ where:{id:req.session.userId}, include:{student:true,teacher:true} }); if (!user || user.status === AccountStatus.DISABLED) { req.session.destroy(()=>{}); return res.status(401).json({error:'Session is no longer valid'}); } req.user=cleanUser(user); next(); } catch(e){ next(e); } });

app.post('/api/auth/login', authLimit, async (req,res,next) => { try { const input=z.object({identifier:z.string().min(1).max(120),password:z.string().min(1).max(200)}).parse(req.body); const user=await prisma.user.findFirst({where:{OR:[{username:input.identifier},{email:input.identifier},{student:{is:{studentNumber:input.identifier}}}]},include:{student:true,teacher:true}}); if(!user || !await bcrypt.compare(input.password,user.passwordHash)) return res.status(401).json({error:'Invalid credentials'}); if(user.status!==AccountStatus.ACTIVE) return res.status(403).json({error:user.status==='PENDING'?'Your account is awaiting approval.':'This account is unavailable.'}); req.session.userId=user.id; res.json({user:cleanUser(user)}); } catch(e){ next(e); } });
app.post('/api/auth/logout', mustLogin, (req,res) => req.session.destroy(()=>res.clearCookie('connect.sid').status(204).end()));
app.get('/api/auth/me', mustLogin, (req,res) => res.json({user:req.user}));
app.post('/api/auth/register/student', authLimit, async (req,res,next)=>{ try { const d=z.object({fullName:z.string().min(2).max(120),studentNumber:z.string().min(2).max(40),email:z.string().email(),phone:z.string().min(7).max(40),classId:z.string().cuid(),dob:z.coerce.date(),gender:z.string().min(1).max(30),password:z.string().min(10).max(200)}).parse(req.body); const result=await prisma.$transaction(async tx=>{ let student=await tx.student.findUnique({where:{studentNumber:d.studentNumber}}); if(student?.userId) throw Object.assign(new Error('An account already exists for this student ID'),{status:409}); const user=await tx.user.create({data:{username:d.email,email:d.email,passwordHash:await bcrypt.hash(d.password,12),role:Role.STUDENT,status:student?AccountStatus.ACTIVE:AccountStatus.PENDING}}); if(student) student=await tx.student.update({where:{id:student.id},data:{userId:user.id,email:d.email,phone:d.phone}}); return {user,linked:!!student}; }); res.status(201).json({message:result.linked?'Account linked to the existing student record.':'Registration submitted for administrator approval.',status:result.linked?'ACTIVE':'PENDING'}); }catch(e){next(e)} });
app.post('/api/auth/password-reset/request', authLimit, async (req,res,next)=>{try{const email=z.string().email().parse(req.body.email);const user=await prisma.user.findFirst({where:{OR:[{email},{username:email}]}});if(user){const token=crypto.randomBytes(32).toString('hex');await prisma.passwordResetToken.create({data:{userId:user.id,tokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});/* Send `token` using a configured email provider; never return it in production. */}res.json({message:'If the account exists, reset instructions have been sent.'});}catch(e){next(e)}});
app.post('/api/auth/password-reset/confirm', authLimit, async(req,res,next)=>{try{const d=z.object({token:z.string().length(64),password:z.string().min(10).max(200)}).parse(req.body);const tokenHash=crypto.createHash('sha256').update(d.token).digest('hex');const record=await prisma.passwordResetToken.findFirst({where:{tokenHash,expiresAt:{gt:new Date()}}});if(!record)return res.status(400).json({error:'Invalid or expired reset link'});await prisma.$transaction([prisma.user.update({where:{id:record.userId},data:{passwordHash:await bcrypt.hash(d.password,12)}}),prisma.passwordResetToken.delete({where:{id:record.id}})]);res.json({message:'Password changed. Please sign in.'});}catch(e){next(e)}});

const resources={ students:'student', teachers:'teacher', classes:'class', subjects:'subject', attendance:'attendanceRecord', results:'result', fees:'fee', timetable:'timetable', assignments:'assignment', exams:'exam', announcements:'announcement', notifications:'notification' };
const protectedModels=new Set(['student','teacher','class','subject','fee','announcement']);
function scope(model,user,method,data={}) { if(user.role==='ADMIN')return {}; if(model==='student') return user.role==='STUDENT'?{id:user.studentId}:{class:{assignments:{some:{teacherId:user.teacherId}}}}; if(model==='teacher')return user.role==='TEACHER'?{id:user.teacherId}:{id:'__none__'}; if(model==='notification')return {studentId:user.studentId}; if(['result','attendanceRecord','fee'].includes(model))return user.role==='STUDENT'?{studentId:user.studentId}:{class:{assignments:{some:{teacherId:user.teacherId}}}}; if(['assignment','exam','timetable'].includes(model))return user.role==='TEACHER'?{class:{assignments:{some:{teacherId:user.teacherId}}}}:{class:{students:{some:{id:user.studentId}}}}; return {id:'__none__'}; }
app.get('/api/:resource', mustLogin, async(req,res,next)=>{try{const model=resources[req.params.resource];if(!model)return res.status(404).json({error:'Unknown resource'});const rows=await prisma[model].findMany({where:scope(model,req.user,'read')});res.json(rows)}catch(e){next(e)}});
app.post('/api/:resource', mustLogin, async(req,res,next)=>{try{const model=resources[req.params.resource];if(!model)return res.status(404).json({error:'Unknown resource'});if(protectedModels.has(model)) allow('ADMIN')(req,res,async()=>{const row=await prisma[model].create({data:req.body});res.status(201).json(row)});else { if(req.user.role==='STUDENT')return res.status(403).json({error:'Students cannot create this resource'}); const row=await prisma[model].create({data:req.body});res.status(201).json(row); }}catch(e){next(e)}});
app.patch('/api/:resource/:id',mustLogin,async(req,res,next)=>{try{const model=resources[req.params.resource];if(!model)return res.status(404).json({error:'Unknown resource'});const found=await prisma[model].findFirst({where:{AND:[{id:req.params.id},scope(model,req.user,'write')]}});if(!found)return res.status(404).json({error:'Record not found'});if(req.user.role==='STUDENT')return res.status(403).json({error:'Students cannot change academic records'});res.json(await prisma[model].update({where:{id:found.id},data:req.body}));}catch(e){next(e)}});
app.delete('/api/:resource/:id',mustLogin,allow('ADMIN'),async(req,res,next)=>{try{const model=resources[req.params.resource];if(!model)return res.status(404).json({error:'Unknown resource'});await prisma[model].delete({where:{id:req.params.id}});res.status(204).end()}catch(e){next(e)}});
app.get('/api/admin/pending-students',mustLogin,allow('ADMIN'),async(req,res,next)=>{try{res.json(await prisma.user.findMany({where:{role:'STUDENT',status:'PENDING'},include:{student:true}}))}catch(e){next(e)}});
app.post('/api/admin/users/:id/approve',mustLogin,allow('ADMIN'),async(req,res,next)=>{try{res.json(await prisma.user.update({where:{id:req.params.id},data:{status:'ACTIVE'}}))}catch(e){next(e)}});
app.post('/api/admin/users/:id/reject',mustLogin,allow('ADMIN'),async(req,res,next)=>{try{res.json(await prisma.user.update({where:{id:req.params.id},data:{status:'REJECTED'}}))}catch(e){next(e)}});
app.use(express.static(root,{index:'index.html'}));
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||400).json({error:err.message==='Invalid credentials'?'Invalid request':'The request could not be completed.'})});
app.listen(Number(process.env.PORT||3000),()=>console.log(`TAYO Academy running on port ${process.env.PORT||3000}`));
