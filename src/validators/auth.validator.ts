import { z } from 'zod'; 

export const registerSchema = z.object({
    name: z.string().min(2, 'Name must be at least 2 characters long'), 
    email: z.string().email('Invalid email address'), 
    password: z.string().min(6, 'Password must be at least 6 characters long'), 
    role: z.enum(['STUDENT', 'STAFF', 'ADMIN']).optional().default('STUDENT'), 
}); 
export const loginSchema = z.object({ 
    email: z.string().email('Invalid email address'), 
    password: z.string().min(1, 'Password is required'), 
}); 

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>; 
export type LoginInput = z.infer<typeof loginSchema>; 
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
