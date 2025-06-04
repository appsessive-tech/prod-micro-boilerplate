const express = require('express');
const mongoose = require('mongoose');
const { Kafka } = require('kafkajs');
const app = express();
const PORT = process.env.PORT || 4002;

app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/products');

// Product Schema
const productSchema = new mongoose.Schema({
	name: { type: String, required: true },
	description: String,
	price: { type: Number, required: true },
	quantity: { type: Number, required: true },
	category: String,
	isActive: { type: Boolean, default: true },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
});

const Product = mongoose.model('Product', productSchema);

// Initialize Kafka
const kafka = new Kafka({
	clientId: 'product-service',
	brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'product-service-group' });

const connectKafka = async () => {
	await producer.connect();
	await consumer.connect();
	await consumer.subscribe({ topics: ['order-payment-completed'] });

	await consumer.run({
		eachMessage: async ({ topic, partition, message }) => {
			if (topic === 'order-payment-completed') {
				const { orderId } = JSON.parse(message.value.toString());

				// Get order details from order service
				const order = await fetchAndOrderDetails(orderId);

				// Update inventory for each product
				for (const item of order.items) {
					await updateInventory(item.productId, -item.quantity);
				}

				// Notify that inventory was updated
				await producer.send({
					topic: 'inventory-updated',
					messages: [
						{
							key: orderId,
							value: JSON.stringify({
								orderId,
								status: 'updated',
							}),
						},
					],
				});
			}
		},
	});
};

// API Routes
app.get('/products', async (req, res) => {
	try {
		const { category, sort, limit = 20, page = 1 } = req.query;
		const query = { isActive: true };
		if (category) query.category = category;

		const sortOptions = {};
		if (sort === 'price-asc') sortOptions.price = 1;
		if (sort === 'price-desc') sortOptions.price = -1;
		if (sort === 'createdAt') sortOptions.createdAt = -1;

		const skip = (parseInt(page) - 1) * parseInt(limit);
		const products = await Product.find(query).sort(sortOptions).skip(skip).limit(parseInt(limit));

		const total = await Product.countDocuments(query);

		res.json({
			products,
			pagination: {
				total,
				pages: Math.ceil(total / parseInt(limit)),
				page: parseInt(page),
			},
		});
	} catch (error) {
		console.error('Error fetching products:', error);
		res.status(500).json({ error: 'Failed to fetch products' });
	}
});

app.get('/products/:id', async (req, res) => {
	try {
		const product = await Product.findById(req.params.id);
		if (!product) return res.status(404).json({ error: 'Product not found' });
		res.json(product);
	} catch (error) {
		console.error('Error fetching product:', error);
		res.status(500).json({ error: 'Failed to fetch product' });
	}
});

app.post('/products', async (req, res) => {
	try {
		const product = new Product(req.body);
		await product.save();

		// Publish product created event
		await producer.send({
			topic: 'product-created',
			messages: [
				{
					key: product._id,
					value: JSON.stringify(product),
				},
			],
		});

		res.status(201).json(product);
	} catch (error) {
		console.error('Error creating product:', error);
		res.status(500).json({ error: 'Failed to create product' });
	}
});

// Health check endpoint
app.get('/health', (req, res) => {
	res.json({ status: 'ok' });
});

// Helper functions
const updateInventory = async (productId, change) => {
	return Product.updateOne({ _id: productId }, { $inc: { inventory: change } });
};

const fetchAndOrderDetails = async (orderId) => {
	// Remote fetch from order service (simulate service discovery)
	const res = await fetch(`http://order-service:4003/orders/${orderId}`);
	return res.json();
};

// Start service and connect to Kafka
Promise.all([
	app.listen(PORT, () => {
		console.log(`Product service running on port ${PORT}`);
	}),
	connectKafka(),
]).catch(console.error);
