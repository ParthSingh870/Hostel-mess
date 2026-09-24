import { Router } from 'express';
import {
    placeOrder,
    getMyOrders,
    getAllOrders,
    updateOrderStatus,
} from '../controllers/order.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';
import { Role } from '@prisma/client';

const router = Router();

// Student routes
router.post('/', authenticate, authorize(Role.STUDENT), placeOrder);
router.get('/my', authenticate, authorize(Role.STUDENT), getMyOrders);

// Staff & Admin routes
router.get('/', authenticate, authorize(Role.STAFF, Role.ADMIN), getAllOrders);
router.patch('/:id/status', authenticate, authorize(Role.STAFF, Role.ADMIN), updateOrderStatus);

export default router;