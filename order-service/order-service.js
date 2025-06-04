const { Kafka } = require('kafkajs');

// Initialize Kafka Client
const kafka = new Kafka({
	clientId: 'order-service',
	brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'order-service-group' });

// Connect to Kafka on service startup
const connectKafka = async () => {
	await producer.connect();
	await consumer.connect();

	// Subscribe to relevant topics
	await consumer.subscribe({ topics: ['payment-processed', 'inventory-updated'] });

	// Process incoming messages
	await consumer.run({
		eachMessage: async ({ topic, partition, message }) => {
			const data = JSON.parse(message.value.toString());

			switch (topic) {
				case 'payment-processed':
					await handlePaymentProcessed(data);
					break;
				case 'inventory-updated':
					await handleInventoryUpdated(data);
					break;
			}
		},
	});
};

// When creating a new order
const createOrder = async (orderData) => {
	// Save order to database with 'pending' status
	const order = await OrderModel.create({
		...orderData,
		status: 'pending',
	});

	// Publish event for other services
	await producer.send({
		topic: 'order-created',
		messages: [
			{
				key: order.id.toString(),
				value: JSON.stringify({
					orderId: order.id,
					userId: order.userId,
					items: order.items,
					totalAmount: order.totalAmount,
					createdAt: order.createdAt,
				}),
			},
		],
	});

	return order;
};

// Handle payment processed event
const handlePaymentProcessed = async (data) => {
	const { orderId, status, transactionId } = data;

	// Update order status
	if (status === 'completed') {
		await OrderModel.updateOne(
			{ _id: orderId },
			{
				$set: {
					status: 'paid',
					paymentId: transactionId,
				},
			}
		);

		// Trigger next step in order process
		await producer.send({
			topic: 'order-payment-completed',
			messages: [
				{
					key: orderId,
					value: JSON.stringify({ orderId }),
				},
			],
		});
	} else {
		await OrderModel.updateOne({ _id: orderId }, { $set: { status: 'payment-failed' } });
	}
};

// Connect on startup
connectKafka().catch(console.error);
