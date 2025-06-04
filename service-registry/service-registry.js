const express = require('express');
const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const app = express();
const PORT = process.env.PORT || 8500;

app.use(express.json());

// Connect to Redis
const redis = new Redis({
	host: process.env.REDIS_HOST || 'localhost',
	port: process.env.REDIS_PORT || 6379,
});

// Register a service
app.post('/register', async (req, res) => {
	const { name, host, port, version, healthEndpoint } = req.body;

	if (!name || !host || !port) {
		return res.status(400).json({ error: 'Missing required fields' });
	}

	const serviceId = uuidv4();
	const serviceKey = `service:${name}:${serviceId}`;

	try {
		await redis.hmset(serviceKey, {
			id: serviceId,
			name,
			host,
			port,
			version: version || '1.0.0',
			healthEndpoint: healthEndpoint || '/health',
			registeredAt: Date.now(),
			status: 'active',
		});

		// Set expiry - services must ping to stay registered
		await redis.expire(serviceKey, 30);

		res.status(201).json({
			serviceId,
			message: 'Service registered successfully',
		});
	} catch (error) {
		console.error('Registration error:', error);
		res.status(500).json({ error: 'Failed to register service' });
	}
});

// Heartbeat to keep service registration active
app.put('/heartbeat/:serviceId', async (req, res) => {
	const { serviceId } = req.params;
	const { name } = req.body;

	if (!name) {
		return res.status(400).json({ error: 'Missing service name' });
	}

	const serviceKey = `service:${name}:${serviceId}`;

	try {
		const exists = await redis.exists(serviceKey);

		if (!exists) {
			return res.status(404).json({ error: 'Service not found' });
		}

		// Update last seen timestamp and extend TTL
		await redis.hset(serviceKey, 'LastSeen', Date.now());
		await redis.expire(serviceKey, 30);

		res.json({ message: 'Heartbeat received' });
	} catch (error) {
		console.error('Heartbeat error:', error);
		res.status(500).json({ error: 'Failed to process heartbeat' });
	}
});

// Discover services by name
app.get('/discover/:name', async (req, res) => {
	const { name } = req.params;

	try {
		const serviceKeys = await redis.keys(`service:${name}:*`);

		if (!serviceKeys.length) {
			return res.status(404).json({ error: 'No services found' });
		}

		const services = [];

		for (const key of serviceKeys) {
			const service = await redis.hgetall(key);
			if (service.status === 'active') {
				services.push(service);
			}
		}

		res.json(services);
	} catch (error) {
		console.error('Discovery error:', error);
		res.status(500).json({ error: 'Failed to discover services' });
	}
});

app.listen(PORT, () => {
	console.log(`Service Registry running on port ${PORT}`);
});
