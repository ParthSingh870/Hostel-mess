import { Router } from 'express';
import { placeOrder } from '../controllers/order.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/', authenticate, placeOrder);

export default router;