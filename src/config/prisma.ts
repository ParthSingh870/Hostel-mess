// Prisma Client ko import kar rahe hain
// Ye '@prisma/client' package se aata hai, jo Prisma generate karta hai
// schema.prisma ke basis pe ye client ban jaata hai
import { PrismaClient } from '@prisma/client';

// PrismaClient ka ek NAYA instance bana rahe hain
// Ye instance database se connection banata hai
// ⚠️ IMPORTANT: Isse sirf EK BAAR banana chahiye poore project mein
// Agar har file mein naya instance banaya, toh multiple DB connections ban jayenge
// aur database ki connection limit khatam ho sakti hai (app crash)
const prisma = new PrismaClient();

// Is instance ko export kar rahe hain (default export)
// Taaki poore project mein kahin bhi ise import kar sakein:
// 
//   import prisma from './prisma.js';
//   const users = await prisma.user.findMany();
//
// Har jagah naya instance banane ki zarurat nahi — bas yahi import kar lo
export default prisma;