import { z } from 'zod'; // Zod library ko import kar rahe hain, jisse hum data validation aur types bana sakte hain.

export const registerSchema = z.object({ // Registration data ke liye ek validation schema bana rahe hain.
    name: z.string().min(2, 'Name must be at least 2 characters long'), // Name string hona chahiye aur kam se kam 2 characters ka hona chahiye.
    email: z.string().email('Invalid email address'), // Email string hona chahiye aur valid email format mein hona chahiye.
    password: z.string().min(6, 'Password must be at least 6 characters long'), // Password string hona chahiye aur kam se kam 6 characters ka hona chahiye.
    role: z.enum(['STUDENT', 'STAFF', 'ADMIN']).optional().default('STUDENT'), // Role sirf in 3 values mein se ho sakta hai; agar role nahi diya gaya toh STUDENT hoga.
}); // Registration schema yahan complete ho raha hai.

export const loginSchema = z.object({ // Login data ke liye ek validation schema bana rahe hain.
    email: z.string().email('Invalid email address'), // Email string hona chahiye aur valid email format mein hona chahiye.
    password: z.string().min(1, 'Password is required'), // Password string hona chahiye aur empty nahi hona chahiye.
}); // Login schema yahan complete ho raha hai.

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>; // registerSchema se automatically RegisterInput naam ka TypeScript type bana rahe hain.TypeScript ko batata hai ki RegisterInput data ka structure kya hoga.
export type LoginInput = z.infer<typeof loginSchema>; // loginSchema se automatically LoginInput naam ka TypeScript type bana rahe hain.

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// ==================== BASIC EXAMPLE ====================

// registerSchema ke according RegisterInput ka structure automatically kuch aisa hoga:
//
// type RegisterInput = {
//     name: string;
//     email: string;
//     password: string;
//     role?: 'STUDENT' | 'STAFF' | 'ADMIN';
// };
//
// Is type ka use hum registration function mein kar sakte hain:
//
// function registerUser(data: RegisterInput) {
//     console.log(data.name);
//     console.log(data.email);
// }
//
// Yahan RegisterInput TypeScript ko batata hai ki registration ke data
// mein name, email, password aur role kis type ke hone chahiye.
//
// Similarly, LoginInput ka structure automatically kuch aisa hoga:
//
// type LoginInput = {
//     email: string;
//     password: string;
// };
//
// function loginUser(data: LoginInput) {
//     console.log(data.email);
//     console.log(data.password);
// }
