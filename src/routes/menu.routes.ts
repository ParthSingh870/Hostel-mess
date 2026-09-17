import { Router } from 'express';
import {
    createItem,
    getItems,
    updateItem,
    deleteItem,
} from '../controllers/menu.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';
import { authorize } from '../middlewares/rbac.middleware.js';

const router = Router();

router.get('/', getItems);
router.post('/', authenticate, authorize('ADMIN', 'STAFF'), createItem);
router.patch('/:id', authenticate, authorize('ADMIN', 'STAFF'), updateItem);
router.delete('/:id', authenticate, authorize('ADMIN', 'STAFF'), deleteItem);

export default router;