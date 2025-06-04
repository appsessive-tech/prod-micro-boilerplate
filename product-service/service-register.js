const registerWithRegistry = async () => {
	try {
		const response = await fetch('http://service-registry:8500/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: 'product-service',
				host: process.env.HOST || 'localhost',
				port: process.env.PORT || 4002,
				version: '1.0.0',
				healthEndpoint: '/health',
			}),
		});

		if (!response.ok) {
			throw new Error('Failed to register with service registry');
		}

		const data = await response.json();
		const serviceId = data.serviceId;

		// Start sending heartbeats
		setInterval(async () => {
			try {
				await fetch(`http://service-registry:8500/heartbeat/${serviceId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: 'product-service' }),
				});
			} catch (error) {
				console.error('Failed to send heartbeat:', error);
			}
		}, 15000); // Every 15 seconds
	} catch (error) {
		console.error('Service registration failed:', error);
		// Implement retry logic here
	}
};

// Call on startup
registerWithRegistry();
