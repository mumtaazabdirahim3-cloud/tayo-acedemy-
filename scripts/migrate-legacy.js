/* Import a JSON file produced by the existing Settings > Export JSON button.
   It only creates records that do not already exist, so rerunning is safe. */
import 'dotenv/config';
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
const input=process.argv[2]; if(!input) throw new Error('Usage: npm run migrate:legacy -- path/to/schoolos-backup.json');
const data=JSON.parse(await fs.readFile(input,'utf8')); const db=new PrismaClient();
const classMap=new Map(), subjectMap=new Map(), studentMap=new Map(), teacherMap=new Map();
for(const x of data.classes||[]){const v=await db.class.upsert({where:{name:x.name},update:{},create:{name:x.name,section:x.section||null,room:x.room||null}});classMap.set(x.id,v.id)}
for(const x of data.subjects||[]){const v=await db.subject.upsert({where:{code:x.code},update:{name:x.name}});subjectMap.set(x.id,v.id)}
for(const x of data.teachers||[]){const v=await db.teacher.upsert({where:{teacherNumber:x.teacherId},update:{fullName:x.name,email:x.email||null,phone:x.phone||null,address:x.address||null},create:{teacherNumber:x.teacherId,fullName:x.name,email:x.email||null,phone:x.phone||null,address:x.address||null}});teacherMap.set(x.id,v.id)}
for(const x of data.students||[]){const v=await db.student.upsert({where:{studentNumber:x.studentId},update:{fullName:x.name,classId:classMap.get(x.classId)||null,phone:x.phone||null},create:{studentNumber:x.studentId,fullName:x.name,classId:classMap.get(x.classId)||null,phone:x.phone||null,guardian:x.guardian||null,parentPhone:x.parentPhone||null,address:x.address||null,gender:x.gender||null,dob:x.dob?new Date(x.dob):null}});studentMap.set(x.id,v.id)}
for(const x of data.results||[]) await db.result.create({data:{examName:x.exam,marks:Number(x.marks),maxMarks:Number(x.maxMarks||100),date:new Date(x.date),studentId:studentMap.get(x.studentId),classId:classMap.get(x.classId),subjectId:subjectMap.get(x.subjectId)}});
for(const x of data.fees||[]) await db.fee.create({data:{term:x.term,total:Number(x.total),paid:Number(x.paid||0),lastPayment:x.lastPayment?new Date(x.lastPayment):null,note:x.note||null,studentId:studentMap.get(x.studentId)}});
console.log(`Migrated ${studentMap.size} students and ${teacherMap.size} teachers without replacing existing IDs.`); await db.$disconnect();
