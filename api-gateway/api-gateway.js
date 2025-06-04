import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import rateLimit from 'express-rate-limit';
import fetch from 'node-fetch';

const app = express();
const PORT = process.env.PORT || 3000;

// Service registry (in production, use etcd, Consul, or ZooKeeper)
const serviceRegistry = {
	auth: 'http://auth-service:4000',
	users: 'http://user-service:4001',
	products: 'http://product-service:4002',
	orders: 'http://order-service:4003',
};

// Rate limiting middleware
const limiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	max: 100, // Limit each IP to 100 requests per windowMs
	standardHeaders: true,
	legacyHeaders: false,
});

// Authentication middleware
const authenticate = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
	const authHeader = req.headers.authorization;
	if (!authHeader) {
		return res.status(401).json({ error: 'No authorization header' });
	}

	try {
		// Call auth service to validate token
		const response = await fetch(`${serviceRegistry.auth}/validate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: authHeader,
			} as any,
		});

		if (!response.ok) {
			return res.status(401).json({ error: 'Invalid token' });
		}

		const userData = await response.json();
		(req as any).user = userData;
		next();
	} catch (error) {
		console.error('Auth service error:', error);
		res.status(500).json({ error: 'Authentication service unavailable' });
	}
};

// Apply rate limiter to all requests
app.use(limiter);

// Public routes
app.use(
	'/api/auth',
	createProxyMiddleware({
		target: serviceRegistry.auth,
		changeOrigin: true,
		pathRewrite: { '^/api/auth': '' },
	})
);

// Protected routes
app.use(
	'/api/users',
	authenticate,
	createProxyMiddleware({
		target: serviceRegistry.users,
		changeOrigin: true,
		pathRewrite: { '^/api/users': '' },
	})
);

app.use(
	'/api/products',
	authenticate,
	createProxyMiddleware({
		target: serviceRegistry.products,
		changeOrigin: true,
		pathRewrite: { '^/api/products': '' },
	})
);

app.use(
	'/api/orders',
	authenticate,
	createProxyMiddleware({
		target: serviceRegistry.orders,
		changeOrigin: true,
		pathRewrite: { '^/api/orders': '' },
	})
);

app.listen(PORT, () => {
	console.log(`API Gateway running on port ${PORT}`);
});
