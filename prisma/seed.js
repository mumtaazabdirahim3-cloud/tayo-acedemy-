import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient, Role, AccountStatus } from '@prisma/client';
const prisma=new PrismaClient();
const password=process.env.ADMIN_PASSWORD;
if(!password || password==='change-this-before-seeding') throw new Error('Set a strong ADMIN_PASSWORD in .env before running the seed.');
await prisma.user.upsert({where:{username:process.env.ADMIN_USERNAME||'admin'},update:{},create:{username:process.env.ADMIN_USERNAME||'admin',passwordHash:await bcrypt.hash(password,12),role:Role.ADMIN,status:AccountStatus.ACTIVE}});
console.log('Initial administrator created or already exists.');
await prisma.$disconnect();
